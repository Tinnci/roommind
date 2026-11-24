"""Tests for native RoomMind Home Assistant service actions."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.exceptions import ServiceValidationError

from custom_components.roommind.const import DOMAIN, VACATION_SENTINEL_UNTIL
from custom_components.roommind.services.ha_services import (
    SERVICE_CLEAR_OVERRIDE,
    SERVICE_SET_CLIMATE_MODE,
    SERVICE_SET_OVERRIDE,
    SERVICE_SET_VACATION,
    async_register_services,
    async_unregister_services,
)


def _fake_services():
    registered: dict[str, object] = {}

    services = MagicMock()
    services.has_service = MagicMock(side_effect=lambda domain, name: domain == DOMAIN and name in registered)
    services.async_register = MagicMock(side_effect=lambda _d, name, fn, schema=None: registered.__setitem__(name, fn))
    services.async_remove = MagicMock(side_effect=lambda _d, name: registered.pop(name, None))
    return services, registered


@pytest.mark.asyncio
async def test_ha_services_register_execute_and_unregister():
    hass = MagicMock()
    services, registered = _fake_services()
    hass.services = services

    store = MagicMock()
    store.get_room.return_value = {
        "area_id": "living",
        "climate_mode": "cool_only",
        "comfort_cool": 24.0,
        "eco_cool": 27.0,
    }
    store.async_update_room = AsyncMock()
    store.async_save_settings = AsyncMock()
    coordinator = MagicMock()
    coordinator.async_request_refresh = AsyncMock()
    hass.data = {DOMAIN: {"store": store, "coordinator": coordinator}}

    await async_register_services(hass)
    # Second call should be idempotent
    await async_register_services(hass)
    assert set(registered) == {
        SERVICE_SET_CLIMATE_MODE,
        SERVICE_SET_OVERRIDE,
        SERVICE_CLEAR_OVERRIDE,
        SERVICE_SET_VACATION,
    }

    await registered[SERVICE_SET_CLIMATE_MODE](SimpleNamespace(data={"area_id": "living", "climate_mode": "dry"}))
    store.async_update_room.assert_awaited_with("living", {"climate_mode": "dry"})

    await registered[SERVICE_SET_OVERRIDE](
        SimpleNamespace(data={"area_id": "living", "override_type": "boost", "duration_hours": 2})
    )
    args = store.async_update_room.call_args.args
    assert args[0] == "living"
    assert args[1]["override_temp"] == 24.0
    assert args[1]["override_type"] == "boost"
    assert args[1]["override_until"] is not None

    await registered[SERVICE_CLEAR_OVERRIDE](SimpleNamespace(data={"area_id": "living"}))
    store.async_update_room.assert_awaited_with(
        "living",
        {"override_temp": None, "override_until": None, "override_type": None},
    )

    await registered[SERVICE_SET_VACATION](SimpleNamespace(data={"enabled": True, "temperature": 16.5}))
    store.async_save_settings.assert_awaited_with({"vacation_temp": 16.5, "vacation_until": VACATION_SENTINEL_UNTIL})

    await registered[SERVICE_SET_VACATION](SimpleNamespace(data={"enabled": False}))
    store.async_save_settings.assert_awaited_with({"vacation_until": None})

    # Error handling for unknown room or custom override missing temperature
    with pytest.raises(ServiceValidationError):
        await registered[SERVICE_SET_OVERRIDE](SimpleNamespace(data={"area_id": "living", "override_type": "custom"}))

    store.get_room.return_value = None
    with pytest.raises(ServiceValidationError):
        await registered[SERVICE_SET_CLIMATE_MODE](SimpleNamespace(data={"area_id": "missing", "climate_mode": "off"}))

    await async_unregister_services(hass)
    assert registered == {}
