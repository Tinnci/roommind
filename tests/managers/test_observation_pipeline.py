"""Focused unit tests for observation_pipeline helpers."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.roommind.control.actuation import (
    ActuationLedger,
    DeviceActuationResult,
    DispatchStatus,
)
from custom_components.roommind.managers.observation_pipeline import (
    async_store_observed_derivatives,
    build_raw_state_observation,
    essential_raw_attributes,
    reconcile_room_evidence,
    state_observed_at,
)


def test_essential_raw_attributes_filters_unneeded_keys() -> None:
    """Only whitelist observation metadata keys are kept."""
    attrs = {
        "unit_of_measurement": "°C",
        "friendly_name": "Temp",
        "extra_noise": [1, 2, 3],
    }
    assert essential_raw_attributes(attrs) == {
        "unit_of_measurement": "°C",
        "friendly_name": "Temp",
    }


def test_build_raw_state_observation_and_timestamp() -> None:
    """Raw observation captures value, unit, quality, and observed timestamp."""
    ts = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    state = SimpleNamespace(
        entity_id="sensor.room_temp",
        state="21.5",
        last_updated=ts,
        last_changed=ts,
        attributes={"unit_of_measurement": "°C", "friendly_name": "Room"},
    )
    obs = build_raw_state_observation("living", "sensor.room_temp", "temperature", state, is_primary=True)
    assert obs["room_id"] == "living"
    assert obs["state"] == "ok"
    assert obs["quality"] == 1.0
    assert obs["observed_at"] == state_observed_at(state, kind="temperature")


def test_reconcile_room_evidence_updates_matching_statuses_only() -> None:
    """Ledger evidence updates stale status entries without mutating unrelated fields."""
    ledger = ActuationLedger()
    ledger.record_dispatch(
        DeviceActuationResult(
            entity_id="climate.ac",
            dispatch=DispatchStatus.SENT,
            service="set_hvac_mode",
            desired={"hvac_mode": "heat"},
            context_id="ctx-1",
        )
    )
    ledger.record_tcl_event(
        {"context_id": "ctx-1", "transport_outcome": "accepted_by_lan", "outcome": "applied"}
    )
    room = {
        "device_actuation_status": [{"entity_id": "climate.ac", "context_id": "ctx-1", "acceptance": "pending"}],
        "night_control_status": [{"entity_id": "light.ac", "context_id": "missing", "acceptance": "pending"}],
    }
    updated = reconcile_room_evidence(room, ledger)
    assert updated["device_actuation_status"][0]["acceptance"] == "accepted"
    assert updated["device_actuation_status"][0]["application"] == "confirmed"
    assert updated["night_control_status"] == room["night_control_status"]
    assert reconcile_room_evidence(updated, ledger) is updated


@pytest.mark.asyncio
async def test_async_store_observed_derivatives_reads_history_and_stores() -> None:
    """Summaries and thermal episodes are delegated to executor jobs."""
    hass = MagicMock()

    async def _run_in_executor(func, *args):
        return func(*args)

    hass.async_add_executor_job.side_effect = _run_in_executor
    obs_store = MagicMock()
    hist_store = MagicMock()
    hist_store.read_detail.return_value = [{"timestamp": 200.0}]
    hist_store.read_history.return_value = [{"timestamp": 100.0}]

    await async_store_observed_derivatives(hass, obs_store, hist_store, "living", now_ts=1000.0)
    assert obs_store.store_window_summaries.call_count == 2
    obs_store.store_thermal_episodes.assert_called_once()
