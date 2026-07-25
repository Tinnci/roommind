"""Tests for MPC applied command reporting."""

from __future__ import annotations

import pytest

from custom_components.roommind.const import MODE_HEATING, MODE_IDLE, TargetTemps
from custom_components.roommind.control.mpc_controller import AppliedCommandReport, MPCController
from custom_components.roommind.control.thermal_model import RoomModelManager
from custom_components.roommind.managers.heat_source_orchestrator import DeviceCommand, HeatSourcePlan

from .conftest import build_hass, make_room


@pytest.mark.asyncio
async def test_async_apply_returns_active_and_inactive_devices():
    hass = build_hass()
    room = make_room()
    ctrl = MPCController(
        hass,
        room,
        model_manager=RoomModelManager(),
        outdoor_temp=5.0,
        settings={},
        has_external_sensor=True,
    )

    report = await ctrl.async_apply(MODE_HEATING, TargetTemps(heat=21.0, cool=24.0), current_temp=18.0)

    assert isinstance(report, AppliedCommandReport)
    assert "climate.living_trv" in report.active_eids
    assert "climate.living_trv" not in report.inactive_eids


@pytest.mark.asyncio
async def test_async_apply_reports_idle_devices_inactive():
    hass = build_hass()
    room = make_room()
    ctrl = MPCController(
        hass,
        room,
        model_manager=RoomModelManager(),
        outdoor_temp=5.0,
        settings={},
        has_external_sensor=True,
    )

    report = await ctrl.async_apply(MODE_IDLE, TargetTemps(heat=21.0, cool=24.0))

    assert isinstance(report, AppliedCommandReport)
    assert "climate.living_trv" in report.inactive_eids
    assert "climate.living_trv" not in report.active_eids


@pytest.mark.asyncio
async def test_async_apply_reports_forced_on_heat_source_thermostat_active():
    hass = build_hass()
    room = make_room()
    ctrl = MPCController(
        hass,
        room,
        model_manager=RoomModelManager(),
        outdoor_temp=5.0,
        settings={},
        has_external_sensor=True,
    )
    plan = HeatSourcePlan(
        commands=[
            DeviceCommand(
                entity_id="climate.living_trv",
                role="primary",
                device_type="thermostat",
                active=False,
                power_fraction=0.0,
                reason="compressor min-run",
            )
        ],
        active_sources="none",
        reason="test",
    )

    report = await ctrl.async_apply(
        MODE_HEATING,
        TargetTemps(heat=21.0, cool=24.0),
        current_temp=18.0,
        heat_source_plan=plan,
        compressor_forced_on={"climate.living_trv"},
    )

    assert "climate.living_trv" in report.active_eids
    assert "climate.living_trv" not in report.inactive_eids
