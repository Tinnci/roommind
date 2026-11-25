"""Tests for event-driven observation sync and WebSocket room subscriptions."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.roommind.const import DOMAIN
from custom_components.roommind.control.thermal_model import TemperatureObservation
from custom_components.roommind.managers.sensor_fusion_manager import SensorFusionManager
from custom_components.roommind.websocket_api import websocket_subscribe_rooms

from .conftest import SAMPLE_ROOM, _create_coordinator, _make_store_mock, make_mock_states_get


def test_sensor_fusion_cadence_and_dropout_fallback() -> None:
    """Slow BLE cadence extends freshness knee and primary dropout uses bias-corrected AC fallback."""
    fusion = SensorFusionManager()
    now = datetime(2026, 11, 25, 12, 0, tzinfo=UTC)

    # Simulate a slow BLE sensor reporting every 240s
    for step in (0, 240, 480):
        obs_t = now + timedelta(seconds=step)
        st = MagicMock()
        st.state = "19.8"
        st.attributes = {"unit_of_measurement": "°C"}
        st.last_reported = obs_t
        fusion.observation_from_state("sensor.ble_room", st, now=obs_t, value_c=19.8, is_primary=False)

    cadence = fusion.get_cadence("sensor.ble_room")
    assert cadence is not None and cadence >= 150.0

    # At age 150s (< 2 * 240s), BLE sensor should remain fresh without inflated aging penalty
    st_aging = MagicMock()
    st_aging.state = "19.8"
    st_aging.attributes = {"unit_of_measurement": "°C"}
    st_aging.last_reported = now + timedelta(seconds=480)
    ble_obs = fusion.observation_from_state(
        "sensor.ble_room",
        st_aging,
        now=now + timedelta(seconds=480 + 150),
        value_c=19.8,
        is_primary=False,
    )
    assert ble_obs is not None
    assert ble_obs.variance == pytest.approx(fusion.base_variance("sensor.ble_room", is_primary=False))

    # Calibrate AC intake offset (+2.5°C vs primary) then drop primary
    for _ in range(250):
        fusion.calibrate_observations(
            [
                TemperatureObservation(value=19.6, variance=0.04, entity_id="sensor.wifi", is_primary=True),
                TemperatureObservation(value=22.1, variance=0.64, entity_id="climate.ac", is_primary=False),
            ],
            mode="heating",
            power_fraction=1.0,
        )

    with_primary = fusion.fuse_temperature(
        [
            TemperatureObservation(value=19.6, variance=0.04, entity_id="sensor.wifi", age_s=5.0, is_primary=True),
            TemperatureObservation(value=22.1, variance=0.64, entity_id="climate.ac", age_s=5.0, is_primary=False),
        ],
        power_fraction=1.0,
    )
    assert with_primary.value == 19.6

    primary_lost = fusion.fuse_temperature(
        [TemperatureObservation(value=22.1, variance=0.64, entity_id="climate.ac", age_s=5.0, is_primary=False)],
        power_fraction=1.0,
    )
    assert primary_lost.value is not None
    assert 19.3 <= primary_lost.value <= 20.1


@pytest.mark.asyncio
async def test_reconcile_observed_room_states_skips_ekf_and_notifies(hass, mock_config_entry):
    """Observation-only sync updates live state & notifies listeners without invoking EKF."""
    states_map: dict[str, tuple[str, dict]] = {
        "climate.living_room": (
            "heat",
            {"hvac_action": "idle", "temperature": 21.0, "current_temperature": 19.5},
        )
    }
    hass.states.get = MagicMock(side_effect=make_mock_states_get(temp="19.5", outdoor_temp="5.0", extra=states_map))
    store = _make_store_mock({SAMPLE_ROOM["area_id"]: SAMPLE_ROOM})
    hass.data = {DOMAIN: {"store": store}}
    hass.services.async_call = AsyncMock()

    coordinator = _create_coordinator(hass, mock_config_entry)
    coordinator.data = await coordinator._async_update_data()
    coordinator._ekf_training.process = MagicMock()
    notified = 0

    def _inc():
        nonlocal notified
        notified += 1

    coordinator.async_update_listeners = _inc

    # Simulate AC confirmation arriving out-of-band on climate state change
    states_map["climate.living_room"] = (
        "heat",
        {"hvac_action": "heating", "temperature": 25.0, "current_temperature": 20.0},
    )
    changed = coordinator._reconcile_observed_room_states({SAMPLE_ROOM["area_id"]})

    assert changed is True
    assert notified == 1
    coordinator._ekf_training.process.assert_not_called()
    live = coordinator.rooms[SAMPLE_ROOM["area_id"]]
    assert live["observed_mode"] == "heating"
    assert live["device_observations"][0]["temperature"] == 25.0


@pytest.mark.asyncio
async def test_websocket_subscribe_rooms_pushes_updates(hass, store, mock_config_entry):
    """roommind/rooms/subscribe pushes initial state and live coordinator updates."""
    await store.async_load()
    hass.data[DOMAIN] = {"store": store}
    coordinator = _create_coordinator(hass, mock_config_entry)
    coordinator.rooms = {}
    hass.data[DOMAIN]["coordinator"] = coordinator
    hass.loop = asyncio.get_running_loop()

    conn = MagicMock()
    conn.subscriptions = {}
    conn.send_result = MagicMock()
    conn.send_message = MagicMock()

    subscribe = websocket_subscribe_rooms.__wrapped__
    await subscribe(hass, conn, {"id": 99, "type": "roommind/rooms/subscribe"})

    conn.send_result.assert_called_once_with(99, None)
    assert conn.send_message.call_count == 1
    assert callable(conn.subscriptions.get(99))

    coordinator.async_update_listeners()
    await asyncio.sleep(0)
    assert conn.send_message.call_count == 2

    conn.subscriptions[99]()
    coordinator.async_update_listeners()
    await asyncio.sleep(0)
    assert conn.send_message.call_count == 2
