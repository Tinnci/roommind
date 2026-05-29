"""Tests for pure room target resolution orchestration."""

from __future__ import annotations

from custom_components.roommind.const import TargetTemps
from custom_components.roommind.utils.target_resolution import resolve_room_targets


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

