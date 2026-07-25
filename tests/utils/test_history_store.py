"""Tests for the CSV-based history store."""

from __future__ import annotations

import os
import time

import pytest

from custom_components.roommind.utils.history_store import HistoryStore


@pytest.fixture
def history_dir(tmp_path):
    return str(tmp_path / "history")


def test_write_and_read(history_dir):
    """Write one record and read it back."""
    store = HistoryStore(history_dir)
    store.record(
        "living_room",
        {
            "room_temp": 21.0,
            "outdoor_temp": 5.0,
            "target_temp": 21.0,
            "mode": "idle",
            "predicted_temp": 21.1,
            "room_humidity": 52.0,
            "q_fan_mix": 0.4,
        },
    )
    rows = store.read_detail("living_room")
    assert len(rows) == 1
    assert rows[0]["room_temp"] == "21.0"
    assert rows[0]["room_humidity"] == "52.0"
    assert rows[0]["q_fan_mix"] == "0.4"


def test_multiple_rooms(history_dir):
    """Each room has separate CSV files."""
    store = HistoryStore(history_dir)
    store.record(
        "room_a",
        {"room_temp": 20.0, "outdoor_temp": 5.0, "target_temp": 21.0, "mode": "heating", "predicted_temp": 20.5},
    )
    store.record(
        "room_b",
        {"room_temp": 25.0, "outdoor_temp": 30.0, "target_temp": 23.0, "mode": "cooling", "predicted_temp": 24.0},
    )
    assert len(store.read_detail("room_a")) == 1
    assert len(store.read_detail("room_b")) == 1


def test_creates_directory(history_dir):
    """Directory is created on first write."""
    store = HistoryStore(history_dir)
    store.record(
        "test_room",
        {"room_temp": 20.0, "outdoor_temp": 5.0, "target_temp": 21.0, "mode": "idle", "predicted_temp": 20.0},
    )
    assert os.path.isdir(history_dir)


def test_read_empty_room(history_dir):
    """Reading nonexistent room returns empty list."""
    store = HistoryStore(history_dir)
    rows = store.read_detail("nonexistent")
    assert rows == []


def test_remove_room(history_dir):
    """remove_room deletes all files for that room."""
    store = HistoryStore(history_dir)
    store.record(
        "room_a", {"room_temp": 20.0, "outdoor_temp": 5.0, "target_temp": 21.0, "mode": "idle", "predicted_temp": 20.0}
    )
    store.remove_room("room_a")
    assert store.read_detail("room_a") == []


def test_multiple_records(history_dir):
    """Multiple records are stored and read back."""
    store = HistoryStore(history_dir)
    base = time.time()
    for i in range(10):
        store.record(
            "room_a",
            {
                "room_temp": 20.0 + i * 0.1,
                "outdoor_temp": 5.0,
                "target_temp": 21.0,
                "mode": "heating",
                "predicted_temp": 20.0 + i * 0.1,
            },
            timestamp=base + i * 60,
        )
    detail_rows = store.read_detail("room_a")
    assert len(detail_rows) == 10


def test_window_open_in_csv(history_dir):
    """window_open field is written and read correctly."""
    store = HistoryStore(history_dir)
    store.record(
        "room_a",
        {
            "room_temp": 20.0,
            "outdoor_temp": 5.0,
            "target_temp": 21.0,
            "mode": "idle",
            "predicted_temp": 20.0,
            "window_open": True,
        },
    )
    store.record(
        "room_a",
        {
            "room_temp": 20.0,
            "outdoor_temp": 5.0,
            "target_temp": 21.0,
            "mode": "idle",
            "predicted_temp": 20.0,
            "window_open": False,
        },
    )
    rows = store.read_detail("room_a")
    assert len(rows) == 2
    assert rows[0]["window_open"] == "True"
    assert rows[1]["window_open"] == "False"


def test_downsample_preserves_window_open(history_dir):
    """_downsample marks a bucket open if any sampled row is open."""
    store = HistoryStore(history_dir)
    rows = [
        {
            "timestamp": "1000",
            "room_temp": "20.0",
            "outdoor_temp": "5.0",
            "target_temp": "21.0",
            "mode": "idle",
            "predicted_temp": "20.0",
            "window_open": "True",
        },
        {
            "timestamp": "1060",
            "room_temp": "20.0",
            "outdoor_temp": "5.0",
            "target_temp": "21.0",
            "mode": "idle",
            "predicted_temp": "20.0",
            "window_open": "False",
        },
        {
            "timestamp": "1500",
            "room_temp": "21.0",
            "outdoor_temp": "5.0",
            "target_temp": "21.0",
            "mode": "heating",
            "predicted_temp": "21.0",
            "window_open": "False",
        },
    ]
    result = store._downsample(rows, bucket_seconds=300)
    # Two buckets: 0-300s (ts 1000, 1060) and 300-600s (ts 1500)
    assert len(result) == 2
    assert result[0]["window_open"] is True
    assert result[1]["window_open"] is False


def test_rotate_moves_old_to_history(history_dir):
    """Rotation moves old detail rows to history file."""
    store = HistoryStore(history_dir)
    now = time.time()
    # Write rows that are "old" (> 48h ago)
    old_ts = now - 50 * 3600  # 50 hours ago
    for i in range(5):
        store.record(
            "room_a",
            {
                "room_temp": 20.0 + i * 0.1,
                "outdoor_temp": 5.0,
                "target_temp": 21.0,
                "mode": "heating",
                "predicted_temp": 20.0,
            },
            timestamp=old_ts + i * 60,
        )
    # Write some recent rows
    for i in range(3):
        store.record(
            "room_a",
            {
                "room_temp": 21.0,
                "outdoor_temp": 5.0,
                "target_temp": 21.0,
                "mode": "idle",
                "predicted_temp": 21.0,
            },
            timestamp=now + i * 60,
        )

    store.rotate("room_a")

    detail = store.read_detail("room_a")
    history = store.read_history("room_a")
    assert len(detail) == 3  # only recent rows remain
    assert len(history) >= 1  # old rows downsampled to history


# ---------------------------------------------------------------------------
# Timestamp-based filtering
# ---------------------------------------------------------------------------


def test_read_detail_with_start_ts(history_dir):
    """start_ts filters out rows before the given timestamp."""
    store = HistoryStore(history_dir)
    for i in range(5):
        store.record(
            "room_a",
            {
                "room_temp": 20.0,
                "outdoor_temp": 5.0,
                "target_temp": 21.0,
                "mode": "idle",
                "predicted_temp": 20.0,
            },
            timestamp=1000.0 + i * 100,
        )

    rows = store.read_detail("room_a", start_ts=1200.0)
    assert len(rows) == 3  # ts 1200, 1300, 1400


def test_read_detail_with_end_ts(history_dir):
    """end_ts filters out rows after the given timestamp."""
    store = HistoryStore(history_dir)
    for i in range(5):
        store.record(
            "room_a",
            {
                "room_temp": 20.0,
                "outdoor_temp": 5.0,
                "target_temp": 21.0,
                "mode": "idle",
                "predicted_temp": 20.0,
            },
            timestamp=1000.0 + i * 100,
        )

    rows = store.read_detail("room_a", end_ts=1200.0)
    assert len(rows) == 3  # ts 1000, 1100, 1200


def test_read_detail_with_start_and_end_ts(history_dir):
    """Both start_ts and end_ts filter rows to a range."""
    store = HistoryStore(history_dir)
    for i in range(5):
        store.record(
            "room_a",
            {
                "room_temp": 20.0,
                "outdoor_temp": 5.0,
                "target_temp": 21.0,
                "mode": "idle",
                "predicted_temp": 20.0,
            },
            timestamp=1000.0 + i * 100,
        )

    rows = store.read_detail("room_a", start_ts=1100.0, end_ts=1300.0)
    assert len(rows) == 3  # ts 1100, 1200, 1300


def test_read_detail_start_ts_overrides_max_age(history_dir):
    """start_ts takes precedence over max_age."""
    store = HistoryStore(history_dir)
    # Write rows: 2 old, 3 recent
    for i in range(5):
        store.record(
            "room_a",
            {
                "room_temp": 20.0,
                "outdoor_temp": 5.0,
                "target_temp": 21.0,
                "mode": "idle",
                "predicted_temp": 20.0,
            },
            timestamp=1000.0 + i * 100,
        )

    # start_ts=1200 should override max_age and return rows from 1200+
    rows = store.read_detail("room_a", start_ts=1200.0, max_age=99999999)
    assert len(rows) == 3


# ---------------------------------------------------------------------------
# Corrupt timestamp handling
# ---------------------------------------------------------------------------


def test_read_detail_skips_corrupt_timestamps(history_dir):
    """Rows with non-numeric timestamps are silently skipped."""
    store = HistoryStore(history_dir)
    store.record(
        "room_a",
        {"room_temp": 20.0, "outdoor_temp": 5.0, "target_temp": 21.0, "mode": "idle", "predicted_temp": 20.0},
        timestamp=1000.0,
    )

    # Manually write a corrupt row
    path = store._detail_path("room_a")
    with open(path, "a") as f:
        f.write("bad_ts,20.0,5.0,21.0,idle,20.0,,,,,\n")

    store.record(
        "room_a",
        {"room_temp": 21.0, "outdoor_temp": 5.0, "target_temp": 21.0, "mode": "idle", "predicted_temp": 21.0},
        timestamp=2000.0,
    )

    # With filtering (max_age triggers timestamp parsing)
    rows = store.read_detail("room_a", start_ts=500.0)
    # Should have 2 valid rows, corrupt one skipped
    assert len(rows) == 2


def test_rotate_skips_corrupt_timestamps(history_dir):
    """Rotate silently skips rows with corrupt timestamps."""
    store = HistoryStore(history_dir)
    now = time.time()
    store.record(
        "room_a",
        {"room_temp": 20.0, "outdoor_temp": 5.0, "target_temp": 21.0, "mode": "idle", "predicted_temp": 20.0},
        timestamp=now,
    )

    # Write a corrupt row
    path = store._detail_path("room_a")
    with open(path, "a") as f:
        f.write("not_a_number,20.0,5.0,21.0,idle,20.0,,,,,\n")

    # Should not raise
    store.rotate("room_a")
    rows = store.read_detail("room_a")
    assert len(rows) == 1  # only the valid row survives
    assert rows[0]["room_temp"] == "20.0"


# ---------------------------------------------------------------------------
# Downsample edge cases
# ---------------------------------------------------------------------------


def test_downsample_empty(history_dir):
    """Empty input returns empty output."""
    store = HistoryStore(history_dir)
    assert store._downsample([], bucket_seconds=300) == []


def test_downsample_non_numeric_values(history_dir):
    """Non-numeric field values produce empty string in output."""
    store = HistoryStore(history_dir)
    rows = [
        {
            "timestamp": "1000",
            "room_temp": "abc",
            "outdoor_temp": "5.0",
            "target_temp": "21.0",
            "mode": "idle",
            "predicted_temp": "20.0",
            "window_open": "",
            "heating_power": "",
            "solar_irradiance": "",
        },
    ]
    result = store._downsample(rows, bucket_seconds=300)
    assert len(result) == 1
    assert result[0]["room_temp"] == ""  # non-numeric → empty
    assert result[0]["outdoor_temp"] == 5.0


# ---------------------------------------------------------------------------
# safe_timestamp edge cases
# ---------------------------------------------------------------------------


def test_safe_ts_valid():
    """Valid timestamp returns float."""
    assert HistoryStore.safe_timestamp({"timestamp": "1234.5"}) == 1234.5


def test_safe_ts_missing_key():
    """Missing timestamp key returns 0.0."""
    assert HistoryStore.safe_timestamp({}) == 0.0


def test_safe_ts_non_numeric():
    """Non-numeric timestamp returns 0.0."""
    assert HistoryStore.safe_timestamp({"timestamp": "abc"}) == 0.0


def test_safe_ts_none_value():
    """None timestamp returns 0.0."""
    assert HistoryStore.safe_timestamp({"timestamp": None}) == 0.0


def test_rotate_trims_old_history(history_dir):
    """rotate() should trim history records older than HISTORY_MAX_AGE."""
    import time as _time

    from custom_components.roommind.utils.history_store import HISTORY_MAX_AGE

    store = HistoryStore(history_dir)
    # Write one very old record directly into history
    old_ts = _time.time() - HISTORY_MAX_AGE - 1000
    store._append_history("room1", [{"timestamp": str(old_ts), "room_temp": "20.0"}])
    assert len(store.read_history("room1")) == 1
    store.rotate("room1")
    assert len(store.read_history("room1")) == 0


# ---------------------------------------------------------------------------
# device_setpoint field
# ---------------------------------------------------------------------------


def test_device_setpoint_in_csv(history_dir):
    """device_setpoint is written to CSV and read back correctly."""
    store = HistoryStore(history_dir)
    store.record(
        "room_a",
        {
            "room_temp": 20.0,
            "outdoor_temp": 5.0,
            "target_temp": 21.0,
            "mode": "heating",
            "predicted_temp": 20.5,
            "device_setpoint": 24.5,
        },
    )
    rows = store.read_detail("room_a")
    assert len(rows) == 1
    assert rows[0]["device_setpoint"] == "24.5"


def test_device_setpoint_missing_defaults_empty(history_dir):
    """Missing device_setpoint defaults to empty string in CSV."""
    store = HistoryStore(history_dir)
    store.record(
        "room_a",
        {
            "room_temp": 20.0,
            "outdoor_temp": 5.0,
            "target_temp": 21.0,
            "mode": "idle",
            "predicted_temp": 20.0,
        },
    )
    rows = store.read_detail("room_a")
    assert len(rows) == 1
    assert rows[0]["device_setpoint"] == ""


def test_environmental_observation_fields_in_csv(history_dir):
    """Humidity, airflow, comfort, and control-state fields are written."""
    store = HistoryStore(history_dir)
    store.record(
        "room_a",
        {
            "room_temp": 25.0,
            "outdoor_temp": 31.0,
            "target_temp": 24.0,
            "mode": "cooling",
            "room_humidity": 63.0,
            "outdoor_humidity": 78.0,
            "perceived_temp": 26.4,
            "q_fan_mix": 0.55,
            "q_vent": 0.2,
            "airflow_ach": 1.6,
            "airflow_plan_level": 0.7,
            "airflow_mix_plan_level": 0.8,
            "airflow_vent_plan_level": 0.3,
            "night_mode_active": True,
            "rapid_recovery_active": True,
            "hvac_stage": "compressor",
            "sensor_conflict": 0.25,
            "mold_surface_rh": 82.0,
            "mold_risk_level": "warning",
            "effective_control_target": "perceived_temperature",
            "heat_target": 21.0,
            "cool_target": 24.0,
            "override_active": True,
            "override_type": "custom",
            "active_heat_sources": "secondary",
            "temperature_source": "sensor.primary_temp",
            "temperature_source_count": 2,
            "temperature_primary_available": True,
            "humidity_sources": "sensor.primary_humidity|sensor.aux_humidity",
            "humidity_source_count": 2,
            "humidity_primary_available": True,
        },
        timestamp=1000.0,
    )

    rows = store.read_detail("room_a")
    assert rows[0]["room_humidity"] == "63.0"
    assert rows[0]["outdoor_humidity"] == "78.0"
    assert rows[0]["perceived_temp"] == "26.4"
    assert rows[0]["q_fan_mix"] == "0.55"
    assert rows[0]["airflow_ach"] == "1.6"
    assert rows[0]["night_mode_active"] == "True"
    assert rows[0]["hvac_stage"] == "compressor"
    assert rows[0]["mold_risk_level"] == "warning"
    assert rows[0]["effective_control_target"] == "perceived_temperature"
    assert rows[0]["override_type"] == "custom"
    assert rows[0]["active_heat_sources"] == "secondary"
    assert rows[0]["temperature_source"] == "sensor.primary_temp"
    assert rows[0]["temperature_source_count"] == "2"
    assert rows[0]["temperature_primary_available"] == "True"
    assert rows[0]["humidity_sources"] == "sensor.primary_humidity|sensor.aux_humidity"
    assert rows[0]["humidity_source_count"] == "2"
    assert rows[0]["humidity_primary_available"] == "True"


def test_migrate_header_rewrites_old_format(history_dir):
    """CSV with outdated header is rewritten with current DETAIL_FIELDS."""
    from custom_components.roommind.utils.history_store import DETAIL_FIELDS

    store = HistoryStore(history_dir)
    os.makedirs(history_dir, exist_ok=True)
    path = store._detail_path("room_a")

    old_fields = ["timestamp", "room_temp", "outdoor_temp", "target_temp", "mode"]
    import csv

    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=old_fields)
        writer.writeheader()
        writer.writerow(
            {"timestamp": "1000", "room_temp": "20.0", "outdoor_temp": "5.0", "target_temp": "21.0", "mode": "heating"}
        )

    store.record(
        "room_a",
        {"room_temp": 22.0, "outdoor_temp": 6.0, "target_temp": 21.0, "mode": "idle", "predicted_temp": 21.5},
        timestamp=2000.0,
    )

    rows = store.read_detail("room_a")
    assert len(rows) == 2
    assert rows[0]["room_temp"] == "20.0"
    assert rows[0].get("predicted_temp") == ""
    assert rows[1]["room_temp"] == "22.0"

    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        assert reader.fieldnames == DETAIL_FIELDS


def test_migrate_header_noop_when_current(history_dir):
    """CSV with current header is not rewritten."""
    store = HistoryStore(history_dir)
    store.record(
        "room_a",
        {"room_temp": 20.0, "outdoor_temp": 5.0, "target_temp": 21.0, "mode": "idle", "predicted_temp": 20.0},
        timestamp=1000.0,
    )
    store.record(
        "room_a",
        {"room_temp": 21.0, "outdoor_temp": 5.0, "target_temp": 21.0, "mode": "idle", "predicted_temp": 21.0},
        timestamp=2000.0,
    )
    rows = store.read_detail("room_a")
    assert len(rows) == 2


def test_migrate_header_handles_corrupt_file(history_dir):
    """Migration silently handles corrupt CSV files."""
    store = HistoryStore(history_dir)
    os.makedirs(history_dir, exist_ok=True)
    path = store._detail_path("room_a")

    with open(path, "w") as f:
        f.write("\x00\x00\x00invalid csv content\n")

    store.record(
        "room_a",
        {"room_temp": 20.0, "outdoor_temp": 5.0, "target_temp": 21.0, "mode": "idle", "predicted_temp": 20.0},
        timestamp=1000.0,
    )
    rows = store.read_detail("room_a")
    assert len(rows) >= 1


def test_read_detail_with_max_age(history_dir):
    """max_age filters out rows older than the specified seconds."""
    store = HistoryStore(history_dir)
    now = time.time()
    store.record(
        "room_a",
        {"room_temp": 20.0, "outdoor_temp": 5.0, "target_temp": 21.0, "mode": "idle", "predicted_temp": 20.0},
        timestamp=now - 7200,
    )
    store.record(
        "room_a",
        {"room_temp": 21.0, "outdoor_temp": 5.0, "target_temp": 21.0, "mode": "idle", "predicted_temp": 21.0},
        timestamp=now - 1800,
    )
    store.record(
        "room_a",
        {"room_temp": 22.0, "outdoor_temp": 5.0, "target_temp": 21.0, "mode": "idle", "predicted_temp": 22.0},
        timestamp=now - 60,
    )

    rows = store.read_detail("room_a", max_age=3600)
    assert len(rows) == 2
    assert rows[0]["room_temp"] == "21.0"
    assert rows[1]["room_temp"] == "22.0"


def test_downsample_averages_device_setpoint(history_dir):
    """_downsample averages device_setpoint like other numeric control outputs."""
    store = HistoryStore(history_dir)
    rows = [
        {
            "timestamp": "1000",
            "room_temp": "20.0",
            "outdoor_temp": "5.0",
            "target_temp": "21.0",
            "mode": "heating",
            "predicted_temp": "20.0",
            "window_open": "",
            "heating_power": "80",
            "solar_irradiance": "",
            "blind_position": "",
            "device_setpoint": "24.0",
        },
        {
            "timestamp": "1060",
            "room_temp": "20.0",
            "outdoor_temp": "5.0",
            "target_temp": "21.0",
            "mode": "heating",
            "predicted_temp": "20.0",
            "window_open": "",
            "heating_power": "80",
            "solar_irradiance": "",
            "blind_position": "",
            "device_setpoint": "26.0",
        },
    ]
    result = store._downsample(rows, bucket_seconds=300)
    assert len(result) == 1
    assert result[0]["device_setpoint"] == 25.0


def test_downsample_preserves_environmental_observations(history_dir):
    """_downsample handles environmental fields by type."""
    store = HistoryStore(history_dir)
    rows = [
        {
            "timestamp": "1000",
            "room_temp": "25.0",
            "outdoor_temp": "30.0",
            "target_temp": "24.0",
            "mode": "cooling",
            "room_humidity": "60",
            "outdoor_humidity": "80",
            "perceived_temp": "26",
            "q_fan_mix": "0.4",
            "q_vent": "0.2",
            "airflow_ach": "1.2",
            "airflow_plan_level": "0.5",
            "night_mode_active": "False",
            "rapid_recovery_active": "False",
            "hvac_stage": "fan",
            "sensor_conflict": "0.1",
            "mold_surface_rh": "70",
            "mold_risk_level": "ok",
            "override_active": "False",
            "override_type": "",
            "active_heat_sources": "primary",
            "temperature_source": "sensor.primary_temp",
            "temperature_source_count": "1",
            "temperature_primary_available": "True",
            "humidity_sources": "sensor.primary_humidity",
            "humidity_source_count": "1",
            "humidity_primary_available": "True",
        },
        {
            "timestamp": "1060",
            "room_temp": "24.0",
            "outdoor_temp": "30.0",
            "target_temp": "24.0",
            "mode": "cooling",
            "room_humidity": "64",
            "outdoor_humidity": "82",
            "perceived_temp": "25",
            "q_fan_mix": "0.8",
            "q_vent": "0.4",
            "airflow_ach": "1.8",
            "airflow_plan_level": "0.7",
            "night_mode_active": "True",
            "rapid_recovery_active": "True",
            "hvac_stage": "compressor",
            "sensor_conflict": "0.3",
            "mold_surface_rh": "74",
            "mold_risk_level": "warning",
            "override_active": "True",
            "override_type": "custom",
            "active_heat_sources": "secondary",
            "temperature_source": "sensor.aux_temp",
            "temperature_source_count": "2",
            "temperature_primary_available": "False",
            "humidity_sources": "sensor.aux_humidity",
            "humidity_source_count": "2",
            "humidity_primary_available": "False",
        },
    ]

    result = store._downsample(rows, bucket_seconds=300)
    assert len(result) == 1
    assert result[0]["room_humidity"] == 62.0
    assert result[0]["outdoor_humidity"] == 81.0
    assert result[0]["perceived_temp"] == 25.5
    assert result[0]["q_fan_mix"] == 0.6
    assert result[0]["q_vent"] == 0.3
    assert result[0]["airflow_ach"] == 1.5
    assert result[0]["night_mode_active"] is True
    assert result[0]["rapid_recovery_active"] is True
    assert result[0]["hvac_stage"] == "fan"
    assert result[0]["sensor_conflict"] == 0.2
    assert result[0]["mold_surface_rh"] == 72.0
    assert result[0]["mold_risk_level"] == "ok"
    assert result[0]["override_active"] is True
    assert result[0]["override_type"] == "custom"
    assert result[0]["active_heat_sources"] == "primary"
    assert result[0]["temperature_source"] == "sensor.primary_temp"
    assert result[0]["temperature_source_count"] == 1.5
    assert result[0]["temperature_primary_available"] is True
    assert result[0]["humidity_sources"] == "sensor.primary_humidity"
    assert result[0]["humidity_source_count"] == 1.5
    assert result[0]["humidity_primary_available"] is True
