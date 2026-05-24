"""Tests for temperature sensor observation fusion helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest

from custom_components.roommind.const import MAX_SENSOR_STALENESS, UPDATE_INTERVAL
from custom_components.roommind.control.thermal_model import TemperatureObservation
from custom_components.roommind.managers.sensor_fusion_manager import SensorFusionManager


def _state(
    value: str,
    *,
    last_reported: datetime | None = None,
    last_updated: datetime | None = None,
    last_changed: datetime | None = None,
) -> MagicMock:
    state = MagicMock()
    state.state = value
    state.attributes = {"unit_of_measurement": "°C"}
    state.last_reported = last_reported
    state.last_updated = last_updated
    state.last_changed = last_changed
    return state


def test_observation_age_uses_last_reported_before_last_changed():
    """Stable HA states stay fresh when entities report the same value."""
    now = datetime(2026, 5, 24, 12, 0, tzinfo=UTC)
    fusion = SensorFusionManager()

    observation = fusion.observation_from_state(
        "sensor.wall",
        _state(
            "20.0",
            last_reported=now - timedelta(seconds=5),
            last_changed=now - timedelta(minutes=30),
        ),
        now=now,
        value_c=20.0,
        is_primary=True,
    )

    assert observation is not None
    assert observation.age_s == pytest.approx(5.0)
    assert observation.variance == pytest.approx(0.04)


def test_observation_falls_back_to_last_updated_when_last_reported_missing():
    """Older HA versions still get a useful freshness timestamp."""
    now = datetime(2026, 5, 24, 12, 0, tzinfo=UTC)
    fusion = SensorFusionManager()

    observation = fusion.observation_from_state(
        "sensor.wall",
        _state("20.0", last_updated=now - timedelta(seconds=15), last_changed=now - timedelta(minutes=10)),
        now=now,
        value_c=20.0,
        is_primary=True,
    )

    assert observation is not None
    assert observation.age_s == pytest.approx(15.0)


def test_observation_inflates_variance_for_aging_sensor():
    """Aging-but-not-stale sensors remain usable with lower trust."""
    now = datetime(2026, 5, 24, 12, 0, tzinfo=UTC)
    fusion = SensorFusionManager()

    observation = fusion.observation_from_state(
        "sensor.trv",
        _state("20.0", last_reported=now - timedelta(seconds=UPDATE_INTERVAL * 3)),
        now=now,
        value_c=20.0,
        is_primary=False,
    )

    assert observation is not None
    assert observation.variance > 0.16


def test_observation_drops_stale_or_invalid_state():
    """Unavailable and stale sensors are excluded from EKF observations."""
    now = datetime(2026, 5, 24, 12, 0, tzinfo=UTC)
    fusion = SensorFusionManager()

    assert (
        fusion.observation_from_state(
            "sensor.trv",
            _state("unavailable", last_reported=now),
            now=now,
            value_c=None,
            is_primary=False,
        )
        is None
    )
    assert (
        fusion.observation_from_state(
            "sensor.trv",
            _state("20.0", last_reported=now - timedelta(seconds=MAX_SENSOR_STALENESS + 1)),
            now=now,
            value_c=20.0,
            is_primary=False,
        )
        is None
    )


def test_calibrate_observations_learns_heating_auxiliary_bias():
    """Auxiliary heating bias is learned online and removed from EKF input."""
    fusion = SensorFusionManager()
    corrected = []

    for _ in range(300):
        corrected = fusion.calibrate_observations(
            [
                TemperatureObservation(value=20.0, variance=0.04, entity_id="sensor.wall", is_primary=True),
                TemperatureObservation(value=22.0, variance=0.16, entity_id="sensor.trv"),
            ],
            mode="heating",
            power_fraction=0.5,
        )

    aux = corrected[1]
    bias = fusion.get_bias("sensor.trv")
    assert aux.value == pytest.approx(20.0, abs=0.5)
    assert bias.static_c + bias.active_c * 0.5 == pytest.approx(2.0, abs=0.5)
    assert bias.active_c >= 0.0


def test_calibrate_observations_clamps_cooling_active_bias_negative():
    """Cooling-mode active bias is constrained to the negative range."""
    fusion = SensorFusionManager()

    for _ in range(300):
        fusion.calibrate_observations(
            [
                TemperatureObservation(value=20.0, variance=0.04, entity_id="sensor.wall", is_primary=True),
                TemperatureObservation(value=18.0, variance=0.16, entity_id="sensor.ac_outlet"),
            ],
            mode="cooling",
            power_fraction=0.5,
        )

    bias = fusion.get_bias("sensor.ac_outlet")
    assert bias.static_c + bias.active_c * 0.5 == pytest.approx(-2.0, abs=0.5)
    assert bias.active_c <= 0.0
