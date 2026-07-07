"""Tests for ground-truth-preserving thermal analytics helpers."""

from __future__ import annotations

from custom_components.roommind.utils.thermal_analysis import (
    build_observed_windows,
    build_thermal_episodes,
    summarize_observed_window,
    valid_thermal_episodes,
)


def test_summarize_observed_window_uses_only_real_samples():
    observations = [
        {"entity_id": "sensor.a", "observed_at": 1000.0, "value": "20.0", "is_primary": True},
        {"entity_id": "sensor.a", "observed_at": 1060.0, "value": "21.0", "is_primary": True},
    ]

    summary = summarize_observed_window(observations, start_ts=1000.0, end_ts=1300.0)

    assert summary["sample_count"] == 2
    assert summary["first_value"] == 20.0
    assert summary["last_value"] == 21.0
    assert summary["mean_value"] == 20.5
    assert summary["coverage_ratio"] == 0.2
    assert summary["method"] == "observed_summary"


def test_empty_window_stays_empty_without_fake_values():
    summary = summarize_observed_window([], start_ts=1000.0, end_ts=1300.0)

    assert summary["sample_count"] == 0
    assert summary["first_value"] is None
    assert summary["last_value"] is None
    assert summary["mean_value"] is None
    assert summary["coverage_ratio"] == 0.0


def test_build_observed_windows_keeps_empty_bucket_empty():
    observations = [
        {"entity_id": "sensor.a", "observed_at": 1000.0, "value": "20.0"},
        {"entity_id": "sensor.a", "observed_at": 1600.0, "value": "22.0"},
    ]

    windows = build_observed_windows(observations, bucket_seconds=300, start_ts=900.0, end_ts=1600.0)

    assert [window["sample_count"] for window in windows] == [1, 0, 1]
    assert windows[1]["mean_value"] is None


def test_valid_episode_from_stable_observed_snapshots():
    rows = [
        {
            "timestamp": 1000.0,
            "mode": "cooling",
            "hvac_stage": "compressor_low",
            "window_open": False,
            "temperature_source": "sensor.temp",
            "humidity_sources": "sensor.rh",
            "room_temp": 27.0,
            "room_humidity": 65.0,
            "outdoor_temp": 34.0,
        },
        {
            "timestamp": 1900.0,
            "mode": "cooling",
            "hvac_stage": "compressor_low",
            "window_open": False,
            "temperature_source": "sensor.temp",
            "humidity_sources": "sensor.rh",
            "room_temp": 26.0,
            "room_humidity": 62.0,
            "outdoor_temp": 34.0,
        },
        {
            "timestamp": 2800.0,
            "mode": "cooling",
            "hvac_stage": "compressor_low",
            "window_open": False,
            "temperature_source": "sensor.temp",
            "humidity_sources": "sensor.rh",
            "room_temp": 25.0,
            "room_humidity": 60.0,
            "outdoor_temp": 33.0,
        },
    ]

    episodes = valid_thermal_episodes(rows, max_gap_s=1200.0)

    assert len(episodes) == 1
    assert episodes[0]["valid"] is True
    assert episodes[0]["temp_slope_c_per_h"] == -4.0
    assert episodes[0]["humidity_slope_rh_per_h"] == -10.0
    assert episodes[0]["outdoor_mean"] == 33.6667


def test_episode_closes_and_rejects_on_source_change():
    rows = [
        {
            "timestamp": 1000.0,
            "mode": "idle",
            "window_open": False,
            "temperature_source": "sensor.primary",
            "room_temp": 25.0,
        },
        {
            "timestamp": 1600.0,
            "mode": "idle",
            "window_open": False,
            "temperature_source": "sensor.aux",
            "room_temp": 26.0,
        },
    ]

    episodes = build_thermal_episodes(rows)

    assert len(episodes) == 2
    assert all(not episode["valid"] for episode in episodes)
    assert all("duration_too_short" in episode["rejection_reasons"] for episode in episodes)
