"""Best-effort control of configured fan and climate airflow devices."""

from __future__ import annotations

import inspect
import logging
from typing import Any

from homeassistant.core import HomeAssistant

from ..const import MODE_IDLE, make_roommind_context
from .environmental_factor_manager import AIRFLOW_ROLE_HVAC_FAN, AIRFLOW_ROLE_VENTILATION, _fan_mode_to_q

_LOGGER = logging.getLogger(__name__)


class AirflowControlManager:
    """Apply MPC-selected airflow levels through HA fan/climate services."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._last_commands: dict[tuple[str, str], tuple[tuple[str, Any], ...]] = {}

    async def async_apply(
        self,
        area_id: str,
        room: dict,
        *,
        mode: str,
        level: float | None = None,
        mix_level: float | None = None,
        vent_level: float | None = None,
    ) -> None:
        """Apply normalized role-specific airflow levels to configured devices."""
        legacy_target = _clamp_level(level) if level is not None else None
        mix_target = _clamp_level(mix_level if mix_level is not None else (legacy_target or 0.0))
        vent_target = _clamp_level(vent_level if vent_level is not None else (legacy_target or 0.0))
        for config in room.get("airflow_devices", []) or []:
            if not config.get("controllable", False) or not config.get("control_enabled", False):
                continue
            entity_id = config.get("entity_id", "")
            if not entity_id:
                continue
            role = config.get("role", "")
            target = vent_target if role == AIRFLOW_ROLE_VENTILATION else mix_target
            domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
            try:
                if domain == "fan":
                    await self._apply_fan(area_id, entity_id, config, target)
                elif domain == "climate":
                    await self._apply_climate(area_id, entity_id, config, target, mode)
            except Exception:  # noqa: BLE001
                _LOGGER.warning("Room '%s': airflow command failed for '%s'", area_id, entity_id, exc_info=True)

    async def _apply_fan(self, area_id: str, entity_id: str, config: dict, level: float) -> None:
        if level <= 0.0:
            await self._call(area_id, "fan", "turn_off", {"entity_id": entity_id})
            return

        await self._call(
            area_id,
            "fan",
            "turn_on",
            {"entity_id": entity_id, "percentage": max(1, min(100, round(level * 100)))},
        )
        direction = config.get("preferred_direction")
        if direction:
            await self._call(area_id, "fan", "set_direction", {"entity_id": entity_id, "direction": direction})
        if config.get("preferred_oscillating") is not None:
            await self._call(
                area_id,
                "fan",
                "oscillate",
                {"entity_id": entity_id, "oscillating": bool(config.get("preferred_oscillating"))},
            )
        preset_mode = config.get("preferred_preset_mode")
        if preset_mode:
            await self._call(area_id, "fan", "set_preset_mode", {"entity_id": entity_id, "preset_mode": preset_mode})

    async def _apply_climate(self, area_id: str, entity_id: str, config: dict, level: float, mode: str) -> None:
        state = self.hass.states.get(entity_id)
        attrs = state.attributes if state else {}
        fan_modes = [str(item) for item in attrs.get("fan_modes") or []]
        hvac_modes = [str(item) for item in attrs.get("hvac_modes") or []]

        role = config.get("role", "")
        if (
            level > 0.0
            and mode == MODE_IDLE
            and role == AIRFLOW_ROLE_HVAC_FAN
            and "fan_only" in hvac_modes
            and state
            and state.state != "fan_only"
        ):
            await self._call(
                area_id,
                "climate",
                "set_hvac_mode",
                {"entity_id": entity_id, "hvac_mode": "fan_only"},
            )

        fan_mode = self._nearest_fan_mode(level, fan_modes)
        if fan_mode:
            await self._call(area_id, "climate", "set_fan_mode", {"entity_id": entity_id, "fan_mode": fan_mode})

        swing_mode = config.get("preferred_swing_mode")
        if swing_mode and (not attrs.get("swing_modes") or swing_mode in attrs.get("swing_modes", [])):
            await self._call(
                area_id,
                "climate",
                "set_swing_mode",
                {"entity_id": entity_id, "swing_mode": swing_mode},
            )

        swing_horizontal = config.get("preferred_swing_horizontal_mode")
        if swing_horizontal and (
            not attrs.get("swing_horizontal_modes") or swing_horizontal in attrs.get("swing_horizontal_modes", [])
        ):
            await self._call(
                area_id,
                "climate",
                "set_swing_horizontal_mode",
                {"entity_id": entity_id, "swing_horizontal_mode": swing_horizontal},
            )

    def _nearest_fan_mode(self, level: float, fan_modes: list[str]) -> str | None:
        if not fan_modes:
            return None
        if level <= 0.0:
            return "off" if "off" in fan_modes else None
        active = [mode for mode in fan_modes if mode.lower() != "off"]
        if not active:
            return None
        return min(active, key=lambda mode: abs(_fan_mode_to_q(mode, fan_modes) - level))

    async def _call(self, area_id: str, domain: str, service: str, data: dict) -> None:
        entity_id = data.get("entity_id", "")
        cache_key = (entity_id, service)
        signature = tuple(sorted(data.items()))
        if self._last_commands.get(cache_key) == signature:
            return

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


def _clamp_level(level: float) -> float:
    return max(0.0, min(1.0, float(level)))
