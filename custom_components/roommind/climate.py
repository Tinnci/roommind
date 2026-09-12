"""Climate platform for RoomMind."""

from __future__ import annotations

import math
from typing import Any

from homeassistant.components.climate import (
    ClimateEntity,
    ClimateEntityFeature,
    HVACAction,
    HVACMode,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DEFAULT_COMFORT_TEMP, DOMAIN, OVERRIDE_CUSTOM, is_override_active
from .coordinator import EntityPlatform, RoomMindCoordinator
from .utils.entity_translation import room_translation_placeholders


def create_room_climates(
    coordinator: RoomMindCoordinator,
    area_id: str,
) -> list[ClimateEntity]:
    """Create climate entities for a room."""
    return [RoomMindComfortClimate(coordinator, area_id), RoomMindOverrideClimate(coordinator, area_id)]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up RoomMind climate entities from a config entry."""
    coordinator: RoomMindCoordinator = hass.data[DOMAIN][entry.entry_id]
    store = hass.data[DOMAIN]["store"]
    rooms = store.get_rooms()
    coordinator.register_entity_platform(
        EntityPlatform.CLIMATE,
        async_add_entities,
        create_room_climates,
        rooms,
    )
    entities: list[ClimateEntity] = []
    for area_id in rooms:
        entities.extend(create_room_climates(coordinator, area_id))
    if entities:
        async_add_entities(entities)


class _RoomMindClimate(CoordinatorEntity, ClimateEntity):
    """Shared room observations and serialized comfort-policy writes."""

    _attr_has_entity_name = True
    _attr_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_target_temperature_step = 0.5
    _attr_min_temp = 5.0
    _attr_max_temp = 35.0

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str, suffix: str) -> None:
        super().__init__(coordinator)
        self._area_id = area_id
        self._attr_unique_id = f"{DOMAIN}_{area_id}_{suffix}"
        self._attr_translation_key = suffix
        self._attr_translation_placeholders = room_translation_placeholders(coordinator, area_id)
        self.entity_id = f"climate.{DOMAIN}_{area_id}_{suffix}"

    @property
    def _room(self) -> dict[str, Any]:
        store = self.coordinator.hass.data[DOMAIN]["store"]
        room: dict[str, Any] = store.get_room(self._area_id) or {}
        return room

    @property
    def _live(self) -> dict[str, Any]:
        live: dict[str, Any] = (self.coordinator.data or {}).get("rooms", {}).get(self._area_id, {})
        return live

    def _is_override_active(self) -> bool:
        """Return True if override is currently active."""
        return is_override_active(self._room)

    @property
    def target_temperature(self) -> float | None:
        """Read the Effective Target Plan, never a device's overdrive setpoint."""
        value = self._live.get("target_temp")
        return float(value) if isinstance(value, int | float) else None

    @property
    def current_temperature(self) -> float | None:
        """Return the room's current temperature from coordinator data."""
        room_data = self._live
        if "current_temp_raw" in room_data and room_data["current_temp_raw"] is None:
            return None
        val = room_data.get("current_temp")
        return float(val) if isinstance(val, (int, float)) else None

    async def async_set_temperature(self, **kwargs: Any) -> None:
        """Set override temperature."""
        hvac_mode = kwargs.get("hvac_mode")
        if hvac_mode is not None and hvac_mode not in self.hvac_modes:
            raise ServiceValidationError(f"Unsupported room comfort mode: {hvac_mode}")
        temperature = kwargs.get("temperature")
        if temperature is None:
            return
        if not isinstance(temperature, int | float) or not math.isfinite(temperature) or not 5 <= temperature <= 35:
            raise ServiceValidationError("Room comfort temperature must be between 5 and 35 °C")
        await self._async_write_override(float(temperature))

    async def _async_write_override(self, temperature: float | None) -> None:
        """Persist one policy change; only the Control Cycle actuates devices."""
        store = self.coordinator.hass.data[DOMAIN]["store"]
        await store.async_update_room(
            self._area_id,
            {
                "override_temp": temperature,
                "override_until": None,
                "override_type": OVERRIDE_CUSTOM if temperature is not None else None,
            },
        )
        await self.coordinator.async_request_refresh()


class RoomMindComfortClimate(_RoomMindClimate):
    """Room comfort endpoint with explicit schedule and hold presets.

    AUTO describes RoomMind's regulation policy. Physical power controls remain
    on device entities; suspending RoomMind uses the existing control switch.
    """

    _attr_icon = "mdi:home-thermometer"
    _attr_hvac_modes = [HVACMode.AUTO]
    _attr_hvac_mode = HVACMode.AUTO
    _attr_preset_modes = ["schedule", "hold"]
    _attr_supported_features = ClimateEntityFeature.TARGET_TEMPERATURE | ClimateEntityFeature.PRESET_MODE

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator, area_id, "comfort")

    @property
    def available(self) -> bool:
        """Offer comfort control only while this indoor room can be managed."""
        room = self._room
        settings = self.coordinator.hass.data[DOMAIN]["store"].get_settings()
        return bool(
            super().available
            and self._live
            and not room.get("is_outdoor", False)
            and (room.get("devices") or room.get("thermostats") or room.get("acs"))
            and room.get("climate_control_enabled", True)
            and settings.get("climate_control_active", True)
        )

    @property
    def hvac_action(self) -> HVACAction | None:
        """Device acceptance or a confirmed setpoint does not prove heat flow."""
        live = self._live
        if live.get("observation_status") != "observed":
            return None
        mode = live.get("observed_mode")
        if not isinstance(mode, str):
            return None
        return {
            "heating": HVACAction.HEATING,
            "cooling": HVACAction.COOLING,
            "idle": HVACAction.IDLE,
            "fan_only": HVACAction.FAN,
        }.get(mode)

    @property
    def preset_mode(self) -> str:
        return "hold" if self._is_override_active() else "schedule"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose comfort policy and evidence without relabeling device settings."""
        live = self._live
        room = self._room
        return {
            "heat_target": live.get("heat_target"),
            "cool_target": live.get("cool_target"),
            "target_temperature_unit": UnitOfTemperature.CELSIUS,
            "control_target": live.get("effective_control_target"),
            "perceived_temperature": live.get("perceived_temp") if self.current_temperature is not None else None,
            "override_active": is_override_active(room),
            "override_temperature": room.get("override_temp"),
            "override_until": room.get("override_until"),
            "override_suppressed": live.get("override_suppressed", False),
            "observation_status": live.get("observation_status", "unknown"),
            "dispatch_status": live.get("dispatch_status", "unknown"),
        }

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        if preset_mode == "schedule":
            await self._async_write_override(None)
        elif preset_mode == "hold":
            if self._is_override_active():
                return
            target = self.target_temperature
            if target is None:
                raise ServiceValidationError("Wait for a room comfort target before selecting Hold")
            await self._async_write_override(target)
        else:
            raise ServiceValidationError(f"Unsupported room comfort preset: {preset_mode}")

    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        if hvac_mode != HVACMode.AUTO:
            raise ServiceValidationError("Room comfort uses automatic regulation; use device controls for power")


class RoomMindOverrideClimate(_RoomMindClimate):
    """Compatibility endpoint: OFF still means cancel the temporary override."""

    _attr_icon = "mdi:thermometer-alert"
    _attr_entity_registry_enabled_default = False
    _attr_hvac_modes = [HVACMode.OFF, HVACMode.AUTO]
    _attr_supported_features = (
        ClimateEntityFeature.TARGET_TEMPERATURE | ClimateEntityFeature.TURN_ON | ClimateEntityFeature.TURN_OFF
    )

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator, area_id, "override")

    @property
    def hvac_mode(self) -> HVACMode:
        return HVACMode.AUTO if self._is_override_active() else HVACMode.OFF

    @property
    def target_temperature(self) -> float:
        if self._is_override_active():
            value = self._room.get("override_temp")
            if isinstance(value, int | float):
                return float(value)
        target = super().target_temperature
        return target if target is not None else DEFAULT_COMFORT_TEMP

    @property
    def extra_state_attributes(self) -> dict[str, str]:
        return {"control_scope": "temporary_override", "off_behavior": "resume_schedule"}

    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        """Set HVAC mode: OFF clears override, AUTO activates."""
        store = self.coordinator.hass.data[DOMAIN]["store"]
        if hvac_mode == HVACMode.OFF:
            await store.async_update_room(
                self._area_id,
                {
                    "override_temp": None,
                    "override_until": None,
                    "override_type": None,
                },
            )
        elif hvac_mode == HVACMode.AUTO:
            if not self._is_override_active():
                await store.async_update_room(
                    self._area_id,
                    {
                        "override_temp": self.target_temperature,
                        "override_until": None,
                        "override_type": OVERRIDE_CUSTOM,
                    },
                )
        await self.coordinator.async_request_refresh()
