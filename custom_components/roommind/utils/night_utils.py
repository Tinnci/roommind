"""Utilities for RoomMind quiet-hours and night-mode decisions."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

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
    (22:00 -> 07:00). Invalid or empty windows count as disabled.
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


@dataclass(frozen=True, slots=True)
class SleepPhaseStatus:
    """Resolved sleep phase, night-mode active flag, and active trigger source."""

    phase: Literal["day", "pre_warm", "sleep", "pre_wake"]
    night_active: bool
    trigger_source: Literal["none", "clock", "entity", "override"]


def _in_minute_window(minute_now: int, start_min: int, end_min: int) -> bool:
    if start_min == end_min:
        return False
    if start_min < end_min:
        return start_min <= minute_now < end_min
    return minute_now >= start_min or minute_now < end_min


def _resolve_clock_phase(
    quiet_hours: dict[str, Any] | None,
    *,
    prewarm_minutes: int = 30,
    prewake_minutes: int = 30,
    now: datetime | None = None,
) -> Literal["day", "pre_warm", "sleep", "pre_wake"]:
    if not quiet_hours:
        return "day"
    start = parse_time_minutes(quiet_hours.get("start"))
    end = parse_time_minutes(quiet_hours.get("end"))
    if start is None or end is None or start == end:
        return "day"

    current = now or dt_util.now()
    minute_now = current.hour * 60 + current.minute

    if _in_minute_window(minute_now, start, end):
        # Measure distance before wake (`end`), supporting midnight wrap.
        prewake = max(0, min(120, int(prewake_minutes)))
        minutes_to_end = (end - minute_now) % 1440
        if prewake > 0 and 0 < minutes_to_end <= prewake:
            return "pre_wake"
        return "sleep"

    prewarm = max(0, min(120, int(prewarm_minutes)))
    if prewarm > 0:
        prewarm_start = (start - prewarm) % 1440
        if _in_minute_window(minute_now, prewarm_start, start):
            return "pre_warm"
    return "day"


def resolve_sleep_phase(
    config: dict[str, Any],
    *,
    now: datetime | None = None,
    trigger_entity_on: bool = False,
    tonight_override: str | None = None,
) -> SleepPhaseStatus:
    """Resolve current sleep phase across manual tonight override, clock, and trigger entity."""
    if tonight_override == "skip":
        return SleepPhaseStatus(phase="day", night_active=False, trigger_source="override")
    if tonight_override == "pre_warm":
        return SleepPhaseStatus(phase="pre_warm", night_active=False, trigger_source="override")
    if tonight_override == "sleep":
        return SleepPhaseStatus(phase="sleep", night_active=True, trigger_source="override")

    if not bool(config.get("night_mode_enabled", True)):
        return SleepPhaseStatus(phase="day", night_active=False, trigger_source="none")

    mode = str(config.get("sleep_trigger_mode") or "clock")
    clock_allowed = mode in ("clock", "either")
    entity_allowed = mode in ("entity", "either")

    clock_phase: Literal["day", "pre_warm", "sleep", "pre_wake"] = "day"
    if clock_allowed:
        clock_phase = _resolve_clock_phase(
            config.get("quiet_hours"),
            prewarm_minutes=int(config.get("sleep_prewarm_minutes") or 0),
            prewake_minutes=int(config.get("sleep_prewake_minutes") or 0),
            now=now,
        )

    if entity_allowed and trigger_entity_on:
        if clock_phase == "pre_wake":
            return SleepPhaseStatus(phase="pre_wake", night_active=True, trigger_source="entity")
        return SleepPhaseStatus(phase="sleep", night_active=True, trigger_source="entity")

    if clock_phase == "pre_warm":
        return SleepPhaseStatus(phase="pre_warm", night_active=False, trigger_source="clock")
    if clock_phase == "sleep":
        return SleepPhaseStatus(phase="sleep", night_active=True, trigger_source="clock")
    if clock_phase == "pre_wake":
        return SleepPhaseStatus(phase="pre_wake", night_active=True, trigger_source="clock")

    return SleepPhaseStatus(phase="day", night_active=False, trigger_source="none")


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
