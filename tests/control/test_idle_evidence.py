"""Idle plans must retain every required operation's dispatch evidence."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from custom_components.roommind.const import MODE_IDLE, TargetTemps
from custom_components.roommind.control.actuation import ActuationLedger, ApplicationStatus, DispatchStatus
from custom_components.roommind.control.climate_actuator import _last_commands, async_turn_off_climate
from custom_components.roommind.control.mpc_controller import MPCController
from custom_components.roommind.control.thermal_model import RoomModelManager

from .conftest import build_hass, make_room


def _controller(idle_action, *, attrs=None, hvac_mode="cool"):
    hass = build_hass()
    state = MagicMock()
    state.state = hvac_mode
    state.attributes = {
        "hvac_modes": ["off", "heat", "cool", "fan_only"],
        "fan_modes": ["low", "high"],
        "temperature": 24,
        "min_temp": 16,
        "max_temp": 30,
        **(attrs or {}),
    }
    hass.states.get.return_value = state
    room = make_room(thermostats=[], acs=["climate.ac"])
    room["devices"][0].update(idle_action=idle_action, idle_fan_mode="low")
    ledger = ActuationLedger()
    controller = MPCController(hass, room, model_manager=RoomModelManager(), actuation_ledger=ledger)
    return hass, controller, ledger


@pytest.mark.parametrize("idle_action", ["off", "fan_only", "low", "setback"])
async def test_failed_idle_operation_cannot_be_reported_inactive(idle_action):
    hass, controller, ledger = _controller(idle_action, hvac_mode="auto" if idle_action == "setback" else "cool")
    hass.services.async_call.side_effect = RuntimeError("offline")

    report = await controller.async_apply(MODE_IDLE, TargetTemps(heat=21, cool=24))

    assert report.failed_eids == {"climate.ac"}
    assert report.inactive_eids == set()
    assert report.results["climate.ac"].dispatch is DispatchStatus.FAILED
    assert ledger.snapshot()
    assert all(evidence.application is ApplicationStatus.UNKNOWN for evidence in ledger.snapshot())


async def test_fan_only_partial_failure_retains_separate_contexts():
    hass, controller, ledger = _controller("fan_only")

    async def dispatch(domain, service, data, **kwargs):
        if service == "set_fan_mode":
            raise RuntimeError("fan setting rejected")
        ledger.record_tcl_event(
            {"context_id": kwargs["context"].id, "transport_outcome": "accepted_by_device", "outcome": "applied"}
        )

    hass.services.async_call.side_effect = dispatch

    report = await controller.async_apply(MODE_IDLE, TargetTemps(heat=21, cool=24))

    assert report.failed_eids == {"climate.ac"}
    assert report.inactive_eids == set()
    operations = report.operation_results["climate.ac"]
    assert [operation.dispatch for operation in operations] == [DispatchStatus.SENT, DispatchStatus.FAILED]
    assert [operation.service for operation in operations] == ["set_hvac_mode", "set_fan_mode"]
    assert len({operation.context_id for operation in operations}) == 2
    assert [evidence.application for evidence in ledger.snapshot()] == [
        ApplicationStatus.CONFIRMED,
        ApplicationStatus.UNKNOWN,
    ]


async def test_missing_idle_boundary_is_unsupported():
    hass, controller, _ = _controller("off", attrs={"hvac_modes": ["cool"], "max_temp": None})

    report = await controller.async_apply(MODE_IDLE, TargetTemps(heat=21, cool=24))

    hass.services.async_call.assert_not_called()
    assert report.inactive_eids == set()
    assert report.results["climate.ac"].dispatch is DispatchStatus.UNSUPPORTED


@pytest.mark.parametrize(
    ("attrs", "cached_setpoint"),
    [
        ({"hvac_modes": ["heat"]}, {"temperature": 16}),
        (
            {"hvac_modes": ["heat_cool"], "target_temp_low": 20, "target_temp_high": 24},
            {"target_temp_low": 16, "target_temp_high": 30},
        ),
        (
            {"hvac_modes": ["cool"], "target_temp_low": 20, "target_temp_high": 24},
            {"target_temp_low": 30, "target_temp_high": 30},
        ),
    ],
)
async def test_no_off_fallback_retries_when_reported_setpoint_disagrees_with_cache(attrs, cached_setpoint):
    """Retained device attributes must preserve the existing idle-retry safeguard."""
    hass, _, _ = _controller("off", attrs=attrs, hvac_mode="unavailable")
    _last_commands["climate.ac"] = {"service": "set_temperature", **cached_setpoint}

    operations = await async_turn_off_climate(hass, "climate.ac")

    hass.services.async_call.assert_called_once()
    assert operations[0].dispatch is DispatchStatus.SENT
    assert operations[0].desired == {"entity_id": "climate.ac", **cached_setpoint}
