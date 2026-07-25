"""Ground-truth-preserving helpers for RoomMind thermal analytics."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

STABLE_EPISODE_FIELDS = (
    "mode",
    "hvac_stage",
    "window_open",
    "temperature_source",
    "humidity_sources",
    "override_active",
)


def safe_float(value: Any) -> float | None:
    """Return a finite float or None."""
    if value in ("", None, "unknown", "unavailable"):
        return None
    try:
        result = float(value)
    except TypeError, ValueError:
        return None
    return result if result == result else None


def safe_bool(value: Any) -> bool:
    """Convert common bool-like values to bool."""
    if value is True:
        return True
    if value is False or value in ("", None):
        return False
    return str(value).lower() in ("1", "true", "yes", "on")


def _row_ts(row: dict) -> float | None:
    """Return a finite snapshot timestamp or None."""
    return safe_float(row.get("timestamp", row.get("ts")))


def _required_row_ts(row: dict) -> float:
    """Return a timestamp for rows already filtered by _row_ts."""
    ts = _row_ts(row)
    if ts is None:
        raise ValueError("snapshot row has no timestamp")
    return ts


def summarize_observed_window(
    observations: Iterable[dict],
    *,
    start_ts: float,
    end_ts: float,
) -> dict:
    """Summarize only real observations inside a time window.

    This function intentionally does not interpolate, smooth, or carry values
    forward. Empty windows remain empty.
    """
    window = [
        observation
        for observation in observations
        if (ts := safe_float(observation.get("observed_at"))) is not None and start_ts <= ts < end_ts
    ]
    window.sort(key=lambda observation: float(observation["observed_at"]))
    values = [value for observation in window if (value := safe_float(observation.get("value"))) is not None]
    observed_ts = [float(observation["observed_at"]) for observation in window]
    entity_ids = {str(observation.get("entity_id", "")) for observation in window if observation.get("entity_id")}
    primary_values = [safe_bool(observation.get("is_primary")) for observation in window]

    max_gap_s = 0.0
    if len(observed_ts) >= 2:
        max_gap_s = max(b - a for a, b in zip(observed_ts, observed_ts[1:], strict=False))
    observed_span_s = observed_ts[-1] - observed_ts[0] if len(observed_ts) >= 2 else 0.0
    duration_s = max(0.0, end_ts - start_ts)

    return {
        "start_ts": start_ts,
        "end_ts": end_ts,
        "sample_count": len(window),
        "numeric_sample_count": len(values),
        "first_observed_ts": observed_ts[0] if observed_ts else None,
        "last_observed_ts": observed_ts[-1] if observed_ts else None,
        "first_value": values[0] if values else None,
        "last_value": values[-1] if values else None,
        "min_value": min(values) if values else None,
        "max_value": max(values) if values else None,
        "mean_value": round(sum(values) / len(values), 4) if values else None,
        "max_gap_s": round(max_gap_s, 3),
        "observed_span_s": round(observed_span_s, 3),
        "coverage_ratio": round(min(1.0, observed_span_s / duration_s), 4) if duration_s > 0 else 0.0,
        "source_count": len(entity_ids),
        "source_changed": len(entity_ids) > 1,
        "primary_available": any(primary_values),
        "method": "observed_summary",
    }


def build_observed_windows(
    observations: Iterable[dict],
    *,
    bucket_seconds: int,
    start_ts: float | None = None,
    end_ts: float | None = None,
) -> list[dict]:
    """Build non-fabricating summaries on a fixed grid."""
    rows = [observation for observation in observations if safe_float(observation.get("observed_at")) is not None]
    if not rows:
        return []
    observed_times = [float(row["observed_at"]) for row in rows]
    first_ts = min(observed_times) if start_ts is None else start_ts
    last_ts = max(observed_times) if end_ts is None else end_ts
    bucket_start = int(first_ts // bucket_seconds) * bucket_seconds
    result = []
    while bucket_start <= last_ts:
        bucket_end = bucket_start + bucket_seconds
        result.append(summarize_observed_window(rows, start_ts=bucket_start, end_ts=bucket_end))
        bucket_start = bucket_end
    return result


def build_thermal_episodes(
    rows: Iterable[dict],
    *,
    min_duration_s: float = 20 * 60,
    max_gap_s: float = 10 * 60,
) -> list[dict]:
    """Split room snapshots into conservative thermal episode candidates."""
    ordered = [row for row in rows if _row_ts(row) is not None]
    ordered.sort(key=_required_row_ts)
    if not ordered:
        return []

    segments: list[list[dict]] = []
    current: list[dict] = []
    for row in ordered:
        if not current:
            current = [row]
            continue
        previous = current[-1]
        row_ts = _required_row_ts(row)
        previous_ts = _required_row_ts(previous)
        if row_ts - previous_ts <= max_gap_s and _stable_within_episode(previous, row):
            current.append(row)
        else:
            segments.append(current)
            current = [row]
    if current:
        segments.append(current)

    return [_episode_from_segment(segment, min_duration_s=min_duration_s, max_gap_s=max_gap_s) for segment in segments]


def valid_thermal_episodes(rows: Iterable[dict], **kwargs: Any) -> list[dict]:
    """Return only valid conservative thermal episodes."""
    return [episode for episode in build_thermal_episodes(rows, **kwargs) if episode["valid"]]


def _stable_within_episode(previous: dict, row: dict) -> bool:
    """Return True when stable fields have not changed."""
    for field in STABLE_EPISODE_FIELDS:
        if str(previous.get(field, "")) != str(row.get(field, "")):
            return False
    return True


def _episode_from_segment(segment: list[dict], *, min_duration_s: float, max_gap_s: float) -> dict:
    first = segment[0]
    last = segment[-1]
    start_ts = _required_row_ts(first)
    end_ts = _required_row_ts(last)
    duration_s = max(0.0, end_ts - start_ts)
    temp_values = [safe_float(row.get("room_temp")) for row in segment]
    humidity_values = [safe_float(row.get("room_humidity")) for row in segment]
    outdoor_values = [value for row in segment if (value := safe_float(row.get("outdoor_temp"))) is not None]
    gaps = [
        _required_row_ts(current) - _required_row_ts(previous)
        for previous, current in zip(segment, segment[1:], strict=False)
    ]
    max_gap = max(gaps) if gaps else 0.0
    reasons = _episode_rejection_reasons(segment, duration_s=duration_s, max_gap_s=max_gap_s)
    temp_start = next((value for value in temp_values if value is not None), None)
    temp_end = next((value for value in reversed(temp_values) if value is not None), None)
    humidity_start = next((value for value in humidity_values if value is not None), None)
    humidity_end = next((value for value in reversed(humidity_values) if value is not None), None)
    duration_h = duration_s / 3600.0 if duration_s > 0 else 0.0

    return {
        "start_ts": start_ts,
        "end_ts": end_ts,
        "duration_s": round(duration_s, 3),
        "sample_count": len(segment),
        "max_gap_s": round(max_gap, 3),
        "mode": first.get("mode", ""),
        "hvac_stage": first.get("hvac_stage", ""),
        "window_open": safe_bool(first.get("window_open")),
        "temperature_source": first.get("temperature_source", ""),
        "humidity_sources": first.get("humidity_sources", ""),
        "temperature_primary_available": safe_bool(first.get("temperature_primary_available")),
        "humidity_primary_available": safe_bool(first.get("humidity_primary_available")),
        "temp_start": temp_start,
        "temp_end": temp_end,
        "temp_slope_c_per_h": round((temp_end - temp_start) / duration_h, 4)
        if temp_start is not None and temp_end is not None and duration_h > 0
        else None,
        "humidity_start": humidity_start,
        "humidity_end": humidity_end,
        "humidity_slope_rh_per_h": round((humidity_end - humidity_start) / duration_h, 4)
        if humidity_start is not None and humidity_end is not None and duration_h > 0
        else None,
        "outdoor_mean": round(sum(outdoor_values) / len(outdoor_values), 4) if outdoor_values else None,
        "valid": not reasons,
        "rejection_reasons": reasons,
        "method": "observed_episode",
    }


def _episode_rejection_reasons(segment: list[dict], *, duration_s: float, max_gap_s: float) -> list[str]:
    reasons: list[str] = []
    if len(segment) < 2:
        reasons.append("insufficient_samples")
    if duration_s < 20 * 60:
        reasons.append("duration_too_short")
    if any(
        _required_row_ts(current) - _required_row_ts(previous) > max_gap_s
        for previous, current in zip(segment, segment[1:], strict=False)
    ):
        reasons.append("gap_too_large")
    if any(safe_float(row.get("room_temp")) is None for row in (segment[0], segment[-1])):
        reasons.append("missing_temperature_endpoint")
    if safe_bool(segment[0].get("window_open")):
        reasons.append("window_open")
    if not segment[0].get("temperature_source"):
        reasons.append("missing_temperature_source")
    mode = str(segment[0].get("mode", ""))
    if mode in ("cooling", "heating") and not segment[0].get("hvac_stage"):
        reasons.append("missing_hvac_stage")
    return reasons
