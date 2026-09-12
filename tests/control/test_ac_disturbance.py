"""Regression coverage for AC setpoint planning and avoidable commands."""

from unittest.mock import MagicMock

import pytest

from custom_components.roommind.const import TargetTemps
from custom_components.roommind.control.climate_actuator import async_idle_device
from custom_components.roommind.control.mpc_controller import MPCController
from custom_components.roommind.control.thermal_model import RoomModelManager

from .conftest import build_hass, make_room


def ac_state(mode="cool", temperature=24.0, **attributes):
    state = MagicMock()
    state.state = mode
    state.attributes = {
        "hvac_modes": ["off", "heat", "cool"],
        "min_temp": 16.0,
        "max_temp": 30.0,
        "target_temp_step": 0.5,
        "temperature": temperature,
        **attributes,
    }
    return state


@pytest.mark.parametrize("idle_action", ["off", "fan_only", "setback"])
async def test_ac_off_does_not_first_request_maximum_cooling(idle_action):
    hass = build_hass()
    hass.states.get.return_value = ac_state()
    devices = [{"entity_id": "climate.ac", "type": "ac", "idle_action": idle_action}]

    results = await async_idle_device(hass, "climate.ac", devices)

    assert [(result.service, result.desired) for result in results] == [
        ("set_hvac_mode", {"entity_id": "climate.ac", "hvac_mode": "off"})
    ]
    assert hass.services.async_call.call_count == 1


async def test_trv_retains_setpoint_before_off_protection():
    hass = build_hass()
    hass.states.get.return_value = ac_state("heat", min_temp=5.0)

    results = await async_idle_device(hass, "climate.trv", [{"entity_id": "climate.trv", "type": "trv"}])

    assert [result.service for result in results] == ["set_temperature", "set_hvac_mode"]
    assert results[0].desired["temperature"] == 5.0


@pytest.mark.parametrize(
    "mode,room_temp,target,fraction,expected",
    [
        ("cooling", 26.0, 24.0, 0.75, 23.0),
        ("cooling", 26.0, 24.0, 1.0, 22.0),
        ("heating", 19.0, 21.0, 0.75, 22.0),
        ("heating", 19.0, 21.0, 1.0, 23.0),
    ],
)
async def test_offset_defines_modulation_range_instead_of_saturating_partial_demand(
    mode, room_temp, target, fraction, expected
):
    hass = build_hass()
    hass.states.get.return_value = ac_state("off", temperature=25.0)
    room = make_room(thermostats=[], acs=["climate.ac"])
    room["devices"][0]["max_setpoint_offset_c"] = 2.0
    targets = TargetTemps(heat=target, cool=target)
    controller = MPCController(hass, room, model_manager=RoomModelManager())

    report = await controller.async_apply(mode, targets, current_temp=room_temp, power_fraction=fraction)

    assert report.results["climate.ac"].desired["temperature"] == expected
    assert targets == TargetTemps(heat=target, cool=target)


async def test_one_device_dispatch_cannot_change_another_devices_plan():
    hass = build_hass()
    states = {eid: ac_state("heat", temperature=21.0) for eid in ("climate.a", "climate.b")}
    hass.states.get.side_effect = states.get

    async def dispatch(domain, service, data, **kwargs):
        if data["entity_id"] == "climate.a":
            states["climate.b"].attributes["max_temp"] = 18.0

    hass.services.async_call.side_effect = dispatch
    controller = MPCController(hass, make_room(thermostats=[], acs=list(states)), model_manager=RoomModelManager())

    report = await controller.async_apply("heating", TargetTemps(heat=21.0, cool=24.0), current_temp=19.0)

    assert report.results["climate.b"].desired["temperature"] == 30.0


@pytest.mark.parametrize("night,interval", [(False, 120.0), (True, 300.0)])
async def test_small_ac_adjustments_wait_then_dispatch_latest_plan(monkeypatch, night, interval):
    from custom_components.roommind.control import climate_actuator

    now = 1000.0
    monkeypatch.setattr(climate_actuator.time, "monotonic", lambda: now)
    hass = build_hass()
    state = ac_state(temperature=25.0)
    hass.states.get.return_value = state
    room = make_room(thermostats=[], acs=["climate.ac"])
    room["devices"][0]["max_setpoint_offset_c"] = 2.0

    async def apply(fraction, target=24.0):
        controller = MPCController(hass, room, model_manager=RoomModelManager(), night_active=night)
        return await controller.async_apply(
            "cooling", TargetTemps(heat=21.0, cool=target), current_temp=26.0, power_fraction=fraction
        )

    await apply(0.5)
    state.attributes["temperature"] = 24.0
    now += 30.0
    pending = await apply(0.625)
    assert pending.results["climate.ac"].dispatch == "deferred"
    assert not pending.active_eids
    assert not pending.failed_eids
    assert hass.services.async_call.call_count == 1

    now = 1000.0 + interval
    latest = await apply(0.75)
    assert latest.results["climate.ac"].dispatch == "sent"
    assert latest.results["climate.ac"].desired["temperature"] == 23.0
    assert hass.services.async_call.call_count == 2


@pytest.mark.parametrize("change", ["reduce_output", "target", "large_increase", "idle", "protection"])
async def test_comfort_changes_and_protection_bypass_temperature_cadence(monkeypatch, change):
    from custom_components.roommind.control import climate_actuator

    monkeypatch.setattr(climate_actuator.time, "monotonic", lambda: 1000.0)
    hass = build_hass()
    state = ac_state(temperature=25.0)
    hass.states.get.return_value = state
    room = make_room(thermostats=[], acs=["climate.ac"])
    room["devices"][0]["max_setpoint_offset_c"] = 2.0
    controller = MPCController(hass, room, model_manager=RoomModelManager(), night_active=True)
    targets = TargetTemps(heat=21.0, cool=24.0)
    await controller.async_apply(
        "cooling", targets, current_temp=26.0, power_fraction=0.75 if change == "reduce_output" else 0.5
    )
    state.attributes["temperature"] = 23.0 if change == "reduce_output" else 24.0
    mode = "idle" if change in {"idle", "protection"} else "cooling"
    if change == "target":
        targets = TargetTemps(heat=21.0, cool=23.5)

    report = await controller.async_apply(
        mode,
        targets,
        current_temp=26.0,
        power_fraction=1.0 if change == "large_increase" else 0.625,
        compressor_forced_on={"climate.ac"} if change == "protection" else None,
    )

    assert report.results["climate.ac"].dispatch != "deferred"
    assert not report.failed_eids


async def test_unconfirmed_temperature_retries_are_bounded_and_external_changes_are_honored(monkeypatch):
    from custom_components.roommind.control import climate_actuator

    now = 1000.0
    monkeypatch.setattr(climate_actuator.time, "monotonic", lambda: now)
    hass = build_hass()
    state = ac_state(temperature=25.0)
    hass.states.get.return_value = state
    room = make_room(thermostats=[], acs=["climate.ac"])
    room["devices"][0]["max_setpoint_offset_c"] = 2.0
    controller = MPCController(hass, room, model_manager=RoomModelManager())

    async def apply():
        return await controller.async_apply(
            "cooling", TargetTemps(heat=21.0, cool=24.0), current_temp=26.0, power_fraction=0.5
        )

    await apply()
    now += 30.0
    assert (await apply()).results["climate.ac"].dispatch == "deferred"
    now += 90.0
    assert (await apply()).results["climate.ac"].dispatch == "sent"
    state.attributes["temperature"] = 26.0
    assert (await apply()).results["climate.ac"].dispatch == "sent"


async def test_night_setpoint_chatter_converges_without_delaying_load_reduction(monkeypatch):
    from custom_components.roommind.control import climate_actuator

    now = 1000.0
    monkeypatch.setattr(climate_actuator.time, "monotonic", lambda: now)
    hass = build_hass()
    state = ac_state(temperature=25.0)
    hass.states.get.return_value = state
    temperatures = []

    async def dispatch(domain, service, data, **kwargs):
        if service == "set_temperature":
            temperatures.append(data["temperature"])
            state.attributes["temperature"] = data["temperature"]

    hass.services.async_call.side_effect = dispatch
    room = make_room(thermostats=[], acs=["climate.ac"])
    room["devices"][0]["max_setpoint_offset_c"] = 2.0
    controller = MPCController(hass, room, model_manager=RoomModelManager(), night_active=True)
    for tick in range(18):
        now = 1000.0 + tick * 30.0
        await controller.async_apply(
            "cooling",
            TargetTemps(heat=21.0, cool=24.0),
            current_temp=26.0,
            power_fraction=0.625 if tick % 2 else 0.5,
        )

    assert temperatures == [24.0, 23.5, 24.0]


@pytest.mark.parametrize("fahrenheit", [False, True])
async def test_encoded_temperature_feedback_does_not_trigger_repeated_commands(fahrenheit):
    from homeassistant.const import UnitOfTemperature

    hass = build_hass()
    hass.config.units.temperature_unit = UnitOfTemperature.FAHRENHEIT if fahrenheit else UnitOfTemperature.CELSIUS

    def native(value):
        return value * 1.8 + 32 if fahrenheit else value

    state = ac_state(
        temperature=native(24.0),
        min_temp=native(16.0),
        max_temp=native(31.0),
        target_temp_step_c=0.5,
        target_temp_tolerance_c=0.25,
    )
    hass.states.get.return_value = state
    room = make_room(thermostats=[], acs=["climate.ac"])
    room["devices"][0]["max_setpoint_offset_c"] = 0.0
    controller = MPCController(hass, room, model_manager=RoomModelManager())
    targets = TargetTemps(heat=21.0, cool=23.5)

    first = await controller.async_apply("cooling", targets, current_temp=26.0)
    assert first.results["climate.ac"].desired["temperature"] == pytest.approx(native(23.5))
    state.attributes["temperature"] = native(23.3)
    second = await controller.async_apply("cooling", targets, current_temp=26.0)
    assert second.results["climate.ac"].dispatch == "skipped"
    assert hass.services.async_call.call_count == 1

    adjacent = await controller.async_apply("cooling", TargetTemps(heat=21.0, cool=24.0), current_temp=26.0)
    assert adjacent.results["climate.ac"].dispatch == "sent"
