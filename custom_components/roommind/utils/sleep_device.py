"""Sleep-zone and heated blanket device inspection and MIoT curve helpers."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant

_DEFAULT_QUSHUI_CURVE = "0-0-23000700-031-00-10090708"
_HEAT_LEVEL_LABELS = ("关闭", "1挡", "2挡", "3挡", "4挡", "5挡", "6挡")


def clamp_gear(value: Any) -> int:
    """Clamp blanket gear level into [0, 6]."""
    try:
        gear = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, min(6, gear))


def gear_to_heat_level_option(gear: int) -> str:
    """Map numeric gear (0..6) to qushui select option label."""
    return _HEAT_LEVEL_LABELS[clamp_gear(gear)]


def parse_ab_gears(raw: str | None) -> tuple[int, int] | None:
    """Parse 'A-B' gear string such as '2-3' into (2, 3)."""
    if not raw or not isinstance(raw, str):
        return None
    parts = [part.strip() for part in raw.strip().split("-")]
    if len(parts) < 2:
        return None
    try:
        gear_a = int(parts[0])
        gear_b = int(parts[1])
    except ValueError:
        return None
    return (clamp_gear(gear_a), clamp_gear(gear_b))


def format_ab_gears(gear_a: int, gear_b: int) -> str:
    """Format A/B blanket gears into 'A-B' wire string."""
    return f"{clamp_gear(gear_a)}-{clamp_gear(gear_b)}"


def _hhmm_to_compact(hhmm: str) -> str | None:
    parts = hhmm.strip().split(":")
    if len(parts) < 2:
        return None
    try:
        hour = int(parts[0])
        minute = int(parts[1])
    except ValueError:
        return None
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return f"{hour:02d}{minute:02d}"


def _compact_to_hhmm(hhmm4: str) -> str | None:
    if len(hhmm4) != 4 or not hhmm4.isdigit():
        return None
    hour = int(hhmm4[:2])
    minute = int(hhmm4[2:])
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return f"{hour:02d}:{minute:02d}"


def parse_qushui_sleep_curve(raw: str | None) -> dict[str, Any] | None:
    """Decode qushui MIoT sleep curve string '0-1-23000700-031-00-10090708'."""
    if not raw or not isinstance(raw, str):
        return None
    fields = [part.strip() for part in raw.strip().split("-")]
    if len(fields) < 3 or len(fields[2]) != 8 or not fields[2].isdigit():
        return None
    start = _compact_to_hhmm(fields[2][:4])
    end = _compact_to_hhmm(fields[2][4:])
    if start is None or end is None:
        return None
    return {
        "raw": raw.strip(),
        "enabled": fields[1] == "1",
        "start": start,
        "end": end,
        "fields": fields,
    }


def update_qushui_sleep_curve(
    raw: str | None,
    *,
    enabled: bool | None = None,
    start: str | None = None,
    end: str | None = None,
) -> str:
    """Return updated MIoT sleep curve preserving untouched hardware curve fields."""
    parsed = parse_qushui_sleep_curve(raw)
    if parsed is None:
        base = _DEFAULT_QUSHUI_CURVE.split("-")
        cur_enabled = False
        cur_start = "23:00"
        cur_end = "07:00"
    else:
        base = list(parsed["fields"])
        cur_enabled = bool(parsed["enabled"])
        cur_start = str(parsed["start"])
        cur_end = str(parsed["end"])

    next_enabled = cur_enabled if enabled is None else bool(enabled)
    next_start_compact = _hhmm_to_compact(start) if start else _hhmm_to_compact(cur_start)
    next_end_compact = _hhmm_to_compact(end) if end else _hhmm_to_compact(cur_end)

    base[1] = "1" if next_enabled else "0"
    if next_start_compact and next_end_compact:
        base[2] = f"{next_start_compact}{next_end_compact}"
    return "-".join(base)


def _state_str(hass: HomeAssistant, entity_id: str | None) -> str | None:
    if not entity_id:
        return None
    st = hass.states.get(entity_id)
    if st is None or st.state in ("unknown", "unavailable"):
        return None
    return str(st.state)


def _is_on(hass: HomeAssistant, entity_id: str | None) -> bool | None:
    val = _state_str(hass, entity_id)
    if val is None:
        return None
    lower = val.lower()
    if lower in ("on", "true", "真"):
        return True
    if lower in ("off", "false", "假"):
        return False
    return None


def _read_int(hass: HomeAssistant, entity_id: str | None) -> int | None:
    val = _state_str(hass, entity_id)
    if val is None:
        return None
    try:
        return int(round(float(val)))
    except ValueError:
        return None


def inspect_sleep_device_state(
    hass: HomeAssistant,
    sleep_device: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Build live status dictionary for a configured room sleep/blanket device."""
    if not sleep_device or not isinstance(sleep_device, dict):
        return None

    power_eid = sleep_device.get("power_entity") or ""
    heat_level_eid = sleep_device.get("heat_level_entity") or ""
    gears_eid = sleep_device.get("gears_entity") or ""
    sleep_switch_eid = sleep_device.get("sleep_switch_entity") or ""
    zone_a_sleep_eid = sleep_device.get("zone_a_sleep_entity") or ""
    zone_b_sleep_eid = sleep_device.get("zone_b_sleep_entity") or ""
    zone_a_countdown_eid = sleep_device.get("zone_a_countdown_entity") or ""
    zone_b_countdown_eid = sleep_device.get("zone_b_countdown_entity") or ""
    remote_eid = sleep_device.get("remote_switch_entity") or ""
    mite_eid = sleep_device.get("mite_removal_entity") or ""
    anti_scald_eid = sleep_device.get("anti_scald_entity") or ""
    fault_eid = sleep_device.get("fault_entity") or ""

    configured = any(
        bool(eid)
        for eid in (
            power_eid,
            heat_level_eid,
            gears_eid,
            sleep_switch_eid,
            zone_a_sleep_eid,
            zone_b_sleep_eid,
        )
    )
    if not configured:
        return None

    power_on = bool(_is_on(hass, power_eid)) if power_eid else False
    sleep_switch_on = bool(_is_on(hass, sleep_switch_eid)) if sleep_switch_eid else False
    heat_level = _state_str(hass, heat_level_eid)
    parsed_gears = parse_ab_gears(_state_str(hass, gears_eid))
    gear_a = parsed_gears[0] if parsed_gears else None
    gear_b = parsed_gears[1] if parsed_gears else None

    # Fallback when device only exposes heat_level select (e.g. '3挡' / '关闭')
    if gear_a is None and heat_level:
        if heat_level in ("关闭", "off", "0"):
            gear_a = 0
        else:
            digits = "".join(ch for ch in heat_level if ch.isdigit())
            if digits:
                gear_a = clamp_gear(digits)

    countdown_a = _read_int(hass, zone_a_countdown_eid)
    countdown_b = _read_int(hass, zone_b_countdown_eid)
    remote_enabled = _is_on(hass, remote_eid) if remote_eid else True
    mite_removal_active = bool(_is_on(hass, mite_eid)) if mite_eid else False
    anti_scald_on = _is_on(hass, anti_scald_eid) if anti_scald_eid else None
    fault = _state_str(hass, fault_eid)
    fault_ok = fault is None or fault.lower() in ("normal", "ok", "none", "0", "正常", "无")

    zone_a_curve = parse_qushui_sleep_curve(_state_str(hass, zone_a_sleep_eid))
    zone_b_curve = parse_qushui_sleep_curve(_state_str(hass, zone_b_sleep_eid))

    heating_active = bool(
        fault_ok
        and (
            power_on
            or sleep_switch_on
            or (gear_a is not None and gear_a > 0)
            or (gear_b is not None and gear_b > 0)
        )
    )

    return {
        "configured": True,
        "name": sleep_device.get("name") or "",
        "power_on": power_on,
        "sleep_switch_on": sleep_switch_on,
        "heat_level": heat_level,
        "gear_a": gear_a,
        "gear_b": gear_b,
        "countdown_a": countdown_a,
        "countdown_b": countdown_b,
        "remote_enabled": True if remote_enabled is None else remote_enabled,
        "mite_removal_active": mite_removal_active,
        "anti_scald_on": anti_scald_on,
        "fault": fault,
        "fault_ok": fault_ok,
        "heating_active": heating_active,
        "zone_a_curve": (
            {
                "enabled": zone_a_curve["enabled"],
                "start": zone_a_curve["start"],
                "end": zone_a_curve["end"],
            }
            if zone_a_curve
            else None
        ),
        "zone_b_curve": (
            {
                "enabled": zone_b_curve["enabled"],
                "start": zone_b_curve["start"],
                "end": zone_b_curve["end"],
            }
            if zone_b_curve
            else None
        ),
    }
