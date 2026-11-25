"""Four-regime inverter AC controller and dynamic fan-speed selector."""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Any, Literal

from ..const import MODE_COOLING, MODE_HEATING, MODE_IDLE, TargetTemps

InverterRegime = Literal["off", "recovery", "approach", "cruise", "coast"]


@dataclass(frozen=True, slots=True)
class InverterRegimeDecision:
    """Resolved inverter operating regime and coupled fan-speed target."""

    regime: InverterRegime
    active: bool
    mode: str
    power_fraction: float
    recommended_fan_level: float
    reason: str
    in_min_hold: bool = False

    def as_dict(self) -> dict[str, Any]:
        """Serialize regime decision for live WebSocket and sensor payloads."""
        return {
            "regime": self.regime,
            "active": self.active,
            "mode": self.mode,
            "power_fraction": round(self.power_fraction, 2),
            "recommended_fan_level": round(self.recommended_fan_level, 2),
            "reason": self.reason,
            "in_min_hold": self.in_min_hold,
        }


@dataclass(slots=True)
class _RegimeState:
    regime: InverterRegime = "off"
    mode: str = MODE_IDLE
    entered_at: float = 0.0
    active_since: float | None = None
    coast_since: float | None = None
    overshoot_since: float | None = None


class InverterRegimeManager:
    """Coordinate 4-regime inverter modulation (`recovery`, `approach`, `cruise`, `coast`)."""

    MIN_RUN_SECONDS = 300.0
    MIN_OFF_SECONDS = 300.0
    RECOVERY_ENTER_ERR_C = 1.2
    RECOVERY_EXIT_ERR_C = 0.9
    APPROACH_ENTER_ERR_C = 0.4
    APPROACH_EXIT_ERR_C = 0.25
    RESTART_ERR_C = 0.2
    CRUISE_FLOOR_ERR_C = -0.35
    SUSTAINED_FLOOR_ERR_C = -0.20
    SUSTAINED_FLOOR_SECONDS = 180.0
    HARD_OVERSHOOT_ERR_C = -0.7
    RESTART_BYPASS_ERR_C = 0.8

    def __init__(self) -> None:
        self._states: dict[str, _RegimeState] = {}

    def reset_room(self, area_id: str) -> None:
        """Clear runtime regime state for a removed/reset room."""
        self._states.pop(area_id, None)

    def get_regime(self, area_id: str) -> InverterRegime:
        """Return the last recorded regime name for *area_id*."""
        return self._states.get(area_id, _RegimeState()).regime

    def evaluate(
        self,
        area_id: str,
        *,
        mode: str,
        power_fraction: float,
        can_heat: bool,
        can_cool: bool,
        current_temp: float | None,
        targets: TargetTemps,
        previous_mode: str,
        has_ac: bool,
        has_external_sensor: bool,
        window_open: bool,
        force_off: bool,
        rapid_recovery_active: bool = False,
        hold_cruise: bool = True,
        now_ts: float | None = None,
    ) -> InverterRegimeDecision:
        """Classify inverter thermal regime with hysteresis and anti-short-cycle guards."""
        now = time.monotonic() if now_ts is None else float(now_ts)
        prev = self._states.get(area_id, _RegimeState(entered_at=now))

        if (
            not has_ac
            or not has_external_sensor
            or current_temp is None
            or not math.isfinite(current_temp)
            or window_open
            or force_off
            or (not can_heat and not can_cool)
        ):
            self._states[area_id] = _RegimeState(regime="off", mode=MODE_IDLE, entered_at=now)
            return InverterRegimeDecision(
                regime="off",
                active=False,
                mode=mode,
                power_fraction=power_fraction if mode != MODE_IDLE else 0.0,
                recommended_fan_level=0.0,
                reason="inactive",
            )

        active_dir = self._resolve_direction(
            mode=mode,
            previous_mode=previous_mode,
            prev_state=prev,
            can_heat=can_heat,
            can_cool=can_cool,
            current_temp=current_temp,
            targets=targets,
        )
        if active_dir is None:
            self._states[area_id] = _RegimeState(regime="off", mode=MODE_IDLE, entered_at=now)
            return InverterRegimeDecision(
                regime="off",
                active=False,
                mode=MODE_IDLE,
                power_fraction=0.0,
                recommended_fan_level=0.0,
                reason="within_deadband",
            )

        is_heating = active_dir == MODE_HEATING
        target = targets.heat if is_heating else targets.cool
        if target is None:
            self._states[area_id] = _RegimeState(regime="off", mode=MODE_IDLE, entered_at=now)
            return InverterRegimeDecision(
                regime="off",
                active=False,
                mode=MODE_IDLE,
                power_fraction=0.0,
                recommended_fan_level=0.0,
                reason="missing_target",
            )

        err = (target - current_temp) if is_heating else (current_temp - target)
        was_active = prev.regime in ("recovery", "approach", "cruise") and prev.mode == active_dir
        controller_active = mode == active_dir

        if not was_active and not controller_active:
            in_min_off = (
                prev.regime == "coast"
                and prev.coast_since is not None
                and (now - prev.coast_since) < self.MIN_OFF_SECONDS
            )
            if in_min_off and err < self.RESTART_BYPASS_ERR_C:
                self._states[area_id] = prev
                return InverterRegimeDecision(
                    regime="coast",
                    active=False,
                    mode=MODE_IDLE,
                    power_fraction=0.0,
                    recommended_fan_level=0.0,
                    reason="min_off_hold",
                    in_min_hold=True,
                )
            if err > self.RESTART_ERR_C:
                return self._enter_active(area_id, err, active_dir, rapid_recovery_active, now, power_fraction)
            if prev.regime == "coast":
                return InverterRegimeDecision(
                    regime="coast",
                    active=False,
                    mode=MODE_IDLE,
                    power_fraction=0.0,
                    recommended_fan_level=0.0,
                    reason="coast_idle",
                )
            self._states[area_id] = _RegimeState(regime="off", mode=MODE_IDLE, entered_at=now)
            return InverterRegimeDecision(
                regime="off",
                active=False,
                mode=MODE_IDLE,
                power_fraction=0.0,
                recommended_fan_level=0.0,
                reason="idle",
            )

        if not was_active and controller_active:
            # Controller explicitly wants active heating/cooling, honor min-off guard after coast.
            in_min_off = (
                prev.regime == "coast"
                and prev.coast_since is not None
                and (now - prev.coast_since) < self.MIN_OFF_SECONDS
                and err < self.RESTART_BYPASS_ERR_C
            )
            if in_min_off and not rapid_recovery_active:
                self._states[area_id] = prev
                return InverterRegimeDecision(
                    regime="coast",
                    active=False,
                    mode=MODE_IDLE,
                    power_fraction=0.0,
                    recommended_fan_level=0.0,
                    reason="min_off_hold",
                    in_min_hold=True,
                )
            return self._enter_active(area_id, err, active_dir, rapid_recovery_active, now, power_fraction)

        # Already active (recovery / approach / cruise)
        active_since = prev.active_since if prev.active_since is not None else now
        overshoot_since = prev.overshoot_since
        if err <= self.SUSTAINED_FLOOR_ERR_C:
            if overshoot_since is None:
                overshoot_since = now
        else:
            overshoot_since = None

        wants_coast = err <= self.CRUISE_FLOOR_ERR_C or (
            overshoot_since is not None and (now - overshoot_since) >= self.SUSTAINED_FLOOR_SECONDS
        )
        hard_overshoot = err <= self.HARD_OVERSHOOT_ERR_C

        if wants_coast or (not hold_cruise and not controller_active and err <= 0.0):
            can_stop = hard_overshoot or (now - active_since) >= self.MIN_RUN_SECONDS
            if can_stop:
                self._states[area_id] = _RegimeState(
                    regime="coast",
                    mode=active_dir,
                    entered_at=now,
                    coast_since=now,
                )
                return InverterRegimeDecision(
                    regime="coast",
                    active=False,
                    mode=MODE_IDLE,
                    power_fraction=0.0,
                    recommended_fan_level=0.0,
                    reason="hard_overshoot" if hard_overshoot else "min_modulation_floor",
                )
            # Anti-short-cycle min-run guard: remain at gentle cruise until MIN_RUN_SECONDS passes.
            self._states[area_id] = _RegimeState(
                regime="cruise",
                mode=active_dir,
                entered_at=prev.entered_at,
                active_since=active_since,
                overshoot_since=overshoot_since,
            )
            return InverterRegimeDecision(
                regime="cruise",
                active=True,
                mode=active_dir,
                power_fraction=0.3,
                recommended_fan_level=0.25,
                reason="min_run_hold",
                in_min_hold=True,
            )

        if (
            rapid_recovery_active
            or err >= self.RECOVERY_ENTER_ERR_C
            or (prev.regime == "recovery" and err >= self.RECOVERY_EXIT_ERR_C)
        ):
            new_regime: InverterRegime = "recovery"
            pf = max(0.85, float(power_fraction)) if controller_active else 1.0
            fan_level = 1.0
            reason = "large_delta" if not rapid_recovery_active else "rapid_recovery"
        elif err >= self.APPROACH_ENTER_ERR_C or (prev.regime == "approach" and err >= self.APPROACH_EXIT_ERR_C):
            new_regime = "approach"
            pf = min(0.75, max(0.5, float(power_fraction))) if controller_active else 0.65
            fan_level = 0.6
            reason = "approaching_target"
        else:
            if not hold_cruise and not controller_active:
                self._states[area_id] = _RegimeState(
                    regime="coast",
                    mode=active_dir,
                    entered_at=now,
                    coast_since=now,
                )
                return InverterRegimeDecision(
                    regime="coast",
                    active=False,
                    mode=MODE_IDLE,
                    power_fraction=0.0,
                    recommended_fan_level=0.0,
                    reason="target_reached",
                )
            new_regime = "cruise"
            pf = min(0.45, max(0.25, float(power_fraction))) if controller_active else 0.3
            fan_level = 0.25
            reason = "near_setpoint_cruise"

        entered_at = prev.entered_at if prev.regime == new_regime else now
        self._states[area_id] = _RegimeState(
            regime=new_regime,
            mode=active_dir,
            entered_at=entered_at,
            active_since=active_since,
            overshoot_since=overshoot_since,
        )
        return InverterRegimeDecision(
            regime=new_regime,
            active=True,
            mode=active_dir,
            power_fraction=pf,
            recommended_fan_level=fan_level,
            reason=reason,
        )

    def _enter_active(
        self,
        area_id: str,
        err: float,
        active_dir: str,
        rapid_recovery_active: bool,
        now: float,
        power_fraction: float,
    ) -> InverterRegimeDecision:
        if rapid_recovery_active or err >= self.RECOVERY_ENTER_ERR_C:
            regime: InverterRegime = "recovery"
            pf = max(0.85, float(power_fraction)) if power_fraction > 0 else 1.0
            fan = 1.0
            reason = "rapid_recovery" if rapid_recovery_active else "large_delta"
        elif err >= self.APPROACH_ENTER_ERR_C:
            regime = "approach"
            pf = 0.65
            fan = 0.6
            reason = "approaching_target"
        else:
            regime = "cruise"
            pf = 0.3
            fan = 0.25
            reason = "near_setpoint_cruise"
        self._states[area_id] = _RegimeState(
            regime=regime,
            mode=active_dir,
            entered_at=now,
            active_since=now,
        )
        return InverterRegimeDecision(
            regime=regime,
            active=True,
            mode=active_dir,
            power_fraction=pf,
            recommended_fan_level=fan,
            reason=reason,
        )

    def _resolve_direction(
        self,
        *,
        mode: str,
        previous_mode: str,
        prev_state: _RegimeState,
        can_heat: bool,
        can_cool: bool,
        current_temp: float,
        targets: TargetTemps,
    ) -> str | None:
        if mode == MODE_HEATING and can_heat and targets.heat is not None:
            return MODE_HEATING
        if mode == MODE_COOLING and can_cool and targets.cool is not None:
            return MODE_COOLING
        if mode != MODE_IDLE:
            return None

        # Continue tracking direction for cruise/coast hysteresis even if bang-bang returned IDLE.
        prior_dir = (
            previous_mode
            if previous_mode in (MODE_HEATING, MODE_COOLING)
            else prev_state.mode
            if prev_state.regime in ("recovery", "approach", "cruise", "coast")
            else None
        )
        if prior_dir == MODE_HEATING and can_heat and targets.heat is not None:
            # Don't stick in heating if room is simultaneously above cool target when auto can cool.
            if not (can_cool and targets.cool is not None and current_temp > targets.cool + self.RESTART_ERR_C):
                return MODE_HEATING
        if prior_dir == MODE_COOLING and can_cool and targets.cool is not None:
            if not (can_heat and targets.heat is not None and current_temp < targets.heat - self.RESTART_ERR_C):
                return MODE_COOLING

        if can_heat and targets.heat is not None and targets.heat - current_temp > self.RESTART_ERR_C:
            return MODE_HEATING
        if can_cool and targets.cool is not None and current_temp - targets.cool > self.RESTART_ERR_C:
            return MODE_COOLING
        return None
