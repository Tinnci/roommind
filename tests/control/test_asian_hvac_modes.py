"""Tests for Asian HVAC climate modes: dry, fan_only, and off."""

from __future__ import annotations

from unittest.mock import ANY, MagicMock

import pytest

from custom_components.roommind.const import (
    CLIMATE_MODE_DRY,
    CLIMATE_MODE_FAN_ONLY,
    CLIMATE_MODE_OFF,
    MODE_DRY,
    MODE_FAN_ONLY,
    MODE_IDLE,
    TargetTemps,
)
from custom_components.roommind.control.mpc_controller import (
    MPCController,
    clear_command_cache,
    get_can_heat_cool,
)
from custom_components.roommind.control.thermal_model import RoomModelManager

from .conftest import build_hass, make_room


@pytest.mark.parametrize("climate_mode", [CLIMATE_MODE_DRY, CLIMATE_MODE_FAN_ONLY, CLIMATE_MODE_OFF])
def test_get_can_heat_cool_disabled_for_non_thermal_modes(climate_mode: str) -> None:
    """Dry, fan_only, and off disable thermal heating/cooling MPC flags."""
    room = make_room(climate_mode=climate_mode, thermostats=["climate.trv"], acs=["climate.ac"])
    assert get_can_heat_cool(room, acs_can_heat=True) == (False, False)


@pytest.mark.asyncio
@pytest.mark.parametrize("has_external_sensor", [True, False])
async def test_evaluate_off_dry_fan_only_modes(has_external_sensor: bool) -> None:
    """MPCController evaluates off, dry, and fan_only deterministically."""
    hass = build_hass()
    model_mgr = RoomModelManager()

    room_off = make_room(climate_mode=CLIMATE_MODE_OFF, thermostats=[], acs=["climate.ac"])
    ctrl_off = MPCController(hass, room_off, model_manager=model_mgr, has_external_sensor=has_external_sensor)
    assert await ctrl_off.async_evaluate(25.0, TargetTemps(heat=21.0, cool=24.0)) == (MODE_IDLE, 0.0)

    room_dry = make_room(climate_mode=CLIMATE_MODE_DRY, thermostats=[], acs=["climate.ac"])
    ctrl_dry = MPCController(hass, room_dry, model_manager=model_mgr, has_external_sensor=has_external_sensor)
    assert await ctrl_dry.async_evaluate(25.0, TargetTemps(heat=None, cool=None)) == (MODE_DRY, 1.0)

    room_fan = make_room(climate_mode=CLIMATE_MODE_FAN_ONLY, thermostats=[], acs=["climate.ac"])
    ctrl_fan = MPCController(hass, room_fan, model_manager=model_mgr, has_external_sensor=has_external_sensor)
    assert await ctrl_fan.async_evaluate(25.0, TargetTemps(heat=None, cool=None)) == (MODE_FAN_ONLY, 1.0)

    room_dry_no_ac = make_room(climate_mode=CLIMATE_MODE_DRY, thermostats=["climate.trv"], acs=[])
    ctrl_no_ac = MPCController(hass, room_dry_no_ac, model_manager=model_mgr, has_external_sensor=has_external_sensor)
    assert await ctrl_no_ac.async_evaluate(25.0, TargetTemps(heat=21.0, cool=24.0)) == (MODE_IDLE, 0.0)


@pytest.mark.asyncio
async def test_apply_dry_commands_ac_dry_and_idles_trv() -> None:
    """Dry mode sets AC to dry and idles TRVs without requiring a temperature target."""
    clear_command_cache()
    hass = build_hass()

    ac_state = MagicMock()
    ac_state.state = "off"
    ac_state.attributes = {"hvac_modes": ["off", "cool", "dry", "fan_only", "heat"]}

    trv_state = MagicMock()
    trv_state.state = "heat"
    trv_state.attributes = {"hvac_modes": ["heat", "off"], "min_temp": 5.0}

    hass.states.get = MagicMock(side_effect=lambda eid: ac_state if eid == "climate.ac" else trv_state)

    room = make_room(climate_mode=CLIMATE_MODE_DRY, thermostats=["climate.trv"], acs=["climate.ac"])
    ctrl = MPCController(hass, room, model_manager=RoomModelManager(), has_external_sensor=True)
    report = await ctrl.async_apply(MODE_DRY, TargetTemps(heat=None, cool=None))

    assert "climate.ac" in report.active_eids
    assert "climate.trv" in report.inactive_eids
    hass.services.async_call.assert_any_call(
        "climate",
        "set_hvac_mode",
        {"entity_id": "climate.ac", "hvac_mode": "dry"},
        blocking=True,
        context=ANY,
    )
    hass.services.async_call.assert_any_call(
        "climate",
        "set_hvac_mode",
        {"entity_id": "climate.trv", "hvac_mode": "off"},
        blocking=True,
        context=ANY,
    )


@pytest.mark.asyncio
async def test_apply_dry_falls_back_to_cool_when_dry_unsupported() -> None:
    """Dry mode falls back to cooling when AC lacks native dry support."""
    clear_command_cache()
    hass = build_hass()

    ac_state = MagicMock()
    ac_state.state = "off"
    ac_state.attributes = {"hvac_modes": ["off", "cool", "heat"], "min_temp": 16.0, "max_temp": 30.0}
    hass.states.get = MagicMock(return_value=ac_state)

    room = make_room(climate_mode=CLIMATE_MODE_DRY, thermostats=[], acs=["climate.ac"])
    ctrl = MPCController(hass, room, model_manager=RoomModelManager(), has_external_sensor=False)
    report = await ctrl.async_apply(MODE_DRY, TargetTemps(heat=21.0, cool=25.0))

    assert "climate.ac" in report.active_eids
    hass.services.async_call.assert_any_call(
        "climate",
        "set_hvac_mode",
        {"entity_id": "climate.ac", "hvac_mode": "cool"},
        blocking=True,
        context=ANY,
    )


@pytest.mark.asyncio
async def test_apply_fan_only_sets_fan_only_and_idle_fan_mode() -> None:
    """Fan-only room mode commands fan_only plus configured idle_fan_mode."""
    clear_command_cache()
    hass = build_hass()

    ac_state = MagicMock()
    ac_state.state = "off"
    ac_state.attributes = {
        "hvac_modes": ["off", "cool", "fan_only"],
        "fan_modes": ["low", "medium", "high"],
        "fan_mode": "high",
    }
    hass.states.get = MagicMock(return_value=ac_state)

    room = make_room(climate_mode=CLIMATE_MODE_FAN_ONLY, thermostats=[], acs=["climate.ac"])
    room["devices"] = [{"entity_id": "climate.ac", "type": "ac", "role": "auto", "idle_fan_mode": "low"}]
    ctrl = MPCController(hass, room, model_manager=RoomModelManager(), has_external_sensor=True)
    report = await ctrl.async_apply(MODE_FAN_ONLY, TargetTemps(heat=None, cool=None))

    assert "climate.ac" in report.active_eids
    hass.services.async_call.assert_any_call(
        "climate",
        "set_hvac_mode",
        {"entity_id": "climate.ac", "hvac_mode": "fan_only"},
        blocking=True,
        context=ANY,
    )
    hass.services.async_call.assert_any_call(
        "climate",
        "set_fan_mode",
        {"entity_id": "climate.ac", "fan_mode": "low"},
        blocking=True,
        context=ANY,
    )


@pytest.mark.asyncio
async def test_apply_explicit_off_mode_turns_off_even_with_fan_only_idle_action() -> None:
    """Explicit Off climate_mode turns devices off rather than leaving fan_only idle active."""
    clear_command_cache()
    hass = build_hass()

    ac_state = MagicMock()
    ac_state.state = "fan_only"
    ac_state.attributes = {"hvac_modes": ["off", "cool", "fan_only"]}
    hass.states.get = MagicMock(return_value=ac_state)

    room = make_room(climate_mode=CLIMATE_MODE_OFF, thermostats=[], acs=["climate.ac"])
    room["devices"] = [{"entity_id": "climate.ac", "type": "ac", "role": "auto", "idle_action": "fan_only"}]
    ctrl = MPCController(hass, room, model_manager=RoomModelManager(), has_external_sensor=True)
    report = await ctrl.async_apply(MODE_IDLE, TargetTemps(heat=21.0, cool=24.0))

    assert "climate.ac" in report.inactive_eids
    hass.services.async_call.assert_called_once_with(
        "climate",
        "set_hvac_mode",
        {"entity_id": "climate.ac", "hvac_mode": "off"},
        blocking=True,
        context=ANY,
    )
