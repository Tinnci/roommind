"""Climate service dispatch and fallback-aware idle actuation.

Every required operation returns dispatch evidence. Confirmation is reconciled
separately by the actuation ledger, including events received during dispatch.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant

from ..const import TargetTemps, make_roommind_context
from ..utils.device_utils import (
    DEFAULT_IDLE_SETBACK_OFFSET,
    IDLE_ACTION_FAN_ONLY,
    IDLE_ACTION_LOW,
    IDLE_ACTION_SETBACK,
    get_device_by_eid,
    get_idle_action,
)
from ..utils.entity_snapshot import EntitySnapshots
from ..utils.temp_utils import celsius_delta_to_ha, celsius_to_ha_temp, ha_temp_to_celsius
from .actuation import DeviceActuationResult, DispatchStatus, plan_setback_temperature

_LOGGER = logging.getLogger(__name__)

# Cache of last successfully sent command per climate entity.
# Fallback for IR devices that don't report temperature attributes.
# Persists across MPCController instances (created fresh each 30s cycle),
# resets on integration reload (module reimport).
_last_commands: dict[str, dict[str, Any]] = {}
_setpoint_override_warned: set[str] = set()


@dataclass(frozen=True, slots=True)
class TemperatureDispatch:
    """The last temperature write, retained for pacing rather than observation."""

    temperature: float
    hvac_mode: str
    observed_temperature: float | None
    policy: tuple[Any, ...]
    sent_at: float


_temperature_dispatches: dict[str, TemperatureDispatch] = {}


def setpoint_delay_reason(
    entity_id: str,
    data: dict[str, Any],
    state: Any,
    *,
    policy: tuple[Any, ...],
    interval: float,
    large_delta: float,
    heating: bool,
    temperature_tolerance: float = 0.0,
) -> str | None:
    """Coalesce small output increases while permitting immediate load reduction.

    Only matching reported modes are paced. Changed comfort policy, large
    corrections, external overrides, and expired retry intervals pass through.
    """
    previous = _temperature_dispatches.get(entity_id)
    mode = data.get("hvac_mode")
    temperature = data.get("temperature")
    if (
        previous is None
        or temperature is None
        or state is None
        or state.state != mode
        or previous.hvac_mode != mode
        or previous.policy != policy
        or time.monotonic() - previous.sent_at >= interval
    ):
        return None
    observed = state.attributes.get("temperature")
    if observed == previous.observed_temperature and temperature == previous.temperature:
        return "awaiting temperature feedback"
    increase = (temperature - previous.temperature) * (1 if heating else -1)
    if _temperature_matches(observed, previous.temperature, temperature_tolerance) and 0 < increase < large_delta:
        return "small setpoint increase coalesced"
    return None


def remember_temperature_dispatch(
    entity_id: str, data: dict[str, Any], state: Any, policy: tuple[Any, ...], result: DeviceActuationResult
) -> None:
    """Remember successful dispatch without claiming the device applied it."""
    if result.dispatch is DispatchStatus.SENT and "temperature" in data:
        _temperature_dispatches[entity_id] = TemperatureDispatch(
            data["temperature"],
            data.get("hvac_mode", ""),
            state.attributes.get("temperature") if state else None,
            policy,
            time.monotonic(),
        )
    elif result.dispatch is DispatchStatus.FAILED:
        _temperature_dispatches.pop(entity_id, None)


def resolve_hvac_mode(desired: str, hvac_modes: list[str]) -> str | None:
    """Resolve a supported mode, using auto for compatible heat/cool intents."""
    if not hvac_modes or desired in hvac_modes:
        return desired
    if desired in ("heat", "cool", "heat_cool") and "auto" in hvac_modes:
        return "auto"
    return None


def _cache_entry(service: str, data: dict) -> dict[str, Any]:
    """Build a cache entry from a service call."""
    return {
        "service": service,
        "hvac_mode": data.get("hvac_mode"),
        "temperature": data.get("temperature"),
        "target_temp_low": data.get("target_temp_low"),
        "target_temp_high": data.get("target_temp_high"),
    }


def _should_use_cache(state: Any) -> bool:
    """Return True when the sent-command cache should be trusted.

    The cache exists for IR-controlled devices that never report state changes.
    When a device has a real HVAC state (not unavailable/unknown), the device's
    actual reported state is authoritative and the cache must not suppress
    retries — a cached "off" must not prevent re-sending when the device
    clearly reports it is still heating.
    """
    if state is None:
        return True
    return state.state in ("unavailable", "unknown")


def temperature_feedback_tolerance(hass: HomeAssistant, state: Any) -> float:
    """Use an explicitly declared protocol tolerance, converted as a difference."""
    raw = state.attributes.get("target_temp_tolerance_c") if state else None
    if isinstance(raw, int | float) and math.isfinite(raw) and raw > 0:
        return celsius_delta_to_ha(hass, raw)
    return 0.0


def _temperature_matches(observed: Any, desired: Any, tolerance: float = 0.0) -> bool:
    if observed is None or desired is None:
        return False
    try:
        return (
            round(float(observed), 1) == round(float(desired), 1) or abs(float(observed) - float(desired)) <= tolerance
        )
    except TypeError, ValueError:
        return False


def _command_payload_matches(
    observed: dict[str, Any], service: str, desired: dict[str, Any], *, temperature_tolerance: float = 0.0
) -> bool:
    """Return whether observed state already represents a desired command."""
    if service == "set_hvac_mode":
        return observed.get("hvac_mode") == desired.get("hvac_mode")
    if service != "set_temperature":
        return False
    fields = ("target_temp_low", "target_temp_high") if "target_temp_low" in desired else ("temperature",)
    return all(_temperature_matches(observed.get(key), desired.get(key), temperature_tolerance) for key in fields)


def _snap_to_step(value: float, step: float | None) -> float:
    if step is None or step <= 0:
        return value
    return round(round(value / step) * step, 2)


def _normalize_temperature_payload(
    state: Any, data: dict[str, Any], temp_intent: str, *, hass: HomeAssistant | None = None
) -> dict[str, Any]:
    """Clamp and adapt one temperature command to device capabilities."""
    normalized = dict(data)
    attrs = state.attributes
    dev_min = attrs.get("min_temp")
    dev_max = attrs.get("max_temp")

    if "temperature" in normalized:
        temperature = normalized["temperature"]
        if dev_max is not None and temperature > dev_max:
            normalized["temperature"] = dev_max
        if dev_min is not None and normalized["temperature"] < dev_min:
            normalized["temperature"] = dev_min

    if "temperature" in normalized and temp_intent in ("heat", "cool") and attrs.get("target_temp_low") is not None:
        temperature = normalized.pop("temperature")
        if temp_intent == "heat":
            range_max = attrs.get("max_temp", temperature)
            current_high = attrs.get("target_temp_high", range_max)
            normalized["target_temp_low"] = temperature
            normalized["target_temp_high"] = max(temperature, current_high)
        elif temp_intent == "cool":
            range_min = attrs.get("min_temp", temperature)
            current_low = attrs.get("target_temp_low", range_min)
            normalized["target_temp_low"] = min(temperature, current_low)
            normalized["target_temp_high"] = temperature

    if "target_temp_low" in normalized:
        if dev_min is not None and normalized["target_temp_low"] < dev_min:
            normalized["target_temp_low"] = dev_min
        if dev_max is not None and normalized["target_temp_high"] > dev_max:
            normalized["target_temp_high"] = dev_max

    native_step = attrs.get("target_temp_step_c") if hass is not None else None
    raw_step = native_step if native_step is not None else attrs.get("target_temp_step")
    if raw_step is None:
        return normalized
    step = float(raw_step)

    def snap(value: float) -> float:
        if native_step is not None and hass is not None:
            return celsius_to_ha_temp(hass, _snap_to_step(ha_temp_to_celsius(hass, value), step))
        return _snap_to_step(value, step)

    if "temperature" in normalized:
        temperature = snap(normalized["temperature"])
        if dev_max is not None and temperature > dev_max:
            temperature = dev_max
        if dev_min is not None and temperature < dev_min:
            temperature = dev_min
        normalized["temperature"] = temperature
    if "target_temp_low" in normalized:
        low = snap(normalized["target_temp_low"])
        if dev_min is not None and low < dev_min:
            low = dev_min
        normalized["target_temp_low"] = low
    if "target_temp_high" in normalized:
        high = snap(normalized["target_temp_high"])
        if dev_max is not None and high > dev_max:
            high = dev_max
        normalized["target_temp_high"] = high
    return normalized


def clear_command_cache() -> None:
    """Clear the sent-command cache (for tests)."""
    _last_commands.clear()
    _setpoint_override_warned.clear()
    _temperature_dispatches.clear()


def last_command_snapshot() -> dict[str, dict[str, Any]]:
    """Return a detached snapshot of the most recently sent device commands."""
    return {entity_id: dict(command) for entity_id, command in _last_commands.items()}


def _resolve_idle_setpoint(
    state: Any,
    fallback_setpoint: float | None,
    *,
    area_id: str = "unknown",
    entity_id: str = "unknown",
) -> float | None:
    """Pick the best setpoint to idle a device.

    Returns min_temp when available (authoritative device floor),
    otherwise fallback_setpoint. Returns None if neither works.
    """
    min_temp: float | None = None
    if state:
        raw = state.attributes.get("min_temp")
        if raw is not None:
            try:
                val = float(raw)
            except ValueError, TypeError:
                val = -1.0
            if val > 0:
                min_temp = val
            elif fallback_setpoint is None:
                _LOGGER.warning(
                    "Area '%s': device '%s' reports min_temp=%s (<= 0), "
                    "no fallback available — cannot lower setpoint (Z2M/firmware bug?)",
                    area_id,
                    entity_id,
                    raw,
                )

    return min_temp if min_temp is not None else fallback_setpoint


type DeviceOperations = tuple[DeviceActuationResult, ...]


async def async_dispatch_climate(
    hass: HomeAssistant,
    service: str,
    data: dict[str, Any],
    *,
    area_id: str,
) -> DeviceActuationResult:
    """Submit one operation and retain its context even when dispatch fails."""
    desired = dict(data)
    entity_id = str(desired.get("entity_id", ""))
    context = make_roommind_context()
    try:
        await hass.services.async_call("climate", service, dict(desired), blocking=True, context=context)
    except Exception as err:  # noqa: BLE001
        _LOGGER.warning("Area '%s': climate.%s failed on '%s'", area_id, service, entity_id, exc_info=True)
        return DeviceActuationResult(
            entity_id, DispatchStatus.FAILED, service, desired, diagnostic=str(err), context_id=context.id
        )
    if entity_id and service in ("set_hvac_mode", "set_temperature"):
        _last_commands[entity_id] = _cache_entry(service, desired)
    return DeviceActuationResult(entity_id, DispatchStatus.SENT, service, desired, context_id=context.id)


async def _send_idle_setpoint(
    hass: HomeAssistant,
    entity_id: str,
    state: Any,
    setpoint: float,
    *,
    area_id: str = "unknown",
) -> DeviceActuationResult:
    """Lower an idle setpoint while preserving limits and override diagnostics."""
    current = state.attributes.get("temperature")
    desired = {"entity_id": entity_id, "temperature": setpoint}
    tolerance = temperature_feedback_tolerance(hass, state)
    if _temperature_matches(current, setpoint, tolerance):
        _setpoint_override_warned.discard(entity_id)
        return DeviceActuationResult(entity_id, DispatchStatus.SKIPPED, "set_temperature", desired)

    dev_min = state.attributes.get("min_temp")
    dev_max = state.attributes.get("max_temp")
    if dev_min is not None:
        try:
            setpoint = max(setpoint, float(dev_min))
        except ValueError, TypeError:
            pass
    if dev_max is not None:
        try:
            setpoint = min(setpoint, float(dev_max))
        except ValueError, TypeError:
            pass
    desired["temperature"] = setpoint
    if _temperature_matches(current, setpoint, tolerance):
        return DeviceActuationResult(entity_id, DispatchStatus.SKIPPED, "set_temperature", desired)

    cached = _last_commands.get(entity_id)
    if (
        cached
        and cached.get("service") == "set_temperature"
        and cached.get("temperature") is not None
        and round(cached["temperature"], 1) == round(setpoint, 1)
        and current is not None
        and entity_id not in _setpoint_override_warned
    ):
        _LOGGER.warning(
            "Area '%s': device '%s' setpoint is %.1f but RoomMind previously sent %.1f — "
            "an external controller may be overriding the setpoint. "
            "Check the device's own schedule/minimum temperature settings",
            area_id,
            entity_id,
            float(current),
            setpoint,
        )
        _setpoint_override_warned.add(entity_id)
    return await async_dispatch_climate(hass, "set_temperature", desired, area_id=area_id)


async def _async_idle_without_off_mode(
    hass: HomeAssistant,
    entity_id: str,
    state: Any,
    hvac_modes: list[str],
    *,
    area_id: str,
) -> DeviceOperations:
    """Neutralize devices without off support, retaining unsupported outcomes."""
    if state.state in ("heat", "cool"):
        is_cooling = state.state == "cool"
    else:
        is_cooling = "heat" not in hvac_modes and ("cool" in hvac_modes or "heat_cool" in hvac_modes)
    boundary_name = "max_temp" if is_cooling else "min_temp"
    boundary = state.attributes.get(boundary_name)
    if boundary is None or float(boundary) <= 0:
        diagnostic = f"no usable {boundary_name} for device without off mode"
        _LOGGER.warning("Area '%s': device '%s': %s", area_id, entity_id, diagnostic)
        return (DeviceActuationResult(entity_id, DispatchStatus.UNSUPPORTED, "set_temperature", {}, diagnostic),)

    is_range = state.attributes.get("target_temp_low") is not None
    if is_range and "heat_cool" in hvac_modes:
        low = state.attributes.get("min_temp")
        high = state.attributes.get("max_temp")
        if low is None or high is None or float(low) <= 0 or float(high) <= 0 or float(low) > float(high):
            diagnostic = "invalid min/max fallback bounds for range device"
            _LOGGER.warning("Area '%s': device '%s': %s", area_id, entity_id, diagnostic)
            return (DeviceActuationResult(entity_id, DispatchStatus.UNSUPPORTED, "set_temperature", {}, diagnostic),)
        desired = {"entity_id": entity_id, "target_temp_low": low, "target_temp_high": high}
        skip = _command_payload_matches(
            dict(state.attributes),
            "set_temperature",
            desired,
            temperature_tolerance=temperature_feedback_tolerance(hass, state),
        )
        missing_setpoint = (
            state.attributes.get("target_temp_low") is None or state.attributes.get("target_temp_high") is None
        )
    elif is_range:
        current = state.attributes.get("target_temp_high" if is_cooling else "target_temp_low")
        desired = {"entity_id": entity_id, "target_temp_low": boundary, "target_temp_high": boundary}
        skip = current is not None and round(current, 1) == round(boundary, 1)
        missing_setpoint = current is None
    else:
        desired = {"entity_id": entity_id, "temperature": boundary}
        skip = _command_payload_matches(
            dict(state.attributes),
            "set_temperature",
            desired,
            temperature_tolerance=temperature_feedback_tolerance(hass, state),
        )
        missing_setpoint = state.attributes.get("temperature") is None
    if not skip and missing_setpoint and _should_use_cache(state):
        cached = _last_commands.get(entity_id)
        skip = bool(
            cached
            and cached.get("service") == "set_temperature"
            and _command_payload_matches(cached, "set_temperature", desired)
        )
    if skip:
        return (DeviceActuationResult(entity_id, DispatchStatus.SKIPPED, "set_temperature", desired),)
    return (await async_dispatch_climate(hass, "set_temperature", desired, area_id=area_id),)


async def async_turn_off_climate(
    hass: HomeAssistant,
    entity_id: str,
    *,
    area_id: str = "unknown",
    fallback_setpoint: float | None = None,
    protect_valve: bool = True,
    observations: EntitySnapshots | None = None,
) -> DeviceOperations:
    """Submit off or a neutral setpoint, keeping every protection operation's evidence."""
    state = observations.get(entity_id) if observations is not None else hass.states.get(entity_id)
    hvac_modes = (state.attributes.get("hvac_modes") or []) if state else []
    if hvac_modes and "off" not in hvac_modes:
        return await _async_idle_without_off_mode(hass, entity_id, state, hvac_modes, area_id=area_id)

    desired = {"entity_id": entity_id, "hvac_mode": "off"}
    effective_setpoint = _resolve_idle_setpoint(state, fallback_setpoint, area_id=area_id, entity_id=entity_id)
    permanently_off = bool(hvac_modes) and set(hvac_modes) == {"off"}
    if permanently_off:
        # These devices control a valve solely by setpoint; setting off can reset it.
        if state is not None and effective_setpoint is not None:
            return (await _send_idle_setpoint(hass, entity_id, state, effective_setpoint, area_id=area_id),)
        return (
            DeviceActuationResult(
                entity_id, DispatchStatus.UNSUPPORTED, "set_temperature", {}, "no usable idle setpoint"
            ),
        )
    if state and state.state == "off":
        return (DeviceActuationResult(entity_id, DispatchStatus.SKIPPED, "set_hvac_mode", desired),)
    if _should_use_cache(state):
        cached = _last_commands.get(entity_id)
        if cached and cached.get("service") == "set_hvac_mode" and cached.get("hvac_mode") == "off":
            return (DeviceActuationResult(entity_id, DispatchStatus.SKIPPED, "set_hvac_mode", desired),)

    operations: list[DeviceActuationResult] = []
    # Preserve setpoint-before-off protection for valves that ignore off commands.
    # Still attempt off if lowering the setpoint fails.
    if protect_valve and state and effective_setpoint is not None:
        operations.append(await _send_idle_setpoint(hass, entity_id, state, effective_setpoint, area_id=area_id))
    operations.append(await async_dispatch_climate(hass, "set_hvac_mode", desired, area_id=area_id))
    return tuple(operations)


async def _async_idle_low(
    hass: HomeAssistant,
    entity_id: str,
    *,
    area_id: str,
    fallback_temp: float | None,
    observations: EntitySnapshots | None,
) -> DeviceOperations:
    """Keep a device awake while lowering its setpoint."""
    state = observations.get(entity_id) if observations is not None else hass.states.get(entity_id)
    setpoint = _resolve_idle_setpoint(state, fallback_temp, area_id=area_id, entity_id=entity_id)
    if state is None or setpoint is None:
        return (
            DeviceActuationResult(
                entity_id, DispatchStatus.UNSUPPORTED, "set_temperature", {}, "no usable idle setpoint"
            ),
        )
    return (await _send_idle_setpoint(hass, entity_id, state, setpoint, area_id=area_id),)


async def _async_idle_setback(
    hass: HomeAssistant,
    entity_id: str,
    *,
    area_id: str,
    targets: TargetTemps | None,
    fallback_temp: float | None,
    setback_offset: float,
    protect_valve: bool,
    observations: EntitySnapshots | None,
) -> DeviceOperations:
    """Shift the active target away from comfort, falling back to evidenced off work."""
    state = observations.get(entity_id) if observations is not None else hass.states.get(entity_id)
    setback_temp = plan_setback_temperature(state.state if state else None, targets, setback_offset)
    if state is None or setback_temp is None:
        return await async_turn_off_climate(
            hass,
            entity_id,
            area_id=area_id,
            fallback_setpoint=fallback_temp,
            protect_valve=protect_valve,
            observations=observations,
        )

    desired = _normalize_temperature_payload(
        state, {"entity_id": entity_id, "temperature": celsius_to_ha_temp(hass, setback_temp)}, "", hass=hass
    )
    ha_t = desired["temperature"]
    skip = _command_payload_matches(
        dict(state.attributes),
        "set_temperature",
        desired,
        temperature_tolerance=temperature_feedback_tolerance(hass, state),
    )
    if not skip and _should_use_cache(state):
        cached = _last_commands.get(entity_id)
        skip = bool(cached and cached.get("service") == "set_temperature" and cached.get("temperature") == ha_t)
    if skip:
        return (DeviceActuationResult(entity_id, DispatchStatus.SKIPPED, "set_temperature", desired),)
    return (await async_dispatch_climate(hass, "set_temperature", desired, area_id=area_id),)


async def _async_idle_fan_only(
    hass: HomeAssistant,
    entity_id: str,
    *,
    area_id: str,
    idle_fan_mode: str,
    fallback_temp: float | None,
    protect_valve: bool,
    observations: EntitySnapshots | None,
) -> DeviceOperations:
    """Switch to circulation-only idle and retain mode and fan evidence separately."""
    state = observations.get(entity_id) if observations is not None else hass.states.get(entity_id)
    hvac_modes = (state.attributes.get("hvac_modes") or []) if state else []
    if "fan_only" not in hvac_modes:
        _LOGGER.warning(
            "Area '%s': device '%s' configured for fan_only idle but does not support it, falling back to off",
            area_id,
            entity_id,
        )
        return await async_turn_off_climate(
            hass,
            entity_id,
            area_id=area_id,
            fallback_setpoint=fallback_temp,
            protect_valve=protect_valve,
            observations=observations,
        )

    desired = {"entity_id": entity_id, "hvac_mode": "fan_only"}
    skip = bool(state and state.state == "fan_only")
    if not skip and _should_use_cache(state) and not idle_fan_mode:
        cached = _last_commands.get(entity_id)
        skip = bool(cached and cached.get("service") == "set_hvac_mode" and cached.get("hvac_mode") == "fan_only")
    mode_result = (
        DeviceActuationResult(entity_id, DispatchStatus.SKIPPED, "set_hvac_mode", desired)
        if skip
        else await async_dispatch_climate(hass, "set_hvac_mode", desired, area_id=area_id)
    )
    if not mode_result.effective or not idle_fan_mode:
        return (mode_result,)

    fan_desired = {"entity_id": entity_id, "fan_mode": idle_fan_mode}
    attrs = state.attributes if state else {}
    if attrs.get("fan_mode") == idle_fan_mode:
        fan_result = DeviceActuationResult(entity_id, DispatchStatus.SKIPPED, "set_fan_mode", fan_desired)
    elif idle_fan_mode not in (attrs.get("fan_modes") or []):
        fan_result = DeviceActuationResult(
            entity_id, DispatchStatus.UNSUPPORTED, "set_fan_mode", fan_desired, f"unsupported fan mode: {idle_fan_mode}"
        )
    else:
        fan_result = await async_dispatch_climate(hass, "set_fan_mode", fan_desired, area_id=area_id)
    return mode_result, fan_result


async def async_idle_device(
    hass: HomeAssistant,
    entity_id: str,
    devices: list[dict],
    *,
    area_id: str = "unknown",
    targets: TargetTemps | None = None,
    setback_offset: float = DEFAULT_IDLE_SETBACK_OFFSET,
    observations: EntitySnapshots | None = None,
) -> DeviceOperations:
    """Submit configured idle work and return each required operation's evidence."""
    idle_action, idle_fan_mode = get_idle_action(devices, entity_id)
    device = get_device_by_eid(devices, entity_id)
    protect_valve = device is None or device.get("type") != "ac"
    fallback_temp = (
        celsius_to_ha_temp(hass, targets.heat - DEFAULT_IDLE_SETBACK_OFFSET)
        if targets is not None and targets.heat is not None
        else None
    )
    if idle_action == IDLE_ACTION_LOW:
        return await _async_idle_low(
            hass, entity_id, area_id=area_id, fallback_temp=fallback_temp, observations=observations
        )
    if idle_action == IDLE_ACTION_SETBACK:
        return await _async_idle_setback(
            hass,
            entity_id,
            area_id=area_id,
            targets=targets,
            fallback_temp=fallback_temp,
            setback_offset=setback_offset,
            protect_valve=protect_valve,
            observations=observations,
        )
    if idle_action == IDLE_ACTION_FAN_ONLY:
        return await _async_idle_fan_only(
            hass,
            entity_id,
            area_id=area_id,
            idle_fan_mode=idle_fan_mode,
            fallback_temp=fallback_temp,
            protect_valve=protect_valve,
            observations=observations,
        )
    return await async_turn_off_climate(
        hass,
        entity_id,
        area_id=area_id,
        fallback_setpoint=fallback_temp,
        protect_valve=protect_valve,
        observations=observations,
    )
