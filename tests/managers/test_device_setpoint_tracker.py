"""Tests for Follow-the-Thermostat / AC Remote setpoint tracking."""

from __future__ import annotations

from custom_components.roommind.managers.device_setpoint_tracker import DeviceSetpointTracker


def test_tracker_ignores_roommind_echo_and_detects_external_change() -> None:
    """RoomMind's own sent setpoints are ignored while manual changes trigger adoption."""
    now = [100.0]
    tracker = DeviceSetpointTracker(lambda: now[0])

    # Baseline observation at 21.0
    assert tracker.observe("climate.ac", "heat", {"temperature": 21.0}, 0.25, 0.5) == {}

    # RoomMind commands 23.0 -> device echoes 23.0 -> no external override
    now[0] += 5.0
    tracker.note_command("climate.ac", "set_temperature", {"temperature": 23.0})
    assert tracker.observe("climate.ac", "heat", {"temperature": 23.0}, 0.25, 0.5) == {}

    # External remote changes setpoint from 23.0 -> 20.5 -> detected!
    now[0] += 30.0
    changes = tracker.observe("climate.ac", "heat", {"temperature": 20.5}, 0.25, 0.5)
    assert changes == {"temperature": (23.0, 20.5)}
