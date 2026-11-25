"""Room validation and live snapshot payload builders for WebSocket API."""

from __future__ import annotations

import time
from copy import deepcopy
from typing import TYPE_CHECKING, Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from ..const import DOMAIN, build_override_live, is_override_suppressed
from ..room_config import resolve_setback_offset
from ..settings_config import DEFAULT_CONTROL_MODE
from ..utils.device_utils import (
    COIL_DRY_MODE_FAN_ONLY,
    DEFAULT_COIL_DRY_DRAIN_MINUTES,
    DEFAULT_COIL_DRY_FAN_MODE,
    DEFAULT_COIL_DRY_MIN_COOLING_MINUTES,
    DEFAULT_COIL_DRY_MINUTES,
)
from ..utils.presence_utils import is_presence_away

if TYPE_CHECKING:
    from ..coordinator import RoomMindCoordinator


def compute_anyone_home(hass: HomeAssistant, settings: dict) -> bool:
    """Return True if at least one tracked person is home (or fail-safe)."""
    return not is_presence_away(hass, {}, settings)


def validate_no_own_entities(
    config: dict, own_prefix: str, *, registry: er.EntityRegistry | None = None
) -> str | None:
    """Reject room policy entities used as physical inputs or actuators."""

    def is_own(entity_id: str) -> bool:
        entry = registry.async_get(entity_id) if registry is not None and entity_id else None
        return bool(
            entity_id.split(".", 1)[-1].startswith(own_prefix) or (entry is not None and entry.platform == DOMAIN)
        )

    for field in (
        "thermostats",
        "acs",
        "temperature_sensors",
        "humidity_sensors",
        "window_sensors",
        "covers",
        "occupancy_sensors",
        "members",
    ):
        for eid in config.get(field, []):
            if is_own(eid):
                return f"Cannot assign RoomMind's own entity '{eid}' as a physical input or actuator"

    for field in ("temperature_sensor", "humidity_sensor", "master_entity"):
        eid = config.get(field, "")
        if eid and is_own(eid):
            return f"Cannot assign RoomMind's own entity '{eid}' as a physical input or actuator"

    nested_entity_fields = (
        ("devices", ("entity_id",)),
        ("airflow_devices", ("entity_id", "power_sensor_entity")),
        ("night_controls", ("entity_id",)),
        ("adjacent_rooms", ("link_sensor_entity", "door_sensor_entity")),
    )
    for config_field, entity_fields in nested_entity_fields:
        for item in config.get(config_field, []):
            for entity_field in entity_fields:
                eid = item.get(entity_field, "")
                if eid and is_own(eid):
                    return f"Cannot assign RoomMind's own entity '{eid}' as a physical input or actuator"

    sleep_dev = config.get("sleep_device")
    if isinstance(sleep_dev, dict):
        for key, val in sleep_dev.items():
            if key.endswith("_entity") and isinstance(val, str) and val and is_own(val):
                return f"Cannot assign RoomMind's own entity '{val}' as a physical input or actuator"

    return None


def validate_no_duplicate_devices(config: dict) -> str | None:
    """Check for duplicate entity_ids in devices[]. Returns error message or None."""
    device_eids = [d["entity_id"] for d in config.get("devices", [])]
    if len(device_eids) != len(set(device_eids)):
        return "devices[] contains duplicate entity_ids"
    airflow_eids = [d["entity_id"] for d in config.get("airflow_devices", [])]
    if len(airflow_eids) != len(set(airflow_eids)):
        return "airflow_devices[] contains duplicate entity_ids"
    return None


def build_room_live_payload(
    room_config: dict,
    live: dict,
    settings: dict,
    *,
    learning_paused_reason: str | None,
) -> dict[str, Any]:
    """Build a deep-copied live state payload for one room."""
    return deepcopy(
        {
            "current_temp": live.get("current_temp"),
            "current_temp_raw": live.get("current_temp_raw", live.get("current_temp")),
            "current_humidity": live.get("current_humidity"),
            "target_temp": live.get("target_temp"),
            "heat_target": live.get("heat_target"),
            "cool_target": live.get("cool_target"),
            "mode": live.get("mode", "idle"),
            "observed_mode": live.get("observed_mode"),
            "observation_status": live.get("observation_status", "unknown"),
            "commanded_mode": live.get("commanded_mode", "idle"),
            "requested_power": live.get("requested_power", 0),
            "dispatch_status": live.get("dispatch_status", "unknown"),
            "heating_power": live.get("heating_power", 0),
            "device_setpoint": live.get("device_setpoint"),
            "device_actuation_status": live.get("device_actuation_status", []),
            "device_observations": live.get("device_observations", []),
            "ac_overdrive_status": live.get("ac_overdrive_status", []),
            "inverter_regime": live.get("inverter_regime"),
            "thermal_load_status": live.get("thermal_load_status"),
            "coil_dry_active": live.get("coil_dry_active", False),
            "coil_dry_phase": live.get("coil_dry_phase"),
            "coil_dry_until": live.get("coil_dry_until"),
            "coil_dry_entities": live.get("coil_dry_entities", []),
            "preheat": live.get("preheat"),
            "occupancy_vacant": live.get("occupancy_vacant", False),
            "co2": live.get("co2"),
            "voc": live.get("voc"),
            "pm25": live.get("pm25"),
            "air_quality_bad": live.get("air_quality_bad", False),
            "air_quality_reason": live.get("air_quality_reason"),
            "ventilation_active": live.get("ventilation_active", False),
            "price_level": live.get("price_level"),
            "price_shift_heat": live.get("price_shift_heat", 0.0),
            "price_shift_cool": live.get("price_shift_cool", 0.0),
            "window_open": live.get("window_open", False),
            **build_override_live(
                room_config,
                suppressed=is_override_suppressed(room_config, settings, live.get("presence_away", False)),
            ),
            "active_schedule_index": live.get("active_schedule_index", -1),
            "confidence": live.get("confidence"),
            "mpc_active": live.get("mpc_active", False),
            "presence_away": live.get("presence_away", False),
            "mold_risk_level": live.get("mold_risk_level", "ok"),
            "mold_surface_rh": live.get("mold_surface_rh"),
            "mold_prevention_active": live.get("mold_prevention_active", False),
            "mold_prevention_delta": live.get("mold_prevention_delta", 0),
            "n_observations": live.get("n_observations", 0),
            "blind_position": live.get("blind_position"),
            "cover_auto_paused": live.get("cover_auto_paused", False),
            "cover_forced_reason": live.get("cover_forced_reason", ""),
            "active_cover_schedule_index": live.get("active_cover_schedule_index", -1),
            "active_heat_sources": live.get("active_heat_sources"),
            "q_fan_mix": live.get("q_fan_mix", 0.0),
            "q_vent": live.get("q_vent", 0.0),
            "airflow_ach": live.get("airflow_ach", 0.0),
            "perceived_temp": live.get("perceived_temp"),
            "airflow_active": live.get("airflow_active", False),
            "airflow_plan_level": live.get("airflow_plan_level", 0.0),
            "airflow_mix_plan_level": live.get("airflow_mix_plan_level", 0.0),
            "airflow_vent_plan_level": live.get("airflow_vent_plan_level", 0.0),
            "airflow_devices_status": live.get("airflow_devices_status", []),
            "airflow_command_status": live.get("airflow_command_status", []),
            "sensor_conflict": live.get("sensor_conflict", 0.0),
            "sensor_fusion_status": live.get("sensor_fusion_status", []),
            "hvac_output_status": live.get("hvac_output_status"),
            "night_mode": live.get("night_mode", {"active": False}),
            "night_control_status": live.get("night_control_status", []),
            "sleep_device_status": live.get("sleep_device_status"),
            "rapid_recovery_active": live.get("rapid_recovery_active", False),
            "effective_control_target": live.get("effective_control_target"),
            "coupling_status": live.get("coupling_status", []),
            "learning_paused_reason": learning_paused_reason,
        }
    )


def build_rooms_list_payload(
    hass: HomeAssistant,
    *,
    coordinator: RoomMindCoordinator | None,
) -> dict[str, Any]:
    """Build the rooms + settings live snapshot payload for WS responses and pushes."""
    store = hass.data[DOMAIN]["store"]
    rooms = store.get_rooms()
    live_states = coordinator.rooms if coordinator else {}
    outdoor_available = coordinator is not None and coordinator.outdoor_temp_effective is not None
    settings = store.get_settings()
    learning_disabled = set(settings.get("learning_disabled_rooms", []))

    result = {}
    for area_id, room_config in rooms.items():
        room_data = dict(room_config)
        live = live_states.get(area_id, {})
        has_external_sensor = bool(room_config.get("temperature_sensor"))
        learning_paused_reason: str | None = (
            "outdoor_unavailable"
            if (
                not outdoor_available
                and has_external_sensor
                and area_id not in learning_disabled
                and not room_config.get("is_outdoor", False)
            )
            else None
        )
        room_data["live"] = build_room_live_payload(
            room_config,
            live,
            settings,
            learning_paused_reason=learning_paused_reason,
        )
        result[area_id] = room_data

    vacation_until = settings.get("vacation_until")
    vacation_active = bool(vacation_until and time.time() < vacation_until)

    return {
        "rooms": result,
        "outdoor_temp": coordinator.outdoor_temp_effective if coordinator else None,
        "outdoor_humidity": coordinator.outdoor_humidity if coordinator else None,
        "vacation_active": vacation_active,
        "vacation_temp": settings.get("vacation_temp") if vacation_active else None,
        "vacation_until": vacation_until if vacation_active else None,
        "hidden_rooms": settings.get("hidden_rooms", []),
        "room_order": settings.get("room_order", []),
        "group_by_floor": settings.get("group_by_floor", False),
        "control_mode": settings.get("control_mode", DEFAULT_CONTROL_MODE),
        "optimizer_strategy": settings.get("optimizer_strategy", "greedy"),
        "climate_control_active": settings.get("climate_control_active", True),
        "presence_enabled": settings.get("presence_enabled", False),
        "presence_persons": settings.get("presence_persons", []),
        "presence_away_action": settings.get("presence_away_action", "eco"),
        "presence_clears_override": settings.get("presence_clears_override", False),
        "schedule_off_action": settings.get("schedule_off_action", "eco"),
        "anyone_home": compute_anyone_home(hass, settings),
        "valve_protection_enabled": settings.get("valve_protection_enabled", False),
        "compressor_groups": settings.get("compressor_groups", []),
        "setback_offset": resolve_setback_offset({}, settings),
        "coil_dry_enabled": settings.get("coil_dry_enabled", False),
        "coil_dry_minutes": settings.get("coil_dry_minutes", DEFAULT_COIL_DRY_MINUTES),
        "coil_dry_mode": settings.get("coil_dry_mode", COIL_DRY_MODE_FAN_ONLY),
        "coil_dry_fan_mode": settings.get("coil_dry_fan_mode", DEFAULT_COIL_DRY_FAN_MODE),
        "coil_dry_min_cooling_minutes": settings.get(
            "coil_dry_min_cooling_minutes", DEFAULT_COIL_DRY_MIN_COOLING_MINUTES
        ),
        "coil_dry_drain_minutes": settings.get("coil_dry_drain_minutes", DEFAULT_COIL_DRY_DRAIN_MINUTES),
        "price_entity": settings.get("price_entity", ""),
        "price_status": coordinator.price_status() if coordinator else None,
    }
