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
    entity_category: str | None = None,
    name: str | None = None,
    original_name: str | None = None,
):
    return SimpleNamespace(
        entity_id=entity_id,
        area_id=area_id,
        device_id=device_id,
        platform=platform,
        disabled_by=disabled_by,
        device_class=device_class,
        original_device_class=original_device_class,
        entity_category=entity_category,
        name=name,
        original_name=original_name,
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


def test_suggest_area_entities_filters_appliance_diagnostic_and_outdoor_temps(monkeypatch):
    entries = {
        # Dining room: water heater + purifier only -> 0 ambient temps
        "water_heater.xiaomi_cn_2060084384_ymm5_s_2_water_heater": _make_entry(
            "water_heater.xiaomi_cn_2060084384_ymm5_s_2_water_heater",
            device_id="dev_waterheater",
            platform="xiaomi_home",
        ),
        "sensor.xiaomi_cn_2060084384_ymm5_temperature_p_4_4": _make_entry(
            "sensor.xiaomi_cn_2060084384_ymm5_temperature_p_4_4",
            device_id="dev_waterheater",
            platform="xiaomi_home",
            device_class="temperature",
            original_name=" 使用记录 温度",
        ),
        "sensor.chunmi_cn_395394739_tsa1_temperature_p_2_5": _make_entry(
            "sensor.chunmi_cn_395394739_tsa1_temperature_p_2_5",
            device_id="dev_purifier",
            platform="xiaomi_home",
            device_class="temperature",
            original_name="出水温度",
        ),
        # Bedroom: keep ambient zM1/ATC sensors, drop AC diagnostic & outdoor temps
        "sensor.wo_shi_2_kong_diao_2_2": _make_entry(
            "sensor.wo_shi_2_kong_diao_2_2",
            device_id="dev_ac2",
            platform="tcl_udp_ac",
            device_class="temperature",
            entity_category="diagnostic",
            original_name="室内机盘管温度",
        ),
        "sensor.wo_shi_2_kong_diao_2_22": _make_entry(
            "sensor.wo_shi_2_kong_diao_2_22",
            device_id="dev_ac2",
            platform="tcl_udp_ac",
            device_class="temperature",
            original_name="室外温度",
        ),
        "sensor.wo_shi_zm1_ad46_temperature": _make_entry(
            "sensor.wo_shi_zm1_ad46_temperature",
            area_id="wo_shi",
            platform="zm1",
            device_class="temperature",
            original_name="温度",
        ),
        "sensor.wo_shi_atc_6e73_temperature": _make_entry(
            "sensor.wo_shi_atc_6e73_temperature",
            area_id="ke_ting",
            platform="bthome",
            device_class="temperature",
            original_name="温度",
        ),
        "sensor.temperature_humidity_sensor_with_button_a248_temperature": _make_entry(
            "sensor.temperature_humidity_sensor_with_button_a248_temperature",
            area_id="ke_ting",
            platform="xiaomi_ble",
            device_class="temperature",
            original_name="温度",
        ),
    }
    entity_reg = SimpleNamespace(entities=entries)
    devices_map = {
        "dev_waterheater": SimpleNamespace(area_id="can_ting", name="米家智能恒温燃气热水器16L S10", model="xiaomi.waterheater.ymm5"),
        "dev_purifier": SimpleNamespace(area_id="can_ting", name="小米台式净饮机", model="chunmi.ysj.tsa1"),
        "dev_ac2": SimpleNamespace(area_id="wo_shi_2", name="TCL AC", model="KFRd-35G"),
    }
    device_reg = SimpleNamespace(async_get=devices_map.get)

    monkeypatch.setattr("custom_components.roommind.utils.area_discovery.er.async_get", lambda _hass: entity_reg)
    monkeypatch.setattr("custom_components.roommind.utils.area_discovery.dr.async_get", lambda _hass: device_reg)

    hass = MagicMock()
    hass.states.get = MagicMock(return_value=None)

    assert suggest_area_entities(hass, "can_ting")["temperature_sensors"] == []
    assert suggest_area_entities(hass, "wo_shi_2")["temperature_sensors"] == []
    assert suggest_area_entities(hass, "wo_shi")["temperature_sensors"] == ["sensor.wo_shi_zm1_ad46_temperature"]
    assert suggest_area_entities(hass, "ke_ting")["temperature_sensors"] == [
        "sensor.temperature_humidity_sensor_with_button_a248_temperature",
        "sensor.wo_shi_atc_6e73_temperature",
    ]
