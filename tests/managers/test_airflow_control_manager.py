"""Tests for airflow service control."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from custom_components.roommind.managers.airflow_control_manager import AirflowControlManager


def _state(state: str, attrs: dict | None = None):
    s = MagicMock()
    s.state = state
    s.attributes = attrs or {}
    return s


@pytest.mark.asyncio
async def test_fan_percentage_direction_and_oscillation_commands(hass):
    hass.states.get.return_value = _state(
        "off",
        {
            "percentage": 0,
            "supported_features": 0,
            "preset_modes": ["normal"],
        },
    )
    mgr = AirflowControlManager(hass)

    await mgr.async_apply(
        "living",
        {
            "airflow_devices": [
                {
                    "entity_id": "fan.living",
                    "role": "circulation",
                    "controllable": True,
                    "control_enabled": True,
                    "preferred_direction": "forward",
                    "preferred_oscillating": True,
                }
            ]
        },
        level=0.5,
        mode="heating",
    )

    calls = hass.services.async_call.call_args_list
    assert ("fan", "turn_on", {"entity_id": "fan.living", "percentage": 50}) in [c.args[:3] for c in calls]
    assert ("fan", "set_direction", {"entity_id": "fan.living", "direction": "forward"}) in [c.args[:3] for c in calls]
    assert ("fan", "oscillate", {"entity_id": "fan.living", "oscillating": True}) in [c.args[:3] for c in calls]


@pytest.mark.asyncio
async def test_climate_fan_mode_and_swing_commands(hass):
    hass.states.get.return_value = _state(
        "heat",
        {
            "fan_mode": "low",
            "fan_modes": ["off", "low", "medium", "high"],
            "swing_modes": ["off", "both"],
            "swing_horizontal_modes": ["off", "on"],
            "hvac_modes": ["off", "heat", "fan_only"],
        },
    )
    mgr = AirflowControlManager(hass)

    await mgr.async_apply(
        "living",
        {
            "airflow_devices": [
                {
                    "entity_id": "climate.ac",
                    "role": "hvac_fan",
                    "controllable": True,
                    "control_enabled": True,
                    "preferred_swing_mode": "both",
                    "preferred_swing_horizontal_mode": "on",
                }
            ]
        },
        level=1.0,
        mode="heating",
    )

    calls = [c.args[:3] for c in hass.services.async_call.call_args_list]
    assert ("climate", "set_fan_mode", {"entity_id": "climate.ac", "fan_mode": "high"}) in calls
    assert ("climate", "set_swing_mode", {"entity_id": "climate.ac", "swing_mode": "both"}) in calls
    assert (
        "climate",
        "set_swing_horizontal_mode",
        {"entity_id": "climate.ac", "swing_horizontal_mode": "on"},
    ) in calls


@pytest.mark.asyncio
async def test_redundant_airflow_command_is_cached(hass):
    hass.states.get.return_value = _state("on", {"percentage": 50})
    mgr = AirflowControlManager(hass)
    room = {
        "airflow_devices": [
            {"entity_id": "fan.living", "role": "circulation", "controllable": True, "control_enabled": True}
        ]
    }

    await mgr.async_apply("living", room, level=0.5, mode="heating")
    await mgr.async_apply("living", room, level=0.5, mode="heating")

    turn_on_calls = [c for c in hass.services.async_call.call_args_list if c.args[:2] == ("fan", "turn_on")]
    assert len(turn_on_calls) == 1
