"""Tests for sleep-device helpers, phased night resolution, and coupled air setback."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import MagicMock

import pytest
from homeassistant.util import dt as dt_util

from custom_components.roommind.utils.night_utils import resolve_sleep_phase
from custom_components.roommind.utils.sleep_device import (
    format_ab_gears,
    inspect_sleep_device_state,
    parse_ab_gears,
    parse_qushui_sleep_curve,
    update_qushui_sleep_curve,
)
from custom_components.roommind.utils.target_resolution import prepare_control_target_plan


def _mock_hass(states: dict[str, tuple[str, dict]] | None = None) -> MagicMock:
    hass = MagicMock()
    hass.config.units.temperature_unit = "°C"
    state_map = states or {}

    def _get(eid: str):
        if eid not in state_map:
            return None
        val, attrs = state_map[eid]
        st = MagicMock()
        st.state = val
        st.attributes = attrs
        return st

    hass.states.get.side_effect = _get
    return hass


def test_ab_gears_round_trip_and_clamp():
    assert parse_ab_gears("2-5") == (2, 5)
    assert parse_ab_gears(" 0 - 9 ") == (0, 6)
    assert parse_ab_gears("invalid") is None
    assert format_ab_gears(-1, 8) == "0-6"


def test_qushui_sleep_curve_parse_and_preserve_tail_segments():
    raw = "0-1-23000700-031-00-10090708"
    parsed = parse_qushui_sleep_curve(raw)
    assert parsed is not None
    assert parsed["enabled"] is True
    assert parsed["start"] == "23:00"
    assert parsed["end"] == "07:00"

    updated = update_qushui_sleep_curve(raw, enabled=False, start="22:30", end="06:45")
    assert updated == "0-0-22300645-031-00-10090708"

    fresh = update_qushui_sleep_curve("", enabled=True, start="23:15", end="07:30")
    assert fresh == "0-1-23150730-031-00-10090708"


def test_resolve_sleep_phase_supports_clock_entity_and_tonight_overrides():
    cfg = {
        "night_mode_enabled": True,
        "quiet_hours": {"start": "23:00", "end": "07:00"},
        "sleep_trigger_mode": "either",
        "sleep_prewarm_minutes": 30,
        "sleep_prewake_minutes": 30,
    }

    prewarm = resolve_sleep_phase(cfg, now=datetime(2026, 11, 25, 22, 40))
    assert prewarm.phase == "pre_warm"
    assert prewarm.night_active is False
    assert prewarm.trigger_source == "clock"

    deep = resolve_sleep_phase(cfg, now=datetime(2026, 11, 25, 1, 15))
    assert deep.phase == "sleep"
    assert deep.night_active is True

    prewake = resolve_sleep_phase(cfg, now=datetime(2026, 11, 25, 6, 45))
    assert prewake.phase == "pre_wake"
    assert prewake.night_active is True

    early_entity = resolve_sleep_phase(
        cfg,
        now=datetime(2026, 11, 25, 21, 0),
        trigger_entity_on=True,
    )
    assert early_entity.phase == "sleep"
    assert early_entity.night_active is True
    assert early_entity.trigger_source == "entity"

    skipped = resolve_sleep_phase(
        cfg,
        now=datetime(2026, 11, 25, 1, 15),
        tonight_override="skip",
    )
    assert skipped.phase == "day"
    assert skipped.night_active is False
    assert skipped.trigger_source == "override"


def test_inspect_sleep_device_state_reads_safety_and_zones():
    hass = _mock_hass(
        {
            "switch.blanket_on": ("on", {}),
            "switch.blanket_sleep": ("on", {}),
            "text.blanket_gears": ("2-3", {}),
            "number.blanket_cd_a": ("180", {}),
            "binary_sensor.blanket_remote": ("on", {}),
            "binary_sensor.blanket_mite": ("off", {}),
            "switch.blanket_scald": ("on", {}),
            "sensor.blanket_fault": ("正常", {}),
            "text.blanket_a_sleep": ("0-1-23000700-031-00-10090708", {}),
        }
    )
    status = inspect_sleep_device_state(
        hass,
        {
            "name": "8H Z1",
            "power_entity": "switch.blanket_on",
            "sleep_switch_entity": "switch.blanket_sleep",
            "gears_entity": "text.blanket_gears",
            "zone_a_countdown_entity": "number.blanket_cd_a",
            "remote_switch_entity": "binary_sensor.blanket_remote",
            "mite_removal_entity": "binary_sensor.blanket_mite",
            "anti_scald_entity": "switch.blanket_scald",
            "fault_entity": "sensor.blanket_fault",
            "zone_a_sleep_entity": "text.blanket_a_sleep",
        },
    )
    assert status is not None
    assert status["heating_active"] is True
    assert status["gear_a"] == 2
    assert status["gear_b"] == 3
    assert status["countdown_a"] == 180
    assert status["remote_enabled"] is True
    assert status["mite_removal_active"] is False
    assert status["fault_ok"] is True
    assert status["zone_a_curve"] == {"enabled": True, "start": "23:00", "end": "07:00"}


@pytest.mark.asyncio
async def test_prepare_control_target_plan_applies_coupled_offset_only_when_heating():
    hass = _mock_hass()
    room = {
        "area_id": "wo_shi",
        "climate_mode": "heat_only",
        "comfort_heat": 21.0,
        "eco_heat": 17.0,
        "schedules": [],
        "night_mode_enabled": True,
        "quiet_hours": {"start": "22:00", "end": "07:00"},
        "sleep_temp_ramp_c": 0.5,
        "sleep_coupled_offset_c": 1.5,
        "sleep_prewarm_minutes": 30,
        "sleep_prewake_minutes": 30,
    }
    ts_sleep = datetime(2026, 11, 25, 23, 30, tzinfo=dt_util.DEFAULT_TIME_ZONE).timestamp()
    plan_off = await prepare_control_target_plan(
        hass, room, {}, now=ts_sleep, sleep_device_heating=False
    )
    assert plan_off.sleep_phase == "sleep"
    assert plan_off.coupled_offset_active is False
    assert plan_off.targets.heat == pytest.approx(20.5)

    plan_on = await prepare_control_target_plan(
        hass, room, {}, now=ts_sleep, sleep_device_heating=True
    )
    assert plan_on.sleep_phase == "sleep"
    assert plan_on.coupled_offset_active is True
    assert plan_on.targets.heat == pytest.approx(19.0)

    ts_prewake = datetime(2026, 11, 26, 6, 45, tzinfo=dt_util.DEFAULT_TIME_ZONE).timestamp()
    plan_prewake = await prepare_control_target_plan(
        hass, room, {}, now=ts_prewake, sleep_device_heating=True
    )
    assert plan_prewake.sleep_phase == "pre_wake"
    assert plan_prewake.targets.heat == pytest.approx(21.0)
