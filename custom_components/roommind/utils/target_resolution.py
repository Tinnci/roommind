"""Room target resolution orchestration.

This module owns the priority chain for room setpoints while keeping Home
Assistant side effects outside the resolution logic.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from ..const import (
    DEFAULT_COMFORT_COOL,
    DEFAULT_COMFORT_HEAT,
    DEFAULT_ECO_COOL,
    DEFAULT_ECO_HEAT,
    SCHEDULE_STATE_ON,
    TargetTemps,
)
from .schedule_utils import resolve_targets_at_time, resolve_targets_from_schedule_data


@dataclass(frozen=True)
class TargetResolutionResult:
    """Resolved room targets plus cleanup intents for expired stored state."""

    targets: TargetTemps
    clear_expired_override: bool = False
    clear_expired_vacation: bool = False


def resolve_room_targets(
    *,
    now: float,
    room: dict[str, Any],
    settings: dict[str, Any],
    presence_away: bool,
    schedule_entity_id: str | None,
    schedule_state: str | None = None,
    schedule_attributes: dict[str, Any] | None = None,
    schedule_blocks: dict[str, Any] | None = None,
    block_temp_converter: Callable[[float], float] | None = None,
) -> TargetResolutionResult:
    """Resolve room heat/cool targets and report expired-state cleanup intents."""
    comfort_heat = room.get("comfort_heat", room.get("comfort_temp", DEFAULT_COMFORT_HEAT))
    comfort_cool = room.get("comfort_cool", DEFAULT_COMFORT_COOL)
    eco_heat = room.get("eco_heat", room.get("eco_temp", DEFAULT_ECO_HEAT))
    eco_cool = room.get("eco_cool", DEFAULT_ECO_COOL)

    override_temp = room.get("override_temp")
    override_until = room.get("override_until")
    clear_expired_override = override_temp is not None and override_until is not None and now >= override_until
    if clear_expired_override:
        override_temp = None
        override_until = None

    vacation_until = settings.get("vacation_until")
    clear_expired_vacation = vacation_until is not None and now >= vacation_until
    if clear_expired_vacation:
        vacation_until = None

    def resolve_with_blocks(blocks: dict[str, Any] | None) -> TargetTemps:
        return resolve_targets_at_time(
            now,
            blocks,
            override_until,
            override_temp,
            vacation_until,
            settings.get("vacation_temp"),
            comfort_heat,
            comfort_cool,
            eco_heat,
            eco_cool,
            presence_away=presence_away,
            block_temp_converter=block_temp_converter,
            presence_away_action=settings.get("presence_away_action", "eco"),
            schedule_off_action=settings.get("schedule_off_action", "eco"),
            presence_clears_override=bool(settings.get("presence_clears_override", False)),
        )

    override_active = override_temp is not None and (override_until is None or now < override_until)
    override_suppressed = presence_away and bool(settings.get("presence_clears_override", False))
    vacation_active = vacation_until is not None and now < vacation_until and settings.get("vacation_temp") is not None
    if (override_active and not override_suppressed) or vacation_active or presence_away:
        targets = resolve_with_blocks(None)
        return TargetResolutionResult(targets, clear_expired_override, clear_expired_vacation)

    if not schedule_entity_id:
        targets = resolve_with_blocks(None)
        return TargetResolutionResult(targets, clear_expired_override, clear_expired_vacation)

    state_unavailable = schedule_state is None or schedule_state in ("unavailable", "unknown")
    if state_unavailable:
        targets = resolve_with_blocks(schedule_blocks) if schedule_blocks is not None else resolve_with_blocks(None)
        return TargetResolutionResult(targets, clear_expired_override, clear_expired_vacation)

    if schedule_state == SCHEDULE_STATE_ON:
        if schedule_blocks is not None:
            targets = resolve_with_blocks(schedule_blocks)
        else:
            targets = resolve_targets_from_schedule_data(
                schedule_attributes or {},
                comfort_heat,
                comfort_cool,
                block_temp_converter,
            )
        return TargetResolutionResult(targets, clear_expired_override, clear_expired_vacation)

    if settings.get("schedule_off_action", "eco") == "off":
        targets = TargetTemps(heat=None, cool=None)
    else:
        targets = TargetTemps(heat=eco_heat, cool=eco_cool)
    return TargetResolutionResult(targets, clear_expired_override, clear_expired_vacation)

