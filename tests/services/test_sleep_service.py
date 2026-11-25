"""Unit tests for roommind.services.sleep_service."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.roommind.services.sleep_service import async_execute_sleep_action


def _state(value: str) -> MagicMock:
    obj = MagicMock()
    obj.state = value
    obj.attributes = {}
    return obj


def _make_hass(states: dict[str, MagicMock]) -> MagicMock:
    hass = MagicMock()
    hass.states.get.side_effect = states.get
    hass.services.async_call = AsyncMock()
    return hass


def _room(sleep_device: dict | None = None) -> dict:
    return {
        "area_id": "bedroom",
        "quiet_hours": {"start": "22:30", "end": "06:30"},
        "sleep_device": sleep_device
        or {
            "power_entity": "switch.blanket_power",
            "gears_entity": "text.blanket_gears",
            "sleep_switch_entity": "switch.blanket_sleep",
            "remote_switch_entity": "switch.blanket_remote",
            "zone_a_countdown_entity": "number.blanket_a_timer",
            "zone_b_countdown_entity": "number.blanket_b_timer",
            "zone_a_sleep_entity": "text.blanket_a_curve",
            "prewarm_gear_a": 5,
            "prewarm_gear_b": 4,
            "sleep_gear_a": 2,
            "sleep_gear_b": 1,
        },
    }


@pytest.mark.asyncio
async def test_sleep_service_rejects_hardware_action_when_remote_disabled() -> None:
    """Hardware-only commands fail cleanly when remote_enable_entity is off."""
    hass = _make_hass({"switch.blanket_remote": _state("off")})
    res = await async_execute_sleep_action(
        hass, _room(), "bedroom", {"action": "set_gears", "gear_a": 3}, coordinator=None
    )
    assert res == {"ok": False, "reason": "remote_disabled"}
    hass.services.async_call.assert_not_awaited()


@pytest.mark.asyncio
async def test_sleep_service_pre_warm_sleep_now_skip_clear_and_gears() -> None:
    """Sleep phase overrides update coordinator and command expected entities."""
    hass = _make_hass(
        {
            "switch.blanket_remote": _state("on"),
            "switch.blanket_power": _state("on"),
            "switch.blanket_sleep": _state("on"),
            "text.blanket_gears": _state("A3 B2"),
        }
    )
    coordinator = MagicMock()
    coordinator.async_request_refresh = AsyncMock()
    room = _room()

    res = await async_execute_sleep_action(
        hass, room, "bedroom", {"action": "pre_warm", "countdown_min": 45}, coordinator=coordinator
    )
    assert res == {"ok": True}
    coordinator.set_tonight_sleep_override.assert_called_with("bedroom", "pre_warm")
    assert any(
        c.args[:2] == ("number", "set_value") and c.args[2]["value"] == 45
        for c in hass.services.async_call.await_args_list
    )

    hass.services.async_call.reset_mock()
    await async_execute_sleep_action(hass, room, "bedroom", {"action": "sleep_now"}, coordinator=coordinator)
    coordinator.set_tonight_sleep_override.assert_called_with("bedroom", "sleep")
    assert any(c.args[:3] == ("switch", "turn_on", {"entity_id": "switch.blanket_sleep"}) for c in hass.services.async_call.await_args_list)

    hass.services.async_call.reset_mock()
    await async_execute_sleep_action(hass, room, "bedroom", {"action": "skip_tonight"}, coordinator=coordinator)
    coordinator.set_tonight_sleep_override.assert_called_with("bedroom", "skip")
    assert len(hass.services.async_call.await_args_list) == 2

    await async_execute_sleep_action(hass, room, "bedroom", {"action": "clear"}, coordinator=coordinator)
    coordinator.clear_tonight_sleep_override.assert_called_once_with("bedroom")

    hass.services.async_call.reset_mock()
    await async_execute_sleep_action(
        hass, room, "bedroom", {"action": "set_gears", "gear_a": 4, "countdown_min": 30}, coordinator=coordinator
    )
    assert any(c.args[:2] == ("text", "set_value") for c in hass.services.async_call.await_args_list)


@pytest.mark.asyncio
async def test_sleep_service_toggles_and_sync_curve() -> None:
    """Power toggle, sleep-switch toggle, and curve sync dispatch expected calls."""
    hass = _make_hass(
        {
            "switch.blanket_remote": _state("on"),
            "switch.blanket_power": _state("off"),
            "switch.blanket_sleep": _state("on"),
            "text.blanket_a_curve": _state("0,23:00,07:00"),
        }
    )
    room = _room()
    await async_execute_sleep_action(hass, room, "bedroom", {"action": "toggle_power"}, coordinator=None)
    await async_execute_sleep_action(hass, room, "bedroom", {"action": "toggle_sleep_switch"}, coordinator=None)
    await async_execute_sleep_action(
        hass, room, "bedroom", {"action": "sync_curve", "zone_a_enabled": True}, coordinator=None
    )

    calls = [c.args[:3] for c in hass.services.async_call.await_args_list]
    assert calls[0] == ("switch", "turn_on", {"entity_id": "switch.blanket_power"})
    assert calls[1] == ("switch", "turn_off", {"entity_id": "switch.blanket_sleep"})
    assert calls[2][0] == "text" and calls[2][1] == "set_value" and calls[2][2]["entity_id"] == "text.blanket_a_curve"
