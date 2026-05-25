"""Tests for airflow environmental factor extraction."""

from __future__ import annotations

from unittest.mock import MagicMock

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
