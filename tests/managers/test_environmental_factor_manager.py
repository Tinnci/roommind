"""Tests for airflow environmental factor extraction."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

from custom_components.roommind.managers import environmental_factor_manager as airflow_factors
from custom_components.roommind.managers.environmental_factor_manager import EnvironmentalFactorManager


def _state(state: str, attrs: dict | None = None):
    s = MagicMock()
    s.state = state
    s.attributes = attrs or {}
    return s


def test_reads_fan_percentage_as_circulation_factor(hass):
    hass.states.get.side_effect = lambda eid: _state(
        "on",
        {
            "percentage": 40,
            "preset_mode": "normal",
            "current_direction": "forward",
            "oscillating": True,
            "speed_count": 4,
        },
    )
    mgr = EnvironmentalFactorManager(hass)

    factors = mgr.read_room_airflow(
        {
            "airflow_devices": [
                {
                    "entity_id": "fan.living_room",
                    "role": "circulation",
                    "controllable": True,
                    "control_enabled": True,
                }
            ]
        }
    )

    assert factors.q_fan_mix == 0.4
    assert factors.q_vent == 0.0
    assert factors.active is True
    assert factors.levels == [0.0, 0.25, 0.5, 0.75, 1.0]
    assert factors.mix_levels == [0.0, 0.25, 0.5, 0.75, 1.0]
    assert factors.vent_levels == [0.0]
    assert factors.has_hvac_fan_control is False
    assert factors.statuses[0].preset_mode == "normal"
    assert factors.statuses[0].oscillating is True


def test_airflow_status_exposes_ha_freshness_metadata(hass, monkeypatch):
    now = datetime(2026, 5, 24, 12, 0, tzinfo=UTC)
    monkeypatch.setattr(airflow_factors.dt_util, "utcnow", lambda: now)

    def get_state(_entity_id):
        state = _state("on", {"percentage": 40, "speed_count": 4})
        state.last_reported = now - timedelta(seconds=7)
        state.last_updated = now - timedelta(seconds=8)
        state.last_changed = now - timedelta(minutes=20)
        return state

    hass.states.get.side_effect = get_state
    mgr = EnvironmentalFactorManager(hass)

    factors = mgr.read_room_airflow(
        {
            "airflow_devices": [
                {
                    "entity_id": "fan.living_room",
                    "role": "circulation",
                }
            ]
        }
    )

    status = factors.as_status_dicts()[0]
    assert status["age_s"] == 7.0
    assert status["freshness_source"] == "last_reported"
    assert status["last_reported"] == "2026-05-24T11:59:53+00:00"
    assert status["last_updated"] == "2026-05-24T11:59:52+00:00"
    assert status["last_changed"] == "2026-05-24T11:40:00+00:00"


def test_preset_only_fan_on_does_not_collapse_to_zero_airflow(hass):
    """Preset-driven fans can report percentage=0 while they are running."""
    hass.states.get.side_effect = lambda eid: _state(
        "on",
        {
            "percentage": 0,
            "preset_mode": "auto",
            "preset_modes": ["sleep", "auto", "turbo"],
            "speed_count": 3,
        },
    )
    mgr = EnvironmentalFactorManager(hass)

    factors = mgr.read_room_airflow(
        {
            "airflow_devices": [
                {
                    "entity_id": "fan.living_room",
                    "role": "circulation",
                    "controllable": True,
                    "control_enabled": True,
                }
            ]
        }
    )

    assert factors.q_fan_mix == 0.5
    assert factors.active is True
    assert factors.statuses[0].percentage == 0
    assert factors.statuses[0].preset_mode == "auto"


def test_reads_climate_fan_mode_and_ventilation_role(hass):
    hass.states.get.side_effect = lambda eid: _state(
        "cool",
        {
            "fan_mode": "high",
            "fan_modes": ["off", "low", "medium", "high"],
            "swing_mode": "both",
            "swing_modes": ["off", "both"],
            "swing_horizontal_mode": "on",
            "swing_horizontal_modes": ["off", "on"],
            "hvac_action": "fan",
            "hvac_modes": ["off", "cool", "fan_only"],
        },
    )
    mgr = EnvironmentalFactorManager(hass)

    factors = mgr.read_room_airflow(
        {
            "airflow_devices": [
                {
                    "entity_id": "climate.living_ac",
                    "role": "ventilation",
                    "controllable": True,
                    "control_enabled": True,
                }
            ]
        }
    )

    assert factors.q_fan_mix == 0.0
    assert factors.q_vent == 1.0
    assert factors.levels == [0.0, 0.333, 0.667, 1.0]
    assert factors.mix_levels == [0.0]
    assert factors.vent_levels == [0.0, 0.333, 0.667, 1.0]
    assert factors.statuses[0].fan_mode == "high"
    assert factors.statuses[0].swing_mode == "both"
    assert factors.statuses[0].swing_horizontal_mode == "on"


def test_hvac_fan_control_capability_is_reported(hass):
    hass.states.get.side_effect = lambda eid: _state(
        "heat",
        {
            "fan_mode": "low",
            "fan_modes": ["off", "low", "high"],
            "hvac_modes": ["off", "heat", "fan_only"],
        },
    )
    mgr = EnvironmentalFactorManager(hass)

    factors = mgr.read_room_airflow(
        {
            "airflow_devices": [
                {
                    "entity_id": "climate.living_ac",
                    "role": "hvac_fan",
                    "controllable": True,
                    "control_enabled": True,
                }
            ]
        }
    )

    assert factors.has_hvac_fan_control is True


def test_ignores_unavailable_airflow_entities(hass):
    hass.states.get.side_effect = lambda eid: _state("unavailable")
    mgr = EnvironmentalFactorManager(hass)

    factors = mgr.read_room_airflow(
        {
            "airflow_devices": [
                {"entity_id": "fan.missing", "role": "circulation", "controllable": True, "control_enabled": True}
            ]
        }
    )

    assert factors.q_fan_mix == 0.0
    assert factors.q_vent == 0.0
    assert factors.active is False
    assert factors.levels == [0.0]
    assert factors.statuses[0].available is False


def test_off_climate_fan_mode_does_not_count_as_active_airflow(hass):
    hass.states.get.side_effect = lambda eid: _state(
        "off",
        {
            "fan_mode": "auto",
            "fan_modes": ["off", "low", "auto", "high"],
            "hvac_action": "off",
        },
    )
    mgr = EnvironmentalFactorManager(hass)

    factors = mgr.read_room_airflow(
        {
            "airflow_devices": [
                {"entity_id": "climate.living_ac", "role": "hvac_fan", "controllable": True, "control_enabled": True}
            ]
        }
    )

    assert factors.q_fan_mix == 0.0
    assert factors.active is False
    assert factors.mix_levels == [0.0, 0.333, 0.5, 1.0]


def test_idle_climate_action_does_not_count_stale_fan_mode_as_airflow(hass):
    """A stale climate fan_mode should not imply airflow while hvac_action is idle."""
    hass.states.get.side_effect = lambda eid: _state(
        "cool",
        {
            "fan_mode": "high",
            "fan_modes": ["off", "low", "medium", "high"],
            "hvac_action": "idle",
        },
    )
    mgr = EnvironmentalFactorManager(hass)

    factors = mgr.read_room_airflow(
        {
            "airflow_devices": [
                {"entity_id": "climate.living_ac", "role": "hvac_fan", "controllable": True, "control_enabled": True}
            ]
        }
    )

    assert factors.q_fan_mix == 0.0
    assert factors.active is False


def test_multiple_circulation_fans_use_saturating_aggregation(hass):
    def get_state(entity_id):
        return _state("on", {"percentage": 50, "speed_count": 2})

    hass.states.get.side_effect = get_state
    mgr = EnvironmentalFactorManager(hass)

    factors = mgr.read_room_airflow(
        {
            "airflow_devices": [
                {"entity_id": "fan.one", "role": "circulation", "effect_weight": 1.0},
                {"entity_id": "fan.two", "role": "circulation", "effect_weight": 1.0},
            ]
        }
    )

    assert factors.q_fan_mix == 0.75


def test_zero_effect_weight_disables_airflow_contribution(hass):
    """An explicit zero weight is distinct from the default weight."""
    hass.states.get.side_effect = lambda eid: _state("on", {"percentage": 50, "speed_count": 2})
    mgr = EnvironmentalFactorManager(hass)

    factors = mgr.read_room_airflow(
        {
            "airflow_devices": [
                {
                    "entity_id": "fan.ignored",
                    "role": "circulation",
                    "effect_weight": 0.0,
                }
            ]
        }
    )

    assert factors.statuses[0].effect_weight == 0.0
    assert factors.q_fan_mix == 0.0
    assert factors.active is False


def test_ventilation_devices_sum_and_report_ach_when_physical_flow_is_configured(hass):
    hass.states.get.side_effect = lambda eid: _state("on", {"percentage": 50, "speed_count": 2})
    mgr = EnvironmentalFactorManager(hass)

    factors = mgr.read_room_airflow(
        {
            "room_volume_m3": 50,
            "airflow_devices": [
                {
                    "entity_id": "fan.vent_one",
                    "role": "ventilation",
                    "effect_weight": 1.0,
                    "airflow_m3h": 120,
                },
                {
                    "entity_id": "fan.vent_two",
                    "role": "ventilation",
                    "effect_weight": 0.5,
                    "airflow_m3h": 80,
                },
            ],
        }
    )

    assert factors.airflow_ach == 1.6
    assert factors.q_vent == 0.533
