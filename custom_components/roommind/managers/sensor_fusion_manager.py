"""Helpers for turning HA temperature states into EKF observations."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any

from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN

from ..const import MAX_SENSOR_STALENESS, UPDATE_INTERVAL
from ..control.thermal_model import TemperatureObservation


@dataclass(frozen=True, slots=True)
class SensorBiasState:
    """Online temperature bias estimate for one auxiliary sensor."""

    static_c: float = 0.0
    active_c: float = 0.0


class SensorFusionManager:
    """Build EKF-ready temperature observations with HA freshness metadata."""

    _PRIMARY_VARIANCE = 0.04
    _AUXILIARY_VARIANCE = 0.16
    _ETA_STATIC = 0.005
    _ETA_ACTIVE = 0.01
    _STATIC_MIN = -5.0
    _STATIC_MAX = 5.0
    _ACTIVE_HEAT_MIN = 0.0
    _ACTIVE_HEAT_MAX = 8.0
    _ACTIVE_COOL_MIN = -8.0
    _ACTIVE_COOL_MAX = 0.0
    _MIX_ACTIVE_BIAS_REDUCTION = 0.35
    _MIX_VARIANCE_REDUCTION = 0.4
    _AUXILIARY_VARIANCE_MIN = 0.06

    def __init__(self) -> None:
        self._biases: dict[str, SensorBiasState] = {}

    def observation_from_state(
        self,
        entity_id: str,
        state: Any | None,
        *,
        now: datetime,
        value_c: float | None,
        is_primary: bool,
    ) -> TemperatureObservation | None:
        """Return a temperature observation or ``None`` when the state is unusable."""
        if state is None or value_c is None:
            return None
        if state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            return None

        timestamp = self._freshness_timestamp(state)
        age_s = 0.0
        if timestamp is not None:
            age_s = max(0.0, (now - timestamp).total_seconds())
            if age_s > MAX_SENSOR_STALENESS:
                return None

        variance = self._PRIMARY_VARIANCE if is_primary else self._AUXILIARY_VARIANCE
        if age_s > UPDATE_INTERVAL * 2:
            variance *= age_s / (UPDATE_INTERVAL * 2)

        return TemperatureObservation(
            value=value_c,
            variance=variance,
            entity_id=entity_id,
            age_s=age_s,
            last_reported=getattr(state, "last_reported", None),
            last_updated=getattr(state, "last_updated", None),
            last_changed=getattr(state, "last_changed", None),
            is_primary=is_primary,
        )

    def calibrate_observations(
        self,
        observations: list[TemperatureObservation],
        *,
        mode: str,
        power_fraction: float,
        q_fan_mix: float = 0.0,
    ) -> list[TemperatureObservation]:
        """Apply online auxiliary-sensor bias correction against the primary observation."""
        primary = next((observation for observation in observations if observation.is_primary), None)
        if primary is None:
            return observations

        corrected: list[TemperatureObservation] = []
        pf = max(0.0, min(1.0, power_fraction))
        mix = max(0.0, min(1.0, q_fan_mix))
        bias_pf = pf * (1.0 - self._MIX_ACTIVE_BIAS_REDUCTION * mix)
        variance_scale = 1.0 - self._MIX_VARIANCE_REDUCTION * mix
        for observation in observations:
            entity_id = observation.entity_id
            if observation.is_primary or not entity_id:
                corrected.append(observation)
                continue

            bias = self._biases.get(entity_id, SensorBiasState())
            epsilon = observation.value - (primary.value + bias.static_c + bias.active_c * bias_pf)

            static_c = self._clamp(bias.static_c + self._ETA_STATIC * epsilon, self._STATIC_MIN, self._STATIC_MAX)
            active_c = bias.active_c
            if mode == "heating":
                active_c = self._clamp(
                    bias.active_c + self._ETA_ACTIVE * epsilon * bias_pf,
                    self._ACTIVE_HEAT_MIN,
                    self._ACTIVE_HEAT_MAX,
                )
            elif mode == "cooling":
                active_c = self._clamp(
                    bias.active_c + self._ETA_ACTIVE * epsilon * bias_pf,
                    self._ACTIVE_COOL_MIN,
                    self._ACTIVE_COOL_MAX,
                )

            updated = SensorBiasState(static_c=static_c, active_c=active_c)
            self._biases[entity_id] = updated
            corrected.append(
                replace(
                    observation,
                    value=observation.value - (updated.static_c + updated.active_c * bias_pf),
                    variance=max(self._AUXILIARY_VARIANCE_MIN, observation.variance * variance_scale),
                )
            )

        return corrected

    def get_bias(self, entity_id: str) -> SensorBiasState:
        """Return the current learned bias for an auxiliary sensor."""
        return self._biases.get(entity_id, SensorBiasState())

    def to_dict(self) -> dict:
        """Serialize learned auxiliary sensor biases."""
        return {
            "biases": {
                entity_id: {"static_c": bias.static_c, "active_c": bias.active_c}
                for entity_id, bias in self._biases.items()
            }
        }

    @classmethod
    def from_dict(cls, data: dict | None) -> SensorFusionManager:
        """Restore learned auxiliary sensor biases."""
        manager = cls()
        if not isinstance(data, dict):
            return manager
        biases = data.get("biases", data)
        if not isinstance(biases, dict):
            return manager
        for entity_id, raw_bias in biases.items():
            if not isinstance(entity_id, str) or not isinstance(raw_bias, dict):
                continue
            try:
                static_c = float(raw_bias.get("static_c", 0.0))
                active_c = float(raw_bias.get("active_c", 0.0))
            except (TypeError, ValueError):
                continue
            manager._biases[entity_id] = SensorBiasState(
                static_c=manager._clamp(static_c, manager._STATIC_MIN, manager._STATIC_MAX),
                active_c=manager._clamp(
                    active_c,
                    manager._ACTIVE_COOL_MIN,
                    manager._ACTIVE_HEAT_MAX,
                ),
            )
        return manager

    def _freshness_timestamp(self, state: Any) -> datetime | None:
        """Prefer HA's report timestamp, falling back for older HA releases."""
        for attr in ("last_reported", "last_updated", "last_changed"):
            value = getattr(state, attr, None)
            if isinstance(value, datetime):
                return value
        return None

    def _clamp(self, value: float, lower: float, upper: float) -> float:
        """Clamp *value* to the inclusive range [lower, upper]."""
        return max(lower, min(upper, value))
