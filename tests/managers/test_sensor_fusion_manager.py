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


def test_diagnostics_exposes_ha_freshness_metadata():
    """Fusion diagnostics include HA timestamp source and serialized timestamps."""
    now = datetime(2026, 5, 24, 12, 0, tzinfo=UTC)
    fusion = SensorFusionManager()
    observation = fusion.observation_from_state(
        "sensor.wall",
        _state(
            "20.0",
            last_reported=now - timedelta(seconds=5),
            last_updated=now - timedelta(seconds=10),
            last_changed=now - timedelta(minutes=30),
        ),
        now=now,
        value_c=20.0,
        is_primary=True,
    )

    assert observation is not None
    diagnostics = fusion.diagnostics([observation], power_fraction=0.0)

    assert diagnostics == [
        {
            "entity_id": "sensor.wall",
            "is_primary": True,
            "value": 20.0,
            "corrected_value": 20.0,
            "static_bias": 0.0,
            "active_bias": 0.0,
            "k_mix": 0.0,
            "age_s": 5.0,
            "variance": 0.04,
            "freshness_source": "last_reported",
            "freshness_status": "fresh",
            "last_reported": "2026-05-24T11:59:55+00:00",
            "last_updated": "2026-05-24T11:59:50+00:00",
            "last_changed": "2026-05-24T11:30:00+00:00",
        }
    ]


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


def test_calibrate_observations_mix_reduces_aux_active_bias_correction():
    """Circulation reduces active sensor self-heating correction and aux variance."""
    observations = [
        TemperatureObservation(value=20.0, variance=0.04, entity_id="sensor.wall", is_primary=True),
        TemperatureObservation(value=22.0, variance=0.16, entity_id="sensor.trv", is_primary=False),
    ]
    still_air = SensorFusionManager()
    mixed_air = SensorFusionManager()

    corrected_still = still_air.calibrate_observations(
        observations,
        mode="heating",
        power_fraction=1.0,
        q_fan_mix=0.0,
    )
    corrected_mixed = mixed_air.calibrate_observations(
        observations,
        mode="heating",
        power_fraction=1.0,
        q_fan_mix=1.0,
    )

    assert corrected_mixed[1].value > corrected_still[1].value
    assert corrected_mixed[1].variance < corrected_still[1].variance


def test_calibrate_observations_learns_sensor_mix_coupling():
    """Repeated fan-mixed samples learn k_mix for auxiliary active bias."""
    fusion = SensorFusionManager()

    for _ in range(350):
        fusion.calibrate_observations(
            [
                TemperatureObservation(value=20.0, variance=0.04, entity_id="sensor.wall", is_primary=True),
                TemperatureObservation(value=24.0, variance=0.16, entity_id="sensor.trv", is_primary=False),
            ],
            mode="heating",
            power_fraction=1.0,
            q_fan_mix=0.0,
        )
    before = fusion.get_bias("sensor.trv")

    for _ in range(350):
        fusion.calibrate_observations(
            [
                TemperatureObservation(value=20.0, variance=0.04, entity_id="sensor.wall", is_primary=True),
                TemperatureObservation(value=22.0, variance=0.16, entity_id="sensor.trv", is_primary=False),
            ],
            mode="heating",
            power_fraction=1.0,
            q_fan_mix=1.0,
        )

    after = fusion.get_bias("sensor.trv")
    assert before.k_mix == pytest.approx(0.0)
    assert after.k_mix > 0.1


def test_sensor_bias_roundtrip_preserves_correction_state():
    """Learned auxiliary sensor bias can be persisted and restored."""
    fusion = SensorFusionManager()
    for _ in range(200):
        fusion.calibrate_observations(
            [
                TemperatureObservation(value=20.0, variance=0.04, entity_id="sensor.wall", is_primary=True),
                TemperatureObservation(value=22.0, variance=0.16, entity_id="sensor.trv", is_primary=False),
            ],
            mode="heating",
            power_fraction=0.5,
        )

    restored = SensorFusionManager.from_dict(fusion.to_dict())
    assert restored.get_bias("sensor.trv") == fusion.get_bias("sensor.trv")

    corrected = restored.calibrate_observations(
        [
            TemperatureObservation(value=20.0, variance=0.04, entity_id="sensor.wall", is_primary=True),
            TemperatureObservation(value=22.0, variance=0.16, entity_id="sensor.trv", is_primary=False),
        ],
        mode="heating",
        power_fraction=0.5,
    )

    assert corrected[1].value < 22.0
