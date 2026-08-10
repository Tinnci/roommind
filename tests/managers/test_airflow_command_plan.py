"""Tests for pure airflow command planning."""

from __future__ import annotations

from custom_components.roommind.managers.airflow_command_plan import (
    AirflowServiceCommand,
    plan_climate_airflow,
    select_climate_preset,
)


def test_idle_hvac_fan_plan_enters_fan_only_before_fan_mode() -> None:
    """Idle HVAC fan control plans fan_only transition before fan speed."""
    plan = plan_climate_airflow(
        entity_id="climate.ac",
        config={"role": "hvac_fan"},
        attrs={
            "fan_modes": ["off", "low", "medium", "high"],
            "hvac_modes": ["off", "heat", "cool", "fan_only"],
        },
        current_hvac_mode="off",
        level=0.6,
        mode="idle",
        roommind_fan_only_owned=False,
    )

    assert plan.commands == [
        AirflowServiceCommand("climate", "set_hvac_mode", {"entity_id": "climate.ac", "hvac_mode": "fan_only"}),
        AirflowServiceCommand("climate", "set_fan_mode", {"entity_id": "climate.ac", "fan_mode": "medium"}),
    ]
    assert plan.outcome == "applied"
    assert plan.fan_only_ownership == "add"
    assert plan.assumed_level == 0.6


def test_zero_level_user_owned_fan_only_is_blocked() -> None:
    """RoomMind should not turn off fan_only mode it did not start."""
    plan = plan_climate_airflow(
        entity_id="climate.ac",
        config={"role": "hvac_fan"},
        attrs={"fan_modes": ["off", "low"], "hvac_modes": ["off", "fan_only"]},
        current_hvac_mode="fan_only",
        level=0.0,
        mode="idle",
        roommind_fan_only_owned=False,
    )

    assert plan.commands == []
    assert plan.outcome == "blocked_by_mode"
    assert plan.skip_reason == "fan_only_not_roommind_owned"
    assert plan.fan_only_ownership is None
    assert plan.assumed_level is None


def test_away_climate_preset_takes_priority_over_night_and_thermal() -> None:
    """Presence-away policy is the most specific climate preset context."""
    config = {
        "preferred_preset_mode_away": "eco",
        "preferred_preset_mode_night": "sleep",
        "preferred_preset_mode_thermal": "boost",
        "preferred_preset_mode_idle": "quiet",
    }

    assert (
        select_climate_preset(
            config,
            "heating",
            night_active=True,
            away_active=True,
        )
        == "eco"
    )
