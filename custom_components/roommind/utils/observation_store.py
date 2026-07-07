"""SQLite store for immutable raw RoomMind observations."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from collections.abc import Iterable
from contextlib import closing
from typing import Any

from .thermal_analysis import build_observed_windows, build_thermal_episodes


class ObservationStore:
    """Append-only raw observation store with bounded retention.

    Raw observations preserve source values as received. Numeric values are
    duplicated into ``value_real`` only for efficient range queries; the source
    string remains in ``value_text``.
    """

    def __init__(
        self,
        db_path: str,
        *,
        raw_retention_days: int = 14,
        interval_retention_days: int = 365,
        summary_retention_days: int = 365,
        episode_retention_days: int = 365,
        interval_gap_seconds: int = 10 * 60,
    ) -> None:
        self._db_path = db_path
        self._raw_retention_days = raw_retention_days
        self._interval_retention_days = interval_retention_days
        self._summary_retention_days = summary_retention_days
        self._episode_retention_days = episode_retention_days
        self._interval_gap_seconds = interval_gap_seconds
        self._schema_ready = False

    def record(self, observation: dict[str, Any]) -> bool:
        """Insert one observation, returning True when a new row was stored."""
        return self.record_many([observation]) == 1

    def record_many(self, observations: Iterable[dict[str, Any]]) -> int:
        """Insert observations, ignoring exact duplicates by fingerprint."""
        rows: list[tuple[Any, ...]] = []
        for observation in observations:
            row = self._row_from_observation(observation)
            if row is not None:
                rows.append(row)
        if not rows:
            return 0
        with closing(self._connect()) as conn:
            before = conn.total_changes
            conn.executemany(
                """
                INSERT OR IGNORE INTO raw_observations (
                    fingerprint, room_id, entity_id, kind, observed_at, ingested_at,
                    state, value_text, value_real, unit, source, is_primary, quality,
                    attrs_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            conn.commit()
            return conn.total_changes - before

    def read(
        self,
        *,
        room_id: str | None = None,
        entity_id: str | None = None,
        kind: str | None = None,
        start_ts: float | None = None,
        end_ts: float | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """Read raw observations ordered by source observation time."""
        clauses: list[str] = []
        params: list[Any] = []
        if room_id is not None:
            clauses.append("room_id = ?")
            params.append(room_id)
        if entity_id is not None:
            clauses.append("entity_id = ?")
            params.append(entity_id)
        if kind is not None:
            clauses.append("kind = ?")
            params.append(kind)
        if start_ts is not None:
            clauses.append("observed_at >= ?")
            params.append(start_ts)
        if end_ts is not None:
            clauses.append("observed_at <= ?")
            params.append(end_ts)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"""
            SELECT observation_id, fingerprint, room_id, entity_id, kind,
                   observed_at, ingested_at, state, value_text, value_real, unit,
                   source, is_primary, quality, attrs_json
            FROM raw_observations
            {where}
            ORDER BY observed_at, observation_id
        """
        if limit is not None:
            sql += " LIMIT ?"
            params.append(limit)
        with closing(self._connect()) as conn:
            return [self._dict_from_row(row) for row in conn.execute(sql, params)]

    def prune_raw(self, *, cutoff_ts: float | None = None) -> int:
        """Compact then delete raw observations older than the retention window."""
        if cutoff_ts is None:
            cutoff_ts = time.time() - self._raw_retention_days * 24 * 3600
        self.compact_raw_before(cutoff_ts=cutoff_ts)
        with closing(self._connect()) as conn:
            cursor = conn.execute("DELETE FROM raw_observations WHERE observed_at < ?", (cutoff_ts,))
            conn.commit()
            return cursor.rowcount

    def prune_derived(
        self,
        *,
        interval_cutoff_ts: float | None = None,
        summary_cutoff_ts: float | None = None,
        episode_cutoff_ts: float | None = None,
    ) -> dict[str, int]:
        """Delete derived rows outside their longer retention windows."""
        now = time.time()
        if interval_cutoff_ts is None:
            interval_cutoff_ts = now - self._interval_retention_days * 24 * 3600
        if summary_cutoff_ts is None:
            summary_cutoff_ts = now - self._summary_retention_days * 24 * 3600
        if episode_cutoff_ts is None:
            episode_cutoff_ts = now - self._episode_retention_days * 24 * 3600

        with closing(self._connect()) as conn:
            interval_cursor = conn.execute(
                "DELETE FROM observation_intervals WHERE end_ts < ?",
                (interval_cutoff_ts,),
            )
            summary_cursor = conn.execute(
                "DELETE FROM observed_window_summaries WHERE end_ts < ?",
                (summary_cutoff_ts,),
            )
            episode_cursor = conn.execute(
                "DELETE FROM thermal_episodes WHERE end_ts < ?",
                (episode_cutoff_ts,),
            )
            conn.commit()
            return {
                "intervals": interval_cursor.rowcount,
                "summaries": summary_cursor.rowcount,
                "episodes": episode_cursor.rowcount,
            }

    def compact_raw_before(self, *, cutoff_ts: float) -> int:
        """Store compact observed intervals for raw rows before cutoff_ts."""
        with closing(self._connect()) as conn:
            rows = list(
                conn.execute(
                    """
                    SELECT observation_id, fingerprint, room_id, entity_id, kind,
                           observed_at, ingested_at, state, value_text, value_real,
                           unit, source, is_primary, quality, attrs_json
                    FROM raw_observations
                    WHERE observed_at < ?
                    ORDER BY room_id, entity_id, kind, observed_at, observation_id
                    """,
                    (cutoff_ts,),
                )
            )
            intervals = self._interval_rows(rows)
            if not intervals:
                return 0
            before = conn.total_changes
            conn.executemany(
                """
                INSERT OR REPLACE INTO observation_intervals (
                    interval_fingerprint, room_id, entity_id, kind, start_ts, end_ts,
                    first_observed_at, last_observed_at, first_ingested_at,
                    last_ingested_at, state, value_text, value_real, unit, source,
                    is_primary, quality_min, quality_max, quality_avg, attrs_json,
                    report_count, max_gap_s, method
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                intervals,
            )
            conn.commit()
            return conn.total_changes - before

    def read_intervals(
        self,
        *,
        room_id: str | None = None,
        entity_id: str | None = None,
        kind: str | None = None,
        start_ts: float | None = None,
        end_ts: float | None = None,
    ) -> list[dict[str, Any]]:
        """Read compact observed intervals ordered by interval start."""
        clauses: list[str] = []
        params: list[Any] = []
        if room_id is not None:
            clauses.append("room_id = ?")
            params.append(room_id)
        if entity_id is not None:
            clauses.append("entity_id = ?")
            params.append(entity_id)
        if kind is not None:
            clauses.append("kind = ?")
            params.append(kind)
        if start_ts is not None:
            clauses.append("end_ts >= ?")
            params.append(start_ts)
        if end_ts is not None:
            clauses.append("start_ts <= ?")
            params.append(end_ts)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"""
            SELECT interval_id, interval_fingerprint, room_id, entity_id, kind,
                   start_ts, end_ts, first_observed_at, last_observed_at,
                   first_ingested_at, last_ingested_at, state, value_text,
                   value_real, unit, source, is_primary, quality_min,
                   quality_max, quality_avg, attrs_json, report_count,
                   max_gap_s, method
            FROM observation_intervals
            {where}
            ORDER BY start_ts, interval_id
        """
        with closing(self._connect()) as conn:
            return [self._interval_dict_from_row(row) for row in conn.execute(sql, params)]

    def store_window_summaries(
        self,
        *,
        room_id: str,
        kind: str,
        bucket_seconds: int,
        start_ts: float | None = None,
        end_ts: float | None = None,
        persist_empty: bool = False,
    ) -> int:
        """Build and persist observed-only window summaries from raw observations."""
        observations = [
            self._observation_for_summary(row)
            for row in self.read(room_id=room_id, kind=kind, start_ts=start_ts, end_ts=end_ts)
        ]
        if not observations:
            if not persist_empty:
                return self._delete_empty_window_summaries(
                    room_id=room_id,
                    kind=kind,
                    bucket_seconds=bucket_seconds,
                    start_ts=start_ts,
                    end_ts=end_ts,
                )
            return 0
        summaries = build_observed_windows(
            observations,
            bucket_seconds=bucket_seconds,
            start_ts=start_ts,
            end_ts=end_ts,
        )
        if not persist_empty:
            summaries = [summary for summary in summaries if summary["sample_count"] > 0]
        rows = [self._window_summary_row(room_id, kind, bucket_seconds, summary) for summary in summaries]
        with closing(self._connect()) as conn:
            before = conn.total_changes
            if not persist_empty:
                self._delete_empty_window_summaries(
                    room_id=room_id,
                    kind=kind,
                    bucket_seconds=bucket_seconds,
                    start_ts=start_ts,
                    end_ts=end_ts,
                    conn=conn,
                )
            conn.executemany(
                """
                INSERT OR REPLACE INTO observed_window_summaries (
                    summary_fingerprint, room_id, kind, bucket_seconds, start_ts,
                    end_ts, sample_count, numeric_sample_count, first_observed_ts,
                    last_observed_ts, first_value, last_value, min_value, max_value,
                    mean_value, max_gap_s, observed_span_s, coverage_ratio,
                    source_count, source_changed, primary_available, method,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            conn.commit()
            return conn.total_changes - before

    def _delete_empty_window_summaries(
        self,
        *,
        room_id: str,
        kind: str,
        bucket_seconds: int,
        start_ts: float | None = None,
        end_ts: float | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> int:
        """Delete materialized empty buckets; absence represents no samples."""
        clauses = [
            "room_id = ?",
            "kind = ?",
            "bucket_seconds = ?",
            "sample_count = 0",
        ]
        params: list[Any] = [room_id, kind, bucket_seconds]
        sql = f"DELETE FROM observed_window_summaries WHERE {' AND '.join(clauses)}"
        if conn is not None:
            return conn.execute(sql, params).rowcount
        with closing(self._connect()) as own_conn:
            cursor = own_conn.execute(sql, params)
            own_conn.commit()
            return cursor.rowcount

    def read_window_summaries(
        self,
        *,
        room_id: str | None = None,
        kind: str | None = None,
        bucket_seconds: int | None = None,
        start_ts: float | None = None,
        end_ts: float | None = None,
    ) -> list[dict[str, Any]]:
        """Read persisted observed-only window summaries."""
        clauses: list[str] = []
        params: list[Any] = []
        if room_id is not None:
            clauses.append("room_id = ?")
            params.append(room_id)
        if kind is not None:
            clauses.append("kind = ?")
            params.append(kind)
        if bucket_seconds is not None:
            clauses.append("bucket_seconds = ?")
            params.append(bucket_seconds)
        if start_ts is not None:
            clauses.append("end_ts >= ?")
            params.append(start_ts)
        if end_ts is not None:
            clauses.append("start_ts <= ?")
            params.append(end_ts)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"""
            SELECT summary_id, summary_fingerprint, room_id, kind,
                   bucket_seconds, start_ts, end_ts, sample_count,
                   numeric_sample_count, first_observed_ts, last_observed_ts,
                   first_value, last_value, min_value, max_value, mean_value,
                   max_gap_s, observed_span_s, coverage_ratio, source_count,
                   source_changed, primary_available, method, created_at
            FROM observed_window_summaries
            {where}
            ORDER BY start_ts, summary_id
        """
        with closing(self._connect()) as conn:
            return [self._window_summary_dict_from_row(row) for row in conn.execute(sql, params)]

    def store_thermal_episodes(
        self,
        *,
        room_id: str,
        rows: Iterable[dict[str, Any]],
        min_duration_s: float = 20 * 60,
        max_gap_s: float = 10 * 60,
    ) -> int:
        """Build and persist conservative thermal episodes from room snapshots."""
        episodes = build_thermal_episodes(
            rows,
            min_duration_s=min_duration_s,
            max_gap_s=max_gap_s,
        )
        episode_rows = [self._thermal_episode_row(room_id, episode) for episode in episodes]
        if not episode_rows:
            return 0
        with closing(self._connect()) as conn:
            before = conn.total_changes
            conn.executemany(
                """
                INSERT OR REPLACE INTO thermal_episodes (
                    episode_fingerprint, room_id, start_ts, end_ts, duration_s,
                    sample_count, max_gap_s, mode, hvac_stage, window_open,
                    temperature_source, humidity_sources,
                    temperature_primary_available, humidity_primary_available,
                    temp_start, temp_end, temp_slope_c_per_h, humidity_start,
                    humidity_end, humidity_slope_rh_per_h, outdoor_mean, valid,
                    rejection_reasons_json, method, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                episode_rows,
            )
            conn.commit()
            return conn.total_changes - before

    def read_thermal_episodes(
        self,
        *,
        room_id: str | None = None,
        start_ts: float | None = None,
        end_ts: float | None = None,
        valid: bool | None = None,
    ) -> list[dict[str, Any]]:
        """Read persisted thermal episodes."""
        clauses: list[str] = []
        params: list[Any] = []
        if room_id is not None:
            clauses.append("room_id = ?")
            params.append(room_id)
        if start_ts is not None:
            clauses.append("end_ts >= ?")
            params.append(start_ts)
        if end_ts is not None:
            clauses.append("start_ts <= ?")
            params.append(end_ts)
        if valid is not None:
            clauses.append("valid = ?")
            params.append(int(valid))
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"""
            SELECT episode_id, episode_fingerprint, room_id, start_ts, end_ts,
                   duration_s, sample_count, max_gap_s, mode, hvac_stage,
                   window_open, temperature_source, humidity_sources,
                   temperature_primary_available, humidity_primary_available,
                   temp_start, temp_end, temp_slope_c_per_h, humidity_start,
                   humidity_end, humidity_slope_rh_per_h, outdoor_mean, valid,
                   rejection_reasons_json, method, created_at
            FROM thermal_episodes
            {where}
            ORDER BY start_ts, episode_id
        """
        with closing(self._connect()) as conn:
            return [self._thermal_episode_dict_from_row(row) for row in conn.execute(sql, params)]

    def _connect(self) -> sqlite3.Connection:
        directory = os.path.dirname(self._db_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        conn = sqlite3.connect(self._db_path)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
        if not self._schema_ready:
            self._ensure_schema(conn)
            self._schema_ready = True
        return conn

    @staticmethod
    def _ensure_schema(conn: sqlite3.Connection) -> None:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS raw_observations (
                observation_id INTEGER PRIMARY KEY,
                fingerprint TEXT NOT NULL UNIQUE,
                room_id TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                observed_at REAL NOT NULL,
                ingested_at REAL NOT NULL,
                state TEXT NOT NULL,
                value_text TEXT,
                value_real REAL,
                unit TEXT,
                source TEXT,
                is_primary INTEGER,
                quality REAL,
                attrs_json TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_raw_room_kind_time
                ON raw_observations(room_id, kind, observed_at);
            CREATE INDEX IF NOT EXISTS idx_raw_entity_time
                ON raw_observations(entity_id, observed_at);
            CREATE INDEX IF NOT EXISTS idx_raw_observed_at
                ON raw_observations(observed_at);
            CREATE TABLE IF NOT EXISTS observation_intervals (
                interval_id INTEGER PRIMARY KEY,
                interval_fingerprint TEXT NOT NULL UNIQUE,
                room_id TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                start_ts REAL NOT NULL,
                end_ts REAL NOT NULL,
                first_observed_at REAL NOT NULL,
                last_observed_at REAL NOT NULL,
                first_ingested_at REAL NOT NULL,
                last_ingested_at REAL NOT NULL,
                state TEXT NOT NULL,
                value_text TEXT,
                value_real REAL,
                unit TEXT,
                source TEXT,
                is_primary INTEGER,
                quality_min REAL,
                quality_max REAL,
                quality_avg REAL,
                attrs_json TEXT,
                report_count INTEGER NOT NULL,
                max_gap_s REAL NOT NULL,
                method TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_interval_room_kind_time
                ON observation_intervals(room_id, kind, start_ts, end_ts);
            CREATE INDEX IF NOT EXISTS idx_interval_entity_time
                ON observation_intervals(entity_id, start_ts, end_ts);
            CREATE TABLE IF NOT EXISTS observed_window_summaries (
                summary_id INTEGER PRIMARY KEY,
                summary_fingerprint TEXT NOT NULL UNIQUE,
                room_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                bucket_seconds INTEGER NOT NULL,
                start_ts REAL NOT NULL,
                end_ts REAL NOT NULL,
                sample_count INTEGER NOT NULL,
                numeric_sample_count INTEGER NOT NULL,
                first_observed_ts REAL,
                last_observed_ts REAL,
                first_value REAL,
                last_value REAL,
                min_value REAL,
                max_value REAL,
                mean_value REAL,
                max_gap_s REAL NOT NULL,
                observed_span_s REAL NOT NULL,
                coverage_ratio REAL NOT NULL,
                source_count INTEGER NOT NULL,
                source_changed INTEGER NOT NULL,
                primary_available INTEGER NOT NULL,
                method TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_window_room_kind_time
                ON observed_window_summaries(room_id, kind, bucket_seconds, start_ts, end_ts);
            CREATE TABLE IF NOT EXISTS thermal_episodes (
                episode_id INTEGER PRIMARY KEY,
                episode_fingerprint TEXT NOT NULL UNIQUE,
                room_id TEXT NOT NULL,
                start_ts REAL NOT NULL,
                end_ts REAL NOT NULL,
                duration_s REAL NOT NULL,
                sample_count INTEGER NOT NULL,
                max_gap_s REAL NOT NULL,
                mode TEXT,
                hvac_stage TEXT,
                window_open INTEGER NOT NULL,
                temperature_source TEXT,
                humidity_sources TEXT,
                temperature_primary_available INTEGER NOT NULL,
                humidity_primary_available INTEGER NOT NULL,
                temp_start REAL,
                temp_end REAL,
                temp_slope_c_per_h REAL,
                humidity_start REAL,
                humidity_end REAL,
                humidity_slope_rh_per_h REAL,
                outdoor_mean REAL,
                valid INTEGER NOT NULL,
                rejection_reasons_json TEXT NOT NULL,
                method TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_episode_room_time
                ON thermal_episodes(room_id, start_ts, end_ts);
            CREATE INDEX IF NOT EXISTS idx_episode_room_valid_time
                ON thermal_episodes(room_id, valid, start_ts, end_ts);
            """
        )
        conn.commit()

    def _interval_rows(self, rows: list[tuple]) -> list[tuple]:
        """Collapse consecutive identical raw observations into observed intervals."""
        intervals: list[tuple] = []
        current: list[tuple] = []
        for row in rows:
            if not current:
                current = [row]
                continue
            previous = current[-1]
            if self._can_merge_interval_rows(previous, row):
                current.append(row)
            else:
                intervals.append(self._interval_from_rows(current))
                current = [row]
        if current:
            intervals.append(self._interval_from_rows(current))
        return intervals

    def _can_merge_interval_rows(self, previous: tuple, row: tuple) -> bool:
        """Return True when two raw rows belong to the same observed interval."""
        previous_observed_at = float(previous[5])
        observed_at = float(row[5])
        if observed_at - previous_observed_at > self._interval_gap_seconds:
            return False
        return self._interval_identity(previous) == self._interval_identity(row)

    @staticmethod
    def _interval_identity(row: tuple) -> tuple:
        """Return fields that must match for interval compaction."""
        return (
            row[2],  # room_id
            row[3],  # entity_id
            row[4],  # kind
            row[7],  # state
            row[8],  # value_text
            row[10],  # unit
            row[11],  # source
            row[12],  # is_primary
            row[14],  # attrs_json
        )

    @classmethod
    def _interval_from_rows(cls, rows: list[tuple]) -> tuple:
        """Build one interval row from consecutive raw observations."""
        first = rows[0]
        observed_times = [float(row[5]) for row in rows]
        ingested_times = [float(row[6]) for row in rows]
        qualities = [quality for row in rows if (quality := _safe_float(row[13])) is not None]
        max_gap_s = (
            max(current - previous for previous, current in zip(observed_times, observed_times[1:], strict=False))
            if len(observed_times) >= 2
            else 0.0
        )
        start_ts = observed_times[0]
        end_ts = observed_times[-1]
        interval_fingerprint = cls._interval_fingerprint(
            room_id=first[2],
            entity_id=first[3],
            kind=first[4],
            start_ts=start_ts,
            end_ts=end_ts,
            state=first[7],
            value_text=first[8],
            attrs_json=first[14],
            report_count=len(rows),
        )
        return (
            interval_fingerprint,
            first[2],
            first[3],
            first[4],
            start_ts,
            end_ts,
            start_ts,
            end_ts,
            ingested_times[0],
            ingested_times[-1],
            first[7],
            first[8],
            first[9],
            first[10],
            first[11],
            first[12],
            min(qualities) if qualities else None,
            max(qualities) if qualities else None,
            round(sum(qualities) / len(qualities), 4) if qualities else None,
            first[14],
            len(rows),
            round(max_gap_s, 3),
            "observed_interval",
        )

    @staticmethod
    def _interval_fingerprint(
        *,
        room_id: str,
        entity_id: str,
        kind: str,
        start_ts: float,
        end_ts: float,
        state: str,
        value_text: str | None,
        attrs_json: str | None,
        report_count: int,
    ) -> str:
        payload = json.dumps(
            {
                "room_id": room_id,
                "entity_id": entity_id,
                "kind": kind,
                "start_ts": round(start_ts, 6),
                "end_ts": round(end_ts, 6),
                "state": state,
                "value_text": value_text,
                "attrs_json": attrs_json,
                "report_count": report_count,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()

    @classmethod
    def _row_from_observation(cls, observation: dict[str, Any]) -> tuple | None:
        room_id = str(observation.get("room_id") or "")
        entity_id = str(observation.get("entity_id") or "")
        kind = str(observation.get("kind") or "")
        observed_at = _safe_float(observation.get("observed_at"))
        if not room_id or not entity_id or not kind or observed_at is None:
            return None
        ingested_at = _safe_float(observation.get("ingested_at")) or time.time()
        state = str(observation.get("state") or "ok")
        value_text, value_real = _value_fields(observation.get("value"))
        unit = _optional_text(observation.get("unit"))
        source = _optional_text(observation.get("source"))
        is_primary = observation.get("is_primary")
        is_primary_int = None if is_primary is None else int(bool(is_primary))
        quality = _safe_float(observation.get("quality"))
        attrs_json = _compact_json(observation.get("attributes"))
        fingerprint = cls._fingerprint(
            room_id=room_id,
            entity_id=entity_id,
            kind=kind,
            observed_at=observed_at,
            state=state,
            value_text=value_text,
            attrs_json=attrs_json,
        )
        return (
            fingerprint,
            room_id,
            entity_id,
            kind,
            observed_at,
            ingested_at,
            state,
            value_text,
            value_real,
            unit,
            source,
            is_primary_int,
            quality,
            attrs_json,
        )

    @staticmethod
    def _fingerprint(
        *,
        room_id: str,
        entity_id: str,
        kind: str,
        observed_at: float,
        state: str,
        value_text: str | None,
        attrs_json: str | None,
    ) -> str:
        payload = json.dumps(
            {
                "room_id": room_id,
                "entity_id": entity_id,
                "kind": kind,
                "observed_at": round(observed_at, 6),
                "state": state,
                "value_text": value_text,
                "attrs_json": attrs_json,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()

    @staticmethod
    def _dict_from_row(row: sqlite3.Row | tuple) -> dict[str, Any]:
        keys = (
            "observation_id",
            "fingerprint",
            "room_id",
            "entity_id",
            "kind",
            "observed_at",
            "ingested_at",
            "state",
            "value_text",
            "value_real",
            "unit",
            "source",
            "is_primary",
            "quality",
            "attrs_json",
        )
        result = dict(zip(keys, row, strict=True))
        result["is_primary"] = None if result["is_primary"] is None else bool(result["is_primary"])
        return result

    @staticmethod
    def _interval_dict_from_row(row: sqlite3.Row | tuple) -> dict[str, Any]:
        keys = (
            "interval_id",
            "interval_fingerprint",
            "room_id",
            "entity_id",
            "kind",
            "start_ts",
            "end_ts",
            "first_observed_at",
            "last_observed_at",
            "first_ingested_at",
            "last_ingested_at",
            "state",
            "value_text",
            "value_real",
            "unit",
            "source",
            "is_primary",
            "quality_min",
            "quality_max",
            "quality_avg",
            "attrs_json",
            "report_count",
            "max_gap_s",
            "method",
        )
        result = dict(zip(keys, row, strict=True))
        result["is_primary"] = None if result["is_primary"] is None else bool(result["is_primary"])
        return result

    @staticmethod
    def _observation_for_summary(row: dict[str, Any]) -> dict[str, Any]:
        """Convert a raw observation row to thermal_analysis input shape."""
        return {
            "entity_id": row.get("entity_id"),
            "observed_at": row.get("observed_at"),
            "value": row.get("value_text"),
            "is_primary": row.get("is_primary"),
        }

    @classmethod
    def _window_summary_row(
        cls,
        room_id: str,
        kind: str,
        bucket_seconds: int,
        summary: dict[str, Any],
    ) -> tuple:
        fingerprint = cls._window_summary_fingerprint(
            room_id=room_id,
            kind=kind,
            bucket_seconds=bucket_seconds,
            start_ts=float(summary["start_ts"]),
            end_ts=float(summary["end_ts"]),
        )
        return (
            fingerprint,
            room_id,
            kind,
            bucket_seconds,
            summary["start_ts"],
            summary["end_ts"],
            int(summary["sample_count"]),
            int(summary["numeric_sample_count"]),
            summary["first_observed_ts"],
            summary["last_observed_ts"],
            summary["first_value"],
            summary["last_value"],
            summary["min_value"],
            summary["max_value"],
            summary["mean_value"],
            summary["max_gap_s"],
            summary["observed_span_s"],
            summary["coverage_ratio"],
            int(summary["source_count"]),
            int(bool(summary["source_changed"])),
            int(bool(summary["primary_available"])),
            summary["method"],
            time.time(),
        )

    @staticmethod
    def _window_summary_fingerprint(
        *,
        room_id: str,
        kind: str,
        bucket_seconds: int,
        start_ts: float,
        end_ts: float,
    ) -> str:
        payload = json.dumps(
            {
                "room_id": room_id,
                "kind": kind,
                "bucket_seconds": bucket_seconds,
                "start_ts": round(start_ts, 6),
                "end_ts": round(end_ts, 6),
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()

    @staticmethod
    def _window_summary_dict_from_row(row: sqlite3.Row | tuple) -> dict[str, Any]:
        keys = (
            "summary_id",
            "summary_fingerprint",
            "room_id",
            "kind",
            "bucket_seconds",
            "start_ts",
            "end_ts",
            "sample_count",
            "numeric_sample_count",
            "first_observed_ts",
            "last_observed_ts",
            "first_value",
            "last_value",
            "min_value",
            "max_value",
            "mean_value",
            "max_gap_s",
            "observed_span_s",
            "coverage_ratio",
            "source_count",
            "source_changed",
            "primary_available",
            "method",
            "created_at",
        )
        result = dict(zip(keys, row, strict=True))
        result["source_changed"] = bool(result["source_changed"])
        result["primary_available"] = bool(result["primary_available"])
        return result

    @classmethod
    def _thermal_episode_row(cls, room_id: str, episode: dict[str, Any]) -> tuple:
        rejection_reasons_json = json.dumps(
            episode.get("rejection_reasons", []),
            sort_keys=True,
            separators=(",", ":"),
        )
        fingerprint = cls._thermal_episode_fingerprint(
            room_id=room_id,
            start_ts=float(episode["start_ts"]),
            end_ts=float(episode["end_ts"]),
            method=str(episode["method"]),
        )
        return (
            fingerprint,
            room_id,
            episode["start_ts"],
            episode["end_ts"],
            episode["duration_s"],
            int(episode["sample_count"]),
            episode["max_gap_s"],
            episode["mode"],
            episode["hvac_stage"],
            int(bool(episode["window_open"])),
            episode["temperature_source"],
            episode["humidity_sources"],
            int(bool(episode["temperature_primary_available"])),
            int(bool(episode["humidity_primary_available"])),
            episode["temp_start"],
            episode["temp_end"],
            episode["temp_slope_c_per_h"],
            episode["humidity_start"],
            episode["humidity_end"],
            episode["humidity_slope_rh_per_h"],
            episode["outdoor_mean"],
            int(bool(episode["valid"])),
            rejection_reasons_json,
            episode["method"],
            time.time(),
        )

    @staticmethod
    def _thermal_episode_fingerprint(
        *,
        room_id: str,
        start_ts: float,
        end_ts: float,
        method: str,
    ) -> str:
        payload = json.dumps(
            {
                "room_id": room_id,
                "start_ts": round(start_ts, 6),
                "end_ts": round(end_ts, 6),
                "method": method,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()

    @staticmethod
    def _thermal_episode_dict_from_row(row: sqlite3.Row | tuple) -> dict[str, Any]:
        keys = (
            "episode_id",
            "episode_fingerprint",
            "room_id",
            "start_ts",
            "end_ts",
            "duration_s",
            "sample_count",
            "max_gap_s",
            "mode",
            "hvac_stage",
            "window_open",
            "temperature_source",
            "humidity_sources",
            "temperature_primary_available",
            "humidity_primary_available",
            "temp_start",
            "temp_end",
            "temp_slope_c_per_h",
            "humidity_start",
            "humidity_end",
            "humidity_slope_rh_per_h",
            "outdoor_mean",
            "valid",
            "rejection_reasons_json",
            "method",
            "created_at",
        )
        result = dict(zip(keys, row, strict=True))
        result["window_open"] = bool(result["window_open"])
        result["temperature_primary_available"] = bool(result["temperature_primary_available"])
        result["humidity_primary_available"] = bool(result["humidity_primary_available"])
        result["valid"] = bool(result["valid"])
        result["rejection_reasons"] = json.loads(result["rejection_reasons_json"])
        return result


def _value_fields(value: Any) -> tuple[str | None, float | None]:
    if value is None:
        return None, None
    value_text = str(value)
    return value_text, _safe_float(value)


def _safe_float(value: Any) -> float | None:
    if value in ("", None):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result else None


def _optional_text(value: Any) -> str | None:
    if value in ("", None):
        return None
    return str(value)


def _compact_json(value: Any) -> str | None:
    if not value:
        return None
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
