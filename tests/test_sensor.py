"""Tests for the sensor platform."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from custom_components.roommind.const import DOMAIN
from custom_components.roommind.coordinator import EntityPlatform
from custom_components.roommind.sensor import (
    RoomMindDewPointSensor,
    RoomMindHumiditySensor,
    RoomMindModeSensor,
    RoomMindMoldRiskSensor,
    RoomMindTargetTemperatureSensor,
    RoomMindTemperatureSensor,
    async_setup_entry,
    create_room_monitor_sensors,
    create_room_sensors,
)


def _make_coordinator(rooms_data=None):
    """Build a mock coordinator with data dict."""
    coordinator = MagicMock()
    coordinator.data = {"rooms": rooms_data or {}}
    return coordinator


@pytest.mark.asyncio
async def test_setup_entry_creates_entities(hass, mock_config_entry, store):
    """Entities are created for each existing room."""
    await store.async_load()
    await store.async_save_room("room_a", {"thermostats": ["climate.trv1"]})

    coordinator = _make_coordinator()
    hass.data[DOMAIN] = {
        mock_config_entry.entry_id: coordinator,
        "store": store,
    }
    add_entities = MagicMock()

    await async_setup_entry(hass, mock_config_entry, add_entities)

    assert coordinator.register_entity_platform.call_count == 2
    assert coordinator.register_entity_platform.call_args_list[0].args == (
        EntityPlatform.SENSOR,
        add_entities,
        create_room_sensors,
        ["room_a"],
    )
    platform_m, callback_m, factory_m, rooms_m = coordinator.register_entity_platform.call_args_list[1].args
    assert platform_m is EntityPlatform.MONITOR_SENSOR
    assert callback_m is add_entities
    assert factory_m is create_room_monitor_sensors
    assert list(rooms_m) == ["room_a"]
    # 2 control sensors + 4 monitor sensors
    add_entities.assert_called_once()
    entities = add_entities.call_args[0][0]
    assert len(entities) == 6


@pytest.mark.asyncio
async def test_setup_entry_no_rooms(hass, mock_config_entry, store):
    """No entities created when store has no rooms."""
    await store.async_load()

    coordinator = _make_coordinator()
    hass.data[DOMAIN] = {
        mock_config_entry.entry_id: coordinator,
        "store": store,
    }
    add_entities = MagicMock()

    await async_setup_entry(hass, mock_config_entry, add_entities)

    assert coordinator.register_entity_platform.call_count == 2
    platform, callback, factory, area_ids = coordinator.register_entity_platform.call_args_list[0].args
    assert platform is EntityPlatform.SENSOR
    assert callback is add_entities
    assert factory is create_room_sensors
    assert list(area_ids) == []
    add_entities.assert_not_called()


@pytest.mark.asyncio
async def test_setup_entry_multiple_rooms(hass, mock_config_entry, store):
    """Entities created for each room."""
    await store.async_load()
    await store.async_save_room("room_a", {"thermostats": ["climate.trv1"]})
    await store.async_save_room("room_b", {"thermostats": ["climate.trv2"]})

    coordinator = _make_coordinator()
    hass.data[DOMAIN] = {
        mock_config_entry.entry_id: coordinator,
        "store": store,
    }
    add_entities = MagicMock()

    await async_setup_entry(hass, mock_config_entry, add_entities)

    entities = add_entities.call_args[0][0]
    assert len(entities) == 12  # 2 control + 4 monitor per room


@pytest.mark.asyncio
async def test_setup_entry_monitor_only_room_skips_control_sensors(hass, mock_config_entry, store):
    """Monitor-only rooms get only passive monitoring sensors, not target_temp or mode."""
    await store.async_load()
    await store.async_save_room("living", {"temperature_sensor": "sensor.living_t"})

    coordinator = _make_coordinator()
    hass.data[DOMAIN] = {
        mock_config_entry.entry_id: coordinator,
        "store": store,
    }
    add_entities = MagicMock()

    await async_setup_entry(hass, mock_config_entry, add_entities)

    assert coordinator.register_entity_platform.call_args_list[0].args[3] == []
    entities = add_entities.call_args[0][0]
    assert len(entities) == 4
    assert isinstance(entities[0], RoomMindTemperatureSensor)
    assert isinstance(entities[1], RoomMindHumiditySensor)
    assert isinstance(entities[2], RoomMindDewPointSensor)
    assert isinstance(entities[3], RoomMindMoldRiskSensor)


def test_monitor_sensors_values_and_dew_point():
    """Monitor sensors expose fused temp, humidity, computed dew point, and mold risk."""
    coordinator = _make_coordinator(
        {
            "living": {
                "current_temp": 22.0,
                "current_humidity": 55.0,
                "mold_risk_level": "warning",
            }
        }
    )
    temp_s, hum_s, dp_s, mold_s = create_room_monitor_sensors(coordinator, "living")
    assert temp_s.native_value == 22.0
    assert hum_s.native_value == 55.0
    assert dp_s.native_value == 12.5
    assert mold_s.native_value == "warning"

    coordinator.data["rooms"]["living"]["current_humidity"] = 0.0
    assert dp_s.native_value is None


def test_create_room_entities():
    """create_room_sensors returns target temp and mode sensors."""
    coordinator = _make_coordinator()
    entities = create_room_sensors(coordinator, "room_a")
    assert len(entities) == 2
    assert isinstance(entities[0], RoomMindTargetTemperatureSensor)
    assert isinstance(entities[1], RoomMindModeSensor)


def test_target_temp_sensor_value():
    """Target temperature sensor returns value from room data."""
    coordinator = _make_coordinator({"room_a": {"target_temp": 21.5}})
    sensor = RoomMindTargetTemperatureSensor(coordinator, "room_a")
    assert sensor.native_value == 21.5


def test_target_temp_sensor_missing_room():
    """Target temperature sensor returns None when room is missing."""
    coordinator = _make_coordinator({})
    sensor = RoomMindTargetTemperatureSensor(coordinator, "room_a")
    assert sensor.native_value is None


def test_target_temp_sensor_missing_key():
    """Target temperature sensor returns None when key is missing."""
    coordinator = _make_coordinator({"room_a": {"mode": "idle"}})
    sensor = RoomMindTargetTemperatureSensor(coordinator, "room_a")
    assert sensor.native_value is None


def test_mode_sensor_value():
    """Mode sensor returns value from room data."""
    coordinator = _make_coordinator({"room_a": {"mode": "heating"}})
    sensor = RoomMindModeSensor(coordinator, "room_a")
    assert sensor.native_value == "heating"


def test_mode_sensor_missing_feedback_stays_unknown():
    """Missing feedback cannot establish physical idle."""
    coordinator = _make_coordinator({"room_a": {"target_temp": 21.0}})
    sensor = RoomMindModeSensor(coordinator, "room_a")
    assert sensor.native_value is None


def test_mode_sensor_missing_room():
    """Mode sensor remains unknown when room is missing."""
    coordinator = _make_coordinator({})
    sensor = RoomMindModeSensor(coordinator, "room_a")
    assert sensor.native_value is None


def test_sensor_unique_id():
    """Sensors have correct unique_id format."""
    coordinator = _make_coordinator()
    temp_sensor = RoomMindTargetTemperatureSensor(coordinator, "room_a")
    mode_sensor = RoomMindModeSensor(coordinator, "room_a")
    assert temp_sensor.unique_id == f"{DOMAIN}_room_a_target_temp"
    assert mode_sensor.unique_id == f"{DOMAIN}_room_a_mode"
    assert temp_sensor._attr_translation_key == "target_temperature"
    assert mode_sensor._attr_translation_key == "mode"


def test_sensor_entity_id():
    """Sensors have correct entity_id format."""
    coordinator = _make_coordinator()
    temp_sensor = RoomMindTargetTemperatureSensor(coordinator, "room_a")
    mode_sensor = RoomMindModeSensor(coordinator, "room_a")
    assert temp_sensor.entity_id == f"sensor.{DOMAIN}_room_a_target_temp"
    assert mode_sensor.entity_id == f"sensor.{DOMAIN}_room_a_mode"
