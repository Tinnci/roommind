"""Home Assistant DeviceInfo helpers for RoomMind hub and per-room devices."""

from __future__ import annotations

from typing import Any

from homeassistant.helpers.device_registry import DeviceInfo

from ..const import DOMAIN, VERSION
from .entity_translation import room_translation_placeholders


def room_device_info(coordinator: Any, area_id: str) -> DeviceInfo:
    """Return DeviceInfo grouping all RoomMind entities belonging to a room."""
    room_name = room_translation_placeholders(coordinator, area_id)["room"]
    return DeviceInfo(
        identifiers={(DOMAIN, area_id)},
        name=f"RoomMind {room_name}",
        manufacturer="RoomMind",
        model="Room Climate Controller",
        sw_version=VERSION,
        suggested_area=room_name,
    )


def hub_device_info() -> DeviceInfo:
    """Return DeviceInfo for whole-home RoomMind coordination entities."""
    return DeviceInfo(
        identifiers={(DOMAIN, "hub")},
        name="RoomMind Hub",
        manufacturer="RoomMind",
        model="Whole-Home Climate Coordinator",
        sw_version=VERSION,
    )
