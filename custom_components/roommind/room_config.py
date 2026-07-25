"""Room configuration normalization and compatibility policy."""

from __future__ import annotations

import copy
from dataclasses import dataclass

from .const import (
    DEFAULT_COMFORT_COOL,
    DEFAULT_COMFORT_HEAT,
    DEFAULT_ECO_COOL,
    DEFAULT_ECO_HEAT,
    DEFAULT_HEAT_SOURCE_AC_MIN_OUTDOOR,
    DEFAULT_HEAT_SOURCE_OUTDOOR_THRESHOLD,
    DEFAULT_HEAT_SOURCE_PRIMARY_DELTA,
)
from .utils.device_utils import (
    devices_to_legacy,
    ensure_room_has_devices,
    get_room_heating_system_type,
    legacy_to_devices,
    migrate_heat_pump_devices,
)

ROOM_CONFIG_DEFAULTS: dict[str, object] = {
    "devices": [],
    "thermostats": [],
    "acs": [],
    "temperature_sensor": "",
    "temperature_sensors": [],
    "airflow_devices": [],
    "room_volume_m3": None,
    "control_target": "air_temperature",
    "quiet_hours": None,
    "night_mode_enabled": True,
    "night_controls": [],
    "night_allow_rapid_recovery": True,
    "rapid_recovery_delta_c": 2.0,
    "max_fan_level_night": 0.5,
    "sleep_temp_ramp_c": 0.0,
    "adjacent_rooms": [],
    "humidity_sensor": "",
    "humidity_sensors": [],
    "occupancy_sensors": [],
    "climate_mode": "auto",
    "schedules": [],
    "schedule_selector_entity": "",
    "window_sensors": [],
    "window_open_delay": 0,
    "window_close_delay": 0,
    "comfort_temp": DEFAULT_COMFORT_HEAT,
    "eco_temp": DEFAULT_ECO_HEAT,
    "comfort_heat": DEFAULT_COMFORT_HEAT,
    "comfort_cool": DEFAULT_COMFORT_COOL,
    "eco_heat": DEFAULT_ECO_HEAT,
    "eco_cool": DEFAULT_ECO_COOL,
    "presence_persons": [],
    "display_name": "",
    "heating_system_type": "",
    "covers": [],
    "covers_auto_enabled": False,
    "covers_deploy_threshold": 1.5,
    "covers_min_position": 0,
    "covers_outdoor_min_temp": None,
    "covers_override_minutes": 60,
    "cover_schedules": [],
    "cover_schedule_selector_entity": "",
    "cover_orientations": {},
    "covers_night_close": False,
    "covers_night_close_elevation": 0,
    "covers_night_close_offset_minutes": 0,
    "covers_night_position": 0,
    "covers_snap_deploy": False,
    "cover_min_positions": {},
    "ignore_presence": False,
    "is_outdoor": False,
    "valve_protection_exclude": [],
    "heat_source_orchestration": False,
    "heat_source_primary_delta": DEFAULT_HEAT_SOURCE_PRIMARY_DELTA,
    "heat_source_outdoor_threshold": DEFAULT_HEAT_SOURCE_OUTDOOR_THRESHOLD,
    "heat_source_ac_min_outdoor": DEFAULT_HEAT_SOURCE_AC_MIN_OUTDOOR,
    "climate_control_enabled": True,
}


@dataclass(frozen=True, slots=True)
class RoomMigrationResult:
    """Persisted compatibility changes applied to one room."""

    device_model_added: bool = False
    heat_pump_migrated: bool = False

    @property
    def changed(self) -> bool:
        """Return whether persistence is required."""
        return self.device_model_added or self.heat_pump_migrated


def migrate_persisted_room(room: dict) -> RoomMigrationResult:
    """Apply persistence-worthy device migrations to a stored room."""
    device_model_added = "devices" not in room
    if device_model_added:
        ensure_room_has_devices(room)

    heat_pump_migrated = migrate_heat_pump_devices(room.get("devices", []))
    if heat_pump_migrated:
        thermostats, acs = devices_to_legacy(room["devices"])
        room["thermostats"] = thermostats
        room["acs"] = acs

    return RoomMigrationResult(
        device_model_added=device_model_added,
        heat_pump_migrated=heat_pump_migrated,
    )


def normalize_room_config(room: dict) -> dict:
    """Apply read-time defaults and compatibility normalization in place."""
    room.setdefault("comfort_heat", room.get("comfort_temp", DEFAULT_COMFORT_HEAT))
    room.setdefault("eco_heat", room.get("eco_temp", DEFAULT_ECO_HEAT))
    room.setdefault("comfort_temp", room["comfort_heat"])
    room.setdefault("eco_temp", room["eco_heat"])
    for key, default in ROOM_CONFIG_DEFAULTS.items():
        if key not in room:
            room[key] = copy.deepcopy(default)

    for adjacent in room.get("adjacent_rooms", []) or []:
        if isinstance(adjacent, dict):
            adjacent.setdefault("allow_borrowed_conditioning", True)

    normalize_room_sensor_sources(room)
    migrate_heat_pump_devices(room.get("devices", []))
    ensure_room_has_devices(room)
    return room


def normalize_room_sensor_sources(room: dict) -> None:
    """Keep primary temperature and humidity sources first and unique."""
    _normalize_sensor_sources(room, primary_key="temperature_sensor", sources_key="temperature_sensors")
    _normalize_sensor_sources(room, primary_key="humidity_sensor", sources_key="humidity_sensors")


def upsert_room_config(area_id: str, existing: dict | None, changes: dict) -> dict:
    """Create or merge a room while preserving all compatibility invariants."""
    if existing is None:
        return _create_room_config(area_id, changes)
    return _merge_room_config(existing, changes)


def _normalize_sensor_sources(room: dict, *, primary_key: str, sources_key: str) -> None:
    primary = room.get(primary_key) or ""
    if not primary:
        room[sources_key] = []
        return

    raw_sensors = room.get(sources_key, []) or []
    if isinstance(raw_sensors, str):
        raw_sensors = [raw_sensors]
    sensor_ids = [primary]
    for item in raw_sensors:
        entity_id = item.get("entity_id") if isinstance(item, dict) else item
        if entity_id and entity_id not in sensor_ids:
            sensor_ids.append(entity_id)
    room[sources_key] = sensor_ids


def _sync_devices(room: dict, changes: dict) -> None:
    if "devices" in changes:
        thermostats, acs = devices_to_legacy(room["devices"])
        room["thermostats"] = thermostats
        room["acs"] = acs
        room["heating_system_type"] = get_room_heating_system_type(room["devices"])
    elif "thermostats" in changes or "acs" in changes:
        room["devices"] = legacy_to_devices(
            room.get("thermostats", []),
            room.get("acs", []),
            room.get("heating_system_type", ""),
        )


def _merge_room_config(existing: dict, changes: dict) -> dict:
    for key, value in changes.items():
        if key != "area_id":
            existing[key] = value

    if "comfort_heat" in changes:
        existing["comfort_temp"] = changes["comfort_heat"]
    if "eco_heat" in changes:
        existing["eco_temp"] = changes["eco_heat"]
    if "comfort_temp" in changes and "comfort_heat" not in changes:
        existing["comfort_heat"] = changes["comfort_temp"]
    if "eco_temp" in changes and "eco_heat" not in changes:
        existing["eco_heat"] = changes["eco_temp"]

    _sync_devices(existing, changes)
    if "temperature_sensor" in changes or "temperature_sensors" in changes:
        _normalize_sensor_sources(
            existing,
            primary_key="temperature_sensor",
            sources_key="temperature_sensors",
        )
    if "humidity_sensor" in changes or "humidity_sensors" in changes:
        _normalize_sensor_sources(
            existing,
            primary_key="humidity_sensor",
            sources_key="humidity_sensors",
        )
    return existing


def _create_room_config(area_id: str, config: dict) -> dict:
    comfort_heat = config.get("comfort_heat", config.get("comfort_temp", DEFAULT_COMFORT_HEAT))
    eco_heat = config.get("eco_heat", config.get("eco_temp", DEFAULT_ECO_HEAT))
    room: dict = {"area_id": area_id, **copy.deepcopy(ROOM_CONFIG_DEFAULTS)}
    for key in ROOM_CONFIG_DEFAULTS:
        if key in config:
            room[key] = config[key]
    room["comfort_temp"] = comfort_heat
    room["comfort_heat"] = comfort_heat
    room["eco_temp"] = eco_heat
    room["eco_heat"] = eco_heat

    if "devices" in config and config["devices"]:
        thermostats, acs = devices_to_legacy(room["devices"])
        room["thermostats"] = thermostats
        room["acs"] = acs
        room["heating_system_type"] = get_room_heating_system_type(room["devices"])
    elif "thermostats" in config or "acs" in config:
        room["thermostats"] = config.get("thermostats", [])
        room["acs"] = config.get("acs", [])
        room["devices"] = legacy_to_devices(
            room["thermostats"],
            room["acs"],
            room.get("heating_system_type", ""),
        )

    normalize_room_sensor_sources(room)
    return room
