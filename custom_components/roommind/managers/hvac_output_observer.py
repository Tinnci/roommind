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
    """Classify coarse compressor stage and capacity multiplier."""

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
        power = self._read_power(device.get("power_sensor_entity"))
        action = str(hvac_action or "").lower()
        if power is not None:
            if power < 10:
                stage = "off"
            elif power < 120:
                stage = "fan"
            elif power < 600:
                stage = "compressor_low"
            elif power < 1000:
                stage = "compressor_mid"
            else:
                stage = "compressor_high"
            return HVACOutputObservation(
                stage=stage,
                electric_power_w=power,
                delivered_capacity_factor=_stage_capacity(stage, fan_q),
                confidence="observed",
            )

        if action in {"off", "idle"}:
            stage = "off"
        elif action == "fan":
            stage = "fan"
        elif action in {"cooling", "heating", "cool", "heat"}:
            slope = abs(temp_slope_c_per_h or 0.0)
            stage = "compressor_high" if slope >= 1.0 else "compressor_mid" if slope >= 0.4 else "compressor_low"
        else:
            stage = "fan" if fan_q > 0 else "off"
        return HVACOutputObservation(
            stage=stage, delivered_capacity_factor=_stage_capacity(stage, fan_q), confidence="low"
        )

    def _read_power(self, entity_id: str | None) -> float | None:
        if not entity_id:
            return None
        state = self.hass.states.get(entity_id)
        if state is None:
            return None
        try:
            return max(0.0, float(state.state))
        except (TypeError, ValueError):
            return None


def _stage_capacity(stage: str, fan_q: float) -> float:
    fan_boost = 1.0 + 0.25 * max(0.0, min(1.0, fan_q))
    stage_factor = {
        "off": 0.0,
        "fan": 0.0,
        "compressor_low": 0.6,
        "compressor_mid": 1.0,
        "compressor_high": 1.25,
    }.get(stage, 0.0)
    return round(stage_factor * fan_boost, 3)
