"""Native Home Assistant service actions for RoomMind."""

from __future__ import annotations

import math
import time
from typing import Any

import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError

from ..const import (
    CLIMATE_MODE_COOL_ONLY,
    CLIMATE_MODES,
    DEFAULT_COMFORT_COOL,
    DEFAULT_COMFORT_HEAT,
    DEFAULT_ECO_COOL,
    DEFAULT_ECO_HEAT,
    DOMAIN,
    OVERRIDE_BOOST,
    OVERRIDE_CUSTOM,
    OVERRIDE_ECO,
    OVERRIDE_TYPES,
    VACATION_SENTINEL_UNTIL,
)

SERVICE_SET_CLIMATE_MODE = "set_climate_mode"
SERVICE_SET_OVERRIDE = "set_override"
SERVICE_CLEAR_OVERRIDE = "clear_override"
SERVICE_SET_VACATION = "set_vacation"

_ALL_SERVICES = (
    SERVICE_SET_CLIMATE_MODE,
    SERVICE_SET_OVERRIDE,
    SERVICE_CLEAR_OVERRIDE,
    SERVICE_SET_VACATION,
)

SET_CLIMATE_MODE_SCHEMA = vol.Schema(
    {
        vol.Required("area_id"): str,
        vol.Required("climate_mode"): vol.In(CLIMATE_MODES),
    }
)

SET_OVERRIDE_SCHEMA = vol.Schema(
    {
        vol.Required("area_id"): str,
        vol.Optional("override_type", default=OVERRIDE_CUSTOM): vol.In(OVERRIDE_TYPES),
        vol.Optional("temperature"): vol.All(vol.Coerce(float), vol.Range(min=5.0, max=35.0)),
        vol.Optional("duration_hours"): vol.All(vol.Coerce(float), vol.Range(min=0.0, max=168.0)),
    }
)

CLEAR_OVERRIDE_SCHEMA = vol.Schema(
    {
        vol.Required("area_id"): str,
    }
)

SET_VACATION_SCHEMA = vol.Schema(
    {
        vol.Required("enabled"): bool,
        vol.Optional("temperature"): vol.All(vol.Coerce(float), vol.Range(min=5.0, max=30.0)),
        vol.Optional("duration_hours"): vol.All(vol.Coerce(float), vol.Range(min=0.0, max=8760.0)),
    }
)


def resolve_override_temperature(
    room: dict[str, Any],
    override_type: str,
    temperature: float | None = None,
) -> float:
    """Resolve the target temperature in Celsius for a preset or custom override."""
    climate_mode = room.get("climate_mode", "auto")
    if override_type == OVERRIDE_BOOST:
        if climate_mode == CLIMATE_MODE_COOL_ONLY:
            return float(room.get("comfort_cool", DEFAULT_COMFORT_COOL))
        return float(room.get("comfort_heat", room.get("comfort_temp", DEFAULT_COMFORT_HEAT)))
    if override_type == OVERRIDE_ECO:
        if climate_mode == CLIMATE_MODE_COOL_ONLY:
            return float(room.get("eco_cool", DEFAULT_ECO_COOL))
        return float(room.get("eco_heat", room.get("eco_temp", DEFAULT_ECO_HEAT)))
    if temperature is None or not isinstance(temperature, int | float) or not math.isfinite(float(temperature)):
        raise ValueError("Custom override requires temperature")
    return float(temperature)


async def async_register_services(hass: HomeAssistant) -> None:
    """Register native Home Assistant service actions for RoomMind."""
    services = getattr(hass, "services", None)
    if services is None or not callable(getattr(services, "async_register", None)):
        return

    async def _handle_set_climate_mode(call: ServiceCall) -> None:
        store = hass.data.get(DOMAIN, {}).get("store")
        coordinator = hass.data.get(DOMAIN, {}).get("coordinator")
        if store is None:
            raise ServiceValidationError("RoomMind is not initialized")
        area_id = call.data["area_id"]
        if store.get_room(area_id) is None:
            raise ServiceValidationError(f"Room '{area_id}' not found")
        await store.async_update_room(area_id, {"climate_mode": call.data["climate_mode"]})
        if coordinator:
            await coordinator.async_request_refresh()

    async def _handle_set_override(call: ServiceCall) -> None:
        store = hass.data.get(DOMAIN, {}).get("store")
        coordinator = hass.data.get(DOMAIN, {}).get("coordinator")
        if store is None:
            raise ServiceValidationError("RoomMind is not initialized")
        area_id = call.data["area_id"]
        room = store.get_room(area_id)
        if room is None:
            raise ServiceValidationError(f"Room '{area_id}' not found")
        override_type = call.data.get("override_type", OVERRIDE_CUSTOM)
        try:
            override_temp = resolve_override_temperature(room, override_type, call.data.get("temperature"))
        except ValueError as err:
            raise ServiceValidationError(str(err)) from err
        duration_hours = call.data.get("duration_hours")
        override_until = (time.time() + duration_hours * 3600) if duration_hours else None
        await store.async_update_room(
            area_id,
            {
                "override_temp": override_temp,
                "override_until": override_until,
                "override_type": override_type,
            },
        )
        if coordinator:
            await coordinator.async_request_refresh()

    async def _handle_clear_override(call: ServiceCall) -> None:
        store = hass.data.get(DOMAIN, {}).get("store")
        coordinator = hass.data.get(DOMAIN, {}).get("coordinator")
        if store is None:
            raise ServiceValidationError("RoomMind is not initialized")
        area_id = call.data["area_id"]
        if store.get_room(area_id) is None:
            raise ServiceValidationError(f"Room '{area_id}' not found")
        await store.async_update_room(
            area_id,
            {
                "override_temp": None,
                "override_until": None,
                "override_type": None,
            },
        )
        if coordinator:
            await coordinator.async_request_refresh()

    async def _handle_set_vacation(call: ServiceCall) -> None:
        store = hass.data.get(DOMAIN, {}).get("store")
        coordinator = hass.data.get(DOMAIN, {}).get("coordinator")
        if store is None:
            raise ServiceValidationError("RoomMind is not initialized")
        enabled = bool(call.data["enabled"])
        changes: dict[str, Any] = {}
        if "temperature" in call.data:
            changes["vacation_temp"] = float(call.data["temperature"])
        if enabled:
            duration_hours = call.data.get("duration_hours")
            changes["vacation_until"] = (
                (time.time() + duration_hours * 3600) if duration_hours else VACATION_SENTINEL_UNTIL
            )
        else:
            changes["vacation_until"] = None
        await store.async_save_settings(changes)
        if coordinator:
            await coordinator.async_request_refresh()

    handlers = (
        (SERVICE_SET_CLIMATE_MODE, _handle_set_climate_mode, SET_CLIMATE_MODE_SCHEMA),
        (SERVICE_SET_OVERRIDE, _handle_set_override, SET_OVERRIDE_SCHEMA),
        (SERVICE_CLEAR_OVERRIDE, _handle_clear_override, CLEAR_OVERRIDE_SCHEMA),
        (SERVICE_SET_VACATION, _handle_set_vacation, SET_VACATION_SCHEMA),
    )
    has_service = getattr(services, "has_service", None)
    for name, handler, schema in handlers:
        if callable(has_service) and has_service(DOMAIN, name) is True:
            continue
        services.async_register(DOMAIN, name, handler, schema=schema)


async def async_unregister_services(hass: HomeAssistant) -> None:
    """Remove RoomMind services when no config entries remain."""
    services = getattr(hass, "services", None)
    if services is None or not callable(getattr(services, "async_remove", None)):
        return
    has_service = getattr(services, "has_service", None)
    for name in _ALL_SERVICES:
        if callable(has_service) and not has_service(DOMAIN, name):
            continue
        services.async_remove(DOMAIN, name)
