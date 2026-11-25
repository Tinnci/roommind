"""Focused unit tests for MasterDeviceManager."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.roommind.const import MODE_COOLING, MODE_HEATING
from custom_components.roommind.managers.compressor_group_manager import CompressorGroupManager
from custom_components.roommind.managers.master_device_manager import MasterDeviceManager


def _make_state(state: str, attrs: dict | None = None) -> MagicMock:
    obj = MagicMock()
    obj.state = state
    obj.attributes = attrs or {}
    return obj


def _make_hass(states: dict[str, MagicMock]) -> MagicMock:
    hass = MagicMock()
    hass.states.get.side_effect = states.get
    hass.services.async_call = AsyncMock()
    return hass


def test_collect_member_room_modes_filters_orchestrated_rooms() -> None:
    """Heat-source orchestration filters out rooms where the group's devices are inactive."""
    cm = CompressorGroupManager()
    mgr = MasterDeviceManager(MagicMock(), cm)
    rooms = {
        "living": {
            "climate_control_enabled": True,
            "is_outdoor": False,
            "heat_source_orchestration": True,
            "devices": [{"entity_id": "climate.boiler", "type": "trv", "role": "primary"}],
        },
        "study": {
            "climate_control_enabled": True,
            "is_outdoor": False,
            "devices": [{"entity_id": "climate.ac_study", "type": "ac", "role": "primary"}],
        },
    }
    room_states = {
        "living": {"commanded_mode": MODE_HEATING, "active_heat_sources": "secondary"},
        "study": {"commanded_mode": MODE_COOLING},
    }
    assert mgr.collect_member_room_modes(
        ["climate.boiler", "climate.ac_study"],
        room_states,
        rooms,
        {"climate_control_active": True},
    ) == [MODE_COOLING]


def test_resolve_master_hvac_mode_fallbacks() -> None:
    """Resolve idle -> off and missing exact mode -> heat_cool/auto fallback."""
    cm = CompressorGroupManager()
    hass = _make_hass(
        {
            "climate.master": _make_state("off", {"hvac_modes": ["off", "heat_cool", "cool"]}),
        }
    )
    mgr = MasterDeviceManager(hass, cm)
    assert mgr.resolve_master_hvac_mode("climate.master", "idle") == "off"
    assert mgr.resolve_master_hvac_mode("climate.master", "cool") == "cool"
    assert mgr.resolve_master_hvac_mode("climate.master", "heat") == "heat_cool"
    assert mgr.resolve_master_hvac_mode("climate.missing", "heat") is None


@pytest.mark.asyncio
async def test_async_control_master_devices_script_only_and_wake_zone() -> None:
    """Master control wakes fan_only zone before starting master and triggers action script."""
    cm = CompressorGroupManager()
    cm.load_groups(
        [
            {
                "id": "g1",
                "name": "Upstairs",
                "master_entity": "climate.master",
                "action_script": "script.notify_master",
                "members": ["climate.zone1"],
            }
        ]
    )
    states = {
        "climate.master": _make_state("off", {"hvac_modes": ["off", "cool", "heat"]}),
        "climate.zone1": _make_state("off", {"hvac_modes": ["off", "fan_only", "cool"]}),
        "script.notify_master": _make_state("off"),
    }
    hass = _make_hass(states)
    mgr = MasterDeviceManager(hass, cm)

    await mgr.async_control_master_devices(
        {"up": {"commanded_mode": MODE_COOLING}},
        {"up": {"climate_control_enabled": True, "devices": [{"entity_id": "climate.zone1"}]}},
        {"climate_control_active": True},
        outdoor_temp_effective=28.0,
    )

    calls = [(call.args[0], call.args[1], call.args[2]) for call in hass.services.async_call.await_args_list]
    assert calls[0] == ("climate", "set_hvac_mode", {"entity_id": "climate.zone1", "hvac_mode": "fan_only"})
    assert calls[1] == ("climate", "set_hvac_mode", {"entity_id": "climate.master", "hvac_mode": "cool"})
    assert calls[2][0] == "script" and calls[2][1] == "turn_on"
    assert calls[2][2]["variables"]["action"] == "cool"
    assert cm.get_state("g1").master_action == "cool"
