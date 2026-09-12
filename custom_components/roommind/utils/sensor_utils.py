"""Sensor reading utilities for RoomMind."""

from __future__ import annotations

import logging
import math
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from ..const import MAX_SENSOR_STALENESS

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)


def sensor_observation_timestamp(state: Any, *, attribute: str | None = None) -> tuple[datetime | None, str]:
    """Prefer field provenance; an invalid explicit timestamp must stay unknown."""
    attrs = getattr(state, "attributes", {})
    if isinstance(attrs, Mapping):
        for key in ([f"{attribute}_observed_at"] if attribute else []) + ["observed_at"]:
            if key not in attrs:
                continue
            value = attrs[key]
            try:
                timestamp = value if isinstance(value, datetime) else datetime.fromisoformat(value)
            except TypeError, ValueError:
                return None, key
            return (timestamp if timestamp.tzinfo is not None else None), key
    for key in ("last_reported", "last_updated", "last_changed"):
        ha_timestamp = getattr(state, key, None)
        if isinstance(ha_timestamp, datetime):
            return (ha_timestamp if ha_timestamp.tzinfo is not None else None), key
    return None, "none"


def sensor_observation_age(state: Any, *, now: datetime, attribute: str | None = None) -> float | None:
    """Return usable observation age without renewing it on an entity update."""
    timestamp, source = sensor_observation_timestamp(state, attribute=attribute)
    if timestamp is None:
        return 0.0 if source == "none" else None
    age_s = (now - timestamp).total_seconds()
    return age_s if 0.0 <= age_s < MAX_SENSOR_STALENESS else None


def _read_climate_attribute(state: Any, value_name: str) -> float | None:
    """Extract a numeric value from a climate entity's attributes.

    Climate entities use ``state.state`` for the HVAC mode (heat/cool/off),
    not for sensor readings.  Temperature and humidity live in attributes.
    """
    if "temperature" in value_name:
        raw = state.attributes.get("current_temperature")
    elif "humidity" in value_name:
        raw = state.attributes.get("current_humidity")
    else:
        return None
    if raw is None:
        return None
    try:
        value = float(raw)
        return value if math.isfinite(value) else None
    except ValueError, TypeError:
        return None


def read_sensor_value(
    hass: HomeAssistant,
    entity_id: str | None,
    area_id: str,
    value_name: str,
    *,
    now: datetime | None = None,
) -> float | None:
    """Read a numeric sensor value, returning None on failure.

    Parameters
    ----------
    hass:
        Home Assistant instance.
    entity_id:
        The sensor entity to read (e.g. ``sensor.living_room_temp``).
        If *None* or empty, returns *None* immediately.
    area_id:
        Used only for log messages.
    value_name:
        Human-readable name of the value (e.g. "temperature", "humidity")
        used in warning messages.
    """
    if not entity_id:
        return None

    state = hass.states.get(entity_id)
    if state is None or state.state in ("unavailable", "unknown"):
        return None

    attribute = None
    if entity_id.startswith("climate."):
        attribute = "current_humidity" if "humidity" in value_name else "current_temperature"
    if sensor_observation_age(state, now=now or datetime.now(UTC), attribute=attribute) is None:
        return None

    # Climate entities store values in attributes, not state
    if entity_id.startswith("climate."):
        return _read_climate_attribute(state, value_name)

    try:
        value = float(state.state)
        return value if math.isfinite(value) else None
    except ValueError, TypeError:
        _LOGGER.warning(
            "Room '%s': cannot parse %s from '%s'",
            area_id,
            value_name,
            state.state,
        )
        return None
