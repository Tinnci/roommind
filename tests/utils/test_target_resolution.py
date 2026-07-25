"""Tests for pure room target resolution orchestration."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.const import UnitOfTemperature
from homeassistant.core import State

from custom_components.roommind.const import TargetTemps
from custom_components.roommind.utils.target_resolution import (
    prepare_control_target_plan,
    resolve_room_targets,
)


def _target_plan_hass(*, person_state: str = "home", temperature_unit: str = UnitOfTemperature.CELSIUS):
    hass = MagicMock()
    hass.config.units.temperature_unit = temperature_unit
    person = State("person.test", person_state)
    hass.states.get.side_effect = lambda entity_id: person if entity_id == person.entity_id else None
    hass.services.async_call = AsyncMock()
    return hass


def test_expired_override_and_vacation_return_cleanup_intents() -> None:
    """Expired state is reported as cleanup intent while targets fall back."""
    result = resolve_room_targets(
        now=1_000.0,
        room={
            "area_id": "living_room",
            "comfort_heat": 21.0,
            "comfort_cool": 24.0,
            "eco_heat": 17.0,
            "eco_cool": 27.0,
            "override_temp": 25.0,
            "override_until": 900.0,
        },
        settings={
            "vacation_temp": 15.0,
            "vacation_until": 950.0,
        },
        presence_away=False,
        schedule_entity_id=None,
    )

    assert result.targets == TargetTemps(heat=21.0, cool=24.0)
    assert result.clear_expired_override is True
    assert result.clear_expired_vacation is True


def test_presence_clears_override_suppresses_but_does_not_clear_override() -> None:
    """Presence-away can pause an active override without deleting it."""
    result = resolve_room_targets(
        now=1_000.0,
        room={
            "area_id": "living_room",
            "comfort_heat": 21.0,
            "comfort_cool": 24.0,
            "eco_heat": 17.0,
            "eco_cool": 27.0,
            "override_temp": 25.0,
            "override_until": 2_000.0,
        },
        settings={
            "presence_clears_override": True,
            "presence_away_action": "eco",
        },
        presence_away=True,
        schedule_entity_id="schedule.living_room",
        schedule_state="off",
    )

    assert result.targets == TargetTemps(heat=17.0, cool=27.0)
    assert result.clear_expired_override is False
    assert result.clear_expired_vacation is False


@pytest.mark.asyncio
async def test_control_target_plan_keeps_current_and_future_mold_night_targets_aligned() -> None:
    """Mold recovery and night ramp are composed identically for now and MPC."""
    hass = _target_plan_hass(person_state="not_home")
    room = {
        "comfort_heat": 21.0,
        "comfort_cool": 24.0,
        "eco_heat": 17.0,
        "eco_cool": 27.0,
        "sleep_temp_ramp_c": 1.0,
        "_night_mode_active": True,
    }
    settings = {
        "presence_enabled": True,
        "presence_persons": ["person.test"],
        "presence_away_action": "off",
    }

    plan = await prepare_control_target_plan(
        hass,
        room,
        settings,
        mold_prevention_active=True,
        mold_prevention_delta=2.0,
        now=1_000.0,
    )

    assert plan.targets == TargetTemps(heat=18.0, cool=28.0)
    assert plan.resolver(1_000.0) == plan.targets
    assert plan.force_off is False
    assert plan.presence_away is True
    assert plan.night_active is True


@pytest.mark.asyncio
async def test_control_target_plan_ignores_inactive_mold_delta() -> None:
    """A stale/non-active prevention delta must not leak into target policy."""
    hass = _target_plan_hass(person_state="not_home")
    room = {
        "eco_heat": 17.0,
        "eco_cool": 27.0,
        "_night_mode_active": False,
    }
    settings = {
        "presence_enabled": True,
        "presence_persons": ["person.test"],
        "presence_away_action": "off",
    }

    plan = await prepare_control_target_plan(
        hass,
        room,
        settings,
        mold_prevention_active=False,
        mold_prevention_delta=2.0,
        now=1_000.0,
    )

    assert plan.targets == TargetTemps(heat=None, cool=None)
    assert plan.resolver(1_000.0) == plan.targets
    assert plan.force_off is True


@pytest.mark.asyncio
async def test_control_target_plan_preserves_expired_state_cleanup_intents() -> None:
    hass = _target_plan_hass()
    room = {
        "comfort_heat": 21.0,
        "comfort_cool": 24.0,
        "override_temp": 25.0,
        "override_until": 900.0,
        "_night_mode_active": False,
    }
    settings = {
        "vacation_temp": 15.0,
        "vacation_until": 950.0,
    }

    plan = await prepare_control_target_plan(hass, room, settings, now=1_000.0)

    assert plan.targets == TargetTemps(heat=21.0, cool=24.0)
    assert plan.clear_expired_override is True
    assert plan.clear_expired_vacation is True


@pytest.mark.asyncio
async def test_control_target_plan_converts_current_and_future_schedule_targets() -> None:
    """Current state attributes and prefetched blocks use the same HA unit conversion."""
    hass = _target_plan_hass(temperature_unit=UnitOfTemperature.FAHRENHEIT)
    schedule_entity_id = "schedule.living_room"
    schedule_state = State(schedule_entity_id, "on", {"temperature": 68.0})
    hass.states.get.side_effect = lambda entity_id: schedule_state if entity_id == schedule_entity_id else None
    blocks = {
        day: [
            {
                "from": "00:00:00",
                "to": "23:59:59",
                "data": {"temperature": 68.0},
            }
        ]
        for day in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
    }
    hass.services.async_call = AsyncMock(return_value={schedule_entity_id: blocks})
    now = datetime(2026, 7, 27, 12, 0).timestamp()
    room = {
        "schedules": [{"entity_id": schedule_entity_id}],
        "comfort_heat": 70.0,
        "comfort_cool": 75.0,
        "_night_mode_active": False,
    }

    plan = await prepare_control_target_plan(hass, room, {}, now=now)

    assert plan.targets.heat == pytest.approx(20.0)
    assert plan.targets.cool == pytest.approx(20.0)
    assert plan.resolver(now).heat == pytest.approx(plan.targets.heat)
    assert plan.resolver(now).cool == pytest.approx(plan.targets.cool)
