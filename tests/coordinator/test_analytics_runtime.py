"""Tests for the coordinator-owned analytics runtime Interface."""

from __future__ import annotations

from unittest.mock import patch

from .conftest import _create_coordinator


def test_analytics_runtime_snapshot_is_non_creating_and_detached(hass, mock_config_entry):
    coordinator = _create_coordinator(hass, mock_config_entry)
    coordinator.rooms = {"living_room": {"blind_position": 45}}
    coordinator.outdoor_temp_effective = 8.5
    coordinator._weather_manager._outdoor_forecast = [{"temperature": 9.0, "cloud_coverage": 30}]

    snapshot = coordinator.analytics_runtime_snapshot(
        "living_room",
        {
            "temperature_sensor": "sensor.living_room",
            "heating_system_type": "radiator",
        },
    )

    assert snapshot.model_info == {}
    assert snapshot.simulation_context is None
    assert snapshot.mpc_active is False
    assert snapshot.outdoor_temp == 8.5
    assert snapshot.live == {"blind_position": 45}
    assert snapshot.weather_forecast == [{"temperature": 9.0, "cloud_coverage": 30}]
    assert snapshot.residual.q_residual == 0.0
    assert snapshot.window_open is False
    assert coordinator._model_manager.get_room_ids() == []

    snapshot.live["blind_position"] = 0
    snapshot.weather_forecast[0]["temperature"] = 99.0

    assert coordinator.rooms["living_room"]["blind_position"] == 45
    assert coordinator._weather_manager.forecast[0]["temperature"] == 9.0


def test_analytics_runtime_respects_bangbang_policy(hass, mock_config_entry):
    coordinator = _create_coordinator(hass, mock_config_entry)
    coordinator._model_manager.update("living_room", 18.0, 5.0, "heating", 5.0)
    room = {
        "temperature_sensor": "sensor.living_room",
        "heating_system_type": "radiator",
    }

    with patch(
        "custom_components.roommind.coordinator.is_mpc_active",
        return_value=True,
    ) as active_check:
        snapshot = coordinator.analytics_runtime_snapshot(
            "living_room",
            room,
            {"control_mode": "bangbang"},
        )

    assert snapshot.model_info
    assert snapshot.mpc_active is False
    assert snapshot.model_info["mpc_active"] is False
    active_check.assert_not_called()
