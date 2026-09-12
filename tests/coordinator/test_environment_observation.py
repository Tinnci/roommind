"""Physical observations must describe the interval before any room actuation."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from .conftest import SAMPLE_ROOM, _create_coordinator, _make_store_mock, make_mock_states_get


async def test_all_rooms_freeze_airflow_power_and_heat_inputs_before_dispatch(hass, mock_config_entry):
    """An early room's actuation must not change another room's learning inputs."""
    rooms = {
        area_id: {
            **SAMPLE_ROOM,
            "area_id": area_id,
            "climate_mode": "cool_only",
            "devices": [{"entity_id": f"climate.{area_id}", "type": "ac"}],
            "airflow_devices": [
                {"entity_id": f"climate.{area_id}", "role": "hvac_fan", "power_sensor_entity": "sensor.ac_power"},
                {"entity_id": "fan.vent", "role": "ventilation"},
            ],
            "occupancy_sensors": ["binary_sensor.occupancy"],
            "window_sensors": ["binary_sensor.window"],
            "covers": ["cover.blind"],
        }
        for area_id in ("room_a", "room_b")
    }
    climate_attrs = {
        "hvac_modes": ["off", "cool"],
        "hvac_action": "cooling",
        "fan_modes": ["low", "high"],
        "fan_mode": "low",
        "temperature": 25.0,
        "min_temp": 16.0,
        "max_temp": 30.0,
    }
    states = {
        "climate.room_a": ("cool", climate_attrs),
        "climate.room_b": ("cool", climate_attrs),
        "sensor.ac_power": ("800", {"unit_of_measurement": "W"}),
        "fan.vent": ("on", {"percentage": 20}),
        "binary_sensor.occupancy": ("off", {}),
        "binary_sensor.window": ("off", {}),
        "cover.blind": ("open", {"current_position": 100}),
    }
    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp="28", outdoor_temp="32", extra=states))
    store = _make_store_mock(rooms)
    hass.data = {"roommind": {"store": store}}

    async def dispatch(domain, service, data, **kwargs):
        if domain == "climate":
            states.update(
                {
                    "sensor.ac_power": ("1200", {"unit_of_measurement": "W"}),
                    "fan.vent": ("on", {"percentage": 90}),
                    "binary_sensor.occupancy": ("on", {}),
                    "binary_sensor.window": ("on", {}),
                    "cover.blind": ("closed", {"current_position": 0}),
                }
            )

    hass.services.async_call = AsyncMock(side_effect=dispatch)
    coordinator = _create_coordinator(hass, mock_config_entry)
    coordinator._ekf_training.process = MagicMock()

    result = await coordinator._async_update_data()

    assert any(call.args[0] == "climate" for call in hass.services.async_call.call_args_list)
    assert set(result["rooms"]) == set(rooms)
    for live in result["rooms"].values():
        assert live["hvac_output_status"]["electric_power_w"] == 800
        assert live["hvac_output_status"]["stage"] == "compressor_mid"
        assert live["q_vent"] == 0.2
        assert live["q_occupancy"] == 0.0
        assert live["shading_factor"] == 1.0
        assert live["window_open"] is False
    assert coordinator._ekf_training.process.call_count == 2
    for call in coordinator._ekf_training.process.call_args_list:
        assert call.kwargs["ekf_mode"] == "cooling"
        assert call.kwargs["ekf_pf"] == 1.0
        assert call.kwargs["q_vent"] == 0.2
        assert call.kwargs["q_occupancy"] == 0.0
        assert call.kwargs["shading_factor"] == 1.0


@pytest.mark.parametrize("hvac_mode", ["off", "cool"])
def test_optimistic_device_state_is_not_physical_feedback(hass, mock_config_entry, hvac_mode):
    """IR integrations can publish a requested mode without device feedback."""
    hass.states.get = MagicMock(
        side_effect=make_mock_states_get(
            extra={"climate.ac": (hvac_mode, {"assumed_state": True, "hvac_action": "cooling"})}
        )
    )
    coordinator = _create_coordinator(hass, mock_config_entry)

    assert coordinator._observe_device_action({"devices": [{"entity_id": "climate.ac", "type": "ac"}]}) == (
        None,
        0.0,
    )


def test_preheating_is_not_observed_heat_delivery(hass, mock_config_entry):
    """Heat-pump startup can warm a coil before it delivers heat to the room."""
    hass.states.get = MagicMock(
        side_effect=make_mock_states_get(extra={"climate.ac": ("heat", {"hvac_action": "preheating"})})
    )
    coordinator = _create_coordinator(hass, mock_config_entry)

    assert coordinator._observe_device_action({"devices": [{"entity_id": "climate.ac", "type": "ac"}]}) == (
        None,
        0.0,
    )


async def test_unknown_activity_does_not_calibrate_sensor_bias_as_idle(hass, mock_config_entry):
    """An indoor AC sensor's unknown active bias must not become its static bias."""
    room = {**SAMPLE_ROOM, "temperature_sensors": ["sensor.ac_local"]}
    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp="24", extra={"sensor.ac_local": ("21", {})}))
    hass.services.async_call = AsyncMock()
    coordinator = _create_coordinator(hass, mock_config_entry)
    coordinator.outdoor_temp_effective = 32.0
    coordinator._sensor_fusion.calibrate_observations = MagicMock(return_value=[])

    live = await coordinator._async_process_room(room, {}, [])

    assert live["observation_status"] == "unknown"
    coordinator._sensor_fusion.calibrate_observations.assert_not_called()


async def test_dispatch_cannot_change_another_rooms_heating_capability(hass, mock_config_entry):
    """A partial device update must not change planning or learning mid-cycle."""
    rooms = {
        area_id: {
            **SAMPLE_ROOM,
            "area_id": area_id,
            "climate_mode": "heat_only",
            "devices": [{"entity_id": f"climate.{area_id}", "type": "ac"}],
        }
        for area_id in ("room_a", "room_b")
    }
    states = {
        f"climate.{area_id}": (
            "heat",
            {"hvac_modes": ["off", "heat", "cool"], "hvac_action": "heating", "temperature": 25.0},
        )
        for area_id in rooms
    }
    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp="15", outdoor_temp="5", extra=states))
    hass.data = {"roommind": {"store": _make_store_mock(rooms)}}

    async def dispatch(domain, service, data, **kwargs):
        if domain == "climate":
            states["climate.room_b"] = ("unavailable", {"hvac_modes": ["off", "cool"]})

    hass.services.async_call = AsyncMock(side_effect=dispatch)
    coordinator = _create_coordinator(hass, mock_config_entry)
    coordinator._ekf_training.process = MagicMock()

    result = await coordinator._async_update_data()

    assert states["climate.room_b"][0] == "unavailable"
    assert result["rooms"]["room_b"]["requested_power"] > 0
    assert coordinator._ekf_training.process.call_count == 2
    for call in coordinator._ekf_training.process.call_args_list:
        assert call.kwargs["can_heat"] is True
        assert call.kwargs["ekf_mode"] == "heating"
