"""Pure interpretation of climate feedback and electrical power observations."""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class ClimateObservation:
    """Reported device state, independent of requested or dispatched commands."""

    entity_id: str
    hvac_mode: str | None
    hvac_action: str | None = None
    assumed_state: bool = False
    hvac_action_is_estimated: bool = False

    @property
    def thermal_mode(self) -> str | None:
        """Return a conclusive thermal action, leaving startup and conflicts unknown."""
        if self.assumed_state or self.hvac_mode in (None, "unknown", "unavailable"):
            return None
        if self.hvac_mode == "off":
            return None if self.hvac_action in ("heating", "cooling", "preheating") else "idle"
        if self.hvac_action_is_estimated:
            return None
        if self.hvac_action in ("heating", "cooling"):
            return self.hvac_action
        if self.hvac_action in ("idle", "off"):
            return "idle"
        return None

    @property
    def output_action(self) -> str | None:
        """Return usable feedback for output diagnostics, including observed fan operation."""
        mode = self.thermal_mode
        if mode is not None:
            return mode
        if (
            not self.assumed_state
            and not self.hvac_action_is_estimated
            and self.hvac_mode not in (None, "unknown", "unavailable", "off")
        ):
            return self.hvac_action
        return None


def observed_room_activity(observations: Iterable[ClimateObservation]) -> tuple[str | None, float]:
    """Reduce device feedback without filling unknown or opposing thermal effects.

    The fraction is a binary activity indicator for the existing thermal model,
    not a measurement of inverter load or electrical power.
    """
    modes = {observation.thermal_mode for observation in observations}
    if not modes or None in modes or {"heating", "cooling"} <= modes:
        return None, 0.0
    if "heating" in modes:
        return "heating", 1.0
    if "cooling" in modes:
        return "cooling", 1.0
    return "idle", 0.0


@dataclass(frozen=True, slots=True)
class HVACOutputObservation:
    """Coarse output estimate with an explicit source for electrical power."""

    stage: str
    delivered_capacity_factor: float
    electric_power_w: float | None = None
    confidence: str = "unknown"
    entity_id: str = ""
    electric_power_source: str = "none"

    def as_status_dict(self) -> dict[str, Any]:
        """Serialize a detached live-state payload."""
        return {
            "entity_id": self.entity_id,
            "stage": self.stage,
            "delivered_capacity_factor": self.delivered_capacity_factor,
            "electric_power_w": self.electric_power_w,
            "confidence": self.confidence,
            "electric_power_source": self.electric_power_source,
        }


def power_in_watts(value: Any, unit: str | None) -> float | None:
    """Normalize finite, nonnegative power; unitless legacy sensors use watts."""
    factor = {None: 1.0, "": 1.0, "W": 1.0, "kW": 1000.0, "MW": 1_000_000.0, "mW": 0.001}.get(unit)
    if factor is None:
        return None
    try:
        power = float(value) * factor
    except TypeError, ValueError, OverflowError:
        return None
    return power if math.isfinite(power) and power >= 0 else None


def estimate_hvac_output(
    device: Mapping[str, Any],
    *,
    hvac_action: str | None,
    fan_q: float,
    power_w: float | None,
) -> HVACOutputObservation:
    """Estimate output from captured signals; never infer a stage from room drift."""
    entity_id = str(device.get("entity_id", ""))
    observer_mode = str(device.get("compressor_stage_observer") or "auto").lower()
    unknown_reason = None
    if observer_mode == "disabled":
        unknown_reason = "disabled"
    elif observer_mode == "power_sensor":
        if not device.get("power_sensor_entity"):
            unknown_reason = "missing_power_sensor"
        elif power_w is None:
            unknown_reason = "power_unavailable"
    if unknown_reason:
        return HVACOutputObservation("unknown", 0.0, confidence=unknown_reason, entity_id=entity_id)

    fan_q = max(0.0, min(1.0, fan_q)) if math.isfinite(fan_q) else 0.0
    if power_w is not None:
        stage = _stage_from_power(power_w)
        return HVACOutputObservation(
            stage=stage,
            delivered_capacity_factor=_stage_capacity(stage, fan_q, device.get("fan_capacity_curve")),
            electric_power_w=power_w,
            # Power is observed, but a generic wattage band is only a stage estimate.
            confidence="estimated",
            entity_id=entity_id,
            electric_power_source="sensor",
        )

    action = str(hvac_action or "").lower()
    if action in {"off", "idle"}:
        stage = "off"
    elif action == "fan":
        stage = "fan"
    elif action in {"cooling", "heating"}:
        stage = "compressor_active"
    else:
        return HVACOutputObservation("unknown", 0.0, entity_id=entity_id)

    estimated_fan_power = _interpolate_curve(device.get("fan_power_curve"), fan_q, "power_w")
    return HVACOutputObservation(
        stage=stage,
        delivered_capacity_factor=_stage_capacity(stage, fan_q, device.get("fan_capacity_curve")),
        electric_power_w=round(estimated_fan_power, 1) if estimated_fan_power is not None else None,
        confidence="estimated" if stage == "compressor_active" or estimated_fan_power is not None else "low",
        entity_id=entity_id,
        electric_power_source="fan_curve" if estimated_fan_power is not None else "none",
    )


def _stage_from_power(power: float) -> str:
    if power < 10:
        return "off"
    if power < 120:
        return "fan"
    if power < 600:
        return "compressor_low"
    if power < 1000:
        return "compressor_mid"
    return "compressor_high"


def _stage_capacity(stage: str, fan_q: float, curve: Sequence[Mapping[str, Any]] | None) -> float:
    curve_factor = _interpolate_curve(curve, fan_q, "capacity_factor")
    fan_boost = curve_factor if curve_factor is not None else 1.0 + 0.25 * fan_q
    stage_factor = {
        "off": 0.0,
        "fan": 0.0,
        "compressor_active": 1.0,
        "compressor_low": 0.6,
        "compressor_mid": 1.0,
        "compressor_high": 1.25,
    }.get(stage, 0.0)
    return round(stage_factor * fan_boost, 3)


def _interpolate_curve(curve: Sequence[Mapping[str, Any]] | None, level: float, value_key: str) -> float | None:
    points: list[tuple[float, float]] = []
    for item in curve or ():
        try:
            x = float(item["level"])
            y = float(item[value_key])
        except KeyError, TypeError, ValueError, OverflowError:
            continue
        if math.isfinite(x) and math.isfinite(y):
            points.append((max(0.0, min(1.0, x)), max(0.0, y)))
    if not points:
        return None
    points.sort(key=lambda point: point[0])
    if level <= points[0][0]:
        return points[0][1]
    if level >= points[-1][0]:
        return points[-1][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:], strict=False):
        if x0 <= level <= x1:
            return y1 if x1 == x0 else y0 + (level - x0) / (x1 - x0) * (y1 - y0)
    return points[-1][1]
