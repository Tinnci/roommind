"""Pure airflow service command planning."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from homeassistant.components.climate import ClimateEntityFeature
from homeassistant.components.fan import FanEntityFeature

from ..const import MODE_COOLING, MODE_HEATING
from .environmental_factor_manager import AIRFLOW_ROLE_HVAC_FAN, _fan_mode_to_q

OUTCOME_APPLIED = "applied"
OUTCOME_SKIPPED_OFF_CLIMATE = "skipped_off_climate"
OUTCOME_UNSUPPORTED_FAN_ONLY = "unsupported_fan_only"
OUTCOME_BLOCKED_BY_MODE = "blocked_by_mode"

FanOnlyOwnership = Literal["add", "discard"]


@dataclass(frozen=True)
class AirflowServiceCommand:
    """A Home Assistant service call requested by an airflow plan."""

    domain: str
    service: str
    data: dict[str, Any]

    @property
    def service_name(self) -> str:
        return f"{self.domain}.{self.service}"


@dataclass(frozen=True)
class AirflowCommandPlan:
    """Planned airflow commands and status metadata."""

    outcome: str
    commands: list[AirflowServiceCommand] = field(default_factory=list)
    skip_reason: str = ""
    skipped_services: list[dict[str, str]] = field(default_factory=list)
    assumed_level: float | None = None
    fan_only_ownership: FanOnlyOwnership | None = None


def plan_fan_airflow(
    *,
    entity_id: str,
    config: dict[str, Any],
    attrs: dict[str, Any],
    level: float,
) -> AirflowCommandPlan:
    """Plan service calls for a fan entity."""
    if level <= 0.0:
        return AirflowCommandPlan(
            OUTCOME_APPLIED,
            [AirflowServiceCommand("fan", "turn_off", {"entity_id": entity_id})],
            assumed_level=0.0,
        )

    commands = [
        AirflowServiceCommand(
            "fan",
            "turn_on",
            {"entity_id": entity_id, "percentage": max(1, min(100, round(level * 100)))},
        )
    ]
    skipped_services: list[dict[str, str]] = []

    direction = config.get("preferred_direction")
    if direction:
        if not supports_feature(attrs, FanEntityFeature.DIRECTION):
            skipped_services.append({"service": "fan.set_direction", "reason": "direction_unsupported"})
        else:
            commands.append(
                AirflowServiceCommand("fan", "set_direction", {"entity_id": entity_id, "direction": direction})
            )

    if config.get("preferred_oscillating") is not None:
        if not supports_feature(attrs, FanEntityFeature.OSCILLATE):
            skipped_services.append({"service": "fan.oscillate", "reason": "oscillate_unsupported"})
        else:
            commands.append(
                AirflowServiceCommand(
                    "fan",
                    "oscillate",
                    {"entity_id": entity_id, "oscillating": bool(config.get("preferred_oscillating"))},
                )
            )

    preset_mode = config.get("preferred_preset_mode")
    if preset_mode:
        preset_modes = [str(item) for item in attrs.get("preset_modes") or []]
        if not supports_feature(attrs, FanEntityFeature.PRESET_MODE) or (
            preset_modes and preset_mode not in preset_modes
        ):
            skipped_services.append({"service": "fan.set_preset_mode", "reason": "preset_unsupported"})
        else:
            commands.append(
                AirflowServiceCommand("fan", "set_preset_mode", {"entity_id": entity_id, "preset_mode": preset_mode})
            )

    return AirflowCommandPlan(
        OUTCOME_APPLIED,
        commands,
        skipped_services=skipped_services,
        assumed_level=level,
    )


def plan_climate_airflow(
    *,
    entity_id: str,
    config: dict[str, Any],
    attrs: dict[str, Any],
    current_hvac_mode: str,
    level: float,
    mode: str,
    roommind_fan_only_owned: bool,
    night_active: bool = False,
) -> AirflowCommandPlan:
    """Plan service calls for a climate airflow entity."""
    fan_modes = [str(item) for item in attrs.get("fan_modes") or []]
    preset_modes = [str(item) for item in attrs.get("preset_modes") or []]
    hvac_modes = [str(item) for item in attrs.get("hvac_modes") or []]
    active_thermal_mode = mode in (MODE_HEATING, MODE_COOLING)

    if level <= 0.0:
        return _plan_climate_zero_level(
            entity_id=entity_id,
            fan_modes=fan_modes,
            current_hvac_mode=current_hvac_mode,
            active_thermal_mode=active_thermal_mode,
            roommind_fan_only_owned=roommind_fan_only_owned,
        )

    commands: list[AirflowServiceCommand] = []
    fan_only_ownership: FanOnlyOwnership | None = None
    role = config.get("role", "")

    if not active_thermal_mode:
        if role == AIRFLOW_ROLE_HVAC_FAN and "fan_only" in hvac_modes:
            if current_hvac_mode != "fan_only":
                commands.append(
                    AirflowServiceCommand(
                        "climate",
                        "set_hvac_mode",
                        {"entity_id": entity_id, "hvac_mode": "fan_only"},
                    )
                )
            fan_only_ownership = "add"
        elif role == AIRFLOW_ROLE_HVAC_FAN:
            return AirflowCommandPlan(OUTCOME_UNSUPPORTED_FAN_ONLY, skip_reason="fan_only_not_supported")
        elif current_hvac_mode == "off":
            return AirflowCommandPlan(OUTCOME_SKIPPED_OFF_CLIMATE, skip_reason="climate_off")
        else:
            return AirflowCommandPlan(
                OUTCOME_BLOCKED_BY_MODE,
                skip_reason="idle_climate_airflow_requires_fan_only",
            )
    elif current_hvac_mode == "off":
        return AirflowCommandPlan(OUTCOME_SKIPPED_OFF_CLIMATE, skip_reason="climate_off")

    skipped_services: list[dict[str, str]] = []
    fan_mode = nearest_fan_mode(level, fan_modes)
    if fan_mode:
        if not supports_feature(attrs, ClimateEntityFeature.FAN_MODE):
            skipped_services.append({"service": "climate.set_fan_mode", "reason": "fan_mode_unsupported"})
        else:
            commands.append(
                AirflowServiceCommand("climate", "set_fan_mode", {"entity_id": entity_id, "fan_mode": fan_mode})
            )

    preset_mode = select_climate_preset(config, mode, night_active=night_active)
    if preset_mode:
        if not supports_feature(attrs, ClimateEntityFeature.PRESET_MODE) or (
            preset_modes and preset_mode not in preset_modes
        ):
            skipped_services.append({"service": "climate.set_preset_mode", "reason": "preset_unsupported"})
        else:
            commands.append(
                AirflowServiceCommand(
                    "climate",
                    "set_preset_mode",
                    {"entity_id": entity_id, "preset_mode": preset_mode},
                )
            )

    swing_mode = config.get("preferred_swing_mode")
    if swing_mode and (not attrs.get("swing_modes") or swing_mode in attrs.get("swing_modes", [])):
        if not supports_feature(attrs, ClimateEntityFeature.SWING_MODE):
            skipped_services.append({"service": "climate.set_swing_mode", "reason": "swing_unsupported"})
        else:
            commands.append(
                AirflowServiceCommand("climate", "set_swing_mode", {"entity_id": entity_id, "swing_mode": swing_mode})
            )

    swing_horizontal = config.get("preferred_swing_horizontal_mode")
    if swing_horizontal and (
        not attrs.get("swing_horizontal_modes") or swing_horizontal in attrs.get("swing_horizontal_modes", [])
    ):
        if not supports_feature(attrs, ClimateEntityFeature.SWING_HORIZONTAL_MODE):
            skipped_services.append(
                {"service": "climate.set_swing_horizontal_mode", "reason": "swing_horizontal_unsupported"}
            )
        else:
            commands.append(
                AirflowServiceCommand(
                    "climate",
                    "set_swing_horizontal_mode",
                    {"entity_id": entity_id, "swing_horizontal_mode": swing_horizontal},
                )
            )

    return AirflowCommandPlan(
        OUTCOME_APPLIED,
        commands,
        skipped_services=skipped_services,
        assumed_level=level,
        fan_only_ownership=fan_only_ownership,
    )


def _plan_climate_zero_level(
    *,
    entity_id: str,
    fan_modes: list[str],
    current_hvac_mode: str,
    active_thermal_mode: bool,
    roommind_fan_only_owned: bool,
) -> AirflowCommandPlan:
    if current_hvac_mode == "fan_only":
        if roommind_fan_only_owned:
            return AirflowCommandPlan(
                OUTCOME_APPLIED,
                [
                    AirflowServiceCommand(
                        "climate",
                        "set_hvac_mode",
                        {"entity_id": entity_id, "hvac_mode": "off"},
                    )
                ],
                fan_only_ownership="discard",
            )
        return AirflowCommandPlan(OUTCOME_BLOCKED_BY_MODE, skip_reason="fan_only_not_roommind_owned")

    if active_thermal_mode and current_hvac_mode != "off" and "off" in [mode.lower() for mode in fan_modes]:
        return AirflowCommandPlan(
            OUTCOME_APPLIED,
            [AirflowServiceCommand("climate", "set_fan_mode", {"entity_id": entity_id, "fan_mode": "off"})],
        )
    return AirflowCommandPlan(OUTCOME_APPLIED)


def nearest_fan_mode(level: float, fan_modes: list[str]) -> str | None:
    """Return the fan mode nearest to the normalized airflow level."""
    if not fan_modes:
        return None
    if level <= 0.0:
        return "off" if "off" in fan_modes else None
    active = [mode for mode in fan_modes if mode.lower() != "off"]
    if not active:
        return None
    return min(active, key=lambda mode: abs(_fan_mode_to_q(mode, fan_modes) - level))


def supports_feature(attrs: dict[str, Any], feature: Any) -> bool:
    """Return whether an entity supports a Home Assistant feature bit."""
    supported = attrs.get("supported_features")
    if supported is None:
        return True
    try:
        return bool(int(supported) & int(feature))
    except (TypeError, ValueError):
        return True


def select_climate_preset(config: dict[str, Any], mode: str, *, night_active: bool = False) -> str:
    """Select the climate preset for current thermal/night context."""
    if night_active and config.get("preferred_preset_mode_night"):
        return str(config.get("preferred_preset_mode_night"))
    if mode in (MODE_HEATING, MODE_COOLING):
        return str(config.get("preferred_preset_mode_thermal") or "")
    return str(config.get("preferred_preset_mode_idle") or "")
