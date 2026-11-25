"""Tests for air quality tracking (CO2, VOC, PM2.5), ventilation control, and binary sensor."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.roommind.binary_sensor import RoomMindAirQualitySensor
from custom_components.roommind.const import DEFAULT_PM25_CLEAR_THRESHOLD, DEFAULT_PM25_THRESHOLD
from custom_components.roommind.managers.air_quality_manager import (
    AirQualityTracker,
    VentilationController,
    next_air_bad,
    read_pm25_value,
)


def test_next_air_bad_co2_and_pm25_hysteresis():
    # Default 0.8 clear factor (1000 ppm -> < 800 ppm)
    assert next_air_bad(False, 999.0, 1000.0) is False
    assert next_air_bad(False, 1000.0, 1000.0) is True
    assert next_air_bad(True, 850.0, 1000.0) is True
    assert next_air_bad(True, 799.0, 1000.0) is False

    # PM2.5 custom clear hysteresis: 35.0 ug/m3 on, < 25.0 ug/m3 clear
    assert next_air_bad(False, 35.0, DEFAULT_PM25_THRESHOLD, clear_below=DEFAULT_PM25_CLEAR_THRESHOLD) is True
    assert next_air_bad(True, 26.0, DEFAULT_PM25_THRESHOLD, clear_below=DEFAULT_PM25_CLEAR_THRESHOLD) is True
    assert next_air_bad(True, 24.9, DEFAULT_PM25_THRESHOLD, clear_below=DEFAULT_PM25_CLEAR_THRESHOLD) is False


def test_read_pm25_value_averages_multiple_sensors():
    hass = MagicMock()
    states_map = {
        "sensor.pm25_a": SimpleNamespace(state="32.0", attributes={}),
        "sensor.pm25_b": SimpleNamespace(state="40.0", attributes={}),
        "sensor.pm25_bad": SimpleNamespace(state="unavailable", attributes={}),
    }
    hass.states.get.side_effect = states_map.get
    room = {"pm25_sensors": ["sensor.pm25_a", "sensor.pm25_b", "sensor.pm25_bad"]}
    assert read_pm25_value(hass, room, "living") == pytest.approx(36.0)


def test_air_quality_tracker_staleness_and_remove_room():
    tracker = AirQualityTracker()
    assert tracker.evaluate("living", "pm25", 42.0, 35.0, 1000.0, clear_below=25.0) is True
    # Reading disappears briefly -> retains bad state within staleness window
    assert tracker.evaluate("living", "pm25", None, 35.0, 1100.0, clear_below=25.0) is True
    # Reading disappears past MAX_SENSOR_STALENESS (300s) -> clears
    assert tracker.evaluate("living", "pm25", None, 35.0, 1400.0, clear_below=25.0) is False
    tracker.remove_room("living")


@pytest.mark.asyncio
async def test_ventilation_controller_on_off_and_window_block():
    hass = MagicMock()
    hass.state = MagicMock()
    st = SimpleNamespace(state="off")
    hass.states.get.side_effect = lambda _eid: st
    hass.services.async_call = AsyncMock()

    ctrl = VentilationController(hass, min_run_s=900)
    await ctrl.async_reconcile({"fan.erv": True}, now=1000.0)
    hass.services.async_call.assert_awaited_once()
    assert ctrl.is_running("fan.erv") is True

    # Simulate fan now running, still within min_run_s -> keeps running even if want=False
    st.state = "on"
    hass.services.async_call.reset_mock()
    await ctrl.async_reconcile({"fan.erv": False}, now=1200.0)
    hass.services.async_call.assert_not_awaited()
    assert ctrl.is_running("fan.erv") is True

    # Past min_run_s -> turns off
    await ctrl.async_reconcile({"fan.erv": False}, now=2000.0)
    hass.services.async_call.assert_awaited_once()
    assert ctrl.is_running("fan.erv") is False


def test_air_quality_binary_sensor_attributes_and_availability():
    coord = MagicMock()
    coord.hass = MagicMock()
    coord.hass.data = {"roommind": {"store": MagicMock(get_room=lambda _id: {"display_name": "Living Room"})}}
    coord.data = {
        "rooms": {
            "living": {
                "co2": 820.0,
                "voc": None,
                "pm25": 41.5,
                "air_quality_bad": True,
                "air_quality_reason": "pm25",
                "ventilation_active": True,
            }
        }
    }
    sensor = RoomMindAirQualitySensor(coord, "living")
    assert sensor.is_on is True
    assert sensor.extra_state_attributes == {
        "co2": 820.0,
        "voc": None,
        "pm25": 41.5,
        "reason": "pm25",
        "ventilation_active": True,
    }
