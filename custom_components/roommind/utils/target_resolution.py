"""Room target resolution orchestration.

This module owns the priority chain for room setpoints while keeping Home
Assistant side effects outside the resolution logic.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from ..const import (
    DEFAULT_COMFORT_COOL,
    DEFAULT_COMFORT_HEAT,
    DEFAULT_ECO_COOL,
    DEFAULT_ECO_HEAT,
    SCHEDULE_STATE_ON,
    TargetTemps,
)
from .night_utils import (
    apply_sleep_ramp_to_targets,
    is_night_mode_active,
    wrap_target_resolver_for_sleep_ramp,
)
from .presence_utils import is_presence_away
from .schedule_utils import (
    apply_mold_prevention_to_targets,
    get_active_schedule_entity,
    make_target_resolver,
    read_schedule_blocks,
    resolve_targets_at_time,
    resolve_targets_from_schedule_data,
)
from .temp_utils import ha_temp_to_celsius


@dataclass(frozen=True)
class TargetResolutionResult:
    """Resolved room targets plus cleanup intents for expired stored state."""

    targets: TargetTemps
    clear_expired_override: bool = False
    clear_expired_vacation: bool = False


@dataclass(frozen=True, slots=True)
class ControlTargetPlan:
    """Effective Target Plan with current and future targets from one policy chain."""

    targets: TargetTemps
    resolver: Callable[[float], TargetTemps]
    force_off: bool
    presence_away: bool
    night_active: bool
    resolved_at: float
    clear_expired_override: bool = False
    clear_expired_vacation: bool = False


async def prepare_control_target_plan(
    hass: HomeAssistant,
    room: dict[str, Any],
    settings: dict[str, Any],
    *,
    schedule_blocks_cache: dict[str, dict] | None = None,
    mold_prevention_active: bool = False,
    mold_prevention_delta: float = 0.0,
    now: float | None = None,
) -> ControlTargetPlan:
    """Resolve effective current and future targets through one policy chain.

    Capture Home Assistant state and schedule data before composing target
    policy. Immediate control and the MPC horizon then share mold, presence,
    unit-conversion, and night-ramp semantics.
    """
    schedule_entity_id = get_active_schedule_entity(hass, room)
    schedule_blocks = (
        await read_schedule_blocks(hass, schedule_entity_id, cache=schedule_blocks_cache)
        if schedule_entity_id
        else None
    )
    resolved_at = time.time() if now is None else now
    presence_away = not room.get("ignore_presence", False) and is_presence_away(hass, room, settings)
    state = hass.states.get(schedule_entity_id) if schedule_entity_id else None

    def converter(value: float) -> float:
        return ha_temp_to_celsius(hass, value)

    base = resolve_room_targets(
        now=resolved_at,
        room=room,
        settings=settings,
        presence_away=presence_away,
        schedule_entity_id=schedule_entity_id,
        schedule_state=state.state if state is not None else None,
        schedule_attributes=dict(state.attributes) if state is not None else None,
        schedule_blocks=schedule_blocks,
        block_temp_converter=converter,
    )

    effective_mold_delta = mold_prevention_delta if mold_prevention_active else 0.0
    targets = apply_mold_prevention_to_targets(base.targets, room, effective_mold_delta)
    resolver = make_target_resolver(
        schedule_blocks,
        room,
        settings,
        presence_away=presence_away,
        mold_prevention_delta=effective_mold_delta,
        block_temp_converter=converter,
    )

    resolved_local_time = datetime.fromtimestamp(resolved_at, tz=dt_util.DEFAULT_TIME_ZONE)
    night_active = is_night_mode_active(room, now=resolved_local_time)
    sleep_ramp_c = max(0.0, float(room.get("sleep_temp_ramp_c") or 0.0))
    if night_active and sleep_ramp_c > 0:
        targets = apply_sleep_ramp_to_targets(targets, sleep_ramp_c)
        resolver = wrap_target_resolver_for_sleep_ramp(resolver, sleep_ramp_c)

    return ControlTargetPlan(
        targets=targets,
        resolver=resolver,
        force_off=targets.heat is None and targets.cool is None,
        presence_away=presence_away,
        night_active=night_active,
        resolved_at=resolved_at,
        clear_expired_override=base.clear_expired_override,
        clear_expired_vacation=base.clear_expired_vacation,
    )


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
