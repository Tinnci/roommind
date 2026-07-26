"""Airflow environmental factors derived from HA fan and climate entities."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from homeassistant.const import STATE_OFF, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .airflow_levels import fan_mode_level, fan_preset_mode_level

AIRFLOW_ROLE_CIRCULATION = "circulation"
AIRFLOW_ROLE_VENTILATION = "ventilation"
AIRFLOW_ROLE_HVAC_FAN = "hvac_fan"
AIRFLOW_ROLES = {AIRFLOW_ROLE_CIRCULATION, AIRFLOW_ROLE_VENTILATION, AIRFLOW_ROLE_HVAC_FAN}


@dataclass(frozen=True, slots=True)
class AirflowDeviceStatus:
    """Current normalized state for one configured airflow device."""

    entity_id: str
    role: str
    available: bool
    q: float = 0.0
    controllable: bool = False
    control_enabled: bool = False
    domain: str = ""
    percentage: float | None = None
    preset_mode: str | None = None
    preset_modes: list[str] = field(default_factory=list)
    direction: str | None = None
    oscillating: bool | None = None
    fan_mode: str | None = None
    fan_modes: list[str] = field(default_factory=list)
    swing_mode: str | None = None
    swing_modes: list[str] = field(default_factory=list)
    swing_horizontal_mode: str | None = None
    swing_horizontal_modes: list[str] = field(default_factory=list)
    levels: list[float] = field(default_factory=lambda: [0.0])
    effect_weight: float = 1.0
    airflow_m3h: float | None = None
    age_s: float | None = None
    freshness_source: str = "none"
    last_reported: str | None = None
    last_updated: str | None = None
    last_changed: str | None = None


@dataclass(frozen=True, slots=True)
class AirflowFactors:
    """Room-level airflow factors consumed by sensors, EKF and MPC."""

    q_fan_mix: float = 0.0
    q_vent: float = 0.0
    airflow_ach: float = 0.0
    active: bool = False
    levels: list[float] = field(default_factory=lambda: [0.0])
    mix_levels: list[float] = field(default_factory=lambda: [0.0])
    vent_levels: list[float] = field(default_factory=lambda: [0.0])
    has_hvac_fan_control: bool = False
    statuses: list[AirflowDeviceStatus] = field(default_factory=list)

    def as_status_dicts(self) -> list[dict[str, Any]]:
        """Serialize status entries for room state payloads."""
        return [
            {
                "entity_id": status.entity_id,
                "role": status.role,
                "available": status.available,
                "q": status.q,
                "controllable": status.controllable,
                "control_enabled": status.control_enabled,
                "domain": status.domain,
                "percentage": status.percentage,
                "preset_mode": status.preset_mode,
                "preset_modes": status.preset_modes,
                "direction": status.direction,
                "oscillating": status.oscillating,
                "fan_mode": status.fan_mode,
                "fan_modes": status.fan_modes,
                "swing_mode": status.swing_mode,
                "swing_modes": status.swing_modes,
                "swing_horizontal_mode": status.swing_horizontal_mode,
                "swing_horizontal_modes": status.swing_horizontal_modes,
                "levels": status.levels,
                "effect_weight": status.effect_weight,
                "airflow_m3h": status.airflow_m3h,
                "age_s": status.age_s,
                "freshness_source": status.freshness_source,
                "last_reported": status.last_reported,
                "last_updated": status.last_updated,
                "last_changed": status.last_changed,
            }
            for status in self.statuses
        ]


class EnvironmentalFactorManager:
    """Read fan/climate airflow state and expose normalized room factors."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    def read_room_airflow(self, room: dict) -> AirflowFactors:
        """Return airflow factors for configured devices in *room*."""
        statuses: list[AirflowDeviceStatus] = []
        levels = {0.0}
        mix_levels = {0.0}
        vent_levels = {0.0}
        q_fan_mix = 0.0
        q_vent = 0.0
        vent_sum = 0.0
        vent_flow_m3h = 0.0
        has_hvac_fan_control = False
        room_volume_m3 = _safe_float(room.get("room_volume_m3"))
        ach_reference = _safe_float(room.get("ach_reference")) or 3.0

        for config in room.get("airflow_devices", []) or []:
            status = self._read_device(config)
            statuses.append(status)
            if not status.available:
                continue
            if status.controllable and status.control_enabled:
                levels.update(status.levels)
                if status.role == AIRFLOW_ROLE_VENTILATION:
                    vent_levels.update(status.levels)
                else:
                    mix_levels.update(status.levels)
                    if status.role == AIRFLOW_ROLE_HVAC_FAN:
                        has_hvac_fan_control = True
            if status.role == AIRFLOW_ROLE_VENTILATION:
                weighted = _round_level(status.effect_weight * status.q)
                vent_sum += weighted
                if status.airflow_m3h is not None:
                    vent_flow_m3h += max(0.0, status.airflow_m3h) * weighted
            else:
                weighted = _round_level(status.effect_weight * status.q)
                q_fan_mix = 1.0 - (1.0 - q_fan_mix) * (1.0 - weighted)

        airflow_ach = vent_flow_m3h / room_volume_m3 if room_volume_m3 and room_volume_m3 > 0 else 0.0
        q_vent = min(1.0, airflow_ach / ach_reference) if airflow_ach > 0.0 else min(1.0, vent_sum)

        sorted_levels = sorted(_round_level(level) for level in levels)
        return AirflowFactors(
            q_fan_mix=_round_level(q_fan_mix),
            q_vent=_round_level(q_vent),
            airflow_ach=round(max(0.0, airflow_ach), 3),
            active=q_fan_mix > 0.0 or q_vent > 0.0,
            levels=sorted_levels or [0.0],
            mix_levels=sorted(_round_level(level) for level in mix_levels) or [0.0],
            vent_levels=sorted(_round_level(level) for level in vent_levels) or [0.0],
            has_hvac_fan_control=has_hvac_fan_control,
            statuses=statuses,
        )

    def _read_device(self, config: dict) -> AirflowDeviceStatus:
        entity_id = config.get("entity_id", "")
        role = config.get("role", AIRFLOW_ROLE_CIRCULATION)
        if role not in AIRFLOW_ROLES:
            role = AIRFLOW_ROLE_CIRCULATION
        controllable = bool(config.get("controllable", False))
        control_enabled = bool(config.get("control_enabled", False))
        configured_effect_weight = _safe_float(config.get("effect_weight"))
        effect_weight = max(0.0, min(2.0, configured_effect_weight if configured_effect_weight is not None else 1.0))
        airflow_m3h = _safe_float(config.get("airflow_m3h"))
        domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
        state = self.hass.states.get(entity_id) if entity_id else None
        freshness = _state_freshness(state)

        if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            return AirflowDeviceStatus(
                entity_id=entity_id,
                role=role,
                available=False,
                controllable=controllable,
                control_enabled=control_enabled,
                domain=domain,
                effect_weight=effect_weight,
                airflow_m3h=airflow_m3h,
                **freshness,
            )

        if domain == "fan":
            return self._read_fan(
                entity_id,
                role,
                state,
                controllable,
                control_enabled,
                effect_weight,
                airflow_m3h,
                freshness,
            )
        if domain == "climate":
            return self._read_climate(
                entity_id,
                role,
                state,
                controllable,
                control_enabled,
                effect_weight,
                airflow_m3h,
                freshness,
            )

        return AirflowDeviceStatus(
            entity_id=entity_id,
            role=role,
            available=False,
            controllable=controllable,
            control_enabled=control_enabled,
            domain=domain,
            effect_weight=effect_weight,
            airflow_m3h=airflow_m3h,
            **freshness,
        )

    def _read_fan(
        self,
        entity_id: str,
        role: str,
        state: Any,
        controllable: bool,
        control_enabled: bool,
        effect_weight: float,
        airflow_m3h: float | None,
        freshness: dict[str, Any],
    ) -> AirflowDeviceStatus:
        percentage = _safe_float(state.attributes.get("percentage"))
        preset_mode = state.attributes.get("preset_mode")
        preset_modes = [str(mode) for mode in state.attributes.get("preset_modes") or []]
        if state.state == STATE_OFF:
            q = 0.0
        elif percentage is not None and percentage > 0:
            q = percentage / 100.0
        elif preset_mode:
            q = fan_preset_mode_level(preset_mode, preset_modes)
        elif percentage is not None:
            q = percentage / 100.0
        else:
            q = 1.0

        speed_count = _safe_int(state.attributes.get("speed_count"))
        if speed_count and speed_count > 0:
            levels = [0.0, *[i / speed_count for i in range(1, speed_count + 1)]]
        else:
            levels = [0.0, 0.25, 0.5, 0.75, 1.0]

        return AirflowDeviceStatus(
            entity_id=entity_id,
            role=role,
            available=True,
            q=_round_level(q),
            controllable=controllable,
            control_enabled=control_enabled,
            domain="fan",
            percentage=percentage,
            preset_mode=preset_mode,
            preset_modes=preset_modes,
            direction=state.attributes.get("current_direction"),
            oscillating=state.attributes.get("oscillating"),
            levels=_unique_levels(levels),
            effect_weight=effect_weight,
            airflow_m3h=airflow_m3h,
            **freshness,
        )

    def _read_climate(
        self,
        entity_id: str,
        role: str,
        state: Any,
        controllable: bool,
        control_enabled: bool,
        effect_weight: float,
        airflow_m3h: float | None,
        freshness: dict[str, Any],
    ) -> AirflowDeviceStatus:
        fan_modes = [str(mode) for mode in state.attributes.get("fan_modes") or []]
        fan_mode = state.attributes.get("fan_mode")
        hvac_action = state.attributes.get("hvac_action")
        hvac_action_text = str(hvac_action).lower() if hvac_action is not None else None
        if state.state == STATE_OFF or hvac_action_text == "off":
            q = 0.0
        elif hvac_action_text == "idle" and state.state != "fan_only":
            q = 0.0
        else:
            q = fan_mode_level(fan_mode, fan_modes)
        if hvac_action_text == "fan" and q == 0.0 and state.state != STATE_OFF:
            q = 1.0
        levels = _levels_from_fan_modes(fan_modes)

        return AirflowDeviceStatus(
            entity_id=entity_id,
            role=role,
            available=True,
            q=_round_level(q),
            controllable=controllable,
            control_enabled=control_enabled,
            domain="climate",
            fan_mode=fan_mode,
            fan_modes=fan_modes,
            swing_mode=state.attributes.get("swing_mode"),
            swing_modes=[str(mode) for mode in state.attributes.get("swing_modes") or []],
            swing_horizontal_mode=state.attributes.get("swing_horizontal_mode"),
            swing_horizontal_modes=[str(mode) for mode in state.attributes.get("swing_horizontal_modes") or []],
            levels=levels,
            effect_weight=effect_weight,
            airflow_m3h=airflow_m3h,
            **freshness,
        )


def airflow_sensor_conflict(observations: list[Any]) -> float:
    """Return a normalized 0..1 measure of current temperature-channel disagreement."""
    values = [float(obs.value) for obs in observations if getattr(obs, "value", None) is not None]
    if len(values) < 2:
        return 0.0
    spread = max(values) - min(values)
    return _round_level(min(1.0, spread / 3.0))


def _state_freshness(state: Any | None) -> dict[str, Any]:
    """Return HA state timestamp metadata for airflow diagnostics."""
    last_reported = getattr(state, "last_reported", None)
    last_updated = getattr(state, "last_updated", None)
    last_changed = getattr(state, "last_changed", None)
    source, timestamp = _freshness_timestamp(
        last_reported=last_reported,
        last_updated=last_updated,
        last_changed=last_changed,
    )
    age_s = None
    if timestamp is not None:
        age_s = round(max(0.0, (dt_util.utcnow() - timestamp).total_seconds()), 1)
    return {
        "age_s": age_s,
        "freshness_source": source,
        "last_reported": _timestamp_iso(last_reported),
        "last_updated": _timestamp_iso(last_updated),
        "last_changed": _timestamp_iso(last_changed),
    }


def _freshness_timestamp(
    *,
    last_reported: Any,
    last_updated: Any,
    last_changed: Any,
) -> tuple[str, datetime | None]:
    for source, value in (
        ("last_reported", last_reported),
        ("last_updated", last_updated),
        ("last_changed", last_changed),
    ):
        if isinstance(value, datetime):
            return source, value
    return "none", None


def _timestamp_iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else None


def _levels_from_fan_modes(fan_modes: list[str]) -> list[float]:
    if not fan_modes:
        return [0.0, 1.0]
    return _unique_levels(fan_mode_level(mode, fan_modes) for mode in fan_modes)


def _unique_levels(levels: Any) -> list[float]:
    return sorted({_round_level(float(level)) for level in levels if _safe_float(level) is not None})


def _round_level(value: float) -> float:
    return round(max(0.0, min(1.0, float(value))), 3)


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except TypeError, ValueError:
        return None


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except TypeError, ValueError:
        return None
