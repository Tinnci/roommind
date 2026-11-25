"""Sleep phase override and heated-blanket command execution service."""

from __future__ import annotations

import inspect
from typing import TYPE_CHECKING, Any

from homeassistant.core import Context, HomeAssistant

from ..const import make_roommind_context
from ..utils.sleep_device import (
    format_ab_gears,
    gear_to_heat_level_option,
    inspect_sleep_device_state,
    update_qushui_sleep_curve,
)

if TYPE_CHECKING:
    from ..coordinator import RoomMindCoordinator

_HARDWARE_ACTIONS = frozenset({"pre_warm", "sleep_now", "set_gears", "toggle_power", "toggle_sleep_switch", "sync_curve"})
_HARDWARE_ONLY_ACTIONS = frozenset({"set_gears", "toggle_power", "toggle_sleep_switch", "sync_curve"})


async def _async_call_service(
    hass: HomeAssistant,
    domain: str,
    service: str,
    data: dict[str, Any],
    *,
    context: Context,
) -> None:
    res = hass.services.async_call(domain, service, data, blocking=True, context=context)
    if inspect.isawaitable(res):
        await res


async def _async_apply_gears(
    hass: HomeAssistant,
    sleep_dev: dict[str, Any] | None,
    gear_a: int,
    gear_b: int,
    *,
    turn_on: bool = True,
    context: Context,
) -> None:
    if not sleep_dev:
        return
    if sleep_dev.get("power_entity"):
        if turn_on and (gear_a > 0 or gear_b > 0):
            await _async_call_service(hass, "switch", "turn_on", {"entity_id": sleep_dev["power_entity"]}, context=context)
        elif gear_a == 0 and gear_b == 0 and not turn_on:
            await _async_call_service(hass, "switch", "turn_off", {"entity_id": sleep_dev["power_entity"]}, context=context)
    if sleep_dev.get("gears_entity"):
        await _async_call_service(
            hass,
            "text",
            "set_value",
            {"entity_id": sleep_dev["gears_entity"], "value": format_ab_gears(gear_a, gear_b)},
            context=context,
        )
    elif sleep_dev.get("heat_level_entity"):
        await _async_call_service(
            hass,
            "select",
            "select_option",
            {"entity_id": sleep_dev["heat_level_entity"], "option": gear_to_heat_level_option(max(gear_a, gear_b))},
            context=context,
        )


async def _async_set_countdown(
    hass: HomeAssistant,
    sleep_dev: dict[str, Any],
    minutes: int,
    *,
    context: Context,
) -> None:
    for cd_key in ("zone_a_countdown_entity", "zone_b_countdown_entity"):
        if sleep_dev.get(cd_key):
            await _async_call_service(
                hass,
                "number",
                "set_value",
                {"entity_id": sleep_dev[cd_key], "value": minutes},
                context=context,
            )


async def _async_sync_sleep_curve(
    hass: HomeAssistant,
    room: dict[str, Any],
    sleep_dev: dict[str, Any],
    msg: dict[str, Any],
    *,
    context: Context,
) -> None:
    qh = room.get("quiet_hours") or {"start": "23:00", "end": "07:00"}
    start_str = str(qh.get("start") or "23:00")
    end_str = str(qh.get("end") or "07:00")
    for key, en_key in (
        ("zone_a_sleep_entity", "zone_a_enabled"),
        ("zone_b_sleep_entity", "zone_b_enabled"),
    ):
        eid = sleep_dev.get(key)
        if not eid:
            continue
        st = hass.states.get(eid)
        raw = str(st.state) if st else None
        en_val = msg[en_key] if en_key in msg else None
        next_curve = update_qushui_sleep_curve(raw, enabled=en_val, start=start_str, end=end_str)
        await _async_call_service(hass, "text", "set_value", {"entity_id": eid, "value": next_curve}, context=context)


async def async_execute_sleep_action(
    hass: HomeAssistant,
    room: dict[str, Any],
    area_id: str,
    msg: dict[str, Any],
    *,
    coordinator: RoomMindCoordinator | None,
) -> dict[str, Any]:
    """Execute a tonight sleep phase override or heated-blanket device command."""
    action = msg["action"]
    sleep_dev = room.get("sleep_device") if isinstance(room.get("sleep_device"), dict) else None
    status = inspect_sleep_device_state(hass, sleep_dev)
    ctx = make_roommind_context()

    if action in _HARDWARE_ACTIONS and status and not status.get("remote_enabled", True):
        if action in _HARDWARE_ONLY_ACTIONS:
            return {"ok": False, "reason": "remote_disabled"}

    if action == "pre_warm":
        if coordinator:
            coordinator.set_tonight_sleep_override(area_id, "pre_warm")
        if sleep_dev and (not status or status.get("remote_enabled", True)):
            ga = int(sleep_dev.get("prewarm_gear_a", 4))
            gb = int(sleep_dev.get("prewarm_gear_b", 4))
            await _async_apply_gears(hass, sleep_dev, ga, gb, turn_on=True, context=ctx)
            await _async_set_countdown(hass, sleep_dev, int(msg.get("countdown_min", 60)), context=ctx)
    elif action == "sleep_now":
        if coordinator:
            coordinator.set_tonight_sleep_override(area_id, "sleep")
        if sleep_dev and (not status or status.get("remote_enabled", True)):
            ga = int(sleep_dev.get("sleep_gear_a", 2))
            gb = int(sleep_dev.get("sleep_gear_b", 2))
            await _async_apply_gears(hass, sleep_dev, ga, gb, turn_on=True, context=ctx)
            if sleep_dev.get("sleep_switch_entity"):
                await _async_call_service(
                    hass, "switch", "turn_on", {"entity_id": sleep_dev["sleep_switch_entity"]}, context=ctx
                )
    elif action == "skip_tonight":
        if coordinator:
            coordinator.set_tonight_sleep_override(area_id, "skip")
        if sleep_dev and status and status.get("remote_enabled", True):
            if sleep_dev.get("sleep_switch_entity") and status.get("sleep_switch_on"):
                await _async_call_service(
                    hass, "switch", "turn_off", {"entity_id": sleep_dev["sleep_switch_entity"]}, context=ctx
                )
            if sleep_dev.get("power_entity") and status.get("power_on"):
                await _async_call_service(
                    hass, "switch", "turn_off", {"entity_id": sleep_dev["power_entity"]}, context=ctx
                )
    elif action == "clear":
        if coordinator:
            coordinator.clear_tonight_sleep_override(area_id)
    elif action == "set_gears" and sleep_dev:
        cur_a = status["gear_a"] if status and status.get("gear_a") is not None else 0
        cur_b = status["gear_b"] if status and status.get("gear_b") is not None else 0
        ga = int(msg["gear_a"]) if "gear_a" in msg else cur_a
        gb = int(msg["gear_b"]) if "gear_b" in msg else cur_b
        await _async_apply_gears(hass, sleep_dev, ga, gb, turn_on=(ga > 0 or gb > 0), context=ctx)
        if "countdown_min" in msg:
            await _async_set_countdown(hass, sleep_dev, int(msg["countdown_min"]), context=ctx)
    elif action == "toggle_power" and sleep_dev and sleep_dev.get("power_entity"):
        is_on = bool(status and status.get("power_on"))
        await _async_call_service(
            hass,
            "switch",
            "turn_off" if is_on else "turn_on",
            {"entity_id": sleep_dev["power_entity"]},
            context=ctx,
        )
    elif action == "toggle_sleep_switch" and sleep_dev and sleep_dev.get("sleep_switch_entity"):
        is_on = bool(status and status.get("sleep_switch_on"))
        await _async_call_service(
            hass,
            "switch",
            "turn_off" if is_on else "turn_on",
            {"entity_id": sleep_dev["sleep_switch_entity"]},
            context=ctx,
        )
    elif action == "sync_curve" and sleep_dev:
        await _async_sync_sleep_curve(hass, room, sleep_dev, msg, context=ctx)

    if coordinator:
        await coordinator.async_request_refresh()

    return {"ok": True}
