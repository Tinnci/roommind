"""Configurable idle targets and their dispatch evidence."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from custom_components.roommind.const import MODE_IDLE, TargetTemps
from custom_components.roommind.control.actuation import (
    AcceptanceStatus,
    ActuationLedger,
    ApplicationStatus,
    DispatchStatus,
)
from custom_components.roommind.control.mpc_controller import MPCController
from custom_components.roommind.control.thermal_model import RoomModelManager

from .conftest import build_hass, make_room


def _setback_controller(hvac_mode="heat", *, room_changes=None, settings=None, attributes=None):
    hass = build_hass()
    state = MagicMock()
    state.state = hvac_mode
    state.attributes = {
        "hvac_modes": ["heat", "cool", "off"],
        "min_temp": 5.0,
        "max_temp": 35.0,
        "temperature": 22.0,
        **(attributes or {}),
    }
    hass.states.get.return_value = state
    room = make_room(thermostats=[], acs=["climate.ac"])
    room["devices"][0]["idle_action"] = "setback"
    room.update(room_changes or {})
    ledger = ActuationLedger()
    controller = MPCController(hass, room, model_manager=RoomModelManager(), settings=settings, actuation_ledger=ledger)
    return hass, room, controller, ledger


@pytest.mark.parametrize("hvac_mode,target,direction", [("heat", 21.0, -1), ("cool", 24.0, 1)])
@pytest.mark.parametrize(
    "room_changes,settings,offset",
    [
        ({}, {}, 2.0),
        ({}, {"setback_offset": 3.0}, 3.0),
        ({"setback_offset": None}, {"setback_offset": 4.0}, 4.0),
        ({"setback_offset": 1.0}, {"setback_offset": 4.0}, 1.0),
        ({"setback_offset": 3.5}, {}, 3.5),
        ({"setback_offset": 5.0}, {}, 5.0),
    ],
)
async def test_setback_uses_room_override_then_global_default(
    hvac_mode, target, direction, room_changes, settings, offset
):
    hass, _, controller, _ = _setback_controller(hvac_mode, room_changes=room_changes, settings=settings)
    targets = TargetTemps(heat=21.0, cool=24.0)

    await controller.async_apply(MODE_IDLE, targets)

    assert hass.services.async_call.call_count == 1
    assert hass.services.async_call.call_args.args[:2] == ("climate", "set_temperature")
    assert hass.services.async_call.call_args.args[2] == {
        "entity_id": "climate.ac",
        "temperature": target + direction * offset,
    }
    assert targets == TargetTemps(heat=21.0, cool=24.0)


@pytest.mark.parametrize("room_changes", [{}, {"setback_offset": 3.0}])
async def test_setback_offset_is_captured_before_execution(room_changes):
    settings = {"setback_offset": 3.0}
    hass, room, controller, _ = _setback_controller(room_changes=room_changes, settings=settings)
    room["setback_offset"] = 5.0
    settings["setback_offset"] = 1.0

    await controller.async_apply(MODE_IDLE, TargetTemps(heat=21.0, cool=24.0))

    assert hass.services.async_call.call_args.args[2]["temperature"] == 18.0


@pytest.mark.parametrize(
    "hvac_mode,targets,attributes,expected",
    [
        ("heat", TargetTemps(heat=8.0, cool=24.0), {"min_temp": 5.0}, 5.0),
        ("cool", TargetTemps(heat=21.0, cool=32.0), {"max_temp": 35.0}, 35.0),
        ("heat", TargetTemps(heat=21.3, cool=24.0), {"target_temp_step": 0.5}, 16.5),
    ],
)
async def test_custom_setback_preserves_device_limits(hvac_mode, targets, attributes, expected):
    hass, _, controller, _ = _setback_controller(hvac_mode, room_changes={"setback_offset": 5.0}, attributes=attributes)

    await controller.async_apply(MODE_IDLE, targets)

    assert hass.services.async_call.call_args.args[2]["temperature"] == expected


async def test_setback_offset_remains_a_celsius_delta_for_fahrenheit_devices():
    hass, _, controller, _ = _setback_controller(
        room_changes={"setback_offset": 3.5}, attributes={"min_temp": 41.0, "max_temp": 95.0}
    )
    hass.config.units.temperature_unit = "°F"

    await controller.async_apply(MODE_IDLE, TargetTemps(heat=21.0, cool=24.0))

    assert hass.services.async_call.call_args.args[2]["temperature"] == pytest.approx(63.5)


async def test_compressor_minimum_run_keeps_comfort_target_with_custom_setback():
    hass, _, controller, _ = _setback_controller("cool", room_changes={"setback_offset": 5.0})

    await controller.async_apply(MODE_IDLE, TargetTemps(heat=21.0, cool=24.0), compressor_forced_on={"climate.ac"})

    assert hass.services.async_call.call_args.args[2]["temperature"] == 24.0


async def test_setback_dispatch_is_pending_until_correlated_confirmation():
    hass, _, controller, ledger = _setback_controller(room_changes={"setback_offset": 3.0})

    report = await controller.async_apply(MODE_IDLE, TargetTemps(heat=21.0, cool=24.0))

    result = report.results["climate.ac"]
    assert result.dispatch is DispatchStatus.SENT
    assert result.desired["temperature"] == 18.0
    assert result.context_id == hass.services.async_call.call_args.kwargs["context"].id
    evidence = ledger.snapshot()[0]
    assert evidence.acceptance is AcceptanceStatus.UNKNOWN
    assert evidence.application is ApplicationStatus.PENDING
    assert report.active_eids == set()
    assert report.inactive_eids == {"climate.ac"}
    confirmed = ledger.record_tcl_event(
        {"context_id": result.context_id, "transport_outcome": "accepted_by_device", "outcome": "applied"}
    )
    assert confirmed.application is ApplicationStatus.CONFIRMED


async def test_failed_setback_is_not_reported_as_successfully_idled():
    hass, _, controller, ledger = _setback_controller(room_changes={"setback_offset": 3.0})
    hass.services.async_call.side_effect = RuntimeError("device unreachable")

    report = await controller.async_apply(MODE_IDLE, TargetTemps(heat=21.0, cool=24.0))

    assert report.failed_eids == {"climate.ac"}
    assert report.inactive_eids == set()
    assert report.active_eids == set()
    assert report.results["climate.ac"].dispatch is DispatchStatus.FAILED
    assert ledger.snapshot()[0].application is ApplicationStatus.UNKNOWN


async def test_setback_at_observed_setpoint_is_skipped_without_confirmation():
    hass, _, controller, _ = _setback_controller(room_changes={"setback_offset": 3.0}, attributes={"temperature": 18.0})

    report = await controller.async_apply(MODE_IDLE, TargetTemps(heat=21.0, cool=24.0))

    hass.services.async_call.assert_not_called()
    assert report.results["climate.ac"].dispatch is DispatchStatus.SKIPPED
    assert report.active_eids == set()
