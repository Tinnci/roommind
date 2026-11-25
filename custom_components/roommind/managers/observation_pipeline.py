"""Raw observation buffering, derivative storage, and actuation evidence reconciliation."""

from __future__ import annotations

import logging
import time
from functools import partial
from typing import TYPE_CHECKING, Any

from ..const import (
    OBSERVED_SUMMARY_BUCKET_SECONDS,
    RAW_OBSERVATION_RETENTION_DAYS,
    THERMAL_EPISODE_MAX_GAP_SECONDS,
    THERMAL_EPISODE_MIN_DURATION_SECONDS,
)
from ..control.actuation import ActuationLedger
from ..utils.history_store import HistoryStore
from ..utils.observation_store import ObservationStore
from ..utils.sensor_utils import sensor_observation_timestamp

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)


def state_observed_at(state: Any, *, kind: str) -> float | None:
    """Return the source observation timestamp for a HA state."""
    attribute = f"current_{kind}" if str(getattr(state, "entity_id", "")).startswith("climate.") else None
    timestamp, source = sensor_observation_timestamp(state, attribute=attribute)
    if timestamp is not None:
        return timestamp.timestamp()
    return time.time() if source == "none" else None


def essential_raw_attributes(attrs: dict) -> dict:
    """Return compact attributes worth preserving in raw observation storage."""
    return {
        key: attrs[key]
        for key in (
            "device_class",
            "state_class",
            "unit_of_measurement",
            "friendly_name",
            "observed_at",
            "observation_source",
            "current_temperature_observed_at",
            "current_humidity_observed_at",
        )
        if key in attrs
    }


def reconcile_room_evidence(room: dict[str, Any], actuation_ledger: ActuationLedger) -> dict[str, Any]:
    """Replace evidence fields while retaining the cycle's physical observations."""
    updates: dict[str, Any] = {}
    for key in ("device_actuation_status", "night_control_status"):
        statuses = room.get(key, [])
        reconciled = []
        changed = False
        for status in statuses:
            evidence = actuation_ledger.get(status.get("context_id"))
            values = (
                {"acceptance": evidence.acceptance.value, "application": evidence.application.value}
                if evidence is not None
                else {}
            )
            if any(status.get(field) != value for field, value in values.items()):
                reconciled.append({**status, **values})
                changed = True
            else:
                reconciled.append(status)
        if changed:
            updates[key] = reconciled
    return {**room, **updates} if updates else room


def build_raw_state_observation(
    area_id: str,
    entity_id: str,
    kind: str,
    state: Any,
    *,
    is_primary: bool,
    quality: float | None = None,
) -> dict[str, Any]:
    """Build one raw HA state observation dict for buffered persistence."""
    state_value = str(getattr(state, "state", ""))
    attrs = getattr(state, "attributes", {}) or {}
    raw_state = "ok" if state_value not in ("unknown", "unavailable") else state_value
    return {
        "room_id": area_id,
        "entity_id": entity_id,
        "kind": kind,
        "observed_at": state_observed_at(state, kind=kind),
        "ingested_at": time.time(),
        "state": raw_state,
        "value": state_value,
        "unit": attrs.get("unit_of_measurement"),
        "source": "home_assistant_state",
        "is_primary": is_primary,
        "quality": quality if quality is not None else (0.0 if raw_state != "ok" else 1.0),
        "attributes": essential_raw_attributes(attrs),
    }


async def async_store_observation_summaries(
    hass: HomeAssistant,
    observation_store: ObservationStore | None,
    room_id: str,
    kinds: tuple[str, ...],
    *,
    now_ts: float,
) -> None:
    """Persist observed-only summaries for raw observation kinds."""
    if not observation_store:
        return
    start_ts = now_ts - RAW_OBSERVATION_RETENTION_DAYS * 24 * 3600
    for kind in kinds:
        try:
            await hass.async_add_executor_job(
                partial(
                    observation_store.store_window_summaries,
                    room_id=room_id,
                    kind=kind,
                    bucket_seconds=OBSERVED_SUMMARY_BUCKET_SECONDS,
                    start_ts=start_ts,
                    end_ts=now_ts,
                )
            )
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Observed summary derivation failed for '%s' %s", room_id, kind)


async def async_store_observed_derivatives(
    hass: HomeAssistant,
    observation_store: ObservationStore | None,
    history_store: HistoryStore | None,
    area_id: str,
    *,
    now_ts: float,
) -> None:
    """Persist low-frequency observed summaries and thermal episodes."""
    await async_store_observation_summaries(
        hass,
        observation_store,
        area_id,
        ("temperature", "humidity"),
        now_ts=now_ts,
    )
    if not observation_store or not history_store:
        return

    start_ts = now_ts - RAW_OBSERVATION_RETENTION_DAYS * 24 * 3600
    try:
        detail_rows = await hass.async_add_executor_job(history_store.read_detail, area_id, None, start_ts, now_ts)
        history_rows = await hass.async_add_executor_job(history_store.read_history, area_id, None, start_ts, now_ts)
        rows = sorted([*history_rows, *detail_rows], key=HistoryStore.safe_timestamp)
        await hass.async_add_executor_job(
            partial(
                observation_store.store_thermal_episodes,
                room_id=area_id,
                rows=rows,
                min_duration_s=THERMAL_EPISODE_MIN_DURATION_SECONDS,
                max_gap_s=THERMAL_EPISODE_MAX_GAP_SECONDS,
            )
        )
    except Exception:  # noqa: BLE001
        _LOGGER.warning("Thermal episode derivation failed for '%s'", area_id)
