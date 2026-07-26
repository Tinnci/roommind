"""Tests for the pure rapid-recovery control policy."""

from custom_components.roommind.const import MODE_COOLING, MODE_HEATING, TargetTemps
from custom_components.roommind.control.rapid_recovery import resolve_rapid_recovery_mode


def test_missing_temperature_disables_recovery():
    assert (
        resolve_rapid_recovery_mode(
            {},
            {},
            current_temp=None,
            targets=TargetTemps(heat=21.0, cool=24.0),
            night_active=False,
            outdoor_temp=10.0,
        )
        is None
    )


def test_night_policy_can_disable_recovery():
    assert (
        resolve_rapid_recovery_mode(
            {"night_allow_rapid_recovery": False},
            {},
            current_temp=17.0,
            targets=TargetTemps(heat=21.0, cool=24.0),
            night_active=True,
            outdoor_temp=10.0,
        )
        is None
    )


def test_threshold_boundary_selects_heating_or_cooling():
    room = {"rapid_recovery_delta_c": 2.0}

    assert (
        resolve_rapid_recovery_mode(
            room,
            {},
            current_temp=19.0,
            targets=TargetTemps(heat=21.0, cool=24.0),
            night_active=False,
            outdoor_temp=10.0,
        )
        == MODE_HEATING
    )
    assert (
        resolve_rapid_recovery_mode(
            room,
            {},
            current_temp=26.0,
            targets=TargetTemps(heat=21.0, cool=24.0),
            night_active=False,
            outdoor_temp=25.0,
        )
        == MODE_COOLING
    )


def test_custom_threshold_defers_recovery_inside_band():
    assert (
        resolve_rapid_recovery_mode(
            {"rapid_recovery_delta_c": 3.0},
            {},
            current_temp=18.5,
            targets=TargetTemps(heat=21.0, cool=24.0),
            night_active=False,
            outdoor_temp=10.0,
        )
        is None
    )


def test_climate_mode_blocks_unavailable_direction():
    assert (
        resolve_rapid_recovery_mode(
            {"climate_mode": "cool_only"},
            {},
            current_temp=17.0,
            targets=TargetTemps(heat=21.0, cool=24.0),
            night_active=False,
            outdoor_temp=10.0,
        )
        is None
    )
    assert (
        resolve_rapid_recovery_mode(
            {"climate_mode": "heat_only"},
            {},
            current_temp=27.0,
            targets=TargetTemps(heat=21.0, cool=24.0),
            night_active=False,
            outdoor_temp=25.0,
        )
        is None
    )


def test_outdoor_safety_gates_each_direction():
    settings = {"outdoor_cooling_min": 16.0, "outdoor_heating_max": 22.0}

    assert (
        resolve_rapid_recovery_mode(
            {},
            settings,
            current_temp=27.0,
            targets=TargetTemps(heat=21.0, cool=24.0),
            night_active=False,
            outdoor_temp=15.0,
        )
        is None
    )
    assert (
        resolve_rapid_recovery_mode(
            {},
            settings,
            current_temp=17.0,
            targets=TargetTemps(heat=21.0, cool=24.0),
            night_active=False,
            outdoor_temp=23.0,
        )
        is None
    )
