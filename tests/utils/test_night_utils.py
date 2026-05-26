"""Tests for night-mode time helpers."""

from __future__ import annotations

from datetime import datetime

from custom_components.roommind.utils.night_utils import is_quiet_hours_now, parse_time_minutes


def test_parse_time_minutes_accepts_hh_mm_and_hh_mm_ss():
    assert parse_time_minutes("22:30") == 22 * 60 + 30
    assert parse_time_minutes("07:05:00") == 7 * 60 + 5
    assert parse_time_minutes("24:00") is None
    assert parse_time_minutes("bad") is None


def test_quiet_hours_handles_cross_midnight_windows():
    quiet = {"start": "22:00", "end": "07:00"}

    assert is_quiet_hours_now(quiet, now=datetime(2026, 5, 25, 23, 15)) is True
    assert is_quiet_hours_now(quiet, now=datetime(2026, 5, 25, 6, 45)) is True
    assert is_quiet_hours_now(quiet, now=datetime(2026, 5, 25, 12, 0)) is False


def test_quiet_hours_handles_same_day_windows():
    quiet = {"start": "13:00", "end": "15:00"}

    assert is_quiet_hours_now(quiet, now=datetime(2026, 5, 25, 14, 0)) is True
    assert is_quiet_hours_now(quiet, now=datetime(2026, 5, 25, 16, 0)) is False
