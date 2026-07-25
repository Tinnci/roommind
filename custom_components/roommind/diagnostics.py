"""Diagnostics support for RoomMind."""

from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, VERSION
from .control.mpc_controller import _last_commands


def _build_device_states(hass: HomeAssistant, devices: list[dict]) -> list[dict[str, Any]]:
    """Build HA entity state snapshot for each device."""
    result = []
    for dev in devices:
        eid = dev.get("entity_id", "")
        state = hass.states.get(eid)
        entry: dict[str, Any] = {
            "entity_id": eid,
            "type": dev.get("type", ""),
            "role": dev.get("role", ""),
            "idle_action": dev.get("idle_action", "off"),
            "idle_fan_mode": dev.get("idle_fan_mode", ""),
        }
        if state:
            attrs = state.attributes
            entry["ha_state"] = state.state
            entry["hvac_mode"] = attrs.get("hvac_mode")
            entry["hvac_modes"] = attrs.get("hvac_modes", [])
            entry["current_temperature"] = attrs.get("current_temperature")
            entry["temperature"] = attrs.get("temperature")
            entry["min_temp"] = attrs.get("min_temp")
            entry["max_temp"] = attrs.get("max_temp")
            entry["target_temp_low"] = attrs.get("target_temp_low")
            entry["target_temp_high"] = attrs.get("target_temp_high")
            entry["fan_mode"] = attrs.get("fan_mode")
            entry["fan_modes"] = attrs.get("fan_modes", [])
        else:
            entry["ha_state"] = "not_found"
        last_cmd = _last_commands.get(eid)
        if last_cmd:
            entry["last_command"] = dict(last_cmd)
        result.append(entry)
    return result


async def async_get_config_entry_diagnostics(hass: HomeAssistant, config_entry: ConfigEntry) -> dict[str, Any]:
    """Return diagnostics for a config entry."""
    data = hass.data.get(DOMAIN, {})
    store = data.get("store")
    coordinator = data.get("coordinator")

    if not store:
        return {"error": "Integration not loaded"}

    settings = store.get_settings()
    rooms_config = store.get_rooms()
    runtime = coordinator.diagnostics_runtime_snapshot(rooms_config) if coordinator else None

    # Build per-room diagnostics
    rooms_diag: dict[str, dict] = {}
    for area_id, config in rooms_config.items():
        room_runtime = runtime.rooms[area_id] if runtime else None
        live = room_runtime.live if room_runtime else {}
        # Expose all room state fields with sensible defaults
        live_diag: dict[str, Any] = {
            "current_temp": None,
            "current_humidity": None,
            "target_temp": None,
            "heat_target": None,
            "cool_target": None,
            "mode": "idle",
            "heating_power": 0,
            "device_setpoint": None,
            "window_open": False,
            "override_active": False,
            "mpc_active": False,
            "confidence": None,
            "presence_away": False,
            "force_off": False,
            "n_observations": 0,
        }
        live_diag.update({k: v for k, v in live.items() if k not in ("area_id", "current_temp_raw")})
        live_diag["ignore_presence"] = config.get("ignore_presence", False)

        # Sensor entity availability
        temp_sensor_id = config.get("temperature_sensor", "")
        if temp_sensor_id:
            ts = hass.states.get(temp_sensor_id)
            live_diag["sensor_state"] = ts.state if ts else "not_found"
        else:
            live_diag["sensor_state"] = "no_sensor"

        if room_runtime:
            live_diag["previous_mode"] = room_runtime.previous_mode
            if room_runtime.mode_active_for_s is not None:
                live_diag["mode_active_for_s"] = room_runtime.mode_active_for_s
            if room_runtime.cached_temp is not None:
                live_diag["cached_temp"] = room_runtime.cached_temp
                live_diag["cached_temp_age_s"] = room_runtime.cached_temp_age_s
            live_diag["q_residual"] = room_runtime.q_residual

        # Schedule entity state
        schedules = config.get("schedules", [])
        if schedules:
            active_idx = live.get("active_schedule_index", -1)
            if 0 <= active_idx < len(schedules):
                sched_eid = schedules[active_idx].get("entity_id", "")
                if sched_eid:
                    ss = hass.states.get(sched_eid)
                    live_diag["schedule_entity"] = sched_eid
                    live_diag["schedule_state"] = ss.state if ss else "not_found"

        room_diag: dict[str, Any] = {
            "config": dict(config),
            "live": live_diag,
        }

        # Device entity states
        devices = config.get("devices", [])
        if devices:
            room_diag["device_states"] = _build_device_states(hass, devices)

        # Model info from EKF estimator
        if room_runtime and room_runtime.model is not None:
            room_diag["model"] = room_runtime.model

        # Window manager state
        if room_runtime:
            room_diag["window"] = room_runtime.window

        # Cover manager state
        if room_runtime and room_runtime.cover:
            room_diag["cover"] = room_runtime.cover

        # Heat source orchestration state
        if room_runtime and room_runtime.heat_source_routing is not None:
            room_diag["heat_source_routing"] = room_runtime.heat_source_routing

        rooms_diag[area_id] = room_diag

    # Outdoor conditions
    outdoor: dict[str, Any] = {
        "temp": runtime.outdoor_temp if runtime else None,
        "humidity": runtime.outdoor_humidity if runtime else None,
    }
    if runtime:
        outdoor["forecast_available"] = runtime.forecast_available
        outdoor["forecast_points"] = runtime.forecast_points

    # Recent history (last 2 hours of detail data per room)
    recent_history: dict[str, list] = {}
    if coordinator and coordinator.history_store:
        for area_id in rooms_config:
            try:
                rows = await hass.async_add_executor_job(coordinator.history_store.read_detail, area_id, 7200)
                recent_history[area_id] = [
                    {
                        "ts": row.get("timestamp", ""),
                        "room_temp": row.get("room_temp", ""),
                        "outdoor_temp": row.get("outdoor_temp", ""),
                        "target_temp": row.get("target_temp", ""),
                        "mode": row.get("mode", ""),
                        "predicted_temp": row.get("predicted_temp", ""),
                    }
                    for row in rows[-240:]  # Cap at ~240 points
                ]
            except Exception:  # noqa: BLE001
                recent_history[area_id] = []

    # Compressor group state
    compressor: dict[str, Any] = runtime.compressor_groups if runtime else {}

    # Valve protection state
    valve: dict[str, Any] = runtime.valve_protection if runtime else {}

    return {
        "integration": {
            "version": VERSION,
            "domain": DOMAIN,
            "ha_temp_unit": hass.config.units.temperature_unit,
        },
        "settings": dict(settings),
        "rooms": rooms_diag,
        "outdoor": outdoor,
        "recent_history": recent_history,
        "compressor_groups": compressor,
        "valve_protection": valve,
        "presence": {
            "enabled": settings.get("presence_enabled", False),
            "persons": settings.get("presence_persons", []),
            "person_states": {
                pid: (s.state if (s := hass.states.get(pid)) else "unavailable")
                for pid in settings.get("presence_persons", [])
            },
        },
    }
