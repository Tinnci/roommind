"""Tests for the raw observation SQLite store."""

from __future__ import annotations

from custom_components.roommind.utils.observation_store import ObservationStore


def test_record_and_read_preserves_value_text_and_numeric_value(tmp_path):
    store = ObservationStore(str(tmp_path / "observations.sqlite"))

    inserted = store.record(
        {
            "room_id": "bedroom",
            "entity_id": "sensor.bedroom_temp",
            "kind": "temperature",
            "observed_at": 1000.0,
            "ingested_at": 1001.0,
            "state": "ok",
            "value": "24.20",
            "unit": "°C",
            "source": "home_assistant_state",
            "is_primary": True,
            "quality": 1.0,
            "attributes": {"device_class": "temperature"},
        }
    )

    assert inserted is True
    rows = store.read(room_id="bedroom", kind="temperature")
    assert len(rows) == 1
    assert rows[0]["value_text"] == "24.20"
    assert rows[0]["value_real"] == 24.2
    assert rows[0]["unit"] == "°C"
    assert rows[0]["is_primary"] is True
    assert rows[0]["attrs_json"] == '{"device_class":"temperature"}'


def test_duplicate_observation_is_ignored(tmp_path):
    store = ObservationStore(str(tmp_path / "observations.sqlite"))
    observation = {
        "room_id": "bedroom",
        "entity_id": "sensor.bedroom_temp",
        "kind": "temperature",
        "observed_at": 1000.0,
        "ingested_at": 1001.0,
        "state": "ok",
        "value": "24.2",
    }

    assert store.record(observation) is True
    assert store.record(observation) is False
    assert len(store.read(room_id="bedroom")) == 1


def test_read_filters_by_entity_kind_and_range(tmp_path):
    store = ObservationStore(str(tmp_path / "observations.sqlite"))
    store.record_many(
        [
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1000.0,
                "value": "24.0",
            },
            {
                "room_id": "bedroom",
                "entity_id": "sensor.humidity",
                "kind": "humidity",
                "observed_at": 1060.0,
                "value": "60",
            },
            {
                "room_id": "living_room",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1120.0,
                "value": "25.0",
            },
        ]
    )

    rows = store.read(room_id="bedroom", kind="humidity", start_ts=1000.0, end_ts=1100.0)
    assert len(rows) == 1
    assert rows[0]["entity_id"] == "sensor.humidity"
    assert rows[0]["value_real"] == 60.0


def test_prune_raw_removes_old_rows(tmp_path):
    store = ObservationStore(str(tmp_path / "observations.sqlite"))
    store.record_many(
        [
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1000.0,
                "value": "24.0",
            },
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 2000.0,
                "value": "25.0",
            },
        ]
    )

    assert store.prune_raw(cutoff_ts=1500.0) == 1
    rows = store.read(room_id="bedroom")
    assert len(rows) == 1
    assert rows[0]["observed_at"] == 2000.0
    intervals = store.read_intervals(room_id="bedroom")
    assert len(intervals) == 1
    assert intervals[0]["start_ts"] == 1000.0
    assert intervals[0]["end_ts"] == 1000.0
    assert intervals[0]["report_count"] == 1
    assert intervals[0]["method"] == "observed_interval"


def test_unavailable_state_is_preserved_without_numeric_value(tmp_path):
    store = ObservationStore(str(tmp_path / "observations.sqlite"))

    store.record(
        {
            "room_id": "bedroom",
            "entity_id": "sensor.temp",
            "kind": "temperature",
            "observed_at": 1000.0,
            "state": "unavailable",
            "value": "unavailable",
            "quality": 0.0,
        }
    )

    row = store.read(room_id="bedroom")[0]
    assert row["state"] == "unavailable"
    assert row["value_text"] == "unavailable"
    assert row["value_real"] is None
    assert row["quality"] == 0.0


def test_compact_raw_merges_consecutive_identical_observations(tmp_path):
    store = ObservationStore(str(tmp_path / "observations.sqlite"), interval_gap_seconds=300)
    store.record_many(
        [
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1000.0,
                "ingested_at": 1001.0,
                "value": "24.0",
                "quality": 1.0,
            },
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1060.0,
                "ingested_at": 1061.0,
                "value": "24.0",
                "quality": 0.8,
            },
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1120.0,
                "ingested_at": 1121.0,
                "value": "24.0",
                "quality": 0.9,
            },
        ]
    )

    assert store.compact_raw_before(cutoff_ts=1200.0) == 1
    intervals = store.read_intervals(room_id="bedroom", kind="temperature")
    assert len(intervals) == 1
    assert intervals[0]["start_ts"] == 1000.0
    assert intervals[0]["end_ts"] == 1120.0
    assert intervals[0]["report_count"] == 3
    assert intervals[0]["max_gap_s"] == 60.0
    assert intervals[0]["quality_min"] == 0.8
    assert intervals[0]["quality_max"] == 1.0
    assert intervals[0]["quality_avg"] == 0.9


def test_compact_raw_splits_on_long_gap_and_value_change(tmp_path):
    store = ObservationStore(str(tmp_path / "observations.sqlite"), interval_gap_seconds=300)
    store.record_many(
        [
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1000.0,
                "value": "24.0",
            },
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 2000.0,
                "value": "24.0",
            },
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 2060.0,
                "value": "25.0",
            },
        ]
    )

    store.compact_raw_before(cutoff_ts=3000.0)
    intervals = store.read_intervals(room_id="bedroom", kind="temperature")

    assert len(intervals) == 3
    assert [(row["start_ts"], row["end_ts"], row["value_text"]) for row in intervals] == [
        (1000.0, 1000.0, "24.0"),
        (2000.0, 2000.0, "24.0"),
        (2060.0, 2060.0, "25.0"),
    ]


def test_prune_raw_keeps_compacted_intervals(tmp_path):
    store = ObservationStore(str(tmp_path / "observations.sqlite"), interval_gap_seconds=300)
    store.record_many(
        [
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1000.0,
                "value": "24.0",
            },
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1060.0,
                "value": "24.0",
            },
        ]
    )

    assert store.prune_raw(cutoff_ts=2000.0) == 2
    assert store.read(room_id="bedroom") == []
    intervals = store.read_intervals(room_id="bedroom")
    assert len(intervals) == 1
    assert intervals[0]["start_ts"] == 1000.0
    assert intervals[0]["end_ts"] == 1060.0
    assert intervals[0]["report_count"] == 2


def test_store_window_summaries_persists_observed_only_buckets(tmp_path):
    store = ObservationStore(str(tmp_path / "observations.sqlite"))
    store.record_many(
        [
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1000.0,
                "value": "24.0",
                "is_primary": True,
            },
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1600.0,
                "value": "26.0",
                "is_primary": True,
            },
        ]
    )

    assert (
        store.store_window_summaries(
            room_id="bedroom",
            kind="temperature",
            bucket_seconds=300,
            start_ts=900.0,
            end_ts=1600.0,
        )
        == 2
    )
    summaries = store.read_window_summaries(room_id="bedroom", kind="temperature", bucket_seconds=300)

    assert [summary["sample_count"] for summary in summaries] == [1, 1]
    assert summaries[0]["first_value"] == 24.0
    assert summaries[0]["method"] == "observed_summary"
    assert summaries[1]["first_value"] == 26.0
    assert summaries[0]["primary_available"] is True


def test_store_window_summaries_can_materialize_empty_buckets(tmp_path):
    store = ObservationStore(str(tmp_path / "observations.sqlite"))
    store.record_many(
        [
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1000.0,
                "value": "24.0",
            },
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1600.0,
                "value": "26.0",
            },
        ]
    )

    assert (
        store.store_window_summaries(
            room_id="bedroom",
            kind="temperature",
            bucket_seconds=300,
            start_ts=900.0,
            end_ts=1600.0,
            persist_empty=True,
        )
        == 3
    )
    summaries = store.read_window_summaries(room_id="bedroom", kind="temperature", bucket_seconds=300)

    assert [summary["sample_count"] for summary in summaries] == [1, 0, 1]
    assert summaries[1]["mean_value"] is None

    store.store_window_summaries(
        room_id="bedroom",
        kind="temperature",
        bucket_seconds=300,
        start_ts=900.0,
        end_ts=1600.0,
    )
    summaries = store.read_window_summaries(room_id="bedroom", kind="temperature", bucket_seconds=300)
    assert [summary["sample_count"] for summary in summaries] == [1, 1]


def test_store_window_summaries_is_idempotent(tmp_path):
    store = ObservationStore(str(tmp_path / "observations.sqlite"))
    store.record(
        {
            "room_id": "bedroom",
            "entity_id": "sensor.temp",
            "kind": "temperature",
            "observed_at": 1000.0,
            "value": "24.0",
        }
    )

    assert store.store_window_summaries(room_id="bedroom", kind="temperature", bucket_seconds=300) == 1
    assert store.store_window_summaries(room_id="bedroom", kind="temperature", bucket_seconds=300) == 1
    assert len(store.read_window_summaries(room_id="bedroom")) == 1


def test_store_thermal_episodes_persists_valid_and_rejected_segments(tmp_path):
    store = ObservationStore(str(tmp_path / "observations.sqlite"))
    snapshots = [
        {
            "timestamp": 1000.0,
            "mode": "cooling",
            "hvac_stage": "compressor_low",
            "window_open": False,
            "temperature_source": "sensor.temp",
            "humidity_sources": "sensor.rh",
            "temperature_primary_available": True,
            "humidity_primary_available": True,
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
            "temperature_primary_available": True,
            "humidity_primary_available": True,
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
            "temperature_primary_available": True,
            "humidity_primary_available": True,
            "room_temp": 25.0,
            "room_humidity": 60.0,
            "outdoor_temp": 33.0,
        },
        {
            "timestamp": 5000.0,
            "mode": "idle",
            "window_open": False,
            "temperature_source": "sensor.temp",
            "room_temp": 25.0,
        },
    ]

    assert store.store_thermal_episodes(room_id="bedroom", rows=snapshots, max_gap_s=1200.0) == 2
    valid = store.read_thermal_episodes(room_id="bedroom", valid=True)
    rejected = store.read_thermal_episodes(room_id="bedroom", valid=False)

    assert len(valid) == 1
    assert valid[0]["temp_slope_c_per_h"] == -4.0
    assert valid[0]["humidity_slope_rh_per_h"] == -10.0
    assert valid[0]["method"] == "observed_episode"
    assert len(rejected) == 1
    assert "insufficient_samples" in rejected[0]["rejection_reasons"]
    assert "duration_too_short" in rejected[0]["rejection_reasons"]


def test_prune_derived_removes_expired_compact_rows(tmp_path):
    store = ObservationStore(str(tmp_path / "observations.sqlite"))
    store.record_many(
        [
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1000.0,
                "value": "24.0",
            },
            {
                "room_id": "bedroom",
                "entity_id": "sensor.temp",
                "kind": "temperature",
                "observed_at": 1060.0,
                "value": "24.0",
            },
        ]
    )
    store.store_window_summaries(
        room_id="bedroom",
        kind="temperature",
        bucket_seconds=300,
        start_ts=900.0,
        end_ts=1199.0,
    )
    store.store_thermal_episodes(
        room_id="bedroom",
        rows=[
            {
                "timestamp": 1000.0,
                "mode": "idle",
                "window_open": False,
                "temperature_source": "sensor.temp",
                "room_temp": 24.0,
            },
            {
                "timestamp": 2500.0,
                "mode": "idle",
                "window_open": False,
                "temperature_source": "sensor.temp",
                "room_temp": 25.0,
            },
        ],
        max_gap_s=1800.0,
    )
    store.prune_raw(cutoff_ts=1500.0)

    counts = store.prune_derived(
        interval_cutoff_ts=1500.0,
        summary_cutoff_ts=1500.0,
        episode_cutoff_ts=3000.0,
    )

    assert counts == {"intervals": 1, "summaries": 1, "episodes": 1}
    assert store.read_intervals(room_id="bedroom") == []
    assert store.read_window_summaries(room_id="bedroom") == []
    assert store.read_thermal_episodes(room_id="bedroom") == []
