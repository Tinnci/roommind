"""Best-effort control of configured fan and climate airflow devices."""

from __future__ import annotations

import inspect
import logging
import time
from typing import Any

from homeassistant.components.climate import ClimateEntityFeature
from homeassistant.components.fan import FanEntityFeature
from homeassistant.core import HomeAssistant

from ..const import MODE_COOLING, MODE_HEATING, make_roommind_context
from ..utils.night_utils import is_quiet_hours_now
from .environmental_factor_manager import (
    AIRFLOW_ROLE_HVAC_FAN,
    AIRFLOW_ROLE_VENTILATION,
    _fan_mode_to_q,
    _fan_preset_mode_to_q,
)

_LOGGER = logging.getLogger(__name__)

OUTCOME_APPLIED = "applied"
OUTCOME_SKIPPED_OFF_CLIMATE = "skipped_off_climate"
OUTCOME_UNSUPPORTED_FAN_ONLY = "unsupported_fan_only"
OUTCOME_BLOCKED_BY_MODE = "blocked_by_mode"
OUTCOME_FAILED = "failed"


class AirflowControlManager:
    """Apply MPC-selected airflow levels through HA fan/climate services."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._last_commands: dict[tuple[str, str], tuple[tuple[str, Any], ...]] = {}
        self._roommind_fan_only: set[str] = set()
        self._assumed_commands: dict[str, dict[str, Any]] = {}

    async def async_apply(
        self,
        area_id: str,
        room: dict,
        *,
        mode: str,
        level: float | None = None,
        mix_level: float | None = None,
        vent_level: float | None = None,
    ) -> list[dict[str, Any]]:
        """Apply normalized role-specific airflow levels to configured devices."""
        legacy_target = _clamp_level(level) if level is not None else None
        mix_target = _clamp_level(mix_level if mix_level is not None else (legacy_target or 0.0))
        vent_target = _clamp_level(vent_level if vent_level is not None else (legacy_target or 0.0))
        night_active = _is_night_context(room)
        rapid_recovery = bool(room.get("_rapid_recovery_active", False))
        night_cap = room.get("max_fan_level_night")
        capped_by_night = False
        if night_active and not rapid_recovery and night_cap is not None:
            capped_mix = min(mix_target, _clamp_level(float(night_cap)))
            capped_by_night = capped_mix < mix_target
            mix_target = capped_mix
        statuses: list[dict[str, Any]] = []
        for config in room.get("airflow_devices", []) or []:
            entity_id = config.get("entity_id", "")
            if not entity_id:
                continue
            role = config.get("role", "")
            target = vent_target if role == AIRFLOW_ROLE_VENTILATION else mix_target
            domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
            status = self._base_status(entity_id, domain, role, target)
            status["night_mode_active"] = night_active
            status["night_capped"] = capped_by_night and role != AIRFLOW_ROLE_VENTILATION
            if not config.get("controllable", False) or not config.get("control_enabled", False):
                status.update({"outcome": OUTCOME_BLOCKED_BY_MODE, "skip_reason": "control_disabled"})
                statuses.append(status)
                continue
            try:
                if domain == "fan":
                    status.update(await self._apply_fan(area_id, entity_id, config, target))
                elif domain == "climate":
                    status.update(await self._apply_climate(area_id, entity_id, config, target, mode, night_active))
                else:
                    status.update({"outcome": OUTCOME_BLOCKED_BY_MODE, "skip_reason": "unsupported_domain"})
            except Exception:  # noqa: BLE001
                _LOGGER.warning("Room '%s': airflow command failed for '%s'", area_id, entity_id, exc_info=True)
                status.update({"outcome": OUTCOME_FAILED, "skip_reason": "service_error"})
            status["roommind_fan_only"] = entity_id in self._roommind_fan_only
            status.update(self._assumed_status(entity_id, target, config))
            statuses.append(status)
        return statuses

    async def _apply_fan(self, area_id: str, entity_id: str, config: dict, level: float) -> dict[str, Any]:
        last_service = None
        skipped_services: list[dict[str, str]] = []
        state = self.hass.states.get(entity_id)
        attrs = state.attributes if state else {}
        if level <= 0.0:
            if await self._call(area_id, "fan", "turn_off", {"entity_id": entity_id}):
                last_service = "fan.turn_off"
            self._record_assumed_command(entity_id, 0.0)
            return {"outcome": OUTCOME_APPLIED, "last_service": last_service, "skipped_services": skipped_services}

        if await self._call(
            area_id,
            "fan",
            "turn_on",
            {"entity_id": entity_id, "percentage": max(1, min(100, round(level * 100)))},
        ):
            last_service = "fan.turn_on"
        direction = config.get("preferred_direction")
        if direction:
            if not _supports_feature(attrs, FanEntityFeature.DIRECTION):
                skipped_services.append({"service": "fan.set_direction", "reason": "direction_unsupported"})
            elif await self._call(area_id, "fan", "set_direction", {"entity_id": entity_id, "direction": direction}):
                last_service = "fan.set_direction"
        if config.get("preferred_oscillating") is not None:
            if not _supports_feature(attrs, FanEntityFeature.OSCILLATE):
                skipped_services.append({"service": "fan.oscillate", "reason": "oscillate_unsupported"})
            elif await self._call(
                area_id,
                "fan",
                "oscillate",
                {"entity_id": entity_id, "oscillating": bool(config.get("preferred_oscillating"))},
            ):
                last_service = "fan.oscillate"
        preset_mode = config.get("preferred_preset_mode")
        if preset_mode:
            preset_modes = [str(item) for item in attrs.get("preset_modes") or []]
            if not _supports_feature(attrs, FanEntityFeature.PRESET_MODE) or (
                preset_modes and preset_mode not in preset_modes
            ):
                skipped_services.append({"service": "fan.set_preset_mode", "reason": "preset_unsupported"})
            elif await self._call(
                area_id,
                "fan",
                "set_preset_mode",
                {"entity_id": entity_id, "preset_mode": preset_mode},
            ):
                last_service = "fan.set_preset_mode"
        self._record_assumed_command(entity_id, level)
        return {"outcome": OUTCOME_APPLIED, "last_service": last_service, "skipped_services": skipped_services}

    async def _apply_climate(
        self,
        area_id: str,
        entity_id: str,
        config: dict,
        level: float,
        mode: str,
        night_active: bool = False,
    ) -> dict[str, Any]:
        state = self.hass.states.get(entity_id)
        attrs = state.attributes if state else {}
        fan_modes = [str(item) for item in attrs.get("fan_modes") or []]
        preset_modes = [str(item) for item in attrs.get("preset_modes") or []]
        hvac_modes = [str(item) for item in attrs.get("hvac_modes") or []]
        current_hvac_mode = str(state.state) if state else ""
        last_service = None
        skipped_services: list[dict[str, str]] = []

        role = config.get("role", "")
        active_thermal_mode = mode in (MODE_HEATING, MODE_COOLING)
        fan_only_started = False
        if level <= 0.0:
            return await self._apply_climate_zero_level(
                area_id,
                entity_id,
                fan_modes,
                current_hvac_mode,
                active_thermal_mode,
            )
        if not active_thermal_mode:
            if role == AIRFLOW_ROLE_HVAC_FAN and "fan_only" in hvac_modes:
                if current_hvac_mode != "fan_only":
                    if await self._call(
                        area_id,
                        "climate",
                        "set_hvac_mode",
                        {"entity_id": entity_id, "hvac_mode": "fan_only"},
                    ):
                        last_service = "climate.set_hvac_mode"
                    fan_only_started = True
                self._roommind_fan_only.add(entity_id)
            elif role == AIRFLOW_ROLE_HVAC_FAN:
                return {
                    "outcome": OUTCOME_UNSUPPORTED_FAN_ONLY,
                    "skip_reason": "fan_only_not_supported",
                    "last_service": last_service,
                }
            elif current_hvac_mode == "off":
                return {
                    "outcome": OUTCOME_SKIPPED_OFF_CLIMATE,
                    "skip_reason": "climate_off",
                    "last_service": last_service,
                }
            else:
                return {
                    "outcome": OUTCOME_BLOCKED_BY_MODE,
                    "skip_reason": "idle_climate_airflow_requires_fan_only",
                    "last_service": last_service,
                }
        elif current_hvac_mode == "off" and not fan_only_started:
            return {
                "outcome": OUTCOME_SKIPPED_OFF_CLIMATE,
                "skip_reason": "climate_off",
                "last_service": last_service,
            }

        fan_mode = self._nearest_fan_mode(level, fan_modes)
        if fan_mode:
            if not _supports_feature(attrs, ClimateEntityFeature.FAN_MODE):
                skipped_services.append({"service": "climate.set_fan_mode", "reason": "fan_mode_unsupported"})
            elif await self._call(
                area_id,
                "climate",
                "set_fan_mode",
                {"entity_id": entity_id, "fan_mode": fan_mode},
            ):
                last_service = "climate.set_fan_mode"

        preset_mode = _select_climate_preset(config, mode, night_active=night_active)
        if preset_mode:
            if not _supports_feature(attrs, ClimateEntityFeature.PRESET_MODE) or (
                preset_modes and preset_mode not in preset_modes
            ):
                skipped_services.append({"service": "climate.set_preset_mode", "reason": "preset_unsupported"})
            elif await self._call(
                area_id,
                "climate",
                "set_preset_mode",
                {"entity_id": entity_id, "preset_mode": preset_mode},
            ):
                last_service = "climate.set_preset_mode"

        swing_mode = config.get("preferred_swing_mode")
        if swing_mode and (not attrs.get("swing_modes") or swing_mode in attrs.get("swing_modes", [])):
            if not _supports_feature(attrs, ClimateEntityFeature.SWING_MODE):
                skipped_services.append({"service": "climate.set_swing_mode", "reason": "swing_unsupported"})
            elif await self._call(
                area_id,
                "climate",
                "set_swing_mode",
                {"entity_id": entity_id, "swing_mode": swing_mode},
            ):
                last_service = "climate.set_swing_mode"

        swing_horizontal = config.get("preferred_swing_horizontal_mode")
        if swing_horizontal and (
            not attrs.get("swing_horizontal_modes") or swing_horizontal in attrs.get("swing_horizontal_modes", [])
        ):
            if not _supports_feature(attrs, ClimateEntityFeature.SWING_HORIZONTAL_MODE):
                skipped_services.append(
                    {"service": "climate.set_swing_horizontal_mode", "reason": "swing_horizontal_unsupported"}
                )
            elif await self._call(
                area_id,
                "climate",
                "set_swing_horizontal_mode",
                {"entity_id": entity_id, "swing_horizontal_mode": swing_horizontal},
            ):
                last_service = "climate.set_swing_horizontal_mode"
        self._record_assumed_command(entity_id, level)
        return {"outcome": OUTCOME_APPLIED, "last_service": last_service, "skipped_services": skipped_services}

    async def _apply_climate_zero_level(
        self,
        area_id: str,
        entity_id: str,
        fan_modes: list[str],
        current_hvac_mode: str,
        active_thermal_mode: bool,
    ) -> dict[str, Any]:
        last_service = None
        if current_hvac_mode == "fan_only":
            if entity_id in self._roommind_fan_only:
                if await self._call(
                    area_id,
                    "climate",
                    "set_hvac_mode",
                    {"entity_id": entity_id, "hvac_mode": "off"},
                ):
                    last_service = "climate.set_hvac_mode"
                self._roommind_fan_only.discard(entity_id)
                return {"outcome": OUTCOME_APPLIED, "last_service": last_service}
            return {
                "outcome": OUTCOME_BLOCKED_BY_MODE,
                "skip_reason": "fan_only_not_roommind_owned",
                "last_service": last_service,
            }
        if active_thermal_mode and current_hvac_mode != "off" and "off" in [mode.lower() for mode in fan_modes]:
            if await self._call(area_id, "climate", "set_fan_mode", {"entity_id": entity_id, "fan_mode": "off"}):
                last_service = "climate.set_fan_mode"
        return {"outcome": OUTCOME_APPLIED, "last_service": last_service}

    def _nearest_fan_mode(self, level: float, fan_modes: list[str]) -> str | None:
        if not fan_modes:
            return None
        if level <= 0.0:
            return "off" if "off" in fan_modes else None
        active = [mode for mode in fan_modes if mode.lower() != "off"]
        if not active:
            return None
        return min(active, key=lambda mode: abs(_fan_mode_to_q(mode, fan_modes) - level))

    async def _call(self, area_id: str, domain: str, service: str, data: dict) -> bool:
        entity_id = data.get("entity_id", "")
        cache_key = (entity_id, service)
        signature = tuple(sorted(data.items()))
        if self._last_commands.get(cache_key) == signature:
            return False

        result = self.hass.services.async_call(
            domain,
            service,
            data,
            blocking=True,
            context=make_roommind_context(),
        )
        if inspect.isawaitable(result):
            await result
        self._last_commands[cache_key] = signature
        _LOGGER.debug("Room '%s': airflow %s.%s %s", area_id, domain, service, data)
        return True

    def _base_status(self, entity_id: str, domain: str, role: str, level: float) -> dict[str, Any]:
        state = self.hass.states.get(entity_id)
        observed_q = None
        if state is not None:
            attrs = state.attributes
            if domain == "fan":
                observed_q = _fan_observed_q(str(state.state), attrs)
            elif domain == "climate":
                observed_q = _climate_observed_q(str(state.state), attrs)
        return {
            "entity_id": entity_id,
            "domain": domain,
            "role": role,
            "planned_level": level,
            "observed_q": observed_q,
            "outcome": OUTCOME_BLOCKED_BY_MODE,
            "skip_reason": "",
            "last_service": None,
            "roommind_fan_only": entity_id in self._roommind_fan_only,
            "skipped_services": [],
        }

    def _record_assumed_command(self, entity_id: str, level: float) -> None:
        self._assumed_commands[entity_id] = {"level": _clamp_level(level), "at": time.time()}

    def _assumed_status(self, entity_id: str, target: float, config: dict) -> dict[str, Any]:
        command = self._assumed_commands.get(entity_id)
        if not command:
            return {"assumed_state_confidence": "observed", "commanded_level": None, "commanded_at": None}
        ttl_raw = config.get("assumed_state_ttl", None)
        ttl = max(0.0, float(ttl_raw if ttl_raw is not None else (config.get("assumed_state_ttl_s") or 120)))
        age = time.time() - float(command["at"])
        if age > ttl:
            confidence = "stale"
        else:
            state = self.hass.states.get(entity_id)
            observed = None
            if state is not None:
                domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
                observed = _fan_observed_q(str(state.state), state.attributes) if domain == "fan" else None
                if domain == "climate":
                    observed = _climate_observed_q(str(state.state), state.attributes)
            confidence = "observed" if observed is not None and abs(observed - target) <= 0.15 else "assumed"
        return {
            "assumed_state_confidence": confidence,
            "commanded_level": command["level"],
            "commanded_at": command["at"],
        }


def _clamp_level(level: float) -> float:
    return max(0.0, min(1.0, float(level)))


def _supports_feature(attrs: dict[str, Any], feature: Any) -> bool:
    supported = attrs.get("supported_features")
    if supported is None:
        return True
    try:
        return bool(int(supported) & int(feature))
    except (TypeError, ValueError):
        return True


def _select_climate_preset(config: dict, mode: str, *, night_active: bool = False) -> str:
    if night_active and config.get("preferred_preset_mode_night"):
        return str(config.get("preferred_preset_mode_night"))
    if mode in (MODE_HEATING, MODE_COOLING):
        return str(config.get("preferred_preset_mode_thermal") or "")
    return str(config.get("preferred_preset_mode_idle") or "")


def _is_night_context(config: dict) -> bool:
    if "_night_mode_active" in config:
        return bool(config.get("_night_mode_active"))
    return bool(config.get("night_mode_enabled", True)) and is_quiet_hours_now(config.get("quiet_hours"))


def _fan_observed_q(state: str, attrs: dict[str, Any]) -> float:
    if state == "off":
        return 0.0
    percentage = attrs.get("percentage")
    preset_mode = attrs.get("preset_mode")
    preset_modes = [str(item) for item in attrs.get("preset_modes") or []]
    if percentage is not None:
        try:
            q = _clamp_level(float(percentage) / 100.0)
        except (TypeError, ValueError):
            return 1.0
        if q > 0.0 or not preset_mode:
            return q
        return _fan_preset_mode_to_q(preset_mode, preset_modes)
    if preset_mode:
        return _fan_preset_mode_to_q(preset_mode, preset_modes)
    return 1.0


def _climate_observed_q(state: str, attrs: dict[str, Any]) -> float:
    if state == "off":
        return 0.0
    fan_modes = [str(item) for item in attrs.get("fan_modes") or []]
    fan_mode = attrs.get("fan_mode")
    if fan_mode:
        return _fan_mode_to_q(str(fan_mode), fan_modes)
    return 1.0 if state == "fan_only" else 0.0
