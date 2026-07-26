"""Room persistence layer for RoomMind."""

from __future__ import annotations

import copy
import logging

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN
from .room_config import (
    migrate_persisted_room,
    normalize_room_config,
    normalize_room_sensor_sources,
    upsert_room_config,
)

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY = DOMAIN


_ORPHAN_SETTINGS_KEYS = ("heating_threshold", "cooling_threshold")


class RoomMindStore:
    """Manage room configuration storage for RoomMind."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialise the store."""
        self._store: Store[dict] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: dict[str, dict] = {}
        self._settings: dict = {}
        self._thermal_data: dict = {}

    async def async_load(self) -> None:
        """Load room data from the HA store."""
        stored = await self._store.async_load()
        if stored and "rooms" in stored:
            self._data = stored["rooms"]
        else:
            self._data = {}

        self._settings = stored.get("settings", {}) if stored else {}
        self._thermal_data = stored.get("thermal_data", {}) if stored else {}

        # One-time migrations (combined into single pass + single save)
        device_migrated = 0
        hp_migrated = 0
        airflow_ttl_migrated = 0
        for room in self._data.values():
            migration = migrate_persisted_room(room)
            if migration.device_model_added:
                device_migrated += 1
            if migration.heat_pump_migrated:
                hp_migrated += 1
            if migration.airflow_ttl_migrated:
                airflow_ttl_migrated += 1
        orphan_settings_removed = [k for k in _ORPHAN_SETTINGS_KEYS if self._settings.pop(k, None) is not None]
        if device_migrated or hp_migrated or airflow_ttl_migrated or orphan_settings_removed:
            await self._async_save()
        if device_migrated:
            _LOGGER.info("Migrated %d room(s) to unified device model", device_migrated)
        if hp_migrated:
            _LOGGER.info("Migrated %d room(s) from heat_pump to ac device type", hp_migrated)
        if airflow_ttl_migrated:
            _LOGGER.info("Migrated airflow assumed-state TTL in %d room(s)", airflow_ttl_migrated)
        if orphan_settings_removed:
            _LOGGER.info("Removed orphan setting(s): %s", ", ".join(orphan_settings_removed))

    async def _async_save(self) -> None:
        """Persist current room data to the HA store."""
        await self._store.async_save(
            {"rooms": self._data, "settings": self._settings, "thermal_data": self._thermal_data}
        )

    def get_rooms(self) -> dict[str, dict]:
        """Return a deep copy of all rooms (with migration applied)."""
        rooms = copy.deepcopy(dict(self._data))
        for room in rooms.values():
            normalize_room_config(room)
        return rooms

    def get_room(self, area_id: str) -> dict | None:
        """Return a deep copy of a single room by area ID, or None if not found."""
        room = self._data.get(area_id)
        if room is None:
            return None
        result = copy.deepcopy(room)
        normalize_room_config(result)
        return result

    def get_settings(self) -> dict:
        """Return a deep copy of global settings."""
        return copy.deepcopy(dict(self._settings))

    async def async_save_settings(self, changes: dict) -> dict:
        """Merge changes into global settings and persist."""
        self._settings.update(changes)
        await self._async_save()
        return dict(self._settings)

    def get_thermal_data(self) -> dict:
        """Return a deep copy of thermal learning data."""
        return copy.deepcopy(dict(self._thermal_data))

    async def async_save_thermal_data(self, data: dict) -> None:
        """Replace thermal learning data and persist."""
        self._thermal_data = data
        await self._async_save()

    async def async_clear_thermal_data_room(self, area_id: str) -> None:
        """Clear thermal learning data for a single room."""
        self._thermal_data.pop(area_id, None)
        await self._async_save()

    async def async_clear_all_thermal_data(self) -> None:
        """Clear all thermal learning data."""
        self._thermal_data = {}
        await self._async_save()

    async def async_save_room(self, area_id: str, config: dict) -> dict:
        """Create or update room configuration for an area."""
        room = upsert_room_config(area_id, self._data.get(area_id), config)
        self._data[area_id] = room
        await self._async_save()
        return room

    async def async_update_room(self, area_id: str, changes: dict) -> dict:
        """Merge changes into an existing room. Raises KeyError if not found.

        Note: Does NOT perform device sync (devices <-> thermostats/acs).
        Use async_save_room() for changes involving device fields.
        """
        if area_id not in self._data:
            raise KeyError(f"Room '{area_id}' not found")

        # Prevent overriding the area_id
        changes.pop("area_id", None)

        self._data[area_id].update(changes)
        if {
            "temperature_sensor",
            "temperature_sensors",
            "humidity_sensor",
            "humidity_sensors",
        }.intersection(changes):
            normalize_room_sensor_sources(self._data[area_id])
        await self._async_save()
        return self._data[area_id]

    async def async_delete_room(self, area_id: str) -> None:
        """Delete a room. Raises KeyError if not found."""
        if area_id not in self._data:
            raise KeyError(f"Room '{area_id}' not found")

        del self._data[area_id]
        await self._async_save()
