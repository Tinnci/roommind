"""Airflow environmental factors derived from HA fan and climate entities."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from homeassistant.const import STATE_OFF, STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import HomeAssistant

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


@dataclass(frozen=True, slots=True)
class AirflowFactors:
    """Room-level airflow factors consumed by sensors, EKF and MPC."""

    q_fan_mix: float = 0.0
    q_vent: float = 0.0
    active: bool = False
    levels: list[float] = field(default_factory=lambda: [0.0])
    mix_levels: list[float] = field(default_factory=lambda: [0.0])
    vent_levels: list[float] = field(default_factory=lambda: [0.0])
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
            if status.role == AIRFLOW_ROLE_VENTILATION:
                q_vent = max(q_vent, status.q)
            else:
                q_fan_mix = max(q_fan_mix, status.q)

        sorted_levels = sorted(_round_level(level) for level in levels)
        return AirflowFactors(
            q_fan_mix=_round_level(q_fan_mix),
            q_vent=_round_level(q_vent),
            active=q_fan_mix > 0.0 or q_vent > 0.0,
            levels=sorted_levels or [0.0],
            mix_levels=sorted(_round_level(level) for level in mix_levels) or [0.0],
            vent_levels=sorted(_round_level(level) for level in vent_levels) or [0.0],
            statuses=statuses,
        )

    def _read_device(self, config: dict) -> AirflowDeviceStatus:
        entity_id = config.get("entity_id", "")
        role = config.get("role", AIRFLOW_ROLE_CIRCULATION)
        if role not in AIRFLOW_ROLES:
            role = AIRFLOW_ROLE_CIRCULATION
        controllable = bool(config.get("controllable", False))
        control_enabled = bool(config.get("control_enabled", False))
        domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
        state = self.hass.states.get(entity_id) if entity_id else None

        if state is None or state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            return AirflowDeviceStatus(
                entity_id=entity_id,
                role=role,
                available=False,
                controllable=controllable,
                control_enabled=control_enabled,
                domain=domain,
            )

        if domain == "fan":
            return self._read_fan(entity_id, role, state, controllable, control_enabled)
        if domain == "climate":
            return self._read_climate(entity_id, role, state, controllable, control_enabled)

        return AirflowDeviceStatus(
            entity_id=entity_id,
            role=role,
            available=False,
            controllable=controllable,
            control_enabled=control_enabled,
            domain=domain,
        )

    def _read_fan(
        self,
        entity_id: str,
        role: str,
        state: Any,
        controllable: bool,
        control_enabled: bool,
    ) -> AirflowDeviceStatus:
        percentage = _safe_float(state.attributes.get("percentage"))
        if state.state == STATE_OFF:
            q = 0.0
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
            preset_mode=state.attributes.get("preset_mode"),
            preset_modes=[str(mode) for mode in state.attributes.get("preset_modes") or []],
            direction=state.attributes.get("current_direction"),
            oscillating=state.attributes.get("oscillating"),
            levels=_unique_levels(levels),
        )

    def _read_climate(
        self,
        entity_id: str,
        role: str,
        state: Any,
        controllable: bool,
        control_enabled: bool,
    ) -> AirflowDeviceStatus:
        fan_modes = [str(mode) for mode in state.attributes.get("fan_modes") or []]
        fan_mode = state.attributes.get("fan_mode")
        hvac_action = state.attributes.get("hvac_action")
        if state.state == STATE_OFF or hvac_action == "off":
            q = 0.0
        else:
            q = _fan_mode_to_q(fan_mode, fan_modes)
        if hvac_action == "fan" and q == 0.0 and state.state != STATE_OFF:
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
        )


def airflow_sensor_conflict(observations: list[Any]) -> float:
    """Return a normalized 0..1 measure of current temperature-channel disagreement."""
    values = [float(obs.value) for obs in observations if getattr(obs, "value", None) is not None]
    if len(values) < 2:
        return 0.0
    spread = max(values) - min(values)
    return _round_level(min(1.0, spread / 3.0))


def _levels_from_fan_modes(fan_modes: list[str]) -> list[float]:
    if not fan_modes:
        return [0.0, 1.0]
    return _unique_levels(_fan_mode_to_q(mode, fan_modes) for mode in fan_modes)


def _fan_mode_to_q(mode: Any, fan_modes: list[str] | None = None) -> float:
    if mode is None:
        return 0.0
    text = str(mode).lower()
    if text in {"off", "none", "stop", "stopped"}:
        return 0.0
    if text in {"quiet", "silent", "low", "minimum", "min"}:
        return 1.0 / 3.0
    if text in {"medium", "mid", "middle", "normal"}:
        return 2.0 / 3.0
    if text in {"high", "max", "maximum", "turbo", "boost", "strong", "on"}:
        return 1.0
    if text == "auto":
        return 0.5
    if fan_modes and mode in fan_modes:
        active_modes = [m for m in fan_modes if str(m).lower() not in {"off", "none", "stop", "stopped"}]
        if mode in active_modes and active_modes:
            return (active_modes.index(mode) + 1) / len(active_modes)
    return 1.0


def _unique_levels(levels: Any) -> list[float]:
    return sorted({_round_level(float(level)) for level in levels if _safe_float(level) is not None})


def _round_level(value: float) -> float:
    return round(max(0.0, min(1.0, float(value))), 3)


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
