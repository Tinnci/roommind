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

    statuses = await mgr.async_apply(
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
                    "preferred_preset_mode": "normal",
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
    assert ("fan", "set_preset_mode", {"entity_id": "fan.living", "preset_mode": "normal"}) in [
        c.args[:3] for c in calls
    ]
    assert statuses[0]["outcome"] == "applied"
    assert statuses[0]["last_service"] == "fan.set_preset_mode"


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
    assert not any(call[0] == "climate" and call[1] == "set_hvac_mode" for call in calls)


@pytest.mark.asyncio
async def test_idle_hvac_fan_switches_to_fan_only_before_fan_mode(hass):
    hass.states.get.return_value = _state(
        "off",
        {
            "fan_modes": ["off", "low", "medium", "high"],
            "hvac_modes": ["off", "heat", "cool", "fan_only"],
        },
    )
    mgr = AirflowControlManager(hass)

    statuses = await mgr.async_apply(
        "living",
        {
            "airflow_devices": [
                {
                    "entity_id": "climate.ac",
                    "role": "hvac_fan",
                    "controllable": True,
                    "control_enabled": True,
                }
            ]
        },
        mix_level=0.6,
        vent_level=0.0,
        mode="idle",
    )

    calls = [c.args[:3] for c in hass.services.async_call.call_args_list]
    assert calls[0] == ("climate", "set_hvac_mode", {"entity_id": "climate.ac", "hvac_mode": "fan_only"})
    assert calls[1] == ("climate", "set_fan_mode", {"entity_id": "climate.ac", "fan_mode": "medium"})
    assert statuses[0]["outcome"] == "applied"
    assert statuses[0]["roommind_fan_only"] is True


@pytest.mark.asyncio
async def test_idle_hvac_fan_without_fan_only_skips_fan_mode(hass):
    hass.states.get.return_value = _state(
        "off",
        {
            "fan_modes": ["off", "low", "medium", "high"],
            "hvac_modes": ["off", "heat", "cool"],
        },
    )
    mgr = AirflowControlManager(hass)

    statuses = await mgr.async_apply(
        "living",
        {
            "airflow_devices": [
                {
                    "entity_id": "climate.ac",
                    "role": "hvac_fan",
                    "controllable": True,
                    "control_enabled": True,
                }
            ]
        },
        mix_level=0.6,
        vent_level=0.0,
        mode="idle",
    )

    assert hass.services.async_call.call_args_list == []
    assert statuses[0]["outcome"] == "unsupported_fan_only"
    assert statuses[0]["skip_reason"] == "fan_only_not_supported"


@pytest.mark.asyncio
async def test_off_climate_circulation_skips_fan_mode_without_fan_only_transition(hass):
    hass.states.get.return_value = _state(
        "off",
        {
            "fan_modes": ["off", "low", "medium", "high"],
            "hvac_modes": ["off", "heat", "cool"],
        },
    )
    mgr = AirflowControlManager(hass)

    statuses = await mgr.async_apply(
        "living",
        {
            "airflow_devices": [
                {
                    "entity_id": "climate.ac",
                    "role": "circulation",
                    "controllable": True,
                    "control_enabled": True,
                }
            ]
        },
        mix_level=1.0,
        mode="idle",
    )

    assert hass.services.async_call.call_args_list == []
    assert statuses[0]["outcome"] == "skipped_off_climate"


@pytest.mark.asyncio
async def test_roommind_owned_fan_only_turns_off_when_mix_level_zero(hass):
    state = _state(
        "off",
        {
            "fan_modes": ["off", "low", "medium", "high"],
            "hvac_modes": ["off", "fan_only"],
        },
    )
    hass.states.get.return_value = state
    mgr = AirflowControlManager(hass)
    room = {
        "airflow_devices": [
            {"entity_id": "climate.ac", "role": "hvac_fan", "controllable": True, "control_enabled": True}
        ]
    }

    await mgr.async_apply("living", room, mix_level=0.5, mode="idle")
    state.state = "fan_only"
    hass.services.async_call.reset_mock()

    statuses = await mgr.async_apply("living", room, mix_level=0.0, mode="idle")

    calls = [c.args[:3] for c in hass.services.async_call.call_args_list]
    assert calls == [("climate", "set_hvac_mode", {"entity_id": "climate.ac", "hvac_mode": "off"})]
    assert statuses[0]["outcome"] == "applied"
    assert statuses[0]["roommind_fan_only"] is False


@pytest.mark.asyncio
async def test_user_fan_only_is_not_turned_off_by_zero_mix_level(hass):
    hass.states.get.return_value = _state(
        "fan_only",
        {
            "fan_modes": ["off", "low", "medium", "high"],
            "hvac_modes": ["off", "fan_only"],
        },
    )
    mgr = AirflowControlManager(hass)

    statuses = await mgr.async_apply(
        "living",
        {
            "airflow_devices": [
                {
                    "entity_id": "climate.ac",
                    "role": "hvac_fan",
                    "controllable": True,
                    "control_enabled": True,
                }
            ]
        },
        mix_level=0.0,
        mode="idle",
    )

    assert hass.services.async_call.call_args_list == []
    assert statuses[0]["outcome"] == "blocked_by_mode"
    assert statuses[0]["skip_reason"] == "fan_only_not_roommind_owned"


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


@pytest.mark.asyncio
async def test_role_specific_levels_do_not_cross_apply(hass):
    mgr = AirflowControlManager(hass)
    room = {
        "airflow_devices": [
            {"entity_id": "fan.mix", "role": "circulation", "controllable": True, "control_enabled": True},
            {"entity_id": "fan.vent", "role": "ventilation", "controllable": True, "control_enabled": True},
        ]
    }

    await mgr.async_apply("living", room, mix_level=0.25, vent_level=0.0, mode="idle")

    calls = [c.args[:3] for c in hass.services.async_call.call_args_list]
    assert ("fan", "turn_on", {"entity_id": "fan.mix", "percentage": 25}) in calls
    assert ("fan", "turn_off", {"entity_id": "fan.vent"}) in calls
