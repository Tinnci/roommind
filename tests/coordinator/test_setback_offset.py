"""Setback policy stays separate from observed physical activity."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.roommind.control.actuation import ApplicationStatus

from .conftest import SAMPLE_ROOM, _create_coordinator, _make_store_mock, make_mock_states_get


def _setback_room(area_id="living", entity_id="climate.ac", **changes):
    return {
        **SAMPLE_ROOM,
        "area_id": area_id,
        "thermostats": [],
        "acs": [entity_id],
        "devices": [{"entity_id": entity_id, "type": "ac", "role": "auto", "idle_action": "setback"}],
        **changes,
    }


@pytest.mark.parametrize("hvac_mode,expected", [("heat", 17.5), ("cool", 27.5)])
@pytest.mark.parametrize("use_override", [True, False])
async def test_cycle_uses_setback_without_changing_effective_targets(
    hass, mock_config_entry, hvac_mode, expected, use_override
):
    room = _setback_room(**({"setback_offset": 3.5} if use_override else {}))
    store = _make_store_mock({"living": room}, {"setback_offset": 5.0 if use_override else 3.5})
    hass.data = {"roommind": {"store": store}}
    hass.states.get = MagicMock(
        side_effect=make_mock_states_get(
            temp="22.0",
            extra={
                "climate.ac": (
                    hvac_mode,
                    {
                        "hvac_modes": ["heat", "cool", "off"],
                        "temperature": 22.0,
                        "min_temp": 5.0,
                        "max_temp": 35.0,
                        "hvac_action": "idle",
                    },
                )
            },
        )
    )
    hass.services.async_call = AsyncMock()
    coordinator = _create_coordinator(hass, mock_config_entry)

    result = (await coordinator._async_update_data())["rooms"]["living"]

    climate_calls = [call for call in hass.services.async_call.call_args_list if call.args[0] == "climate"]
    assert len(climate_calls) == 1
    assert climate_calls[0].args[2]["temperature"] == expected
    assert result["heat_target"] == 21.0
    assert result["cool_target"] == 24.0
    assert result["current_temp"] == 22.0
    assert result["commanded_mode"] == "idle"
    assert result["observed_mode"] == "idle"
    assert result["heating_power"] == 0
    assert result["dispatch_status"] == "sent"
    assert coordinator._actuation_ledger.snapshot()[0].application is ApplicationStatus.PENDING


async def test_setback_failure_keeps_observed_heating_as_physical_truth(hass, mock_config_entry):
    room = _setback_room(setback_offset=3.5)
    hass.data = {"roommind": {"store": _make_store_mock({"living": room})}}
    hass.states.get = MagicMock(
        side_effect=make_mock_states_get(
            temp="22.0",
            extra={
                "climate.ac": (
                    "heat",
                    {
                        "hvac_modes": ["heat", "cool", "off"],
                        "temperature": 21.0,
                        "min_temp": 5.0,
                        "max_temp": 35.0,
                        "hvac_action": "heating",
                    },
                )
            },
        )
    )
    hass.services.async_call = AsyncMock(side_effect=RuntimeError("device unreachable"))
    coordinator = _create_coordinator(hass, mock_config_entry)

    result = (await coordinator._async_update_data())["rooms"]["living"]

    assert result["commanded_mode"] == "idle"
    assert result["requested_power"] == 0
    assert result["dispatch_status"] == "failed"
    assert result["observed_mode"] == "heating"
    assert result["mode"] == "heating"
    assert result["heating_power"] > 0


async def test_settings_saved_during_actuation_take_effect_next_cycle(hass, mock_config_entry, store):
    await store.async_load()
    await store.async_save_settings({"setback_offset": 3.0})
    for name in ("one", "two"):
        await store.async_save_room(name, _setback_room(name, f"climate.{name}"))
    hass.data = {"roommind": {"store": store}}
    hass.states.get = MagicMock(
        side_effect=make_mock_states_get(
            temp="22.0",
            extra={
                f"climate.{name}": (
                    "heat",
                    {
                        "hvac_modes": ["heat", "cool", "off"],
                        "temperature": 21.0,
                        "min_temp": 5.0,
                        "max_temp": 35.0,
                        "hvac_action": "idle",
                    },
                )
                for name in ("one", "two")
            },
        )
    )

    async def dispatch(domain, service, data, **kwargs):
        if domain == "climate" and data["entity_id"] == "climate.one":
            await store.async_save_settings({"setback_offset": 5.0})

    hass.services.async_call = AsyncMock(side_effect=dispatch)
    coordinator = _create_coordinator(hass, mock_config_entry)

    await coordinator._async_update_data()
    first_cycle = [
        call.args[2]["temperature"] for call in hass.services.async_call.call_args_list if call.args[0] == "climate"
    ]
    assert first_cycle == [18.0, 18.0]
    hass.services.async_call.reset_mock()

    await coordinator._async_update_data()
    second_cycle = [
        call.args[2]["temperature"] for call in hass.services.async_call.call_args_list if call.args[0] == "climate"
    ]
    assert second_cycle == [16.0, 16.0]
