"""Tests for RoomMind select platform."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.exceptions import ServiceValidationError

from custom_components.roommind.const import CLIMATE_MODES, DOMAIN
from custom_components.roommind.coordinator import EntityPlatform
from custom_components.roommind.select import (
    RoomMindClimateModeSelect,
    async_setup_entry,
    create_room_selects,
)


@pytest.fixture
def mock_select_coordinator():
    coordinator = MagicMock()
    coordinator.async_request_refresh = AsyncMock()
    store = MagicMock()
    store.get_room.return_value = {"climate_mode": "cool_only"}
    store.async_update_room = AsyncMock()
    coordinator.hass = MagicMock()
    coordinator.hass.data = {DOMAIN: {"store": store}}
    return coordinator, store


def test_select_entity_metadata_and_option(mock_select_coordinator):
    coordinator, store = mock_select_coordinator
    select = RoomMindClimateModeSelect(coordinator, "bedroom")
    assert select.unique_id == "roommind_bedroom_climate_mode"
    assert select.entity_id == "select.roommind_bedroom_climate_mode"
    assert select.options == list(CLIMATE_MODES)
    assert select.current_option == "cool_only"

    store.get_room.return_value = None
    assert select.current_option is None


@pytest.mark.asyncio
async def test_select_option_persists_and_validates(mock_select_coordinator):
    coordinator, store = mock_select_coordinator
    select = RoomMindClimateModeSelect(coordinator, "bedroom")
    await select.async_select_option("dry")
    store.async_update_room.assert_awaited_once_with("bedroom", {"climate_mode": "dry"})
    coordinator.async_request_refresh.assert_awaited_once()

    with pytest.raises(ServiceValidationError):
        await select.async_select_option("invalid_mode")


@pytest.mark.asyncio
async def test_select_setup_entry_registers_platform():
    coordinator = MagicMock()
    coordinator.hass = MagicMock()
    store = MagicMock()
    store.get_rooms.return_value = {"living_room": {}, "bedroom": {}}

    entry = MagicMock()
    entry.entry_id = "entry1"
    hass = MagicMock()
    hass.data = {DOMAIN: {entry.entry_id: coordinator, "store": store}}
    coordinator.hass = hass

    add_entities = MagicMock()
    await async_setup_entry(hass, entry, add_entities)
    coordinator.register_entity_platform.assert_called_once_with(
        EntityPlatform.CLIMATE_MODE_SELECT,
        add_entities,
        create_room_selects,
        {"living_room": {}, "bedroom": {}},
    )
    add_entities.assert_called_once()
    assert len(add_entities.call_args[0][0]) == 2
