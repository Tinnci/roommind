"""Estimate HVAC fan/compressor output from available Home Assistant signals."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant


@dataclass(frozen=True, slots=True)
class HVACOutputObservation:
    """Best-effort HVAC output estimate for one climate device."""

    stage: str
    delivered_capacity_factor: float
    electric_power_w: float | None = None
    confidence: str = "low"


class HVACOutputObserver:
    """Classify coarse compressor stage and capacity multiplier.

    The observer prefers a configured power sensor when available. It then falls
    back to HA's hvac_action and an optional temperature slope. Fan curves let a
    user calibrate how indoor fan speed changes delivered capacity. They also
    let a user calibrate the fan power for a specific AC.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    def observe(
        self,
        device: dict[str, Any],
        *,
        hvac_action: str | None,
        fan_q: float,
        temp_slope_c_per_h: float | None = None,
    ) -> HVACOutputObservation:
        """Return a coarse output observation for *device*."""
        observer_mode = str(device.get("compressor_stage_observer") or "auto").lower()
        fan_q = max(0.0, min(1.0, float(fan_q)))
        if observer_mode == "disabled":
            return HVACOutputObservation(stage="unknown", delivered_capacity_factor=0.0, confidence="disabled")

        power_sensor = device.get("power_sensor_entity")
        power = self._read_power(power_sensor)
        if observer_mode == "power_sensor" and not power_sensor:
            return HVACOutputObservation(
                stage="unknown",
                delivered_capacity_factor=0.0,
                electric_power_w=None,
                confidence="missing_power_sensor",
            )
        if observer_mode == "power_sensor" and power is None:
            return HVACOutputObservation(
                stage="unknown",
                delivered_capacity_factor=0.0,
                electric_power_w=None,
                confidence="power_unavailable",
            )

        if power is not None:
            stage = _stage_from_power(power)
            return HVACOutputObservation(
                stage=stage,
                electric_power_w=power,
                delivered_capacity_factor=_stage_capacity(stage, fan_q, device.get("fan_capacity_curve")),
                confidence="observed",
            )

        action = str(hvac_action or "").lower()
        if action in {"off", "idle"}:
            stage = "off"
        elif action == "fan":
            stage = "fan"
        elif action in {"cooling", "heating", "cool", "heat"}:
            slope = abs(temp_slope_c_per_h or 0.0)
            stage = "compressor_high" if slope >= 1.0 else "compressor_mid" if slope >= 0.4 else "compressor_low"
        else:
            stage = "fan" if fan_q > 0 else "off"
        estimated_fan_power = _interpolate_curve(device.get("fan_power_curve"), fan_q, "power_w")
        confidence = "estimated" if estimated_fan_power is not None else "low"
        return HVACOutputObservation(
            stage=stage,
            delivered_capacity_factor=_stage_capacity(stage, fan_q, device.get("fan_capacity_curve")),
            electric_power_w=round(estimated_fan_power, 1) if estimated_fan_power is not None else None,
            confidence=confidence,
        )

    def _read_power(self, entity_id: str | None) -> float | None:
        if not entity_id:
            return None
        state = self.hass.states.get(entity_id)
        if state is None:
            return None
        try:
            return max(0.0, float(state.state))
        except TypeError, ValueError:
            return None


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


def _stage_capacity(stage: str, fan_q: float, fan_capacity_curve: list[dict[str, Any]] | None = None) -> float:
    curve_factor = _interpolate_curve(fan_capacity_curve, fan_q, "capacity_factor")
    fan_boost = curve_factor if curve_factor is not None else 1.0 + 0.25 * max(0.0, min(1.0, fan_q))
    stage_factor = {
        "off": 0.0,
        "fan": 0.0,
        "compressor_low": 0.6,
        "compressor_mid": 1.0,
        "compressor_high": 1.25,
    }.get(stage, 0.0)
    return round(stage_factor * max(0.0, fan_boost), 3)


def _interpolate_curve(curve: list[dict[str, Any]] | None, level: float, value_key: str) -> float | None:
    points: list[tuple[float, float]] = []
    for item in curve or []:
        try:
            raw_level = item.get("level")
            raw_value = item.get(value_key)
            if raw_level is None or raw_value is None:
                continue
            x = max(0.0, min(1.0, float(raw_level)))
            y = max(0.0, float(raw_value))
        except TypeError, ValueError:
            continue
        points.append((x, y))
    if not points:
        return None
    points.sort(key=lambda point: point[0])
    x = max(0.0, min(1.0, float(level)))
    if x <= points[0][0]:
        return points[0][1]
    if x >= points[-1][0]:
        return points[-1][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:], strict=False):
        if x0 <= x <= x1:
            if abs(x1 - x0) < 1e-9:
                return y1
            ratio = (x - x0) / (x1 - x0)
            return y0 + ratio * (y1 - y0)
    return points[-1][1]
