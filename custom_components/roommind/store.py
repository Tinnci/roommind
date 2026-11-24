"""Room persistence layer for RoomMind."""

from __future__ import annotations

import asyncio
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
from .settings_config import UI_PREF_FIELDS

_LOGGER = logging.getLogger(__name__)

STORAGE_VERSION = 1
STORAGE_KEY = DOMAIN
THERMAL_STORAGE_KEY = f"{DOMAIN}_thermal"


_ORPHAN_SETTINGS_KEYS = ("heating_threshold", "cooling_threshold")


class RoomMindStore:
    """Manage room configuration storage for RoomMind."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialise the store."""
        self._store: Store[dict] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._thermal_store: Store[dict] = Store(hass, STORAGE_VERSION, THERMAL_STORAGE_KEY)
        self._data: dict[str, dict] = {}
        self._settings: dict = {}
        self._ui_prefs: dict = {}
        self._thermal_data: dict = {}
        self._write_lock = asyncio.Lock()
        self._thermal_write_lock = asyncio.Lock()
        self._last_saved_snapshot: dict | None = None
        self._last_saved_thermal_snapshot: dict | None = None

    @property
    def _write_transaction(self) -> asyncio.Lock:
        """Return the config write lock, tolerating legacy test/store construction."""
        lock = getattr(self, "_write_lock", None)
        if lock is None:
            lock = self._write_lock = asyncio.Lock()
        return lock

    @property
    def _thermal_transaction(self) -> asyncio.Lock:
        """Return the thermal write lock, tolerating partial test construction."""
        lock = getattr(self, "_thermal_write_lock", None)
        if lock is None:
            lock = self._thermal_write_lock = asyncio.Lock()
        return lock

    async def async_load(self) -> None:
        """Load room configuration and split thermal data from the HA stores."""
        stored = await self._store.async_load()
        if stored and "rooms" in stored:
            self._data = stored["rooms"]
        else:
            self._data = {}

        self._settings = stored.get("settings", {}) if stored else {}
        self._ui_prefs = (
            copy.deepcopy(stored.get("ui_prefs", {})) if isinstance(stored, dict) and "ui_prefs" in stored else {}
        )
        legacy_thermal = stored.get("thermal_data") if isinstance(stored, dict) else None

        thermal_store = getattr(self, "_thermal_store", None)
        thermal_stored = await thermal_store.async_load() if thermal_store is not None else None
        if isinstance(thermal_stored, dict) and "thermal_data" in thermal_stored:
            self._thermal_data = thermal_stored.get("thermal_data", {})
            self._last_saved_thermal_snapshot = copy.deepcopy({"thermal_data": self._thermal_data})
        elif isinstance(legacy_thermal, dict):
            self._thermal_data = copy.deepcopy(legacy_thermal)
            self._last_saved_thermal_snapshot = None
        else:
            self._thermal_data = {}
            self._last_saved_thermal_snapshot = None

        ui_prefs_migrated = False
        for key in list(UI_PREF_FIELDS):
            if key in self._settings:
                val = self._settings.pop(key)
                self._ui_prefs.setdefault(key, val)
                ui_prefs_migrated = True

        self._last_saved_snapshot = (
            self._build_config_snapshot()
            if stored and not isinstance(legacy_thermal, dict) and not ui_prefs_migrated
            else None
        )

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
        had_legacy_thermal = isinstance(stored, dict) and "thermal_data" in stored
        if had_legacy_thermal and not (isinstance(thermal_stored, dict) and "thermal_data" in thermal_stored):
            await self._async_save_thermal()
        if (
            device_migrated
            or hp_migrated
            or airflow_ttl_migrated
            or orphan_settings_removed
            or had_legacy_thermal
            or ui_prefs_migrated
        ):
            await self._async_save()
        if device_migrated:
            _LOGGER.info("Migrated %d room(s) to unified device model", device_migrated)
        if hp_migrated:
            _LOGGER.info("Migrated %d room(s) from heat_pump to ac device type", hp_migrated)
        if airflow_ttl_migrated:
            _LOGGER.info("Migrated airflow assumed-state TTL in %d room(s)", airflow_ttl_migrated)
        if orphan_settings_removed:
            _LOGGER.info("Removed orphan setting(s): %s", ", ".join(orphan_settings_removed))
        if had_legacy_thermal:
            _LOGGER.info("Migrated thermal model data into separate store '%s'", THERMAL_STORAGE_KEY)
        if ui_prefs_migrated:
            _LOGGER.info("Separated UI preferences into 'ui_prefs' storage section")

    def _build_config_snapshot(self) -> dict:
        """Build an immutable configuration snapshot separating policy from UI prefs."""
        snapshot: dict = {"rooms": self._data, "settings": self._settings}
        ui_prefs = getattr(self, "_ui_prefs", {})
        if ui_prefs:
            snapshot["ui_prefs"] = ui_prefs
        return copy.deepcopy(snapshot)

    async def _async_save(self) -> None:
        """Persist current room configuration to the config HA store."""
        async with self._write_transaction:
            await self._async_save_locked()

    async def _async_save_locked(self) -> None:
        """Persist one immutable config snapshot while holding the write transaction."""
        snapshot = self._build_config_snapshot()
        if snapshot == getattr(self, "_last_saved_snapshot", None):
            return
        await self._store.async_save(snapshot)
        # Remember only successful writes so an identical retry remains durable.
        self._last_saved_snapshot = copy.deepcopy(snapshot)

    async def _async_save_thermal(self) -> None:
        """Persist current thermal learning data to its dedicated HA store."""
        async with self._thermal_transaction:
            await self._async_save_thermal_locked()

    async def _async_save_thermal_locked(self) -> None:
        """Persist one immutable thermal snapshot while holding the thermal transaction."""
        thermal_store = getattr(self, "_thermal_store", None)
        if thermal_store is None:
            return
        snapshot = copy.deepcopy({"thermal_data": self._thermal_data})
        if snapshot == getattr(self, "_last_saved_thermal_snapshot", None):
            return
        await thermal_store.async_save(snapshot)
        self._last_saved_thermal_snapshot = copy.deepcopy(snapshot)

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
        """Return a deep copy of global settings merged with UI preferences."""
        merged = dict(self._settings)
        merged.update(getattr(self, "_ui_prefs", {}))
        return copy.deepcopy(merged)

    def get_policy_settings(self) -> dict:
        """Return a deep copy of control-policy settings (excluding UI layout prefs)."""
        return copy.deepcopy(dict(self._settings))

    def get_ui_prefs(self) -> dict:
        """Return a deep copy of frontend UI layout preferences."""
        return copy.deepcopy(dict(getattr(self, "_ui_prefs", {})))

    async def async_save_settings(self, changes: dict) -> dict:
        """Merge changes into policy settings and UI preferences and persist."""
        changes = copy.deepcopy(changes)
        async with self._write_transaction:
            ui_prefs = getattr(self, "_ui_prefs", None)
            if ui_prefs is None:
                ui_prefs = self._ui_prefs = {}
            for key, value in changes.items():
                if key in UI_PREF_FIELDS:
                    ui_prefs[key] = value
                else:
                    self._settings[key] = value
            await self._async_save_locked()
            return self.get_settings()

    async def async_save_ui_prefs(self, changes: dict) -> dict:
        """Merge UI-only preferences and persist without altering control policy."""
        filtered = {k: v for k, v in changes.items() if k in UI_PREF_FIELDS}
        if not filtered:
            return self.get_ui_prefs()
        async with self._write_transaction:
            ui_prefs = getattr(self, "_ui_prefs", None)
            if ui_prefs is None:
                ui_prefs = self._ui_prefs = {}
            ui_prefs.update(copy.deepcopy(filtered))
            await self._async_save_locked()
            return self.get_ui_prefs()

    def get_thermal_data(self) -> dict:
        """Return a deep copy of thermal learning data."""
        return copy.deepcopy(dict(self._thermal_data))

    async def async_save_thermal_data(self, data: dict) -> None:
        """Replace thermal learning data and persist."""
        data = copy.deepcopy(data)
        async with self._thermal_transaction:
            self._thermal_data = data
            await self._async_save_thermal_locked()

    async def async_clear_thermal_data_room(self, area_id: str) -> None:
        """Clear thermal learning data for a single room."""
        async with self._thermal_transaction:
            self._thermal_data.pop(area_id, None)
            await self._async_save_thermal_locked()

    async def async_clear_all_thermal_data(self) -> None:
        """Clear all thermal learning data."""
        async with self._thermal_transaction:
            self._thermal_data = {}
            await self._async_save_thermal_locked()

    async def async_save_room(self, area_id: str, config: dict) -> dict:
        """Create or update room configuration for an area."""
        config = copy.deepcopy(config)
        async with self._write_transaction:
            room = upsert_room_config(area_id, self._data.get(area_id), config)
            self._data[area_id] = room
            await self._async_save_locked()
            return copy.deepcopy(room)

    async def async_update_room(self, area_id: str, changes: dict) -> dict:
        """Merge changes into an existing room. Raises KeyError if not found.

        Note: Does NOT perform device sync (devices <-> thermostats/acs).
        Use async_save_room() for changes involving device fields.
        """
        changes = copy.deepcopy(changes)
        async with self._write_transaction:
            if area_id not in self._data:
                raise KeyError(f"Room '{area_id}' not found")

            # Prevent overriding the area_id
            changes = {key: value for key, value in changes.items() if key != "area_id"}

            self._data[area_id].update(changes)
            if {
                "temperature_sensor",
                "temperature_sensors",
                "humidity_sensor",
                "humidity_sensors",
            }.intersection(changes):
                normalize_room_sensor_sources(self._data[area_id])
            await self._async_save_locked()
            return copy.deepcopy(self._data[area_id])

    async def async_delete_room(self, area_id: str) -> None:
        """Delete a room. Raises KeyError if not found."""
        async with self._write_transaction:
            if area_id not in self._data:
                raise KeyError(f"Room '{area_id}' not found")

            del self._data[area_id]
            await self._async_save_locked()
