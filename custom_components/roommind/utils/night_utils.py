"""Utilities for RoomMind quiet-hours and night-mode decisions."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime
from typing import Any

from homeassistant.util import dt as dt_util

from ..const import TargetTemps


def parse_time_minutes(value: Any) -> int | None:
    """Parse a HH:MM or HH:MM:SS value into minutes after midnight."""
    if not isinstance(value, str):
        return None
    parts = value.strip().split(":")
    if len(parts) < 2:
        return None
    try:
        hour = int(parts[0])
        minute = int(parts[1])
    except ValueError:
        return None
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return hour * 60 + minute


def is_quiet_hours_now(quiet_hours: dict[str, Any] | None, now: datetime | None = None) -> bool:
    """Return whether the current local time falls inside quiet hours.

    Supports regular windows (21:00 -> 23:00) and cross-midnight windows
    (22:00 -> 07:00). Invalid or empty windows are treated as disabled.
    """
    if not quiet_hours:
        return False
    start = parse_time_minutes(quiet_hours.get("start"))
    end = parse_time_minutes(quiet_hours.get("end"))
    if start is None or end is None or start == end:
        return False
    current = now or dt_util.now()
    minute_now = current.hour * 60 + current.minute
    if start < end:
        return start <= minute_now < end
    return minute_now >= start or minute_now < end


def is_night_mode_active(config: dict[str, Any], now: datetime | None = None) -> bool:
    """Return whether night-mode rules should currently apply for a room/config."""
    return bool(config.get("night_mode_enabled", True)) and is_quiet_hours_now(config.get("quiet_hours"), now=now)


def apply_sleep_ramp_to_targets(targets: TargetTemps, ramp_c: float) -> TargetTemps:
    """Relax targets at night: slightly cooler heating and warmer cooling."""
    if ramp_c <= 0:
        return targets
    return TargetTemps(
        heat=(targets.heat - ramp_c if targets.heat is not None else None),
        cool=(targets.cool + ramp_c if targets.cool is not None else None),
    )


def wrap_target_resolver_for_sleep_ramp(
    resolver: Callable[[float], TargetTemps],
    ramp_c: float,
) -> Callable[[float], TargetTemps]:
    """Wrap a target resolver so future MPC targets follow the night sleep ramp."""
    if ramp_c <= 0:
        return resolver

    def _resolver(ts: float) -> TargetTemps:
        return apply_sleep_ramp_to_targets(resolver(ts), ramp_c)

    return _resolver
