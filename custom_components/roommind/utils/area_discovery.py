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


def suggest_area_entities(hass: HomeAssistant, area_id: str) -> dict[str, Any]:
    """Discover physical climate, sensor, cover, and fan entities in an HA Area."""
    entity_reg = er.async_get(hass)
    device_reg = dr.async_get(hass)

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
        if not effective_area and entry.device_id:
            device = device_reg.async_get(entry.device_id)
            effective_area = device.area_id if device is not None else None
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
            dc = _device_class(hass, entry)
            if dc == "temperature":
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
