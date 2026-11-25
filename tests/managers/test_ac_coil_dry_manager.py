"""Tests for AC evaporator coil drying manager."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.roommind.const import MODE_COOLING, MODE_IDLE
from custom_components.roommind.managers.ac_coil_dry_manager import AcCoilDryManager


def _make_hass(hvac_modes=None, fan_modes=None, fan_mode="high", state_val="cool"):
    hass = MagicMock()
    st = SimpleNamespace(
        state=state_val,
        attributes={
            "hvac_modes": hvac_modes if hvac_modes is not None else ["off", "cool", "fan_only"],
            "fan_modes": fan_modes if fan_modes is not None else ["low", "medium", "high"],
            "fan_mode": fan_mode,
        },
    )
    hass.states.get = MagicMock(return_value=st)
    hass.services.async_call = AsyncMock()
    return hass


@pytest.mark.asyncio
async def test_coil_dry_triggers_after_cooling_and_completes(monkeypatch) -> None:
    """Extended cooling triggers bounded fan_only run after cooling stops, then restores fan."""
    now = [1000.0]
    monkeypatch.setattr("custom_components.roommind.managers.ac_coil_dry_manager.time.time", lambda: now[0])
    hass = _make_hass()
    mgr = AcCoilDryManager(hass)
    room = {
        "devices": [{"entity_id": "climate.ac", "type": "ac", "idle_action": "off"}],
    }
    settings = {
        "coil_dry_enabled": True,
        "coil_dry_min_cooling_minutes": 10,
        "coil_dry_minutes": 15,
        "coil_dry_mode": "fan_only",
        "coil_dry_fan_mode": "low",
        "coil_dry_drain_minutes": 0,
    }

    # Cool for 12 minutes
    res1 = await mgr.async_process_room(
        area_id="bedroom",
        room=room,
        settings=settings,
        mode=MODE_COOLING,
        commandable=True,
        compressor_forced_on=set(),
        compressor_forced_off=set(),
        exclude_eids=set(),
        force_off=False,
        can_activate=lambda _eid: True,
    )
    assert not res1.active

    now[0] += 12 * 60
    # Stop cooling -> starts coil dry blow phase
    res2 = await mgr.async_process_room(
        area_id="bedroom",
        room=room,
        settings=settings,
        mode=MODE_IDLE,
        commandable=True,
        compressor_forced_on=set(),
        compressor_forced_off=set(),
        exclude_eids=set(),
        force_off=False,
        can_activate=lambda _eid: True,
    )
    assert res2.active is True
    assert res2.phase == "blow"
    assert res2.controlled_eids == {"climate.ac"}
    assert res2.skip_ekf_training is False
    calls = [c.args[:3] for c in hass.services.async_call.call_args_list]
    assert ("climate", "set_hvac_mode", {"entity_id": "climate.ac", "hvac_mode": "fan_only"}) in calls
    assert ("climate", "set_fan_mode", {"entity_id": "climate.ac", "fan_mode": "low"}) in calls

    # Device reflects new fan_mode="low"
    hass.states.get.return_value.attributes["fan_mode"] = "low"
    hass.services.async_call.reset_mock()

    # Complete 15 min blow -> restores prev_fan_mode ("high") and clears state
    now[0] += 16 * 60
    res3 = await mgr.async_process_room(
        area_id="bedroom",
        room=room,
        settings=settings,
        mode=MODE_IDLE,
        commandable=True,
        compressor_forced_on=set(),
        compressor_forced_off=set(),
        exclude_eids=set(),
        force_off=False,
        can_activate=lambda _eid: True,
    )
    assert res3.active is False
    restore_calls = [c.args[:3] for c in hass.services.async_call.call_args_list]
    assert ("climate", "set_fan_mode", {"entity_id": "climate.ac", "fan_mode": "high"}) in restore_calls


def test_coil_dry_serialization_roundtrip(monkeypatch) -> None:
    """Wetness state survives get_state / load_state without losing elapsed minutes."""
    now = [2000.0]
    monkeypatch.setattr("custom_components.roommind.managers.ac_coil_dry_manager.time.time", lambda: now[0])
    hass = _make_hass()
    mgr = AcCoilDryManager(hass)
    mgr.load_state({"climate.ac": {"wet_seconds": 480.0, "expires_at": now[0] + 1000.0}})
    saved = mgr.get_state()
    assert saved["climate.ac"]["wet_seconds"] == 480.0
