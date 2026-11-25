"""Tests for HA Area entity auto-discovery."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from custom_components.roommind.utils.area_discovery import suggest_area_entities


def _make_entry(
    entity_id: str,
    *,
    area_id: str | None = None,
    device_id: str | None = None,
    platform: str = "mqtt",
    disabled_by: str | None = None,
    device_class: str | None = None,
    original_device_class: str | None = None,
):
    return SimpleNamespace(
        entity_id=entity_id,
        area_id=area_id,
        device_id=device_id,
        platform=platform,
        disabled_by=disabled_by,
        device_class=device_class,
        original_device_class=original_device_class,
    )


def _state(attrs: dict | None = None):
    return SimpleNamespace(state="on", attributes=attrs or {})


def test_suggest_area_entities_classifies_direct_and_device_inherited_entities(monkeypatch):
    entries = {
        "climate.roommind_living_comfort": _make_entry(
            "climate.roommind_living_comfort", area_id="living", platform="roommind"
        ),
        "climate.living_ac": _make_entry("climate.living_ac", area_id="living"),
        "climate.living_trv": _make_entry("climate.living_trv", device_id="dev_trv"),
        "sensor.living_temp": _make_entry("sensor.living_temp", area_id="living", original_device_class="temperature"),
        "sensor.living_rh": _make_entry("sensor.living_rh", area_id="living", device_class="humidity"),
        "sensor.living_co2": _make_entry("sensor.living_co2", area_id="living", device_class="carbon_dioxide"),
        "sensor.living_voc": _make_entry(
            "sensor.living_voc", area_id="living", device_class="volatile_organic_compounds"
        ),
        "sensor.living_pm25": _make_entry("sensor.living_pm25", area_id="living", device_class="pm25"),
        "binary_sensor.living_window": _make_entry(
            "binary_sensor.living_window", area_id="living", device_class="window"
        ),
        "binary_sensor.living_motion": _make_entry("binary_sensor.living_motion", device_id="dev_motion"),
        "binary_sensor.disabled_win": _make_entry(
            "binary_sensor.disabled_win", area_id="living", device_class="window", disabled_by="user"
        ),
        "cover.living_blinds": _make_entry("cover.living_blinds", area_id="living"),
        "fan.living_ceiling": _make_entry("fan.living_ceiling", area_id="living"),
        "climate.kitchen_trv": _make_entry("climate.kitchen_trv", area_id="kitchen"),
    }
    entity_reg = SimpleNamespace(entities=entries)
    devices_map = {
        "dev_trv": SimpleNamespace(area_id="living"),
        "dev_motion": SimpleNamespace(area_id="living"),
    }
    device_reg = SimpleNamespace(async_get=devices_map.get)

    monkeypatch.setattr("custom_components.roommind.utils.area_discovery.er.async_get", lambda _hass: entity_reg)
    monkeypatch.setattr("custom_components.roommind.utils.area_discovery.dr.async_get", lambda _hass: device_reg)

    states = {
        "climate.living_ac": _state({"hvac_modes": ["off", "cool", "dry", "heat"]}),
        "climate.living_trv": _state({"hvac_modes": ["off", "heat"]}),
        "binary_sensor.living_motion": _state({"device_class": "motion"}),
    }
    hass = MagicMock()
    hass.states.get = MagicMock(side_effect=states.get)

    suggestion = suggest_area_entities(hass, "living")
    assert suggestion["area_id"] == "living"
    assert suggestion["devices"] == [
        {"entity_id": "climate.living_ac", "type": "ac", "role": "auto"},
        {"entity_id": "climate.living_trv", "type": "trv", "role": "auto"},
    ]
    assert suggestion["temperature_sensors"] == ["sensor.living_temp"]
    assert suggestion["humidity_sensors"] == ["sensor.living_rh"]
    assert suggestion["co2_sensor"] == "sensor.living_co2"
    assert suggestion["voc_sensor"] == "sensor.living_voc"
    assert suggestion["pm25_sensors"] == ["sensor.living_pm25"]
    assert suggestion["window_sensors"] == ["binary_sensor.living_window"]
    assert suggestion["occupancy_sensors"] == ["binary_sensor.living_motion"]
    assert suggestion["covers"] == ["cover.living_blinds"]
    assert suggestion["airflow_devices"] == [
        {"entity_id": "fan.living_ceiling", "role": "circulation", "controllable": True, "control_enabled": False}
    ]
