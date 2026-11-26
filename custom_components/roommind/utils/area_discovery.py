"""Home Assistant Area Registry discovery helpers for RoomMind."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from ..const import DOMAIN

_AC_MODES = frozenset({"cool", "dry"})
_WINDOW_CLASSES = frozenset({"window", "door", "opening"})
_OCCUPANCY_CLASSES = frozenset({"occupancy", "motion", "presence"})
_VOC_CLASSES = frozenset({"volatile_organic_compounds", "volatile_organic_compounds_parts"})
_NON_AMBIENT_ENTITY_CATEGORIES = frozenset({"diagnostic", "config"})
_NON_AMBIENT_DEVICE_DOMAINS = frozenset(
    {"water_heater", "vacuum", "lawn_mower", "camera", "media_player", "device_tracker"}
)
_OUTDOOR_TEMP_KEYWORDS = ("outdoor", "outside", "exterior", "室外", "außen", "aussen")
_APPLIANCE_TEMP_KEYWORDS = (
    "water_heater",
    "waterheater",
    "water_temp",
    "input_water",
    "output_water",
    "hot_water",
    "cold_water",
    "inlet_temp",
    "outlet_temp",
    "boiler",
    "kettle",
    "fryer",
    "oven",
    "fridge",
    "freezer",
    "refrigerator",
    "dishwasher",
    "washer",
    "coffee",
    "dispenser",
    "purifier",
    ".ysj.",
    "_ysj_",
    "coil",
    "exhaust",
    "compressor",
    "condenser",
    "evaporator",
    "pipe_temp",
    "battery",
    "cpu",
    "gpu",
    "soc_temp",
    "chip",
    "board_temp",
    "body_temp",
    "body temperature",
    "nvme",
    "ssd",
    "hdd",
    "热水器",
    "饮水机",
    "净饮机",
    "净水器",
    "出水",
    "进水",
    "水温",
    "沸点",
    "炸锅",
    "冰箱",
    "烤箱",
    "洗衣机",
    "洗碗机",
    "咖啡机",
    "盘管",
    "排气",
    "压缩机",
    "冷凝",
    "蒸发",
    "电池",
    "芯片",
    "机身",
    "体温",
    "主板",
    "硬盘",
    "warmwasser",
    "heizkessel",
    "wasserkocher",
    "backofen",
    "kühlschrank",
    "batterie",
    "akku",
    "körper",
)


def _is_own_entity(entry: er.RegistryEntry) -> bool:
    """Return True if the registry entry belongs to RoomMind itself."""
    if entry.platform == DOMAIN:
        return True
    obj_id = entry.entity_id.split(".", 1)[-1]
    return bool(obj_id.startswith(f"{DOMAIN}_"))


def _device_class(hass: HomeAssistant, entry: er.RegistryEntry) -> str:
    """Resolve effective device_class from live state or entity registry metadata."""
    state = hass.states.get(entry.entity_id)
    if state is not None:
        dc = state.attributes.get("device_class")
        if isinstance(dc, str) and dc:
            return dc
    if entry.device_class:
        return str(entry.device_class)
    if entry.original_device_class:
        return str(entry.original_device_class)
    return ""


def _classify_climate_device(hass: HomeAssistant, entity_id: str) -> str:
    """Return 'ac' when entity supports cooling/dry modes, else 'trv'."""
    state = hass.states.get(entity_id)
    if state is not None:
        hvac_modes = state.attributes.get("hvac_modes") or ()
        if any(mode in _AC_MODES for mode in hvac_modes):
            return "ac"
    return "trv"


def _is_non_ambient_category(entry: er.RegistryEntry) -> bool:
    """Return True if the registry entry is marked diagnostic or config."""
    category = getattr(entry, "entity_category", None)
    return isinstance(category, str) and category.lower() in _NON_AMBIENT_ENTITY_CATEGORIES


def classify_temperature_sensor_exclusion(
    hass: HomeAssistant,
    entry: er.RegistryEntry,
    device: dr.DeviceEntry | None,
    device_domains: dict[str, set[str]],
) -> str | None:
    """Return an exclusion reason ('diagnostic', 'appliance', 'outdoor') or None."""
    if _is_non_ambient_category(entry):
        return "diagnostic"

    device_id = getattr(entry, "device_id", None)
    if isinstance(device_id, str) and device_domains.get(device_id, set()) & _NON_AMBIENT_DEVICE_DOMAINS:
        return "appliance"

    state = hass.states.get(entry.entity_id)
    friendly_name = state.attributes.get("friendly_name") if state is not None else None
    raw_parts = (
        entry.entity_id,
        friendly_name,
        getattr(entry, "name", None),
        getattr(entry, "original_name", None),
        getattr(device, "name", None) if device is not None else None,
        getattr(device, "name_by_user", None) if device is not None else None,
        getattr(device, "model", None) if device is not None else None,
        getattr(device, "model_id", None) if device is not None else None,
    )
    searchable = " ".join(part for part in raw_parts if isinstance(part, str) and part).lower()
    if any(kw in searchable for kw in _OUTDOOR_TEMP_KEYWORDS):
        return "outdoor"
    if any(kw in searchable for kw in _APPLIANCE_TEMP_KEYWORDS):
        return "appliance"
    return None


def suggest_area_entities(hass: HomeAssistant, area_id: str) -> dict[str, Any]:
    """Discover physical climate, sensor, cover, and fan entities in an HA Area."""
    entity_reg = er.async_get(hass)
    device_reg = dr.async_get(hass)

    device_domains: dict[str, set[str]] = {}
    for entry in entity_reg.entities.values():
        if _is_own_entity(entry):
            continue
        did = getattr(entry, "device_id", None)
        if isinstance(did, str) and did:
            device_domains.setdefault(did, set()).add(entry.entity_id.split(".", 1)[0])

    devices: list[dict[str, str]] = []
    temperature_sensors: list[str] = []
    humidity_sensors: list[str] = []
    co2_sensor = ""
    voc_sensor = ""
    pm25_sensors: list[str] = []
    window_sensors: list[str] = []
    occupancy_sensors: list[str] = []
    covers: list[str] = []
    airflow_devices: list[dict[str, Any]] = []

    for entry in sorted(entity_reg.entities.values(), key=lambda item: item.entity_id):
        if entry.disabled_by is not None or _is_own_entity(entry):
            continue

        effective_area = entry.area_id
        device = device_reg.async_get(entry.device_id) if entry.device_id else None
        if not effective_area and device is not None:
            effective_area = device.area_id
        if effective_area != area_id:
            continue

        eid = entry.entity_id
        domain = eid.split(".", 1)[0]

        if domain == "climate":
            devices.append(
                {
                    "entity_id": eid,
                    "type": _classify_climate_device(hass, eid),
                    "role": "auto",
                }
            )
        elif domain == "sensor":
            if _is_non_ambient_category(entry):
                continue
            dc = _device_class(hass, entry)
            if dc == "temperature":
                if classify_temperature_sensor_exclusion(hass, entry, device, device_domains) is None:
                    temperature_sensors.append(eid)
            elif dc == "humidity":
                humidity_sensors.append(eid)
            elif dc == "carbon_dioxide" and not co2_sensor:
                co2_sensor = eid
            elif dc in _VOC_CLASSES and not voc_sensor:
                voc_sensor = eid
            elif dc == "pm25":
                pm25_sensors.append(eid)
        elif domain == "binary_sensor":
            if _is_non_ambient_category(entry):
                continue
            dc = _device_class(hass, entry)
            if dc in _WINDOW_CLASSES:
                window_sensors.append(eid)
            elif dc in _OCCUPANCY_CLASSES:
                occupancy_sensors.append(eid)
        elif domain == "cover":
            covers.append(eid)
        elif domain == "fan":
            airflow_devices.append(
                {
                    "entity_id": eid,
                    "role": "circulation",
                    "controllable": True,
                    "control_enabled": False,
                }
            )

    return {
        "area_id": area_id,
        "devices": devices,
        "temperature_sensors": temperature_sensors,
        "humidity_sensors": humidity_sensors,
        "co2_sensor": co2_sensor,
        "voc_sensor": voc_sensor,
        "pm25_sensors": pm25_sensors,
        "window_sensors": window_sensors,
        "occupancy_sensors": occupancy_sensors,
        "covers": covers,
        "airflow_devices": airflow_devices,
    }
