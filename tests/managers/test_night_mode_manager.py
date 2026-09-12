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

    assert active_status[0]["outcome"] == "sent"
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
async def test_night_mode_reapplies_if_user_changes_target_during_night(hass):
    states = {"light.ac_display": _state("on")}

    def _get_state(entity_id: str):
        return states.get(entity_id)

    hass.states.get.side_effect = _get_state
    manager = NightModeManager(hass)
    room = {"night_controls": [{"entity_id": "light.ac_display", "role": "display_light"}]}

    await manager.async_apply("bedroom", room, active=True)
    states["light.ac_display"] = _state("off")
    await manager.async_apply("bedroom", room, active=True)
    states["light.ac_display"] = _state("on")
    status = await manager.async_apply("bedroom", room, active=True)

    assert status[0]["outcome"] == "sent"
    assert [call.args[:3] for call in hass.services.async_call.call_args_list].count(
        ("light", "turn_off", {"entity_id": "light.ac_display"})
    ) == 2


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


@pytest.mark.asyncio
async def test_dispatch_is_pending_until_the_accessory_is_observed(hass):
    states = {"switch.beeper": _state("on")}
    hass.states.get.side_effect = states.get
    manager = NightModeManager(hass)
    room = {"night_controls": [{"entity_id": "switch.beeper"}]}

    first = (await manager.async_apply("bedroom", room, active=True))[0]
    repeated = (await manager.async_apply("bedroom", room, active=True))[0]

    assert first["outcome"] == "sent"
    assert first["application"] == "pending"
    assert first["context_id"]
    assert repeated["outcome"] == "pending"
    assert hass.services.async_call.call_count == 1

    states["switch.beeper"] = _state("off")
    observed = (await manager.async_apply("bedroom", room, active=True))[0]
    assert observed["outcome"] == "observed"
    assert observed["observed_value"] == "off"


@pytest.mark.asyncio
async def test_restore_keeps_previous_value_until_feedback_matches(hass):
    states = {"switch.beeper": _state("on")}
    hass.states.get.side_effect = states.get
    manager = NightModeManager(hass)
    room = {"night_controls": [{"entity_id": "switch.beeper"}]}
    await manager.async_apply("bedroom", room, active=True)
    states["switch.beeper"] = _state("off")
    await manager.async_apply("bedroom", room, active=True)

    await manager.async_apply("bedroom", room, active=False)
    repeated = (await manager.async_apply("bedroom", room, active=False))[0]

    assert repeated["target_value"] == "on"
    assert repeated["previous_value"] == "on"
    assert repeated["outcome"] == "pending"
    assert hass.services.async_call.call_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["unknown", "unavailable"])
async def test_unavailable_accessory_is_not_commanded_or_saved_for_restore(hass, value):
    hass.states.get.return_value = _state(value)
    manager = NightModeManager(hass)

    statuses = await manager.async_apply("bedroom", {"night_controls": [{"entity_id": "switch.beeper"}]}, active=True)

    assert statuses[0]["outcome"] == "unavailable"
    assert statuses[0]["previous_value"] is None
    hass.services.async_call.assert_not_called()


async def test_unconfirmed_accessories_retry_with_backoff(hass, monkeypatch):
    from custom_components.roommind.managers import night_mode_manager

    now = 1000.0
    monkeypatch.setattr(night_mode_manager.time, "monotonic", lambda: now)
    hass.states.get.return_value = _state("on")
    manager = NightModeManager(hass)
    room = {"night_controls": [{"entity_id": "switch.beeper"}]}

    await manager.async_apply("bedroom", room, active=True)
    for elapsed in (30, 60, 90):
        now = 1000.0 + elapsed
        assert (await manager.async_apply("bedroom", room, active=True))[0]["outcome"] == "pending"
    now = 1120.0
    assert (await manager.async_apply("bedroom", room, active=True))[0]["outcome"] == "sent"
    now = 1240.0
    assert (await manager.async_apply("bedroom", room, active=True))[0]["outcome"] == "pending"
    now = 1360.0
    assert (await manager.async_apply("bedroom", room, active=True))[0]["outcome"] == "sent"
    assert hass.services.async_call.call_count == 3


async def test_early_device_confirmation_is_correlated_with_accessory_dispatch(hass):
    from custom_components.roommind.control.actuation import ActuationLedger

    ledger = ActuationLedger()
    hass.states.get.return_value = _state("on")

    async def dispatch(domain, service, data, **kwargs):
        ledger.record_tcl_event(
            {"context_id": kwargs["context"].id, "outcome": "applied", "transport_outcome": "accepted_by_udp"}
        )

    hass.services.async_call.side_effect = dispatch
    manager = NightModeManager(hass, actuation_ledger=ledger)
    status = (await manager.async_apply("bedroom", {"night_controls": [{"entity_id": "switch.beeper"}]}, active=True))[
        0
    ]

    assert status["dispatch"] == "sent"
    assert status["acceptance"] == "accepted"
    assert status["application"] == "confirmed"
    assert status["observed_value"] == "on"


async def test_select_without_a_quiet_option_is_not_arbitrarily_changed(hass):
    hass.states.get.return_value = _state("medium", {"options": ["loud", "medium"]})
    manager = NightModeManager(hass)

    status = (await manager.async_apply("bedroom", {"night_controls": [{"entity_id": "select.beeper"}]}, active=True))[
        0
    ]

    assert status["skip_reason"] == "no_target_value"
    hass.services.async_call.assert_not_called()


async def test_all_accessory_restore_values_are_captured_before_first_dispatch(hass):
    states = {"switch.beeper": _state("on"), "light.display": _state("on")}
    hass.states.get.side_effect = states.get

    async def dispatch(domain, service, data, **kwargs):
        states["light.display"].state = "off"

    hass.services.async_call.side_effect = dispatch
    manager = NightModeManager(hass)
    room = {"night_controls": [{"entity_id": entity_id} for entity_id in states]}

    status = await manager.async_apply("bedroom", room, active=True)

    assert [item["previous_value"] for item in status] == ["on", "on"]


async def test_failed_dispatch_keeps_restoration_value_and_does_not_retry_each_cycle(hass):
    hass.states.get.return_value = _state("on")
    hass.services.async_call.side_effect = RuntimeError("device unavailable")
    manager = NightModeManager(hass)
    room = {"night_controls": [{"entity_id": "switch.beeper"}]}

    first = (await manager.async_apply("bedroom", room, active=True))[0]
    await manager.async_apply("bedroom", room, active=True)

    assert first["outcome"] == "failed"
    assert first["application"] == "unknown"
    assert first["previous_value"] == "on"
    hass.services.async_call.assert_called_once()


async def test_assumed_state_cannot_supply_physical_confirmation_or_restore_values(hass):
    hass.states.get.return_value = _state("off", {"assumed_state": True})
    manager = NightModeManager(hass)

    status = (await manager.async_apply("bedroom", {"night_controls": [{"entity_id": "switch.beeper"}]}, active=True))[
        0
    ]

    assert status["outcome"] == "unverified"
    assert status["application"] == "unknown"
    assert status["previous_value"] is None


async def test_late_night_command_does_not_erase_pending_day_restoration(hass):
    states = {"switch.beeper": _state("on")}
    hass.states.get.side_effect = states.get
    manager = NightModeManager(hass)
    room = {"night_controls": [{"entity_id": "switch.beeper"}]}
    await manager.async_apply("bedroom", room, active=True)

    restoring = (await manager.async_apply("bedroom", room, active=False))[0]
    assert restoring["outcome"] == "sent"
    assert restoring["target_value"] == "on"
    assert (await manager.async_apply("bedroom", room, active=False))[0]["outcome"] == "pending"

    states["switch.beeper"] = _state("off")
    late = (await manager.async_apply("bedroom", room, active=False))[0]
    assert late["target_value"] == "on"
    assert late["outcome"] == "sent"
    states["switch.beeper"] = _state("on")
    assert (await manager.async_apply("bedroom", room, active=False))[0]["outcome"] == "observed"
    assert (await manager.async_apply("bedroom", room, active=False))[0]["target_value"] is None
