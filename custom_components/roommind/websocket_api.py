"""WebSocket API for RoomMind room CRUD operations."""

from __future__ import annotations

import inspect
import logging
import time
from copy import deepcopy
from typing import TYPE_CHECKING

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er

from .const import (
    DOMAIN,
    OVERRIDE_TYPES,
    build_override_live,
    is_override_suppressed,
    make_roommind_context,
)
from .managers.airflow_levels import resolve_fan_mode_for_policy, resolve_fan_target_for_policy
from .room_config import ROOM_CONFIG_FIELDS, ROOM_CONFIG_SCHEMA, resolve_setback_offset
from .services.analytics_service import (
    _compute_target_forecast,  # noqa: F401 - re-exported for tests
    _csv_to_points,  # noqa: F401 - re-exported for tests
    _safe_float,  # noqa: F401 - re-exported for tests
    build_analytics_data,
)
from .services.ha_services import resolve_override_temperature
from .settings_config import (
    DEFAULT_CONTROL_MODE,
    SETTINGS_FIELDS,
    SETTINGS_SCHEMA,
    SettingsValidationError,
    validate_settings_changes,
)
from .utils.area_discovery import suggest_area_entities
from .utils.schedule_utils import read_schedule_blocks
from .utils.sleep_device import (
    format_ab_gears,
    gear_to_heat_level_option,
    inspect_sleep_device_state,
    update_qushui_sleep_curve,
)

_LOGGER = logging.getLogger(__name__)


if TYPE_CHECKING:
    from homeassistant.components.websocket_api import ActiveConnection

    from .coordinator import RoomMindCoordinator


def _get_coordinator(hass: HomeAssistant) -> RoomMindCoordinator | None:
    """Return the RoomMindCoordinator from hass.data, or None."""
    coordinator: RoomMindCoordinator | None = hass.data.get(DOMAIN, {}).get("coordinator")
    return coordinator


# _safe_float, _csv_to_points and _compute_target_forecast come from
# .services.analytics_service (see imports above). The module re-exports
# them so existing callers (incl. tests) keep working.


def _compute_anyone_home(hass: HomeAssistant, settings: dict) -> bool:
    """Return True if at least one tracked person is home (or fail-safe)."""
    from .utils.presence_utils import is_presence_away

    return not is_presence_away(hass, {}, settings)  # all away


def _validate_no_own_entities(
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


def _validate_no_duplicate_devices(config: dict) -> str | None:
    """Check for duplicate entity_ids in devices[]. Returns error message or None."""
    device_eids = [d["entity_id"] for d in config.get("devices", [])]
    if len(device_eids) != len(set(device_eids)):
        return "devices[] contains duplicate entity_ids"
    airflow_eids = [d["entity_id"] for d in config.get("airflow_devices", [])]
    if len(airflow_eids) != len(set(airflow_eids)):
        return "airflow_devices[] contains duplicate entity_ids"
    return None


# ---------------------------------------------------------------------------
# List rooms
# ---------------------------------------------------------------------------


@websocket_api.websocket_command({vol.Required("type"): "roommind/rooms/list"})
@websocket_api.async_response
async def websocket_list_rooms(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Return all rooms with current state."""
    store = hass.data[DOMAIN]["store"]
    rooms = store.get_rooms()

    # Merge live state from coordinator
    coordinator = _get_coordinator(hass)
    # If coordinator has no data yet but rooms exist, trigger an immediate refresh
    if coordinator and rooms and not coordinator.rooms:
        await coordinator.async_request_refresh()
    live_states = coordinator.rooms if coordinator else {}

    # Outdoor temperature availability gates EKF training (#301).  Surface the
    # paused state per room so the frontend can show an explanatory badge.
    outdoor_available = coordinator is not None and coordinator.outdoor_temp_effective is not None
    settings = store.get_settings()
    learning_disabled = set(settings.get("learning_disabled_rooms", []))

    # Build response: config + live state per room
    # Compute override fields from the store (always up-to-date) rather
    # than from the coordinator (which refreshes on a 10s cycle).
    result = {}
    for area_id, room_config in rooms.items():
        room_data = dict(room_config)
        live = live_states.get(area_id, {})
        # Managed Mode rooms (no temperature_sensor) never train the EKF, so
        # surfacing "learning paused" would be misleading.
        has_external_sensor = bool(room_config.get("temperature_sensor"))
        if (
            not outdoor_available
            and has_external_sensor
            and area_id not in learning_disabled
            and not room_config.get("is_outdoor", False)
        ):
            learning_paused_reason: str | None = "outdoor_unavailable"
        else:
            learning_paused_reason = None

        room_data["live"] = deepcopy(
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
        result[area_id] = room_data

    # Vacation state from settings
    vacation_until = settings.get("vacation_until")
    vacation_active = bool(vacation_until and time.time() < vacation_until)

    connection.send_result(
        msg["id"],
        {
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
            "anyone_home": _compute_anyone_home(hass, settings),
            "valve_protection_enabled": settings.get("valve_protection_enabled", False),
            "compressor_groups": settings.get("compressor_groups", []),
            "setback_offset": resolve_setback_offset({}, settings),
        },
    )


# ---------------------------------------------------------------------------
# Save room (upsert: create or update)
# ---------------------------------------------------------------------------


@websocket_api.websocket_command(
    {
        vol.Required("type"): "roommind/rooms/save",
        vol.Required("area_id"): str,
        **ROOM_CONFIG_SCHEMA,
    }
)
@websocket_api.async_response
async def websocket_save_room(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Create or update a room configuration."""
    store = hass.data[DOMAIN]["store"]
    area_id = msg["area_id"]

    # Build config dict from optional fields present in the message
    config: dict = {}
    for key in ROOM_CONFIG_FIELDS:
        if key in msg:
            config[key] = msg[key]

    # Reject RoomMind's own entities to prevent self-assignment (#86)
    own_prefix = f"{DOMAIN}_"
    err = _validate_no_own_entities(config, own_prefix, registry=er.async_get(hass))
    if err:
        connection.send_error(msg["id"], "invalid_entity", err)
        return
    # Reject duplicate entity_ids in devices[]
    err = _validate_no_duplicate_devices(config)
    if err:
        connection.send_error(msg["id"], "duplicate_entity", err)
        return

    if ("thermostats" in config or "acs" in config) and "devices" not in config:
        _LOGGER.warning(
            "Room save for '%s' uses legacy thermostats/acs fields without devices. "
            "These fields are deprecated and a future version removes them.",
            area_id,
        )

    room = await store.async_save_room(area_id, config)

    # Notify coordinator to create/update sensor entities for the room
    coordinator = _get_coordinator(hass)
    if coordinator:
        await coordinator.async_room_added(room)

    connection.send_result(msg["id"], {"room": room})


# ---------------------------------------------------------------------------
# Delete room
# ---------------------------------------------------------------------------


@websocket_api.websocket_command(
    {
        vol.Required("type"): "roommind/rooms/delete",
        vol.Required("area_id"): str,
    }
)
@websocket_api.async_response
async def websocket_delete_room(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Delete a room."""
    store = hass.data[DOMAIN]["store"]
    area_id = msg["area_id"]

    try:
        await store.async_delete_room(area_id)
    except KeyError:
        connection.send_error(msg["id"], "not_found", f"Room '{area_id}' not found")
        return

    # Notify coordinator to remove sensor entities for the deleted room
    coordinator = _get_coordinator(hass)
    if coordinator:
        await coordinator.async_room_removed(area_id)

    connection.send_result(msg["id"], {"success": True})


# ---------------------------------------------------------------------------
# Set override
# ---------------------------------------------------------------------------


@websocket_api.websocket_command(
    {
        vol.Required("type"): "roommind/override/set",
        vol.Required("area_id"): str,
        vol.Required("override_type"): vol.In(OVERRIDE_TYPES),
        vol.Optional("temperature"): vol.Coerce(float),
        vol.Optional("duration"): vol.Coerce(float),  # hours (omit or 0 for permanent)
    }
)
@websocket_api.async_response
async def websocket_override_set(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Set a temporary override for a room."""
    store = hass.data[DOMAIN]["store"]
    area_id = msg["area_id"]
    override_type = msg["override_type"]
    duration_hours = msg.get("duration")

    room = store.get_room(area_id)
    if room is None:
        connection.send_error(msg["id"], "not_found", f"Room '{area_id}' not found")
        return

    # Resolve override temperature
    try:
        override_temp = resolve_override_temperature(room, override_type, msg.get("temperature"))
    except ValueError as err:
        connection.send_error(msg["id"], "invalid", str(err))
        return

    override_until = (time.time() + duration_hours * 3600) if duration_hours else None

    await store.async_update_room(
        area_id,
        {
            "override_temp": override_temp,
            "override_until": override_until,
            "override_type": override_type,
        },
    )

    coordinator = _get_coordinator(hass)
    if coordinator:
        await coordinator.async_request_refresh()

    connection.send_result(msg["id"], {"success": True})


# ---------------------------------------------------------------------------
# Clear override
# ---------------------------------------------------------------------------


@websocket_api.websocket_command(
    {
        vol.Required("type"): "roommind/override/clear",
        vol.Required("area_id"): str,
    }
)
@websocket_api.async_response
async def websocket_override_clear(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Clear an active override for a room."""
    store = hass.data[DOMAIN]["store"]
    area_id = msg["area_id"]

    room = store.get_room(area_id)
    if room is None:
        connection.send_error(msg["id"], "not_found", f"Room '{area_id}' not found")
        return

    await store.async_update_room(
        area_id,
        {
            "override_temp": None,
            "override_until": None,
            "override_type": None,
        },
    )

    coordinator = _get_coordinator(hass)
    if coordinator:
        await coordinator.async_request_refresh()

    connection.send_result(msg["id"], {"success": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "roommind/fan/set",
        vol.Required("area_id"): str,
        vol.Optional("fan_speed_mode"): str,
        vol.Optional("entity_id"): str,
        vol.Optional("fan_mode"): str,
        vol.Optional("percentage"): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("preset_mode"): str,
        vol.Optional("swing_mode"): str,
        vol.Optional("swing_horizontal_mode"): str,
        vol.Optional("oscillating"): bool,
        vol.Optional("direction"): vol.In(["forward", "reverse"]),
        vol.Optional("turn_on"): bool,
    }
)
@websocket_api.async_response
async def websocket_fan_set(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Apply room-level fan_speed_mode or per-unit fan/swing/oscillation controls."""
    store = hass.data[DOMAIN]["store"]
    area_id = msg["area_id"]
    room = store.get_room(area_id)
    if room is None:
        connection.send_error(msg["id"], "not_found", f"Room '{area_id}' not found")
        return

    applied: list[dict] = []
    ctx = make_roommind_context()

    async def _dispatch(domain: str, service: str, data: dict) -> None:
        result = hass.services.async_call(domain, service, data, blocking=True, context=ctx)
        if inspect.isawaitable(result):
            await result
        applied.append({"domain": domain, "service": service, **data})

    if "fan_speed_mode" in msg:
        mode_val = str(msg["fan_speed_mode"] or "auto").strip()
        await store.async_update_room(area_id, {"fan_speed_mode": mode_val})

        seen: set[str] = set()
        for dev in room.get("devices", []) or []:
            eid = dev.get("entity_id", "") if isinstance(dev, dict) else ""
            if not eid or eid in seen or not eid.startswith("climate."):
                continue
            seen.add(eid)
            st = hass.states.get(eid)
            if st is None or str(st.state) in ("off", "unavailable", "unknown"):
                continue
            fan_modes = [str(m) for m in (st.attributes or {}).get("fan_modes") or []]
            target_mode = resolve_fan_mode_for_policy(mode_val, fan_modes)
            if target_mode and st.attributes.get("fan_mode") != target_mode:
                await _dispatch("climate", "set_fan_mode", {"entity_id": eid, "fan_mode": target_mode})

        for dev in room.get("airflow_devices", []) or []:
            eid = dev.get("entity_id", "") if isinstance(dev, dict) else ""
            if not eid or eid in seen:
                continue
            if dev.get("role") == "ventilation" or not dev.get("controllable") or not dev.get("control_enabled"):
                continue
            seen.add(eid)
            st = hass.states.get(eid)
            if st is None or str(st.state) in ("off", "unavailable", "unknown"):
                continue
            if eid.startswith("climate."):
                fan_modes = [str(m) for m in (st.attributes or {}).get("fan_modes") or []]
                target_mode = resolve_fan_mode_for_policy(mode_val, fan_modes)
                if target_mode and st.attributes.get("fan_mode") != target_mode:
                    await _dispatch("climate", "set_fan_mode", {"entity_id": eid, "fan_mode": target_mode})
            elif eid.startswith("fan."):
                pct, preset = resolve_fan_target_for_policy(mode_val, st.attributes or {})
                if pct is not None:
                    await _dispatch("fan", "turn_on", {"entity_id": eid, "percentage": pct})
                if preset:
                    await _dispatch("fan", "set_preset_mode", {"entity_id": eid, "preset_mode": preset})

        coordinator = _get_coordinator(hass)
        if coordinator:
            await coordinator.async_request_refresh()

    if "entity_id" in msg:
        eid = msg["entity_id"]
        st = hass.states.get(eid)
        if st is None:
            connection.send_error(msg["id"], "not_found", f"Entity '{eid}' not found")
            return
        domain = eid.split(".", 1)[0] if "." in eid else ""
        if domain not in ("climate", "fan"):
            connection.send_error(msg["id"], "invalid", f"Unsupported domain for fan control: '{eid}'")
            return
        if domain == "climate":
            if "fan_mode" in msg:
                await _dispatch("climate", "set_fan_mode", {"entity_id": eid, "fan_mode": msg["fan_mode"]})
            if "swing_mode" in msg:
                await _dispatch("climate", "set_swing_mode", {"entity_id": eid, "swing_mode": msg["swing_mode"]})
            if "swing_horizontal_mode" in msg:
                await _dispatch(
                    "climate",
                    "set_swing_horizontal_mode",
                    {"entity_id": eid, "swing_horizontal_mode": msg["swing_horizontal_mode"]},
                )
            if "preset_mode" in msg:
                await _dispatch("climate", "set_preset_mode", {"entity_id": eid, "preset_mode": msg["preset_mode"]})
        else:
            if msg.get("turn_on") is False or msg.get("percentage") == 0:
                await _dispatch("fan", "turn_off", {"entity_id": eid})
            elif "percentage" in msg:
                await _dispatch("fan", "turn_on", {"entity_id": eid, "percentage": int(msg["percentage"])})
            elif msg.get("turn_on") is True:
                await _dispatch("fan", "turn_on", {"entity_id": eid})
            if "preset_mode" in msg:
                await _dispatch("fan", "set_preset_mode", {"entity_id": eid, "preset_mode": msg["preset_mode"]})
            if "oscillating" in msg:
                await _dispatch("fan", "oscillate", {"entity_id": eid, "oscillating": bool(msg["oscillating"])})
            if "direction" in msg:
                await _dispatch("fan", "set_direction", {"entity_id": eid, "direction": msg["direction"]})

    connection.send_result(msg["id"], {"success": True, "applied": applied})


# ---------------------------------------------------------------------------
# Get settings
# ---------------------------------------------------------------------------


@websocket_api.websocket_command({vol.Required("type"): "roommind/settings/get"})
@websocket_api.async_response
async def websocket_get_settings(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Return global settings."""
    store = hass.data[DOMAIN]["store"]
    connection.send_result(msg["id"], {"settings": store.get_settings()})


# ---------------------------------------------------------------------------
# Save settings
# ---------------------------------------------------------------------------


@websocket_api.websocket_command(
    {
        vol.Required("type"): "roommind/settings/save",
        **SETTINGS_SCHEMA,
    }
)
@websocket_api.async_response
async def websocket_save_settings(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Save global settings (partial merge)."""
    store = hass.data[DOMAIN]["store"]
    changes: dict = {}
    for key in SETTINGS_FIELDS:
        if key in msg:
            changes[key] = msg[key]

    try:
        validate_settings_changes(changes)
    except SettingsValidationError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return

    for group in changes.get("compressor_groups", []):
        entity_error = _validate_no_own_entities(group, f"{DOMAIN}_", registry=er.async_get(hass))
        if entity_error:
            connection.send_error(msg["id"], "invalid_entity", entity_error)
            return

    settings = await store.async_save_settings(changes)
    connection.send_result(msg["id"], {"settings": settings})


# ---------------------------------------------------------------------------
# Target temperature forecast (for analytics chart)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Get analytics data
# ---------------------------------------------------------------------------


@websocket_api.websocket_command(
    {
        vol.Required("type"): "roommind/analytics/get",
        vol.Required("area_id"): str,
        vol.Optional("range"): vol.In(["12h", "24h", "2d", "7d", "14d", "30d", "90d"]),
        vol.Optional("start_ts"): vol.Coerce(float),
        vol.Optional("end_ts"): vol.Coerce(float),
    }
)
@websocket_api.async_response
async def websocket_get_analytics(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Return analytics data for a room."""
    store = hass.data[DOMAIN]["store"]
    coordinator = _get_coordinator(hass)
    result = await build_analytics_data(
        hass,
        msg["area_id"],
        msg.get("range", "12h"),
        store,
        coordinator,
        custom_start=msg.get("start_ts"),
        custom_end=msg.get("end_ts"),
    )
    connection.send_result(msg["id"], result)


# ---------------------------------------------------------------------------
# Reset thermal model (per room)
# ---------------------------------------------------------------------------


@websocket_api.websocket_command(
    {
        vol.Required("type"): "roommind/thermal/reset",
        vol.Required("area_id"): str,
    }
)
@websocket_api.async_response
async def websocket_thermal_reset(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Reset thermal model and history for a single room."""
    store = hass.data[DOMAIN]["store"]
    area_id = msg["area_id"]
    coordinator = _get_coordinator(hass)

    # Clear learned model and residual heat tracking
    if coordinator:
        coordinator.reset_thermal_room(area_id)

    # Clear persisted thermal data
    await store.async_clear_thermal_data_room(area_id)

    # Clear history CSV files
    if coordinator and coordinator.history_store:
        await hass.async_add_executor_job(coordinator.history_store.remove_room, area_id)

    connection.send_result(msg["id"], {"success": True})


# ---------------------------------------------------------------------------
# Reset thermal model (all rooms)
# ---------------------------------------------------------------------------


@websocket_api.websocket_command({vol.Required("type"): "roommind/thermal/reset_all"})
@websocket_api.async_response
async def websocket_thermal_reset_all(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Reset thermal model and history for all rooms."""
    store = hass.data[DOMAIN]["store"]
    coordinator = _get_coordinator(hass)

    # Clear all learned models — replace entire manager for clean state
    room_ids: list[str] = []
    if coordinator:
        room_ids = coordinator.reset_thermal_all()

    # Clear persisted thermal data
    await store.async_clear_all_thermal_data()

    # Clear history CSV files for all rooms
    if coordinator and coordinator.history_store:
        for area_id in room_ids:
            await hass.async_add_executor_job(coordinator.history_store.remove_room, area_id)

    connection.send_result(msg["id"], {"success": True})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "roommind/model/boost_learning",
        vol.Required("area_id"): str,
    }
)
@websocket_api.async_response
async def websocket_boost_learning(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Boost EKF covariance for a room to accelerate re-learning."""
    store = hass.data[DOMAIN]["store"]
    coordinator = _get_coordinator(hass)
    area_id = msg["area_id"]

    if not coordinator:
        connection.send_error(msg["id"], "no_coordinator", "Coordinator not ready")
        return

    n_obs = coordinator.boost_learning(area_id)

    # Persist cooldown anchor in settings
    settings = store.get_settings()
    boost_applied = dict(settings.get("boost_applied_at", {}))
    boost_applied[area_id] = n_obs
    await store.async_save_settings({"boost_applied_at": boost_applied})

    connection.send_result(msg["id"], {"success": True, "n_observations": n_obs})


# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------


@websocket_api.websocket_command({vol.Required("type"): "roommind/diagnostics/get"})
@websocket_api.async_response
async def websocket_get_diagnostics(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict,
) -> None:
    """Return full integration diagnostics via WebSocket."""
    from .diagnostics import async_get_config_entry_diagnostics

    entries = hass.config_entries.async_entries(DOMAIN)
    if not entries:
        connection.send_error(msg["id"], "not_found", "No config entry found")
        return
    result = await async_get_config_entry_diagnostics(hass, entries[0])
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command(
    {
        vol.Required("type"): "roommind/area/suggest",
        vol.Required("area_id"): str,
    }
)
@websocket_api.async_response
async def websocket_area_suggest(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Return auto-discovered HA Area entities suitable for RoomMind configuration."""
    connection.send_result(msg["id"], suggest_area_entities(hass, msg["area_id"]))


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


@websocket_api.websocket_command(
    {
        vol.Required("type"): "roommind/schedules/blocks",
        vol.Required("area_id"): str,
    }
)
@websocket_api.async_response
async def websocket_get_schedule_blocks(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Return resolved weekly schedule blocks for every schedule configured on a room."""
    store = hass.data[DOMAIN]["store"]
    area_id = msg["area_id"]
    room = store.get_room(area_id)
    if room is None:
        connection.send_error(msg["id"], "not_found", f"Room '{area_id}' not found")
        return

    coordinator = _get_coordinator(hass)
    cache = getattr(coordinator, "_schedule_blocks_cache", None) if coordinator else None
    blocks_by_entity: dict[str, dict] = {}
    for entry in room.get("schedules", []) or []:
        eid = entry.get("entity_id", "") if isinstance(entry, dict) else ""
        if not eid:
            continue
        blocks = await read_schedule_blocks(hass, eid, cache=cache)
        if blocks is not None:
            normalized_days: dict[str, list[dict]] = {}
            for day_key, items in blocks.items():
                if not isinstance(items, list):
                    continue
                norm_items = []
                for blk in items:
                    if not isinstance(blk, dict):
                        continue
                    f_raw = blk.get("from", "00:00:00")
                    t_raw = blk.get("to", "00:00:00")
                    norm_items.append(
                        {
                            "from": f_raw.strftime("%H:%M:%S") if hasattr(f_raw, "strftime") else str(f_raw),
                            "to": t_raw.strftime("%H:%M:%S") if hasattr(t_raw, "strftime") else str(t_raw),
                            "data": dict(blk.get("data") or {}),
                        }
                    )
                normalized_days[str(day_key)] = norm_items
            blocks_by_entity[eid] = normalized_days

    live = (coordinator.rooms.get(area_id, {}) if coordinator else {}) or {}
    connection.send_result(
        msg["id"],
        {
            "area_id": area_id,
            "blocks_by_entity": blocks_by_entity,
            "active_index": live.get("active_schedule_index", -1),
            "selector_entity": room.get("schedule_selector_entity", ""),
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "roommind/sleep/action",
        vol.Required("area_id"): str,
        vol.Required("action"): vol.In(
            [
                "pre_warm",
                "sleep_now",
                "skip_tonight",
                "clear",
                "set_gears",
                "toggle_power",
                "toggle_sleep_switch",
                "sync_curve",
            ]
        ),
        vol.Optional("gear_a"): vol.All(vol.Coerce(int), vol.Range(min=0, max=6)),
        vol.Optional("gear_b"): vol.All(vol.Coerce(int), vol.Range(min=0, max=6)),
        vol.Optional("countdown_min"): vol.All(vol.Coerce(int), vol.Range(min=0, max=720)),
        vol.Optional("zone_a_enabled"): bool,
        vol.Optional("zone_b_enabled"): bool,
    }
)
@websocket_api.async_response
async def websocket_sleep_action(
    hass: HomeAssistant,
    connection: ActiveConnection,
    msg: dict,
) -> None:
    """Apply tonight sleep phase overrides or heated-blanket device commands."""
    store = hass.data[DOMAIN]["store"]
    area_id = msg["area_id"]
    room = store.get_room(area_id)
    if room is None:
        connection.send_error(msg["id"], "not_found", f"Room '{area_id}' not found")
        return

    action = msg["action"]
    coordinator = _get_coordinator(hass)
    sleep_dev = room.get("sleep_device") if isinstance(room.get("sleep_device"), dict) else None
    status = inspect_sleep_device_state(hass, sleep_dev)
    ctx = make_roommind_context()

    async def _call(domain: str, service: str, data: dict) -> None:
        res = hass.services.async_call(domain, service, data, blocking=True, context=ctx)
        if inspect.isawaitable(res):
            await res

    hardware_actions = {"pre_warm", "sleep_now", "set_gears", "toggle_power", "toggle_sleep_switch", "sync_curve"}
    if action in hardware_actions and status and not status.get("remote_enabled", True):
        if action in {"set_gears", "toggle_power", "toggle_sleep_switch", "sync_curve"}:
            connection.send_result(msg["id"], {"ok": False, "reason": "remote_disabled"})
            return

    async def _apply_gears(gear_a: int, gear_b: int, *, turn_on: bool = True) -> None:
        if not sleep_dev:
            return
        if sleep_dev.get("power_entity"):
            if turn_on and (gear_a > 0 or gear_b > 0):
                await _call("switch", "turn_on", {"entity_id": sleep_dev["power_entity"]})
            elif gear_a == 0 and gear_b == 0 and not turn_on:
                await _call("switch", "turn_off", {"entity_id": sleep_dev["power_entity"]})
        if sleep_dev.get("gears_entity"):
            await _call(
                "text",
                "set_value",
                {"entity_id": sleep_dev["gears_entity"], "value": format_ab_gears(gear_a, gear_b)},
            )
        elif sleep_dev.get("heat_level_entity"):
            await _call(
                "select",
                "select_option",
                {"entity_id": sleep_dev["heat_level_entity"], "option": gear_to_heat_level_option(max(gear_a, gear_b))},
            )

    if action == "pre_warm":
        if coordinator:
            coordinator.set_tonight_sleep_override(area_id, "pre_warm")
        if sleep_dev and (not status or status.get("remote_enabled", True)):
            ga = int(sleep_dev.get("prewarm_gear_a", 4))
            gb = int(sleep_dev.get("prewarm_gear_b", 4))
            await _apply_gears(ga, gb, turn_on=True)
            cd = int(msg.get("countdown_min", 60))
            for cd_key in ("zone_a_countdown_entity", "zone_b_countdown_entity"):
                if sleep_dev.get(cd_key):
                    await _call("number", "set_value", {"entity_id": sleep_dev[cd_key], "value": cd})
    elif action == "sleep_now":
        if coordinator:
            coordinator.set_tonight_sleep_override(area_id, "sleep")
        if sleep_dev and (not status or status.get("remote_enabled", True)):
            ga = int(sleep_dev.get("sleep_gear_a", 2))
            gb = int(sleep_dev.get("sleep_gear_b", 2))
            await _apply_gears(ga, gb, turn_on=True)
            if sleep_dev.get("sleep_switch_entity"):
                await _call("switch", "turn_on", {"entity_id": sleep_dev["sleep_switch_entity"]})
    elif action == "skip_tonight":
        if coordinator:
            coordinator.set_tonight_sleep_override(area_id, "skip")
        if sleep_dev and status and status.get("remote_enabled", True):
            if sleep_dev.get("sleep_switch_entity") and status.get("sleep_switch_on"):
                await _call("switch", "turn_off", {"entity_id": sleep_dev["sleep_switch_entity"]})
            if sleep_dev.get("power_entity") and status.get("power_on"):
                await _call("switch", "turn_off", {"entity_id": sleep_dev["power_entity"]})
    elif action == "clear":
        if coordinator:
            coordinator.clear_tonight_sleep_override(area_id)
    elif action == "set_gears":
        if sleep_dev:
            cur_a = status["gear_a"] if status and status.get("gear_a") is not None else 0
            cur_b = status["gear_b"] if status and status.get("gear_b") is not None else 0
            ga = int(msg["gear_a"]) if "gear_a" in msg else cur_a
            gb = int(msg["gear_b"]) if "gear_b" in msg else cur_b
            await _apply_gears(ga, gb, turn_on=(ga > 0 or gb > 0))
            if "countdown_min" in msg:
                cd = int(msg["countdown_min"])
                for cd_key in ("zone_a_countdown_entity", "zone_b_countdown_entity"):
                    if sleep_dev.get(cd_key):
                        await _call("number", "set_value", {"entity_id": sleep_dev[cd_key], "value": cd})
    elif action == "toggle_power":
        if sleep_dev and sleep_dev.get("power_entity"):
            is_on = bool(status and status.get("power_on"))
            await _call(
                "switch",
                "turn_off" if is_on else "turn_on",
                {"entity_id": sleep_dev["power_entity"]},
            )
    elif action == "toggle_sleep_switch":
        if sleep_dev and sleep_dev.get("sleep_switch_entity"):
            is_on = bool(status and status.get("sleep_switch_on"))
            await _call(
                "switch",
                "turn_off" if is_on else "turn_on",
                {"entity_id": sleep_dev["sleep_switch_entity"]},
            )
    elif action == "sync_curve":
        if sleep_dev:
            qh = room.get("quiet_hours") or {"start": "23:00", "end": "07:00"}
            start_str = str(qh.get("start") or "23:00")
            end_str = str(qh.get("end") or "07:00")
            for key, en_key in (
                ("zone_a_sleep_entity", "zone_a_enabled"),
                ("zone_b_sleep_entity", "zone_b_enabled"),
            ):
                eid = sleep_dev.get(key)
                if not eid:
                    continue
                st = hass.states.get(eid)
                raw = str(st.state) if st else None
                en_val = msg[en_key] if en_key in msg else None
                next_curve = update_qushui_sleep_curve(raw, enabled=en_val, start=start_str, end=end_str)
                await _call("text", "set_value", {"entity_id": eid, "value": next_curve})

    if coordinator:
        await coordinator.async_request_refresh()

    connection.send_result(msg["id"], {"ok": True})


@callback
def async_register_websocket_commands(hass: HomeAssistant) -> None:
    """Register all RoomMind WebSocket commands."""
    websocket_api.async_register_command(hass, websocket_list_rooms)
    websocket_api.async_register_command(hass, websocket_save_room)
    websocket_api.async_register_command(hass, websocket_delete_room)
    websocket_api.async_register_command(hass, websocket_override_set)
    websocket_api.async_register_command(hass, websocket_override_clear)
    websocket_api.async_register_command(hass, websocket_fan_set)
    websocket_api.async_register_command(hass, websocket_get_settings)
    websocket_api.async_register_command(hass, websocket_save_settings)
    websocket_api.async_register_command(hass, websocket_get_analytics)
    websocket_api.async_register_command(hass, websocket_thermal_reset)
    websocket_api.async_register_command(hass, websocket_thermal_reset_all)
    websocket_api.async_register_command(hass, websocket_boost_learning)
    websocket_api.async_register_command(hass, websocket_get_diagnostics)
    websocket_api.async_register_command(hass, websocket_area_suggest)
    websocket_api.async_register_command(hass, websocket_get_schedule_blocks)
    websocket_api.async_register_command(hass, websocket_sleep_action)
