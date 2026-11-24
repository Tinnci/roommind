"""Presence detection utilities for RoomMind."""

from __future__ import annotations

from typing import TYPE_CHECKING

from homeassistant.core import State

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant


def is_presence_away(hass: HomeAssistant, room: dict, settings: dict) -> bool:
    """Return True if presence detection says all relevant persons are away.

    Per-room persons take precedence over global persons. When neither list
    is configured, falls back to Home Assistant's native ``zone.home`` person
    count (0 = away). Fail-safe: unavailable/unknown entities count as "home".
    """
    if not settings.get("presence_enabled", False):
        return False
    global_persons = settings.get("presence_persons", [])
    room_persons = room.get("presence_persons", [])
    persons = room_persons if room_persons else global_persons

    if not persons:
        zone_home = hass.states.get("zone.home")
        if zone_home is not None and isinstance(zone_home.state, str):
            raw_count = zone_home.state.strip()
            if raw_count.isdigit():
                return int(raw_count) == 0
        return False

    for pid in persons:
        state = hass.states.get(pid)
        if state is None or state.state in ("unavailable", "unknown"):
            return False  # fail-safe: treat as home
        if _is_entity_home(state):
            return False
    return True


def _is_entity_home(state: State) -> bool:
    """Check if a presence entity indicates someone is home.

    person.*/device_tracker.* use "home"/"not_home"; binary_sensor/input_boolean use "on"/"off".
    """
    if state.entity_id.startswith(("person.", "device_tracker.")):
        return bool(state.state == "home")
    return bool(state.state == "on")
