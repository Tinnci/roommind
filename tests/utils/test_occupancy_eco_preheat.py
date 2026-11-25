"""Tests for occupancy eco capping, preheat_enabled gating, and follow_thermostat_dial."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.roommind.const import TargetTemps
from custom_components.roommind.control.mpc_controller import MPCController
from custom_components.roommind.control.thermal_model import RoomModelManager
from custom_components.roommind.coordinator import RoomMindCoordinator
from custom_components.roommind.utils.presence_utils import is_room_vacant
from custom_components.roommind.utils.target_resolution import resolve_room_targets


def _make_state(entity_id: str, state: str, *, last_changed: datetime | None = None, attributes: dict | None = None):
    st = MagicMock()
    st.entity_id = entity_id
    st.state = state
    st.last_changed = last_changed or datetime(2026, 11, 25, 12, 0, tzinfo=UTC)
    st.attributes = attributes or {}
    return st


def test_is_room_vacant_requires_enabled_sensors_and_delay():
    now_dt = datetime(2026, 11, 25, 12, 20, tzinfo=UTC)
    now_ts = now_dt.timestamp()
    states = {
        "binary_sensor.occ_1": _make_state("binary_sensor.occ_1", "off", last_changed=now_dt - timedelta(minutes=20)),
        "binary_sensor.occ_2": _make_state("binary_sensor.occ_2", "off", last_changed=now_dt - timedelta(minutes=16)),
    }
    hass = MagicMock()
    hass.states.get.side_effect = states.get

    room = {
        "occupancy_sensors": ["binary_sensor.occ_1", "binary_sensor.occ_2"],
        "occupancy_eco_enabled": True,
        "occupancy_eco_delay_minutes": 15,
    }
    assert is_room_vacant(hass, room, now_ts) is True

    # Disabled toggle -> not vacant
    assert is_room_vacant(hass, {**room, "occupancy_eco_enabled": False}, now_ts) is False

    # One sensor still within delay -> not vacant
    states["binary_sensor.occ_2"] = _make_state("binary_sensor.occ_2", "off", last_changed=now_dt - timedelta(minutes=5))
    assert is_room_vacant(hass, room, now_ts) is False

    # One sensor active -> not vacant
    states["binary_sensor.occ_2"] = _make_state("binary_sensor.occ_2", "on", last_changed=now_dt - timedelta(minutes=25))
    assert is_room_vacant(hass, room, now_ts) is False


def test_resolve_room_targets_caps_vacant_room_to_eco():
    room = {
        "comfort_heat": 22.0,
        "comfort_cool": 24.0,
        "eco_heat": 18.0,
        "eco_cool": 27.5,
    }
    res = resolve_room_targets(
        now=1_000_000.0,
        room=room,
        settings={},
        presence_away=False,
        schedule_entity_id=None,
        room_vacant=True,
    )
    assert res.occupancy_vacant is True
    assert res.targets == TargetTemps(heat=18.0, cool=27.5)

    # Explicit override bypasses vacancy eco cap
    res_override = resolve_room_targets(
        now=1_000_000.0,
        room={**room, "override_temp": 23.0, "override_until": 1_003_600.0},
        settings={},
        presence_away=False,
        schedule_entity_id=None,
        room_vacant=True,
    )
    assert res_override.targets == TargetTemps(heat=23.0, cool=23.0)


def test_mpc_preheat_disabled_flattens_future_target_series(monkeypatch):
    from types import SimpleNamespace

    captured: dict = {}

    class FakeOptimizer:
        def __init__(self, **kwargs):
            pass

        def optimize(self, **kwargs):
            captured["heat_target_series"] = kwargs["heat_target_series"]
            captured["cool_target_series"] = kwargs["cool_target_series"]
            return SimpleNamespace(
                get_current_action=lambda: "idle",
                get_current_power_fraction=lambda: 0.0,
                get_current_airflow_level=lambda: 0.0,
                get_current_mix_level=lambda: 0.0,
                get_current_vent_level=lambda: 0.0,
                lookahead_blocks=1,
                temperatures=[18.0] * (len(kwargs["heat_target_series"]) + 1),
            )

    monkeypatch.setattr("custom_components.roommind.control.mpc_controller.MPCOptimizer", FakeOptimizer)
    monkeypatch.setattr("custom_components.roommind.control.mpc_controller.is_mpc_active", lambda *a, **kw: True)

    mgr = RoomModelManager()
    room = {
        "area_id": "study",
        "thermostats": ["climate.study_trv"],
        "devices": [{"entity_id": "climate.study_trv", "type": "trv", "role": "primary"}],
        "climate_mode": "auto",
        "preheat_enabled": False,
    }
    hass = MagicMock()
    hass.states.get.return_value = None

    def resolver(ts: float) -> TargetTemps:
        # Would rise to 22.0 in future blocks if preheat were enabled
        return TargetTemps(heat=22.0, cool=26.0)

    ctrl = MPCController(
        hass,
        room,
        model_manager=mgr,
        outdoor_temp=10.0,
        settings={},
        acs_can_heat=False,
        target_resolver=resolver,
    )
    ctrl._evaluate_mpc(
        18.0,
        TargetTemps(heat=18.0, cool=26.0),
    )
    assert all(t == pytest.approx(18.0) for t in captured["heat_target_series"])

    # With preheat enabled (default), future schedule targets propagate
    room["preheat_enabled"] = True
    ctrl._evaluate_mpc(
        18.0,
        TargetTemps(heat=18.0, cool=26.0),
    )
    assert all(t == pytest.approx(22.0) for t in captured["heat_target_series"])


@pytest.mark.asyncio
async def test_adopt_device_setpoints_promotes_manual_dial_when_enabled():
    hass = MagicMock()
    hass.config.units.temperature_unit = "°C"
    store = MagicMock()
    store.async_update_room = AsyncMock()
    hass.data = {"roommind": {"store": store}}

    current_state = _make_state(
        "climate.bedroom_ac",
        "cool",
        attributes={"temperature": 25.0, "hvac_modes": ["off", "cool", "heat"]},
    )
    hass.states.get.return_value = current_state

    coord = RoomMindCoordinator.__new__(RoomMindCoordinator)
    coord.hass = hass
    from custom_components.roommind.managers.device_setpoint_tracker import DeviceSetpointTracker

    coord.device_setpoints = DeviceSetpointTracker(lambda: 1000.0)

    room = {
        "area_id": "bedroom",
        "climate_mode": "cool_only",
        "climate_control_enabled": True,
        "follow_thermostat_dial": True,
        "devices": [{"entity_id": "climate.bedroom_ac", "type": "ac", "role": "primary"}],
    }
    settings = {"climate_control_active": True}

    # First observation primes baseline -> no override yet
    updated = await coord._async_adopt_device_setpoints(room, settings)
    assert updated is room
    store.async_update_room.assert_not_awaited()

    # Manual dial change to 23.0 -> adopts override
    hass.states.get.return_value = _make_state(
        "climate.bedroom_ac",
        "cool",
        attributes={"temperature": 23.0, "hvac_modes": ["off", "cool", "heat"]},
    )
    updated2 = await coord._async_adopt_device_setpoints(room, settings)
    assert updated2["override_temp"] == pytest.approx(23.0)
    store.async_update_room.assert_awaited_once()
