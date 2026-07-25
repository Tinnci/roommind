"""Analytics data assembly service for RoomMind."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, cast

from homeassistant.core import HomeAssistant

from ..const import (
    CLIMATE_MODE_COOL_ONLY,
    CLIMATE_MODE_HEAT_ONLY,
)
from ..control.mpc_controller import (
    DEFAULT_OUTDOOR_TEMP_FALLBACK,
    check_acs_can_heat,
    get_can_heat_cool,
    is_mpc_active,
)

_LOGGER = logging.getLogger(__name__)

_RANGE_MAX_AGE: dict[str, int] = {
    "12h": 43200,
    "24h": 86400,
    "2d": 172800,
    "7d": 604800,
    "14d": 1209600,
    "30d": 2592000,
    "90d": 7776000,
}


def _safe_float(value: str) -> float | None:
    """Convert CSV string to float, or None for empty/invalid values."""
    if not value:
        return None
    try:
        return float(value)
    except ValueError, TypeError:
        return None


def _safe_int(value: str) -> int | None:
    """Convert CSV string to int, or None for empty/invalid values."""
    if not value:
        return None
    try:
        return int(float(value))
    except ValueError, TypeError:
        return None


def _safe_bool(value: Any) -> bool:
    """Convert CSV string/bool values to bool."""
    if value is True:
        return True
    if value is False or value in ("", None):
        return False
    return str(value).lower() in ("1", "true", "yes", "on")


def _csv_to_points(rows: list[dict]) -> list[dict]:
    """Convert CSV rows (string values, 'timestamp' key) to typed points ('ts' key)."""
    result = []
    for row in rows:
        ts = _safe_float(row.get("timestamp", ""))
        if ts is None:
            continue
        result.append(
            {
                "ts": ts,
                "room_temp": _safe_float(row.get("room_temp", "")),
                "outdoor_temp": _safe_float(row.get("outdoor_temp", "")),
                "target_temp": _safe_float(row.get("target_temp", "")),
                "mode": row.get("mode", ""),
                "predicted_temp": _safe_float(row.get("predicted_temp", "")),
                "window_open": _safe_bool(row.get("window_open", "")),
                "heating_power": _safe_float(row.get("heating_power", "")),
                "solar_irradiance": _safe_float(row.get("solar_irradiance", "")),
                "blind_position": _safe_int(row.get("blind_position", "")),
                "cover_reason": row.get("cover_reason", ""),
                "device_setpoint": _safe_float(row.get("device_setpoint", "")),
                "occupancy": _safe_bool(row.get("occupancy", "")),
                "room_humidity": _safe_float(row.get("room_humidity", "")),
                "outdoor_humidity": _safe_float(row.get("outdoor_humidity", "")),
                "perceived_temp": _safe_float(row.get("perceived_temp", "")),
                "q_fan_mix": _safe_float(row.get("q_fan_mix", "")),
                "q_vent": _safe_float(row.get("q_vent", "")),
                "airflow_ach": _safe_float(row.get("airflow_ach", "")),
                "airflow_plan_level": _safe_float(row.get("airflow_plan_level", "")),
                "airflow_mix_plan_level": _safe_float(row.get("airflow_mix_plan_level", "")),
                "airflow_vent_plan_level": _safe_float(row.get("airflow_vent_plan_level", "")),
                "night_mode_active": _safe_bool(row.get("night_mode_active", "")),
                "rapid_recovery_active": _safe_bool(row.get("rapid_recovery_active", "")),
                "hvac_stage": row.get("hvac_stage", ""),
                "sensor_conflict": _safe_float(row.get("sensor_conflict", "")),
                "mold_surface_rh": _safe_float(row.get("mold_surface_rh", "")),
                "mold_risk_level": row.get("mold_risk_level", ""),
                "effective_control_target": row.get("effective_control_target", ""),
                "heat_target": _safe_float(row.get("heat_target", "")),
                "cool_target": _safe_float(row.get("cool_target", "")),
                "override_active": _safe_bool(row.get("override_active", "")),
                "override_type": row.get("override_type", ""),
                "active_heat_sources": row.get("active_heat_sources", ""),
                "temperature_source": row.get("temperature_source", ""),
                "temperature_source_count": _safe_int(row.get("temperature_source_count", "")),
                "temperature_primary_available": _safe_bool(row.get("temperature_primary_available", "")),
                "humidity_sources": row.get("humidity_sources", ""),
                "humidity_source_count": _safe_int(row.get("humidity_source_count", "")),
                "humidity_primary_available": _safe_bool(row.get("humidity_primary_available", "")),
            }
        )
    return result


async def _compute_target_forecast(
    hass: HomeAssistant,
    room: dict,
    settings: dict,
    mold_prevention_delta: float = 0.0,
    hours: float = 3.0,
    interval_minutes: int = 5,
    schedule_blocks_cache: dict[str, dict] | None = None,
) -> list[dict]:
    """Compute target temperature forecast for the next N hours.

    Each point contains ``target_temp`` (chart display, mode-aware),
    ``heat_target`` and ``cool_target`` (for MPC simulator).
    """
    from ..utils.presence_utils import is_presence_away
    from ..utils.schedule_utils import (
        get_active_schedule_entity,
        make_target_resolver,
        read_schedule_blocks,
    )

    climate_mode = room.get("climate_mode", "auto")

    presence_away = not room.get("ignore_presence", False) and is_presence_away(hass, room, settings)

    entity_id = get_active_schedule_entity(hass, room)
    schedule_blocks = await read_schedule_blocks(hass, entity_id, cache=schedule_blocks_cache) if entity_id else None

    target_resolver = make_target_resolver(
        schedule_blocks,
        room,
        settings,
        hass=hass,
        presence_away=presence_away,
        mold_prevention_delta=mold_prevention_delta,
    )

    # Generate forecast points
    now = time.time()
    end_ts = now + hours * 3600
    result: list[dict] = []
    ts = now
    while ts <= end_ts:
        targets = target_resolver(ts)
        heat_target = round(targets.heat, 1) if targets.heat is not None else None
        cool_target = targets.cool

        # Chart display: mode-aware single value
        if climate_mode == CLIMATE_MODE_COOL_ONLY:
            target = cool_target
        elif climate_mode == CLIMATE_MODE_HEAT_ONLY:
            target = heat_target
        else:
            # Auto mode: show heat target (primary for chart line)
            target = heat_target

        result.append(
            {
                "ts": round(ts, 1),
                "target_temp": target,
                "heat_target": heat_target,
                "cool_target": cool_target,
            }
        )
        ts += interval_minutes * 60
    return result


async def build_analytics_data(
    hass: HomeAssistant,
    area_id: str,
    range_key: str,
    store: Any,
    coordinator: Any,
    custom_start: float | None = None,
    custom_end: float | None = None,
) -> dict:
    """Build analytics response data for a room.

    This is the core data assembly extracted from websocket_get_analytics.
    """
    settings = store.get_settings()
    room_config = store.get_room(area_id) or {}
    history_store = coordinator.history_store if coordinator else None

    # Read history data -- custom timestamps take precedence over range preset
    detail: list = []
    history: list = []
    if history_store:
        if custom_start is not None:
            detail_rows, history_rows = await asyncio.gather(
                hass.async_add_executor_job(history_store.read_detail, area_id, None, custom_start, custom_end),
                hass.async_add_executor_job(history_store.read_history, area_id, None, custom_start, custom_end),
            )
            detail = _csv_to_points(detail_rows)
            history = _csv_to_points(history_rows)
        else:
            max_age = _RANGE_MAX_AGE.get(range_key, _RANGE_MAX_AGE["12h"])
            detail_rows, history_rows = await asyncio.gather(
                hass.async_add_executor_job(history_store.read_detail, area_id, max_age),
                hass.async_add_executor_job(history_store.read_history, area_id, max_age),
            )
            detail = _csv_to_points(detail_rows)
            history = _csv_to_points(history_rows)

    # Model info (only if estimator exists -- avoid auto-creating for unknown rooms)
    model_info: dict = {}
    mpc_active = False
    acs_can_heat: bool | None = None
    if coordinator:
        mgr = coordinator._model_manager
        model_info = mgr.analytics_snapshot(area_id) or {}
        if model_info:
            has_ext_sensor = bool(room_config.get("temperature_sensor"))
            if has_ext_sensor:
                acs_can_heat = check_acs_can_heat(hass, room_config)
                can_heat, can_cool = get_can_heat_cool(
                    room_config,
                    coordinator.outdoor_temp_effective,
                    acs_can_heat=acs_can_heat,
                )
                T_out = (
                    coordinator.outdoor_temp_effective
                    if coordinator.outdoor_temp_effective is not None
                    else DEFAULT_OUTDOOR_TEMP_FALLBACK
                )
                mpc_active = is_mpc_active(mgr, area_id, can_heat, can_cool, 20.0, T_out)
            else:
                mpc_active = False
            has_occupancy_sensors = len(room_config.get("occupancy_sensors", [])) > 0
            model_info["mpc_active"] = mpc_active
            model_info["has_occupancy_sensors"] = has_occupancy_sensors

    # Build merged forecast: same format as history points, on a shared 5-min grid
    mold_delta = 0.0
    if coordinator:
        live = coordinator.rooms.get(area_id, {})
        mold_delta = live.get("mold_prevention_delta", 0.0)
    try:
        target_forecast = await _compute_target_forecast(
            hass,
            room_config,
            settings,
            mold_prevention_delta=mold_delta,
            schedule_blocks_cache=getattr(coordinator, "_schedule_blocks_cache", None),
        )
    except Exception:  # noqa: BLE001
        _LOGGER.debug("Target forecast computation failed for '%s'", area_id)
        target_forecast = []

    # Forward-simulate temperature prediction for the forecast period.
    from ..control.analytics_simulator import (
        build_forecast_outdoor_series,
        build_forecast_solar_series,
        simulate_prediction,
    )

    pred_temps: list[float | None] = list()
    prediction_enabled = settings.get("prediction_enabled", True)
    if prediction_enabled and target_forecast and coordinator:
        mgr = coordinator._model_manager
        simulation_context = mgr.simulation_context(area_id)
        if simulation_context is not None:
            all_points = detail if detail else history
            current_t: float | None = None
            for p in reversed(all_points):
                if p.get("room_temp") is not None:
                    current_t = p["room_temp"]
                    break
            if current_t is not None:
                T_out_now = (
                    coordinator.outdoor_temp_effective
                    if coordinator.outdoor_temp_effective is not None
                    else DEFAULT_OUTDOOR_TEMP_FALLBACK
                )
                outdoor_series = build_forecast_outdoor_series(
                    coordinator._weather_manager.forecast,
                    T_out_now,
                    len(target_forecast),
                )
                # Shading factor from current cover positions
                live = coordinator.rooms.get(area_id, {})
                _shading = 1.0
                if live.get("blind_position") is not None:
                    from ..managers.cover_manager import compute_shading_factor

                    _shading = compute_shading_factor([live["blind_position"]])
                solar_series = build_forecast_solar_series(
                    hass.config.latitude,
                    hass.config.longitude,
                    coordinator._weather_manager.forecast,
                    len(target_forecast),
                    shading_factor=_shading,
                )
                # Residual heat state for analytics simulation
                system_type = room_config.get("heating_system_type", "")
                residual = coordinator._residual_tracker.simulation_snapshot(area_id, system_type)

                sim_q_occupancy = 0.0
                for occ_eid in room_config.get("occupancy_sensors", []):
                    occ_state = hass.states.get(occ_eid)
                    if occ_state and occ_state.state == "on":
                        sim_q_occupancy = 1.0
                        break

                if acs_can_heat is None:
                    acs_can_heat = check_acs_can_heat(hass, room_config)
                pred_temps = cast(
                    list[float | None],
                    simulate_prediction(
                        model=simulation_context.model,
                        estimator=simulation_context.estimator,
                        target_forecast=target_forecast,
                        outdoor_series=outdoor_series,
                        current_temp=current_t,
                        window_open=coordinator._window_manager.is_paused(area_id),
                        mpc_active=mpc_active,
                        room_config=room_config,
                        settings=settings,
                        all_points=all_points,
                        solar_series=solar_series,
                        acs_can_heat=acs_can_heat,
                        q_residual=residual.q_residual,
                        heating_system_type=system_type,
                        heating_duration_minutes=residual.heating_duration_minutes,
                        last_power_fraction=residual.last_power_fraction,
                        q_occupancy=sim_q_occupancy,
                    ),
                )

    # Merge into unified forecast points on shared 5-min grid
    forecast: list[dict] = []
    grid = 300  # 5 minutes
    for i, tf in enumerate(target_forecast):
        snapped = round(tf["ts"] / grid) * grid
        forecast.append(
            {
                "ts": snapped,
                "room_temp": None,
                "outdoor_temp": None,
                "target_temp": tf["target_temp"],
                "mode": "forecast",
                "predicted_temp": pred_temps[i] if i < len(pred_temps) else None,
                "window_open": False,
                "heating_power": None,
                "solar_irradiance": None,
                "blind_position": None,
                "cover_reason": "",
                "device_setpoint": None,
                "occupancy": False,
                "room_humidity": None,
                "outdoor_humidity": None,
                "perceived_temp": None,
                "q_fan_mix": None,
                "q_vent": None,
                "airflow_ach": None,
                "airflow_plan_level": None,
                "airflow_mix_plan_level": None,
                "airflow_vent_plan_level": None,
                "night_mode_active": False,
                "rapid_recovery_active": False,
                "hvac_stage": "",
                "sensor_conflict": None,
                "mold_surface_rh": None,
                "mold_risk_level": "",
                "effective_control_target": "",
                "heat_target": tf.get("heat_target"),
                "cool_target": tf.get("cool_target"),
                "override_active": False,
                "override_type": "",
                "active_heat_sources": "",
                "temperature_source": "",
                "temperature_source_count": None,
                "temperature_primary_available": False,
                "humidity_sources": "",
                "humidity_source_count": None,
                "humidity_primary_available": False,
            }
        )

    return {
        "detail": detail,
        "history": history,
        "model": model_info,
        "forecast": forecast,
    }
