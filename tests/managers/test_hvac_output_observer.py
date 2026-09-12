"""Tests for HVAC output stage observation."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from homeassistant.helpers import entity_registry as er

from custom_components.roommind.const import MAX_SENSOR_STALENESS
from custom_components.roommind.control.hvac_observation import observed_room_activity
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
    assert result.electric_power_source == "sensor"
    assert result.confidence == "estimated"
    assert result.delivered_capacity_factor > 1.0


def test_without_power_sensor_uses_observed_fan_action(hass):
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

    assert result.stage == "compressor_active"
    assert result.delivered_capacity_factor == 1.2
    assert result.electric_power_w == 20.0
    assert result.electric_power_source == "fan_curve"
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


def test_power_sensor_converts_kw_before_classifying_output(hass):
    """An inverter drawing 0.8 kW must not be reported as switched off."""
    hass.states.get.return_value = _state("0.8", {"unit_of_measurement": "kW"})

    result = HVACOutputObserver(hass).observe(
        {"entity_id": "climate.ac", "power_sensor_entity": "sensor.ac_power"},
        hvac_action="cooling",
        fan_q=0.5,
    )

    assert result.electric_power_w == 800
    assert result.stage == "compressor_mid"


@pytest.mark.parametrize(
    ("value", "unit"),
    [("nan", "W"), ("inf", "W"), ("-inf", "W"), ("-10", "W"), ("800", "kWh"), ("unavailable", "W")],
)
def test_invalid_power_remains_unknown(hass, value, unit):
    """Invalid telemetry must not become zero output or full compressor load."""
    hass.states.get.return_value = _state(value, {"unit_of_measurement": unit})

    result = HVACOutputObserver(hass).observe(
        {
            "entity_id": "climate.ac",
            "power_sensor_entity": "sensor.ac_power",
            "compressor_stage_observer": "power_sensor",
        },
        hvac_action="cooling",
        fan_q=0.5,
    )

    assert result.stage == "unknown"
    assert result.electric_power_w is None
    assert result.confidence == "power_unavailable"


def test_stale_power_is_not_reused_as_current_output(hass):
    """A disconnected power sensor can retain a valid numeric state."""
    state = _state("1200", {"unit_of_measurement": "W"})
    state.last_reported = datetime.now(UTC) - timedelta(seconds=MAX_SENSOR_STALENESS + 60)
    state.last_updated = state.last_reported
    state.last_changed = state.last_reported
    hass.states.get.return_value = state

    result = HVACOutputObserver(hass).observe(
        {
            "entity_id": "climate.ac",
            "power_sensor_entity": "sensor.ac_power",
            "compressor_stage_observer": "power_sensor",
        },
        hvac_action="cooling",
        fan_q=0.5,
    )

    assert result.stage == "unknown"
    assert result.electric_power_w is None


def test_repeated_power_report_is_fresh_even_when_value_is_unchanged(hass):
    """last_reported takes precedence over old state-change timestamps."""
    state = _state("800", {"unit_of_measurement": "W"})
    state.last_reported = datetime.now(UTC)
    state.last_updated = state.last_reported - timedelta(hours=1)
    state.last_changed = state.last_updated
    hass.states.get.return_value = state

    result = HVACOutputObserver(hass).observe(
        {"entity_id": "climate.ac", "power_sensor_entity": "sensor.ac_power"},
        hvac_action="cooling",
        fan_q=0.5,
    )

    assert result.stage == "compressor_mid"
    assert result.electric_power_w == 800


@pytest.mark.parametrize("fan_q", [0.0, 1.0])
def test_missing_action_does_not_imply_off_or_fan(hass, fan_q):
    """A stored fan setting does not observe compressor or fan operation."""
    result = HVACOutputObserver(hass).observe(
        {"entity_id": "climate.ac"},
        hvac_action=None,
        fan_q=fan_q,
    )

    assert result.stage == "unknown"
    assert result.confidence == "unknown"


@pytest.mark.parametrize("slope", [-4.0, 0.0, 4.0])
def test_room_drift_cannot_measure_inverter_load(hass, slope):
    """Solar and ventilation can reverse room drift while the compressor runs."""
    result = HVACOutputObserver(hass).observe(
        {"entity_id": "climate.ac"},
        hvac_action="cooling",
        fan_q=0.5,
        temp_slope_c_per_h=slope,
    )

    assert result.stage == "compressor_active"
    assert result.electric_power_w is None
    assert result.confidence == "estimated"


@pytest.mark.parametrize(
    ("mode", "action"), [("cool", "cooling"), ("cool", "idle"), ("heat", "heating"), ("heat", "idle")]
)
def test_tcl_temperature_heuristic_is_not_observed_thermal_activity(hass, mode, action):
    """TCL 0.10.0 compares indoor temperature with target to synthesize action."""
    registry = MagicMock()
    registry.async_get.return_value.platform = "tcl_udp_ac"
    hass.data[er.DATA_REGISTRY] = registry
    hass.states.get.return_value = _state(mode, {"hvac_action": action})
    observer = HVACOutputObserver(hass)

    climate = observer.read_climate("climate.ac")
    output = observer.observe({"entity_id": "climate.ac"}, hvac_action=climate.output_action, fan_q=0.5)

    assert climate.hvac_action == action
    assert observed_room_activity([climate]) == (None, 0.0)
    assert output.stage == "unknown"


def test_tcl_reported_off_remains_usable_without_a_temperature_heuristic(hass):
    """Reported power-off does not depend on the integration's thermostat estimate."""
    registry = MagicMock()
    registry.async_get.return_value.platform = "tcl_udp_ac"
    hass.data[er.DATA_REGISTRY] = registry
    hass.states.get.return_value = _state("off", {"hvac_action": "off"})

    climate = HVACOutputObserver(hass).read_climate("climate.ac")

    assert observed_room_activity([climate]) == ("idle", 0.0)


@pytest.mark.parametrize("estimated", [True, False])
def test_explicit_action_provenance_overrides_legacy_platform_fallback(hass, estimated):
    """An updated driver can describe its feedback without a version gate."""
    registry = MagicMock()
    registry.async_get.return_value.platform = "tcl_udp_ac"
    hass.data[er.DATA_REGISTRY] = registry
    hass.states.get.return_value = _state("cool", {"hvac_action": "cooling", "hvac_action_is_estimated": estimated})

    climate = HVACOutputObserver(hass).read_climate("climate.ac")

    assert observed_room_activity([climate]) == ((None, 0.0) if estimated else ("cooling", 1.0))
