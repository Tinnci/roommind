"""Read-only Recorder write attribution; no purge, vacuum, or configuration changes."""

from __future__ import annotations

import argparse
import json
import sqlite3
import time
from collections import Counter
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

RECEIPT_ATTRIBUTES = frozenset(
    {
        "observed_at",
        "hvac_mode_observed_at",
        "hvac_action_observed_at",
        "current_temperature_observed_at",
        "current_humidity_observed_at",
    }
)


def audit_recorder(
    database: Path, *, start: float, end: float, platforms: dict[str, str] | None = None
) -> dict[str, Any]:
    """Count changes using each row's real predecessor, including before the window."""
    entities: dict[str, dict[str, Any]] = {}
    with closing(sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True, timeout=5)) as conn:
        conn.execute("PRAGMA query_only=ON")
        rows = conn.execute(
            """
            SELECT m.entity_id, s.state, a.shared_attrs, old.state, oa.shared_attrs,
                   old.state_id
            FROM states s JOIN states_meta m USING (metadata_id)
            LEFT JOIN state_attributes a ON s.attributes_id = a.attributes_id
            LEFT JOIN states old ON s.old_state_id = old.state_id
            LEFT JOIN state_attributes oa ON old.attributes_id = oa.attributes_id
            WHERE s.last_updated_ts >= ? AND s.last_updated_ts < ?
            ORDER BY s.last_updated_ts, s.state_id
            """,
            (start, end),
        )
        for entity_id, state, attrs_json, old_state, old_attrs_json, old_id in rows:
            entity = entities.setdefault(
                entity_id,
                {
                    "entity_id": entity_id,
                    "platform": (platforms or {}).get(entity_id),
                    "rows": 0,
                    "unchanged_value_rows": 0,
                    "receipt_only_rows": 0,
                    "unchanged_recorded_rows": 0,
                    "changed_attribute_counts": Counter(),
                },
            )
            entity["rows"] += 1
            if old_id is None or state != old_state:
                continue
            entity["unchanged_value_rows"] += 1
            attrs = json.loads(attrs_json or "{}")
            old_attrs = json.loads(old_attrs_json or "{}")
            changed = {
                key
                for key in attrs.keys() | old_attrs.keys()
                if key not in attrs or key not in old_attrs or attrs[key] != old_attrs[key]
            }
            entity["changed_attribute_counts"].update(changed)
            if not changed:
                entity["unchanged_recorded_rows"] += 1
            elif changed <= RECEIPT_ATTRIBUTES:
                entity["receipt_only_rows"] += 1
        storage = {
            key: conn.execute(f"PRAGMA {key}").fetchone()[0]
            for key in ("page_size", "page_count", "freelist_count", "journal_mode")
        }
    return {
        "start": datetime.fromtimestamp(start, UTC).isoformat(),
        "end": datetime.fromtimestamp(end, UTC).isoformat(),
        "window_s": end - start,
        "state_rows": sum(entity["rows"] for entity in entities.values()),
        "receipt_only_rows": sum(entity["receipt_only_rows"] for entity in entities.values()),
        "entities": sorted(entities.values(), key=lambda entity: (-entity["rows"], entity["entity_id"])),
        "storage": storage,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("--registry", type=Path, help="Optional HA entity registry for platform attribution")
    parser.add_argument("--hours", type=float, default=1)
    parser.add_argument("--end", type=float, default=None, help="Window end as a Unix timestamp")
    args = parser.parse_args()
    if args.hours <= 0:
        parser.error("--hours must be positive")
    platforms = None
    if args.registry:
        registry = json.loads(args.registry.read_text())["data"]["entities"]
        platforms = {entry["entity_id"]: entry["platform"] for entry in registry}
    end = time.time() if args.end is None else args.end
    print(
        json.dumps(audit_recorder(args.database, start=end - args.hours * 3600, end=end, platforms=platforms), indent=2)
    )


if __name__ == "__main__":
    main()
