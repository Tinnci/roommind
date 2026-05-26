"""Tests for HVAC output stage observation."""

from __future__ import annotations

from unittest.mock import MagicMock

from custom_components.roommind.managers.hvac_output_observer import HVACOutputObserver


def _state(state: str, attrs: dict | None = None):
    s = MagicMock()
    s.state = state
    s.attributes = attrs or {}
    return s


def test_power_sensor_classifies_compressor_stage(hass):
    hass.states.get.side_effect = lambda eid: _state("1200" if eid == "sensor.ac_power" else "cool")
    observer = HVACOutputObserver(hass)

    result = observer.observe(
        {"entity_id": "climate.ac", "power_sensor_entity": "sensor.ac_power"},
        hvac_action="cooling",
        fan_q=1.0,
        temp_slope_c_per_h=-1.2,
    )

    assert result.stage == "compressor_high"
    assert result.electric_power_w == 1200
    assert result.delivered_capacity_factor > 1.0


def test_without_power_sensor_uses_hvac_action_and_slope(hass):
    observer = HVACOutputObserver(hass)

    result = observer.observe(
        {"entity_id": "climate.ac"},
        hvac_action="fan",
        fan_q=0.5,
        temp_slope_c_per_h=0.0,
    )

    assert result.stage == "fan"
    assert result.confidence == "low"


def test_capacity_and_power_curves_are_interpolated(hass):
    observer = HVACOutputObserver(hass)

    result = observer.observe(
        {
            "entity_id": "climate.ac",
            "fan_capacity_curve": [
                {"level": 0.0, "capacity_factor": 1.0},
                {"level": 1.0, "capacity_factor": 1.4},
            ],
            "fan_power_curve": [
                {"level": 0.0, "power_w": 0},
                {"level": 1.0, "power_w": 40},
            ],
        },
        hvac_action="cooling",
        fan_q=0.5,
        temp_slope_c_per_h=-0.8,
    )

    assert result.stage == "compressor_mid"
    assert result.delivered_capacity_factor == 1.2
    assert result.electric_power_w == 20.0
    assert result.confidence == "estimated"


def test_power_sensor_mode_reports_missing_power_sensor(hass):
    observer = HVACOutputObserver(hass)

    result = observer.observe(
        {"entity_id": "climate.ac", "compressor_stage_observer": "power_sensor"},
        hvac_action="cooling",
        fan_q=1.0,
        temp_slope_c_per_h=-1.0,
    )

    assert result.stage == "unknown"
    assert result.confidence == "missing_power_sensor"
