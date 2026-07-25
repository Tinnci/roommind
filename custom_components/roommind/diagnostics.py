"""Diagnostics support for RoomMind."""

from __future__ import annotations

import time
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
    live_states = coordinator.rooms if coordinator else {}

    # Build per-room diagnostics
    rooms_diag: dict[str, dict] = {}
    for area_id, config in rooms_config.items():
        live = live_states.get(area_id, {})
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

        # Coordinator internal state for this room
        if coordinator:
            live_diag["previous_mode"] = coordinator._previous_modes.get(area_id, "idle")
            on_since = coordinator._mode_on_since.get(area_id)
            if on_since is not None:
                live_diag["mode_active_for_s"] = round(time.time() - on_since)
            cached = coordinator._last_valid_temps.get(area_id)
            if cached is not None:
                live_diag["cached_temp"] = cached[0]
                live_diag["cached_temp_age_s"] = round(time.monotonic() - cached[1])

        # Residual heat state
        if coordinator:
            live_diag["q_residual"] = round(
                coordinator._residual_tracker.get_q_residual(
                    area_id,
                    config.get("heating_system_type", ""),
                    coordinator._previous_modes.get(area_id, "idle"),
                ),
                4,
            )

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
        if coordinator:
            mgr = coordinator._model_manager
            model = mgr.diagnostics_snapshot(area_id)
            if model is not None:
                room_diag["model"] = model

        # Window manager state
        if coordinator:
            room_diag["window"] = coordinator._window_manager.diagnostics_snapshot(area_id)

        # Cover manager state
        if coordinator:
            cover = coordinator._cover_manager.diagnostics_snapshot(area_id)
            if cover:
                room_diag["cover"] = cover

        # Heat source orchestration state
        if coordinator and area_id in coordinator._heat_source_states:
            room_diag["heat_source_routing"] = coordinator._heat_source_states[area_id]

        rooms_diag[area_id] = room_diag

    # Outdoor conditions
    outdoor: dict[str, Any] = {
        "temp": coordinator.outdoor_temp if coordinator else None,
        "humidity": coordinator.outdoor_humidity if coordinator else None,
    }
    if coordinator:
        forecast = coordinator._weather_manager.forecast
        outdoor["forecast_available"] = bool(forecast)
        outdoor["forecast_points"] = len(forecast) if forecast else 0

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
    compressor: dict[str, Any] = {}
    if coordinator:
        compressor = coordinator._compressor_manager.diagnostics_snapshot()

    # Valve protection state
    valve: dict[str, Any] = {}
    if coordinator:
        valve = coordinator._valve_manager.diagnostics_snapshot()

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
