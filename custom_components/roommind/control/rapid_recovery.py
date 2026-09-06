"""Pure policy for rapid room-temperature recovery."""

from __future__ import annotations

from typing import Any

from ..const import (
    CLIMATE_MODE_COOL_ONLY,
    CLIMATE_MODE_HEAT_ONLY,
    DEFAULT_OUTDOOR_COOLING_MIN,
    DEFAULT_OUTDOOR_HEATING_MAX,
    MODE_COOLING,
    MODE_HEATING,
    TargetTemps,
)


def resolve_rapid_recovery_mode(
    room: dict[str, Any],
    settings: dict[str, Any],
    *,
    current_temp: float | None,
    targets: TargetTemps,
    night_active: bool,
    outdoor_temp: float | None,
) -> str | None:
    """Return fast pull-down or warm-up mode when policy permits it."""
    if current_temp is None or not room.get("rapid_recovery_enabled", True):
        return None
    if night_active and not room.get("night_allow_rapid_recovery", True):
        return None

    delta = max(0.5, float(room.get("rapid_recovery_delta_c") or 2.0))
    climate_mode = room.get("climate_mode", "auto")
    can_cool = climate_mode != CLIMATE_MODE_HEAT_ONLY and targets.cool is not None
    can_heat = climate_mode != CLIMATE_MODE_COOL_ONLY and targets.heat is not None

    if outdoor_temp is not None:
        outdoor_cooling_min = float(settings.get("outdoor_cooling_min", DEFAULT_OUTDOOR_COOLING_MIN))
        outdoor_heating_max = float(settings.get("outdoor_heating_max", DEFAULT_OUTDOOR_HEATING_MAX))
        if outdoor_temp < outdoor_cooling_min:
            can_cool = False
        if outdoor_temp > outdoor_heating_max:
            can_heat = False

    if can_cool and targets.cool is not None and current_temp - targets.cool >= delta:
        return MODE_COOLING
    if can_heat and targets.heat is not None and targets.heat - current_temp >= delta:
        return MODE_HEATING
    return None
