"""Helpers for translated Home Assistant entity names."""

from __future__ import annotations

from typing import Any

from homeassistant.helpers import area_registry as ar


def room_translation_placeholders(coordinator: Any, area_id: str) -> dict[str, str]:
    """Return translation placeholders for room-scoped entities."""
    room_name = area_id
    try:
        area = ar.async_get(coordinator.hass).async_get_area(area_id)
    except Exception:  # noqa: BLE001
        area = None
    if area is not None and area.name:
        room_name = area.name
    return {"room": room_name}
