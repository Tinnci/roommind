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
    assert factors.statuses[0].preset_mode == "normal"
    assert factors.statuses[0].oscillating is True


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
