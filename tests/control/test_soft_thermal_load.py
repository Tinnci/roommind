"""Tests for soft thermal-load / plume estimator and overdrive regime tapering."""

from __future__ import annotations

from custom_components.roommind.control.ac_overdrive import ACOverdriveManager
from custom_components.roommind.control.hvac_observation import estimate_soft_thermal_load


def test_power_sensor_takes_priority_in_soft_thermal_load() -> None:
    """Measured electrical wattage yields high-confidence load stage."""
    est = estimate_soft_thermal_load(
        hvac_mode="heat",
        hvac_action=None,
        expected_mode="heating",
        power_w=320.0,
        room_temp_c=20.5,
        ac_internal_temp_c=23.0,
        outdoor_temp_c=8.0,
        temp_slope_c_per_h=0.5,
        alpha=0.05,
    )
    assert est.source == "power_sensor"
    assert est.stage == "min_floor"
    assert est.load_fraction == 0.35
    assert est.supports_training is True


def test_thermal_plume_and_heat_balance_detects_active_heating_without_hvac_action() -> None:
    """Dual-sensor plume + positive heat-balance unlocks mode-aware EKF training safely."""
    est = estimate_soft_thermal_load(
        hvac_mode="heat",
        hvac_action=None,
        expected_mode="heating",
        power_w=None,
        room_temp_c=20.0,
        ac_internal_temp_c=22.6,
        outdoor_temp_c=10.0,
        temp_slope_c_per_h=0.6,
        alpha=0.05,
    )
    assert est.source == "thermal_plume"
    assert est.supports_training is True
    assert est.plume_delta_c is not None and est.plume_delta_c > 2.0
    assert 0.25 <= est.load_fraction <= 1.0


def test_overdrive_tapers_deadband_in_approach_and_cruise() -> None:
    """Cruise drops deadband push so overdrive settles near target + intake_bias."""
    mgr = ACOverdriveManager()
    rec_sp, _ = mgr.plan_setpoint(
        "climate.ac",
        target_c=21.0,
        room_temp_c=21.0,
        ac_internal_temp_c=23.0,
        demand=0.5,
        heating=True,
        limit_c=31.0,
        regime="recovery",
    )
    cruise_sp, cruise_diag = mgr.plan_setpoint(
        "climate.ac",
        target_c=21.0,
        room_temp_c=21.0,
        ac_internal_temp_c=23.0,
        demand=0.3,
        heating=True,
        limit_c=31.0,
        regime="cruise",
    )
    assert cruise_diag["regime"] == "cruise"
    assert cruise_sp < rec_sp
