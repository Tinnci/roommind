"""Tests for the public last-command diagnostics Interface."""

from __future__ import annotations

from custom_components.roommind.control.mpc_controller import (
    _last_commands,
    clear_command_cache,
    last_command_snapshot,
)


def test_last_command_snapshot_is_detached():
    clear_command_cache()
    _last_commands["climate.living_room"] = {
        "service": "set_temperature",
        "temperature": 21.0,
    }

    snapshot = last_command_snapshot()
    snapshot["climate.living_room"]["temperature"] = 99.0
    snapshot["climate.other"] = {"service": "turn_off"}

    assert _last_commands == {
        "climate.living_room": {
            "service": "set_temperature",
            "temperature": 21.0,
        }
    }

    clear_command_cache()
