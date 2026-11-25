"""Tests for bias-compensated, online-learned AC overdrive."""

from __future__ import annotations

from custom_components.roommind.control.ac_overdrive import ACOverdriveManager


def test_bedroom_intake_bias_compensated_overdrive() -> None:
    """Room at 19.6°C vs 21.0°C target with AC reading 22.2°C should overdrive sensibly."""
    mgr = ACOverdriveManager()

    planned, diag = mgr.plan_setpoint(
        "climate.tcl_air_conditioner_2",
        target_c=21.0,
        room_temp_c=19.6,
        ac_internal_temp_c=22.2,
        demand=1.0,
        heating=True,
        limit_c=31.0,
        max_offset_c=6.0,
    )

    # Neutral setpoint to overcome +2.6°C intake plume alone is ~22.7-23.6°C,
    # plus deadband (0.5) + gain*err (1.2*1.4=1.68) => ~24.9°C (not 21.0°C and not 31.0°C).
    assert 24.0 <= planned <= 26.5
    assert diag["intake_bias_c"] > 1.5
    assert diag["commanded_setpoint_c"] == round(planned, 1)


def test_cooling_symmetry_and_max_offset_clamp() -> None:
    """Cooling compensates negative AC intake bias and honors max_offset_c cap."""
    mgr = ACOverdriveManager()

    planned, diag = mgr.plan_setpoint(
        "climate.ac",
        target_c=24.0,
        room_temp_c=26.5,
        ac_internal_temp_c=21.0,
        demand=1.0,
        heating=False,
        limit_c=16.0,
        max_offset_c=4.0,
    )

    assert planned == 20.0
    assert diag["drive_offset_c"] == 4.0


def test_online_stalled_heating_learns_higher_trim_and_overshoot_backs_off() -> None:
    """Stalled warming steps up trim/deadband; overshoot steps trim down and softens gain."""
    mgr = ACOverdriveManager()
    eid = "climate.tcl_air_conditioner_2"

    # t=0: establish baseline active observation at 19.6°C
    mgr.observe_response(
        eid,
        room_temp_c=19.6,
        target_c=21.0,
        ac_internal_temp_c=22.2,
        heating=True,
        active=True,
        outdoor_temp_c=10.0,
        alpha=0.05,
        now_ts=1000.0,
    )
    # t=+300s (5 min): still 19.6°C -> stalled progress -> trim & deadband should increase
    stalled = mgr.observe_response(
        eid,
        room_temp_c=19.6,
        target_c=21.0,
        ac_internal_temp_c=22.2,
        heating=True,
        active=True,
        outdoor_temp_c=19.6,
        alpha=0.0,
        now_ts=1300.0,
    )
    assert stalled.integral_trim_c > 0.0
    assert stalled.deadband_c > 0.5
    assert stalled.samples == 1

    # t=+600s: room overshoots to 21.5°C (> target + 0.3) -> trim drops & gain softens
    overshot = mgr.observe_response(
        eid,
        room_temp_c=21.5,
        target_c=21.0,
        ac_internal_temp_c=23.5,
        heating=True,
        active=True,
        outdoor_temp_c=10.0,
        alpha=0.05,
        now_ts=1600.0,
    )
    assert overshot.integral_trim_c < stalled.integral_trim_c
    assert overshot.response_gain < stalled.response_gain


def test_ac_overdrive_serialization_roundtrip() -> None:
    """Persisted overdrive parameters survive to_dict / from_dict cleanly."""
    mgr = ACOverdriveManager()
    mgr.observe_response(
        "climate.ac",
        room_temp_c=19.6,
        target_c=21.0,
        ac_internal_temp_c=22.2,
        heating=True,
        active=True,
        now_ts=100.0,
    )
    mgr.observe_response(
        "climate.ac",
        room_temp_c=19.6,
        target_c=21.0,
        ac_internal_temp_c=22.2,
        heating=True,
        active=True,
        now_ts=400.0,
    )

    restored = ACOverdriveManager.from_dict(mgr.to_dict())
    s1 = mgr.get_state("climate.ac")
    s2 = restored.get_state("climate.ac")
    assert round(s1.intake_bias_c, 3) == round(s2.intake_bias_c, 3)
    assert round(s1.deadband_c, 3) == round(s2.deadband_c, 3)
    assert s1.samples == s2.samples
