"""Integration: store save/load round-trips with real RoomMindStore."""

from __future__ import annotations

import copy

import pytest

from custom_components.roommind.store import RoomMindStore

from .conftest import ROOM_LIVING


class TestStoreRoundTrip:
    @pytest.mark.asyncio
    async def test_setback_overrides_and_inheritance_survive_reload(self, real_store, hass):
        await real_store.async_load()
        await real_store.async_save_settings({"setback_offset": 3.0})
        await real_store.async_save_room("inherited", {})
        saved_room = await real_store.async_save_room("custom", {"setback_offset": 4.5})
        saved_snapshot = real_store._store.async_save.call_args.args[0]
        saved_room["setback_offset"] = 1.0
        await real_store.async_save_room("custom", {"comfort_heat": 22.0})
        assert saved_snapshot["rooms"]["custom"]["setback_offset"] == 4.5
        assert real_store.get_room("custom")["setback_offset"] == 4.5

        reloaded = RoomMindStore(hass)
        reloaded._store = real_store._store
        reloaded._store.async_load.return_value = copy.deepcopy(saved_snapshot)
        await reloaded.async_load()
        assert reloaded.get_settings()["setback_offset"] == 3.0
        assert reloaded.get_room("custom")["setback_offset"] == 4.5
        assert reloaded.get_room("inherited")["setback_offset"] is None

        await reloaded.async_save_room("custom", {"setback_offset": None})
        reloaded._store.async_load.return_value = copy.deepcopy(reloaded._store.async_save.call_args.args[0])
        await reloaded.async_load()
        assert reloaded.get_room("custom")["setback_offset"] is None
        assert saved_snapshot["rooms"]["custom"]["setback_offset"] == 4.5

    @pytest.mark.asyncio
    async def test_save_and_load_room(self, real_store):
        await real_store.async_load()
        await real_store.async_save_room("living_room", ROOM_LIVING)

        rooms = real_store.get_rooms()
        assert "living_room" in rooms
        assert rooms["living_room"]["comfort_temp"] == 21.0

    @pytest.mark.asyncio
    async def test_update_room_merges(self, real_store):
        await real_store.async_load()
        await real_store.async_save_room("living_room", ROOM_LIVING)
        await real_store.async_update_room("living_room", {"comfort_temp": 22.0})

        rooms = real_store.get_rooms()
        assert rooms["living_room"]["comfort_temp"] == 22.0
        assert rooms["living_room"]["eco_temp"] == 17.0

    @pytest.mark.asyncio
    async def test_settings_merge(self, real_store):
        await real_store.async_load()
        await real_store.async_save_settings({"outdoor_temp_sensor": "sensor.outdoor"})
        await real_store.async_save_settings({"presence_enabled": True})

        settings = real_store.get_settings()
        assert settings["outdoor_temp_sensor"] == "sensor.outdoor"
        assert settings["presence_enabled"] is True

    @pytest.mark.asyncio
    async def test_thermal_data_persists(self, real_store):
        await real_store.async_load()
        thermal = {"living_room": {"alpha": 0.5, "beta_h": 0.3}}
        await real_store.async_save_thermal_data(thermal)

        assert real_store._store.async_save.called
        assert real_store.get_thermal_data() == thermal
