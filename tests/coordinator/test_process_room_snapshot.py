"""Snapshot tests for coordinator._async_process_room return dict.

These tests call _async_process_room directly and verify the return dict
to catch regressions during future coordinator decomposition.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.util import dt as dt_util

from custom_components.roommind.utils import target_resolution

from .conftest import (
    MANAGED_ROOM,
    SAMPLE_ROOM,
    _create_coordinator,
    _make_store_mock,
    make_mock_states_get,
)


def _setup_coordinator(hass, mock_config_entry, rooms, settings=None):
    """Wire up hass, store, and create coordinator."""
    store = _make_store_mock(rooms)
    if settings:
        store.get_settings.return_value = settings
    hass.data = {"roommind": {"store": store}}
    hass.services.async_call = AsyncMock()
    coordinator = _create_coordinator(hass, mock_config_entry)
    return coordinator, store


class TestProcessRoomSnapshot:
    """Snapshot tests for _async_process_room return dict."""

    @pytest.mark.asyncio
    async def test_normal_heating(self, hass, mock_config_entry):
        """temp=18, schedule=on: should heat toward comfort_temp=21."""
        coordinator, store = _setup_coordinator(
            hass,
            mock_config_entry,
            {"living_room_abc12345": SAMPLE_ROOM},
        )
        hass.states.get = MagicMock(
            side_effect=make_mock_states_get(temp="18.0", humidity="55.0"),
        )

        settings = store.get_settings()
        result = await coordinator._async_process_room(SAMPLE_ROOM, settings, [])

        # All expected keys present

        assert result["area_id"] == "living_room_abc12345"
        assert result["current_temp"] == 18.0
        assert result["target_temp"] == pytest.approx(21.0)
        assert result["heat_target"] == pytest.approx(21.0)
        assert result["commanded_mode"] == "heating"
        assert result["requested_power"] > 0
        assert result["observation_status"] == "unknown"
        assert result["window_open"] is False
        assert result["override_active"] is False
        assert result["presence_away"] is False
        assert result["force_off"] is False
        assert result["mold_risk_level"] == "ok"
        assert result["mold_prevention_active"] is False
        assert result["mold_prevention_delta"] == 0
        assert result["q_occupancy"] == 0.0

    @pytest.mark.asyncio
    async def test_idle_at_target(self, hass, mock_config_entry):
        """temp=21 (at comfort_temp), schedule=on: target_temp=21, mode idle."""
        coordinator, store = _setup_coordinator(
            hass,
            mock_config_entry,
            {"living_room_abc12345": SAMPLE_ROOM},
        )
        hass.states.get = MagicMock(
            side_effect=make_mock_states_get(temp="21.0", humidity="55.0"),
        )

        settings = store.get_settings()
        result = await coordinator._async_process_room(SAMPLE_ROOM, settings, [])

        assert result["area_id"] == "living_room_abc12345"
        assert result["current_temp"] == 21.0
        assert result["target_temp"] == pytest.approx(21.0)
        assert result["heat_target"] == pytest.approx(21.0)
        # At target, bang-bang controller should be idle
        assert result["mode"] == "idle"
        assert result["heating_power"] == 0

    @pytest.mark.asyncio
    async def test_saved_default_quiet_hours_make_night_mode_active(self, hass, mock_config_entry, monkeypatch):
        """Default quiet hours saved by the frontend should activate backend night mode."""
        room = {
            **SAMPLE_ROOM,
            "quiet_hours": {"start": "22:00", "end": "07:00"},
            "night_mode_enabled": True,
        }
        coordinator, store = _setup_coordinator(
            hass,
            mock_config_entry,
            {"living_room_abc12345": room},
        )
        monkeypatch.setattr(
            target_resolution.time,
            "time",
            lambda: datetime(2026, 5, 25, 23, 15, tzinfo=dt_util.DEFAULT_TIME_ZONE).timestamp(),
        )
        hass.states.get = MagicMock(
            side_effect=make_mock_states_get(temp="21.0", humidity="55.0"),
        )

        settings = store.get_settings()
        result = await coordinator._async_process_room(room, settings, [])

        assert result["night_mode"]["active"] is True
        assert result["night_mode"]["quiet_hours"] == {"start": "22:00", "end": "07:00"}

    @pytest.mark.asyncio
    async def test_window_open(self, hass, mock_config_entry):
        """Window sensor on: window_open=True, mode=idle."""
        room = {
            **SAMPLE_ROOM,
            "window_sensors": ["binary_sensor.w1"],
        }
        coordinator, store = _setup_coordinator(
            hass,
            mock_config_entry,
            {"living_room_abc12345": room},
        )
        hass.states.get = MagicMock(
            side_effect=make_mock_states_get(
                temp="18.0",
                humidity="55.0",
                window_sensors={"binary_sensor.w1": "on"},
            ),
        )

        settings = store.get_settings()
        result = await coordinator._async_process_room(room, settings, [])

        assert result["window_open"] is True
        assert result["mode"] == "idle"
        assert result["heating_power"] == 0

    @pytest.mark.asyncio
    async def test_outdoor_room(self, hass, mock_config_entry):
        """is_outdoor=True: returns reduced key set, mode=idle, force_off=False."""
        room = {
            **SAMPLE_ROOM,
            "is_outdoor": True,
        }
        coordinator, store = _setup_coordinator(
            hass,
            mock_config_entry,
            {"living_room_abc12345": room},
        )
        hass.states.get = MagicMock(
            side_effect=make_mock_states_get(temp="18.0", humidity="55.0"),
        )

        settings = store.get_settings()
        result = await coordinator._async_process_room(room, settings, [])

        assert result["mode"] == "idle"
        assert result["force_off"] is False  # NOT True!
        assert result["target_temp"] is None
        assert result["override_active"] is False
        # Outdoor rooms now include q_occupancy and active_heat_sources for consistency
        assert result["q_occupancy"] == 0.0
        assert result["active_heat_sources"] is None

    @pytest.mark.asyncio
    async def test_climate_control_disabled(self, hass, mock_config_entry):
        """climate_control_enabled=False: mode=idle, heating_power=0."""
        room = {**SAMPLE_ROOM, "climate_control_enabled": False}
        coordinator, store = _setup_coordinator(
            hass,
            mock_config_entry,
            {"living_room_abc12345": room},
        )
        hass.states.get = MagicMock(
            side_effect=make_mock_states_get(temp="18.0", humidity="55.0"),
        )

        settings = store.get_settings()
        result = await coordinator._async_process_room(room, settings, [])

        assert result["mode"] == "idle"
        assert result["heating_power"] == 0
        # All normal keys should still be present

    @pytest.mark.asyncio
    async def test_managed_mode(self, hass, mock_config_entry):
        """MANAGED_ROOM with device temp: target_temp is not None."""
        coordinator, store = _setup_coordinator(
            hass,
            mock_config_entry,
            {"living_room_abc12345": MANAGED_ROOM},
        )
        # Provide device temperature via climate entity's current_temperature
        hass.states.get = MagicMock(
            side_effect=make_mock_states_get(
                temp=None,  # No external sensor
                humidity="55.0",
                extra={
                    "climate.living_room": (
                        "heat",
                        {
                            "current_temperature": 19.0,
                            "temperature": 21.0,
                            "hvac_modes": ["off", "heat"],
                            "max_temp": 30,
                            "min_temp": 5,
                        },
                    ),
                },
            ),
        )

        settings = store.get_settings()
        result = await coordinator._async_process_room(MANAGED_ROOM, settings, [])

        assert result["target_temp"] is not None
        # Managed mode should still return all normal keys
