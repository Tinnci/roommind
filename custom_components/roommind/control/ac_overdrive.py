"""Bias-compensated, online-learned AC setpoint overdrive controller."""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Any

from .actuation import plan_active_temperature


@dataclass(frozen=True, slots=True)
class ACOverdriveState:
    """Learned AC setpoint-response parameters for one climate entity."""

    intake_bias_c: float = 0.0
    deadband_c: float = 0.5
    response_gain: float = 1.2
    integral_trim_c: float = 0.0
    last_temp_c: float | None = None
    last_ts: float | None = None
    samples: int = 0


class ACOverdriveManager:
    """Learn how an AC responds to commanded setpoints relative to room truth."""

    _BIAS_ALPHA = 0.15
    _DEFAULT_MAX_OFFSET = 6.0
    _MIN_DEADBAND = 0.2
    _MAX_DEADBAND = 3.0
    _MIN_GAIN = 0.5
    _MAX_GAIN = 3.0
    _MIN_TRIM = -1.5
    _MAX_TRIM = 3.0
    _MIN_DT_MIN = 2.0
    _MAX_DT_MIN = 20.0
    _STALL_ERROR_C = 0.3
    _STALL_PROGRESS_C_PER_H = 0.15
    _STRONG_PROGRESS_C_PER_H = 1.5
    _OVERSHOOT_ERROR_C = -0.3

    def __init__(self) -> None:
        self._states: dict[str, ACOverdriveState] = {}

    def get_state(self, entity_id: str) -> ACOverdriveState:
        """Return the learned overdrive state for *entity_id*."""
        return self._states.get(entity_id, ACOverdriveState())

    def _effective_intake_bias(
        self,
        state: ACOverdriveState,
        *,
        room_temp_c: float,
        ac_internal_temp_c: float | None,
        learned_sensor_bias_c: float | None,
    ) -> float:
        """Estimate (T_ac_internal - T_room) using live and learned priors."""
        live_diff = (
            float(ac_internal_temp_c) - float(room_temp_c)
            if ac_internal_temp_c is not None and math.isfinite(ac_internal_temp_c)
            else None
        )
        candidates: list[tuple[float, float]] = []
        if live_diff is not None:
            candidates.append((live_diff, 0.65))
        if learned_sensor_bias_c is not None and math.isfinite(learned_sensor_bias_c):
            candidates.append((float(learned_sensor_bias_c), 0.25))
        if state.samples > 0:
            candidates.append((state.intake_bias_c, 0.35))
        if not candidates:
            return 0.0
        total_w = sum(w for _, w in candidates)
        return sum(val * w for val, w in candidates) / total_w

    def plan_setpoint(
        self,
        entity_id: str,
        *,
        target_c: float,
        room_temp_c: float | None,
        ac_internal_temp_c: float | None,
        demand: float,
        heating: bool,
        limit_c: float,
        max_offset_c: float | None = None,
        learned_sensor_bias_c: float | None = None,
        regime: str | None = None,
    ) -> tuple[float, dict[str, Any]]:
        """Compute a bias-compensated, adaptive AC setpoint in Celsius."""
        if room_temp_c is None or not math.isfinite(room_temp_c):
            return target_c, {
                "entity_id": entity_id,
                "intake_bias_c": 0.0,
                "deadband_c": 0.0,
                "response_gain": 1.0,
                "integral_trim_c": 0.0,
                "drive_offset_c": 0.0,
                "commanded_setpoint_c": round(target_c, 1),
                "samples": 0,
            }

        state = self.get_state(entity_id)
        eff_demand = max(0.0, min(1.0, float(demand)))
        effective_max_offset = (
            self._DEFAULT_MAX_OFFSET if max_offset_c is None else max(0.0, float(max_offset_c))
        )

        # If max_offset_c explicitly disables offset (0), bypass overdrive cleanly.
        if effective_max_offset == 0.0:
            planned = plan_active_temperature(
                target=target_c,
                current_temp=room_temp_c,
                demand=eff_demand,
                limit=limit_c,
                heating=heating,
                direct=True,
                max_offset=0.0,
            )
            return planned, {
                "entity_id": entity_id,
                "intake_bias_c": round(state.intake_bias_c, 2),
                "deadband_c": round(state.deadband_c, 2),
                "response_gain": round(state.response_gain, 2),
                "integral_trim_c": round(state.integral_trim_c, 2),
                "drive_offset_c": 0.0,
                "commanded_setpoint_c": round(planned, 1),
                "samples": state.samples,
            }

        intake_bias = self._effective_intake_bias(
            state,
            room_temp_c=room_temp_c,
            ac_internal_temp_c=ac_internal_temp_c,
            learned_sensor_bias_c=learned_sensor_bias_c,
        )

        if heating:
            intake_comp = max(0.0, intake_bias)
            signed_err = target_c - room_temp_c
            room_err = max(0.0, signed_err)
            if regime == "cruise":
                drive = max(-0.2, min(0.5, 0.5 * signed_err))
                cap = min(limit_c, target_c + effective_max_offset)
                raw = target_c + intake_comp + drive
                planned = max(target_c - 0.5, min(cap, raw))
            elif regime == "approach":
                taper = max(0.25, min(1.0, room_err / 1.2))
                drive = max(
                    0.0,
                    taper * state.deadband_c + state.response_gain * eff_demand * room_err + 0.5 * state.integral_trim_c,
                )
                cap = min(limit_c, target_c + effective_max_offset)
                raw = target_c + intake_comp + drive
                planned = max(target_c, min(cap, raw))
            else:
                drive = max(0.0, state.deadband_c + state.response_gain * eff_demand * room_err + state.integral_trim_c)
                cap = min(limit_c, target_c + effective_max_offset)
                raw = target_c + intake_comp + drive
                planned = max(target_c, min(cap, raw))
            drive_offset = planned - target_c
        else:
            intake_comp = max(0.0, -intake_bias)
            signed_err = room_temp_c - target_c
            room_err = max(0.0, signed_err)
            if regime == "cruise":
                drive = max(-0.2, min(0.5, 0.5 * signed_err))
                cap = max(limit_c, target_c - effective_max_offset)
                raw = target_c - intake_comp - drive
                planned = min(target_c + 0.5, max(cap, raw))
            elif regime == "approach":
                taper = max(0.25, min(1.0, room_err / 1.2))
                drive = max(
                    0.0,
                    taper * state.deadband_c + state.response_gain * eff_demand * room_err + 0.5 * state.integral_trim_c,
                )
                cap = max(limit_c, target_c - effective_max_offset)
                raw = target_c - intake_comp - drive
                planned = min(target_c, max(cap, raw))
            else:
                drive = max(0.0, state.deadband_c + state.response_gain * eff_demand * room_err + state.integral_trim_c)
                cap = max(limit_c, target_c - effective_max_offset)
                raw = target_c - intake_comp - drive
                planned = min(target_c, max(cap, raw))
            drive_offset = target_c - planned

        diag = {
            "entity_id": entity_id,
            "intake_bias_c": round(intake_bias, 2),
            "deadband_c": round(state.deadband_c, 2),
            "response_gain": round(state.response_gain, 2),
            "integral_trim_c": round(state.integral_trim_c, 2),
            "drive_offset_c": round(drive_offset, 2),
            "commanded_setpoint_c": round(planned, 1),
            "samples": state.samples,
            "regime": regime,
        }
        return planned, diag

    def observe_response(
        self,
        entity_id: str,
        *,
        room_temp_c: float | None,
        target_c: float | None,
        ac_internal_temp_c: float | None,
        heating: bool,
        active: bool,
        outdoor_temp_c: float | None = None,
        alpha: float = 0.0,
        now_ts: float | None = None,
    ) -> ACOverdriveState:
        """Update online overdrive calibration from observed room thermal progress."""
        now = time.monotonic() if now_ts is None else float(now_ts)
        state = self.get_state(entity_id)

        if room_temp_c is None or not math.isfinite(room_temp_c):
            return state

        if not active or target_c is None:
            decayed_trim = state.integral_trim_c * 0.85
            if abs(decayed_trim) < 0.05:
                decayed_trim = 0.0
            updated = ACOverdriveState(
                intake_bias_c=state.intake_bias_c,
                deadband_c=state.deadband_c,
                response_gain=state.response_gain,
                integral_trim_c=decayed_trim,
                last_temp_c=room_temp_c,
                last_ts=now,
                samples=state.samples,
            )
            self._states[entity_id] = updated
            return updated

        intake_bias = state.intake_bias_c
        if ac_internal_temp_c is not None and math.isfinite(ac_internal_temp_c):
            measured_bias = float(ac_internal_temp_c) - float(room_temp_c)
            intake_bias = (
                measured_bias
                if state.samples == 0
                else (1.0 - self._BIAS_ALPHA) * intake_bias + self._BIAS_ALPHA * measured_bias
            )
            intake_bias = max(-8.0, min(8.0, intake_bias))

        deadband = state.deadband_c
        gain = state.response_gain
        trim = state.integral_trim_c
        last_temp = state.last_temp_c
        last_ts = state.last_ts
        samples = state.samples

        if last_temp is not None and last_ts is not None:
            dt_min = (now - last_ts) / 60.0
            if self._MIN_DT_MIN <= dt_min <= self._MAX_DT_MIN:
                dt_h = dt_min / 60.0
                dT_per_h = (float(room_temp_c) - last_temp) / dt_h
                loss_comp = (
                    max(0.0, alpha) * (float(room_temp_c) - float(outdoor_temp_c))
                    if outdoor_temp_c is not None and math.isfinite(outdoor_temp_c)
                    else 0.0
                )
                net_rate = dT_per_h + loss_comp
                progress = net_rate if heating else -net_rate
                err = (float(target_c) - float(room_temp_c)) if heating else (float(room_temp_c) - float(target_c))

                if err > self._STALL_ERROR_C and progress < self._STALL_PROGRESS_C_PER_H:
                    trim = min(self._MAX_TRIM, trim + 0.25)
                    deadband = min(self._MAX_DEADBAND, deadband + 0.1)
                elif err < self._OVERSHOOT_ERROR_C:
                    trim = max(self._MIN_TRIM, trim - 0.3)
                    gain = max(self._MIN_GAIN, gain - 0.05)
                elif err <= 0.15:
                    trim *= 0.7
                    if abs(trim) < 0.05:
                        trim = 0.0
                elif err > 0.5 and progress > self._STRONG_PROGRESS_C_PER_H:
                    deadband = max(self._MIN_DEADBAND, deadband - 0.05)

                last_temp = float(room_temp_c)
                last_ts = now
                samples += 1
            elif dt_min > self._MAX_DT_MIN:
                last_temp = float(room_temp_c)
                last_ts = now
        else:
            last_temp = float(room_temp_c)
            last_ts = now

        updated = ACOverdriveState(
            intake_bias_c=intake_bias,
            deadband_c=deadband,
            response_gain=gain,
            integral_trim_c=trim,
            last_temp_c=last_temp,
            last_ts=last_ts,
            samples=samples,
        )
        self._states[entity_id] = updated
        return updated

    def remove_entity(self, entity_id: str) -> None:
        """Discard learned state for an entity."""
        self._states.pop(entity_id, None)

    def to_dict(self) -> dict[str, Any]:
        """Serialize learned overdrive parameters (excluding ephemeral timestamps)."""
        return {
            entity_id: {
                "intake_bias_c": round(state.intake_bias_c, 4),
                "deadband_c": round(state.deadband_c, 4),
                "response_gain": round(state.response_gain, 4),
                "integral_trim_c": round(state.integral_trim_c, 4),
                "samples": state.samples,
            }
            for entity_id, state in self._states.items()
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> ACOverdriveManager:
        """Restore persisted overdrive parameters safely."""
        mgr = cls()
        if not isinstance(data, dict):
            return mgr
        for entity_id, raw in data.items():
            if not isinstance(entity_id, str) or not isinstance(raw, dict):
                continue
            try:
                intake_bias = max(-8.0, min(8.0, float(raw.get("intake_bias_c", 0.0))))
                deadband = max(cls._MIN_DEADBAND, min(cls._MAX_DEADBAND, float(raw.get("deadband_c", 0.5))))
                gain = max(cls._MIN_GAIN, min(cls._MAX_GAIN, float(raw.get("response_gain", 1.2))))
                trim = max(cls._MIN_TRIM, min(cls._MAX_TRIM, float(raw.get("integral_trim_c", 0.0))))
                samples = max(0, int(raw.get("samples", 0)))
            except TypeError, ValueError:
                continue
            mgr._states[entity_id] = ACOverdriveState(
                intake_bias_c=intake_bias,
                deadband_c=deadband,
                response_gain=gain,
                integral_trim_c=trim,
                samples=samples,
            )
        return mgr
