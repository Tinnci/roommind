"""WebSocket API for RoomMind room CRUD operations."""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import (
    DEFAULT_COMFORT_COOL,
    DEFAULT_COMFORT_HEAT,
    DEFAULT_ECO_COOL,
    DEFAULT_ECO_HEAT,
    DOMAIN,
    OVERRIDE_TYPES,
    build_override_live,
    is_override_suppressed,
)
from .room_config import ROOM_CONFIG_FIELDS, ROOM_CONFIG_SCHEMA
from .services.analytics_service import (
    _compute_target_forecast,  # noqa: F401 - re-exported for tests
    _csv_to_points,  # noqa: F401 - re-exported for tests
    _safe_float,  # noqa: F401 - re-exported for tests
    build_analytics_data,
)
from .settings_config import (
    DEFAULT_CONTROL_MODE,
    SETTINGS_FIELDS,
    SETTINGS_SCHEMA,
    SettingsValidationError,
    validate_settings_changes,
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


def _validate_no_own_entities(config: dict, own_prefix: str) -> str | None:
    """Verify that no RoomMind-owned entity is assigned to a room. Returns an error message or None."""
    for field in (
        "thermostats",
        "acs",
        "temperature_sensors",
        "humidity_sensors",
        "window_sensors",
        "covers",
        "occupancy_sensors",
    ):
        for eid in config.get(field, []):
            if eid.split(".", 1)[-1].startswith(own_prefix):
                return f"Cannot assign RoomMind's own entity '{eid}' to a room"

    for field in ("temperature_sensor", "humidity_sensor"):
        eid = config.get(field, "")
        if eid and eid.split(".", 1)[-1].startswith(own_prefix):
            return f"Cannot assign RoomMind's own entity '{eid}' to a room"

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
                if eid and eid.split(".", 1)[-1].startswith(own_prefix):
                    return f"Cannot assign RoomMind's own entity '{eid}' to a room"

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

        room_data["live"] = {
            "current_temp": live.get("current_temp"),
            "current_humidity": live.get("current_humidity"),
            "target_temp": live.get("target_temp"),
            "heat_target": live.get("heat_target"),
            "cool_target": live.get("cool_target"),
            "mode": live.get("mode", "idle"),
            "heating_power": live.get("heating_power", 0),
            "device_setpoint": live.get("device_setpoint"),
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
            "rapid_recovery_active": live.get("rapid_recovery_active", False),
            "effective_control_target": live.get("effective_control_target"),
            "coupling_status": live.get("coupling_status", []),
            "learning_paused_reason": learning_paused_reason,
        }
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
    err = _validate_no_own_entities(config, own_prefix)
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
    if override_type == "boost":
        climate_mode = room.get("climate_mode", "auto")
        if climate_mode == "cool_only":
            override_temp = room.get("comfort_cool", DEFAULT_COMFORT_COOL)
        else:
            override_temp = room.get("comfort_heat", room.get("comfort_temp", DEFAULT_COMFORT_HEAT))
    elif override_type == "eco":
        climate_mode = room.get("climate_mode", "auto")
        if climate_mode == "cool_only":
            override_temp = room.get("eco_cool", DEFAULT_ECO_COOL)
        else:
            override_temp = room.get("eco_heat", room.get("eco_temp", DEFAULT_ECO_HEAT))
    else:  # custom
        override_temp = msg.get("temperature")
        if override_temp is None:
            connection.send_error(msg["id"], "invalid", "Custom override requires temperature")
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


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


@callback
def async_register_websocket_commands(hass: HomeAssistant) -> None:
    """Register all RoomMind WebSocket commands."""
    websocket_api.async_register_command(hass, websocket_list_rooms)
    websocket_api.async_register_command(hass, websocket_save_room)
    websocket_api.async_register_command(hass, websocket_delete_room)
    websocket_api.async_register_command(hass, websocket_override_set)
    websocket_api.async_register_command(hass, websocket_override_clear)
    websocket_api.async_register_command(hass, websocket_get_settings)
    websocket_api.async_register_command(hass, websocket_save_settings)
    websocket_api.async_register_command(hass, websocket_get_analytics)
    websocket_api.async_register_command(hass, websocket_thermal_reset)
    websocket_api.async_register_command(hass, websocket_thermal_reset_all)
    websocket_api.async_register_command(hass, websocket_boost_learning)
    websocket_api.async_register_command(hass, websocket_get_diagnostics)
