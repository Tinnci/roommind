"""Tests for the coordinator-owned analytics runtime Interface."""

from __future__ import annotations

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
