"""Tests for night-mode accessory controls."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from custom_components.roommind.managers.night_mode_manager import NightModeManager


def _state(state: str, attrs: dict | None = None):
    s = MagicMock()
    s.state = state
    s.attributes = attrs or {}
    return s


@pytest.mark.asyncio
async def test_night_mode_turns_light_off_and_restores_previous_state(hass):
    states = {"light.ac_display": _state("on")}

    def _get_state(entity_id: str):
        return states.get(entity_id)

    hass.states.get.side_effect = _get_state
    manager = NightModeManager(hass)
    room = {"night_controls": [{"entity_id": "light.ac_display", "role": "display_light"}]}

    active_status = await manager.async_apply("bedroom", room, active=True)

    assert active_status[0]["outcome"] == "applied"
    assert active_status[0]["target_value"] == "off"
    assert active_status[0]["previous_value"] == "on"
    assert ("light", "turn_off", {"entity_id": "light.ac_display"}) in [
        call.args[:3] for call in hass.services.async_call.call_args_list
    ]

    states["light.ac_display"] = _state("off")
    inactive_status = await manager.async_apply("bedroom", room, active=False)

    assert inactive_status[0]["target_value"] == "on"
    assert inactive_status[0]["last_service"] == "light.turn_on"


@pytest.mark.asyncio
async def test_night_mode_select_uses_quiet_fallback(hass):
    hass.states.get.return_value = _state("normal", {"options": ["normal", "quiet", "loud"]})
    manager = NightModeManager(hass)

    status = await manager.async_apply(
        "bedroom",
        {"night_controls": [{"entity_id": "select.fan_beep", "role": "beeper"}]},
        active=True,
    )

    assert status[0]["target_value"] == "quiet"
    assert ("select", "select_option", {"entity_id": "select.fan_beep", "option": "quiet"}) in [
        call.args[:3] for call in hass.services.async_call.call_args_list
    ]


@pytest.mark.asyncio
async def test_night_mode_reports_unsupported_domain(hass):
    hass.states.get.return_value = _state("on")
    manager = NightModeManager(hass)

    status = await manager.async_apply(
        "bedroom",
        {"night_controls": [{"entity_id": "sensor.ac_led", "role": "display_light", "night_value": "off"}]},
        active=True,
    )

    assert status[0]["outcome"] == "unsupported"
    assert status[0]["skip_reason"] == "unsupported_domain"
