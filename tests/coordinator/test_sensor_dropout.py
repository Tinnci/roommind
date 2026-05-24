"""Tests for sensor dropout fallback (cached temperature on sensor unavailability)."""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.roommind.const import MAX_SENSOR_STALENESS, MODE_IDLE
from custom_components.roommind.control.thermal_model import TemperatureObservation

from .conftest import (
    MANAGED_ROOM,
    SAMPLE_ROOM,
    _create_coordinator,
    _make_store_mock,
    make_mock_states_get,
)


@pytest.mark.asyncio
async def test_sensor_dropout_keeps_previous_mode(hass, mock_config_entry):
    """When sensor drops out, cached temp keeps mode=heating instead of idle."""
    store = _make_store_mock({"living_room_abc12345": SAMPLE_ROOM})
    hass.data = {"roommind": {"store": store}}

    # Cycle 1: valid temp → heating (18°C < 21°C comfort)
    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp="18.0"))
    hass.services.async_call = AsyncMock()
    coordinator = _create_coordinator(hass, mock_config_entry)
    result1 = await coordinator._async_update_data()
    assert result1["rooms"]["living_room_abc12345"]["mode"] == "heating"

    # Cycle 2: sensor dropout (temp=None) → should still be heating via cache
    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp=None))
    result2 = await coordinator._async_update_data()
    room2 = result2["rooms"]["living_room_abc12345"]
    assert room2["mode"] == "heating", "sensor dropout should use cached temp, not idle"
    assert room2["current_temp"] == 18.0, "current_temp should show cached value"
    assert room2["current_temp_raw"] is None, "current_temp_raw should be None (real reading)"


def test_read_room_sensors_returns_multi_sensor_observations(hass, mock_config_entry):
    """Configured auxiliary temperature sensors become EKF observations."""
    now = datetime.now(UTC)
    room = {
        **SAMPLE_ROOM,
        "temperature_sensors": ["sensor.living_room_temp", "sensor.living_room_trv"],
    }

    def _mock_state(entity_id):
        state = MagicMock()
        state.attributes = {"unit_of_measurement": "°C"}
        state.last_reported = now - timedelta(seconds=5)
        if entity_id == "sensor.living_room_temp":
            state.state = "20.0"
            return state
        if entity_id == "sensor.living_room_trv":
            state.state = "20.4"
            return state
        if entity_id == "sensor.living_room_humidity":
            state.state = "55.0"
            return state
        return None

    hass.states.get = MagicMock(side_effect=_mock_state)
    coordinator = _create_coordinator(hass, mock_config_entry)

    current_temp, current_temp_raw, current_humidity, has_external_sensor, observations = (
        coordinator._read_room_sensors(
            room,
            "living_room_abc12345",
        )
    )

    assert current_temp == 20.0
    assert current_temp_raw == 20.0
    assert current_humidity == 55.0
    assert has_external_sensor is True
    assert [observation.entity_id for observation in observations] == [
        "sensor.living_room_temp",
        "sensor.living_room_trv",
    ]
    assert observations[0].is_primary is True
    assert observations[0].variance < observations[1].variance


@pytest.mark.asyncio
async def test_observe_and_train_uses_calibrated_temperature_observations(hass, mock_config_entry):
    """EKF training receives bias-corrected observations from the fusion manager."""
    coordinator = _create_coordinator(hass, mock_config_entry)
    coordinator.outdoor_temp_effective = 5.0
    raw_observations = [
        TemperatureObservation(value=20.0, variance=0.04, entity_id="sensor.wall", is_primary=True),
        TemperatureObservation(value=22.0, variance=0.16, entity_id="sensor.trv"),
    ]
    corrected_observations = [
        raw_observations[0],
        TemperatureObservation(value=20.5, variance=0.16, entity_id="sensor.trv"),
    ]
    coordinator._sensor_fusion.calibrate_observations = MagicMock(return_value=corrected_observations)
    coordinator._ekf_training.process = MagicMock()
    coordinator._observe_device_action = MagicMock(return_value=(None, 0.0))

    await coordinator._observe_and_train(
        area_id="living_room_abc12345",
        room=SAMPLE_ROOM,
        settings={},
        current_temp_raw=20.0,
        temperature_observations=raw_observations,
        mode="heating",
        power_fraction=0.5,
        window_open=False,
        raw_open=False,
        q_residual=0.0,
        shading_factor=1.0,
        q_occupancy=0.0,
        has_external_sensor=True,
        heat_source_plan=None,
        climate_active=True,
    )

    coordinator._sensor_fusion.calibrate_observations.assert_called_once_with(
        raw_observations,
        mode="heating",
        power_fraction=0.5,
        q_fan_mix=0.0,
    )
    assert coordinator._ekf_training.process.call_args.kwargs["current_observations"] == corrected_observations


@pytest.mark.asyncio
async def test_sensor_dropout_staleness_timeout(hass, mock_config_entry):
    """Cached temp older than MAX_SENSOR_STALENESS → fall back to idle."""
    store = _make_store_mock({"living_room_abc12345": SAMPLE_ROOM})
    hass.data = {"roommind": {"store": store}}

    # Cycle 1: populate cache
    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp="18.0"))
    hass.services.async_call = AsyncMock()
    coordinator = _create_coordinator(hass, mock_config_entry)
    await coordinator._async_update_data()

    # Manually expire the cache
    area_id = "living_room_abc12345"
    cached_temp, _ = coordinator._last_valid_temps[area_id]
    coordinator._last_valid_temps[area_id] = (cached_temp, time.monotonic() - MAX_SENSOR_STALENESS - 1)

    # Cycle 2: sensor dropout with expired cache → idle
    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp=None))
    result = await coordinator._async_update_data()
    assert result["rooms"]["living_room_abc12345"]["mode"] == MODE_IDLE


@pytest.mark.asyncio
async def test_sensor_dropout_ekf_skipped(hass, mock_config_entry):
    """EKF training is skipped during sensor dropout, even with cached temp."""
    store = _make_store_mock({"living_room_abc12345": SAMPLE_ROOM})
    hass.data = {"roommind": {"store": store}}

    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp="18.0"))
    hass.services.async_call = AsyncMock()
    coordinator = _create_coordinator(hass, mock_config_entry)
    await coordinator._async_update_data()

    # Patch EKF training to track calls
    with (
        patch.object(coordinator._ekf_training, "process") as mock_process,
        patch.object(coordinator._ekf_training, "clear") as mock_clear,
    ):
        hass.states.get = MagicMock(side_effect=make_mock_states_get(temp=None))
        await coordinator._async_update_data()

        mock_process.assert_not_called()
        mock_clear.assert_called_once_with("living_room_abc12345")


@pytest.mark.asyncio
async def test_sensor_dropout_history_records_none(hass, mock_config_entry):
    """History CSV should record None for room_temp during dropout, not cached value."""
    store = _make_store_mock({"living_room_abc12345": SAMPLE_ROOM})
    hass.data = {"roommind": {"store": store}}

    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp="18.0"))
    hass.services.async_call = AsyncMock()
    coordinator = _create_coordinator(hass, mock_config_entry)
    await coordinator._async_update_data()

    # Sensor dropout
    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp=None))
    result = await coordinator._async_update_data()
    room = result["rooms"]["living_room_abc12345"]
    assert room["current_temp_raw"] is None
    assert room["current_temp"] == 18.0  # cached for display


@pytest.mark.asyncio
async def test_sensor_dropout_min_run_preserved(hass, mock_config_entry):
    """Min-run timer (_mode_on_since) survives sensor dropout."""
    store = _make_store_mock({"living_room_abc12345": SAMPLE_ROOM})
    hass.data = {"roommind": {"store": store}}

    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp="18.0"))
    hass.services.async_call = AsyncMock()
    coordinator = _create_coordinator(hass, mock_config_entry)
    await coordinator._async_update_data()

    area_id = "living_room_abc12345"
    assert area_id in coordinator._mode_on_since, "_mode_on_since should be set after heating starts"
    ts_before = coordinator._mode_on_since[area_id]

    # Sensor dropout
    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp=None))
    await coordinator._async_update_data()

    assert area_id in coordinator._mode_on_since, "_mode_on_since should survive sensor dropout"
    assert coordinator._mode_on_since[area_id] == ts_before, "timestamp should not change"


@pytest.mark.asyncio
async def test_no_cache_first_cycle_stays_idle(hass, mock_config_entry):
    """First cycle with no prior cache and sensor=None → idle (no fallback available)."""
    store = _make_store_mock({"living_room_abc12345": SAMPLE_ROOM})
    hass.data = {"roommind": {"store": store}}

    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp=None))
    hass.services.async_call = AsyncMock()
    coordinator = _create_coordinator(hass, mock_config_entry)
    result = await coordinator._async_update_data()

    assert result["rooms"]["living_room_abc12345"]["mode"] == MODE_IDLE


@pytest.mark.asyncio
async def test_room_removal_clears_cache(hass, mock_config_entry):
    """async_room_removed clears the temperature cache for that room."""
    store = _make_store_mock({"living_room_abc12345": SAMPLE_ROOM})
    hass.data = {"roommind": {"store": store}}

    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp="18.0"))
    hass.services.async_call = AsyncMock()
    coordinator = _create_coordinator(hass, mock_config_entry)
    await coordinator._async_update_data()

    area_id = "living_room_abc12345"
    assert area_id in coordinator._last_valid_temps

    coordinator.async_request_refresh = AsyncMock()
    with patch("homeassistant.helpers.entity_registry.async_get") as mock_er:
        mock_er.return_value = MagicMock(entities=MagicMock(values=MagicMock(return_value=[])))
        await coordinator.async_room_removed(area_id)

    assert area_id not in coordinator._last_valid_temps


@pytest.mark.asyncio
async def test_managed_mode_dropout_uses_cache(hass, mock_config_entry):
    """Managed Mode room with device temp dropout also uses cached temperature."""
    managed_room = {**MANAGED_ROOM, "area_id": "living_room_abc12345"}
    store = _make_store_mock({"living_room_abc12345": managed_room})
    hass.data = {"roommind": {"store": store}}

    # Cycle 1: device reports temperature via climate entity
    climate_attrs = {
        "hvac_modes": ["off", "heat"],
        "current_temperature": 19.0,
        "temperature": 21.0,
        "min_temp": 5,
        "max_temp": 30,
    }
    hass.states.get = MagicMock(
        side_effect=make_mock_states_get(
            temp=None,  # no external sensor
            extra={"climate.living_room": ("heat", climate_attrs)},
        )
    )
    hass.services.async_call = AsyncMock()
    coordinator = _create_coordinator(hass, mock_config_entry)
    await coordinator._async_update_data()

    area_id = "living_room_abc12345"
    assert area_id in coordinator._last_valid_temps
    cached_val, _ = coordinator._last_valid_temps[area_id]
    assert cached_val == 19.0

    # Cycle 2: device also unavailable → cache kicks in
    climate_attrs_none = {
        "hvac_modes": ["off", "heat"],
        "current_temperature": None,
        "temperature": 21.0,
        "min_temp": 5,
        "max_temp": 30,
    }
    hass.states.get = MagicMock(
        side_effect=make_mock_states_get(
            temp=None,
            extra={"climate.living_room": ("heat", climate_attrs_none)},
        )
    )
    result = await coordinator._async_update_data()
    room = result["rooms"]["living_room_abc12345"]
    assert room["current_temp"] == 19.0, "should use cached device temp"
    assert room["current_temp_raw"] is None
