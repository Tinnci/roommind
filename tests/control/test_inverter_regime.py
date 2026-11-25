"""Tests for 4-regime inverter controller and anti-short-cycle guards."""

from __future__ import annotations

from custom_components.roommind.const import MODE_COOLING, MODE_HEATING, MODE_IDLE, TargetTemps
from custom_components.roommind.control.inverter_regime import InverterRegimeManager


def test_four_regime_progression_and_fan_stepping() -> None:
    """Inverter regime transitions recovery -> approach -> cruise -> coast with fan stepping."""
    mgr = InverterRegimeManager()
    targets = TargetTemps(heat=21.0, cool=24.0)

    # 1. Large error -> recovery (fan 1.0)
    r1 = mgr.evaluate(
        "bedroom",
        mode=MODE_HEATING,
        power_fraction=1.0,
        can_heat=True,
        can_cool=False,
        current_temp=19.2,
        targets=targets,
        previous_mode=MODE_IDLE,
        has_ac=True,
        has_external_sensor=True,
        window_open=False,
        force_off=False,
        now_ts=100.0,
    )
    assert r1.regime == "recovery"
    assert r1.recommended_fan_level == 1.0

    # 2. Approaching setpoint (err = 0.6°C) -> approach (fan 0.6)
    r2 = mgr.evaluate(
        "bedroom",
        mode=MODE_HEATING,
        power_fraction=0.8,
        can_heat=True,
        can_cool=False,
        current_temp=20.4,
        targets=targets,
        previous_mode=MODE_HEATING,
        has_ac=True,
        has_external_sensor=True,
        window_open=False,
        force_off=False,
        now_ts=200.0,
    )
    assert r2.regime == "approach"
    assert r2.recommended_fan_level == 0.6

    # 3. Near setpoint (err = 0.0°C) even if bang-bang suggests IDLE -> stays in cruise (fan 0.25)
    r3 = mgr.evaluate(
        "bedroom",
        mode=MODE_IDLE,
        power_fraction=0.0,
        can_heat=True,
        can_cool=False,
        current_temp=21.0,
        targets=targets,
        previous_mode=MODE_HEATING,
        has_ac=True,
        has_external_sensor=True,
        window_open=False,
        force_off=False,
        now_ts=300.0,
    )
    assert r3.regime == "cruise"
    assert r3.active is True
    assert r3.mode == MODE_HEATING
    assert r3.recommended_fan_level == 0.25

    # 4. Hit minimum modulation floor (-0.4°C overshoot) before MIN_RUN elapsed -> held in cruise
    r4_hold = mgr.evaluate(
        "bedroom",
        mode=MODE_IDLE,
        power_fraction=0.0,
        can_heat=True,
        can_cool=False,
        current_temp=21.4,
        targets=targets,
        previous_mode=MODE_HEATING,
        has_ac=True,
        has_external_sensor=True,
        window_open=False,
        force_off=False,
        now_ts=350.0,
    )
    assert r4_hold.regime == "cruise"
    assert r4_hold.in_min_hold is True

    # 5. After MIN_RUN (100 + 300 = 400s), floor overshoot enters coast (off)
    r5 = mgr.evaluate(
        "bedroom",
        mode=MODE_IDLE,
        power_fraction=0.0,
        can_heat=True,
        can_cool=False,
        current_temp=21.4,
        targets=targets,
        previous_mode=MODE_HEATING,
        has_ac=True,
        has_external_sensor=True,
        window_open=False,
        force_off=False,
        now_ts=450.0,
    )
    assert r5.regime == "coast"
    assert r5.active is False
    assert r5.mode == MODE_IDLE
    assert r5.recommended_fan_level == 0.0

    # 6. Small dip within MIN_OFF window stays in coast (anti-short-cycle)
    r6 = mgr.evaluate(
        "bedroom",
        mode=MODE_HEATING,
        power_fraction=1.0,
        can_heat=True,
        can_cool=False,
        current_temp=20.7,
        targets=targets,
        previous_mode=MODE_IDLE,
        has_ac=True,
        has_external_sensor=True,
        window_open=False,
        force_off=False,
        now_ts=550.0,
    )
    assert r6.regime == "coast"
    assert r6.in_min_hold is True


def test_trv_only_or_window_open_returns_off() -> None:
    """Rooms without ACs or with window open do not enter inverter regimes."""
    mgr = InverterRegimeManager()
    res = mgr.evaluate(
        "study",
        mode=MODE_COOLING,
        power_fraction=1.0,
        can_heat=False,
        can_cool=True,
        current_temp=26.0,
        targets=TargetTemps(heat=20.0, cool=24.0),
        previous_mode=MODE_IDLE,
        has_ac=False,
        has_external_sensor=True,
        window_open=False,
        force_off=False,
        now_ts=100.0,
    )
    assert res.regime == "off"
