"""Tests for the coordinator-owned diagnostics runtime Interface."""

from __future__ import annotations

import time

from .conftest import _create_coordinator


def test_diagnostics_runtime_snapshot_is_complete_detached_and_non_creating(hass, mock_config_entry):
    coordinator = _create_coordinator(hass, mock_config_entry)
    wall_now = time.time()
    monotonic_now = time.monotonic()
    coordinator.rooms = {"living_room": {"current_temp": 21.5}}
    coordinator.outdoor_temp = 7.0
    coordinator.outdoor_humidity = 65.0
    coordinator._previous_modes["living_room"] = "idle"
    coordinator._mode_on_since["living_room"] = wall_now - 30
    coordinator._last_valid_temps["living_room"] = (21.0, monotonic_now - 15)
    coordinator._window_manager._paused["living_room"] = True
    coordinator._weather_manager._outdoor_forecast = [{"temperature": 8.0}]
    coordinator._heat_source_states["living_room"] = "primary"

    snapshot = coordinator.diagnostics_runtime_snapshot({"living_room": {"heating_system_type": "radiator"}})
    room = snapshot.rooms["living_room"]

    assert room.live == {"current_temp": 21.5}
    assert room.previous_mode == "idle"
    assert 28 <= room.mode_active_for_s <= 32
    assert room.cached_temp == 21.0
    assert room.cached_temp_age_s is not None
    assert 13 <= room.cached_temp_age_s <= 17
    assert room.q_residual == 0.0
    assert room.model is None
    assert room.window == {"paused": True}
    assert room.cover is None
    assert room.heat_source_routing == "primary"
    assert snapshot.outdoor_temp == 7.0
    assert snapshot.outdoor_humidity == 65.0
    assert snapshot.forecast_available is True
    assert snapshot.forecast_points == 1
    assert snapshot.compressor_groups == {}
    assert snapshot.valve_protection == {"currently_cycling": {}}
    assert coordinator._model_manager.get_room_ids() == []
    assert coordinator._cover_manager._states == {}

    room.live["current_temp"] = 99.0
    assert coordinator.rooms["living_room"]["current_temp"] == 21.5
