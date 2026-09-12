"""Recorder attribution must not classify changing climate attributes as noise."""

import json
import sqlite3
from contextlib import closing

from tools.audit_recorder import audit_recorder


def test_audit_preserves_physical_changes_and_uses_registry_after_rename(tmp_path):
    database = tmp_path / "recorder.sqlite"
    with closing(sqlite3.connect(database)) as conn:
        conn.executescript(
            """
            CREATE TABLE states_meta(metadata_id INTEGER PRIMARY KEY, entity_id TEXT);
            CREATE TABLE state_attributes(attributes_id INTEGER PRIMARY KEY, shared_attrs TEXT);
            CREATE TABLE states(state_id INTEGER PRIMARY KEY, metadata_id INTEGER, state TEXT,
                                attributes_id INTEGER, old_state_id INTEGER, last_updated_ts REAL);
            INSERT INTO states_meta VALUES (1, 'climate.renamed');
            INSERT INTO states_meta VALUES (2, 'sensor.renamed');
            """
        )
        attrs = [
            {"temperature": 25.0, "observed_at": "first"},
            {"temperature": 25.0, "observed_at": "second"},
            {"temperature": 25.01, "observed_at": "third"},
        ]
        conn.executemany("INSERT INTO state_attributes VALUES (?, ?)", enumerate(map(json.dumps, attrs), 1))
        conn.executemany(
            "INSERT INTO states VALUES (?, ?, ?, ?, ?, ?)",
            [
                (1, 1, "cool", 1, None, 0),
                (2, 1, "cool", 2, 1, 10),
                (3, 1, "cool", 3, 2, 20),
                (4, 2, "25.0", 1, None, 0),
                (5, 2, "25.01", 2, 4, 30),
                (6, 2, "25.01", 2, 5, 40),
            ],
        )
        conn.commit()
    before = database.read_bytes()

    result = audit_recorder(database, start=5, end=45, platforms={"climate.renamed": "tcl_udp_ac"})

    assert result["state_rows"] == 4
    assert result["receipt_only_rows"] == 1
    climate, sensor = result["entities"]
    assert climate["platform"] == "tcl_udp_ac"
    assert climate["changed_attribute_counts"] == {"temperature": 1, "observed_at": 2}
    assert sensor["receipt_only_rows"] == 0
    assert sensor["unchanged_recorded_rows"] == 1
    assert database.read_bytes() == before
