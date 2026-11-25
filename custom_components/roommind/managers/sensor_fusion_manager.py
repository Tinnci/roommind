"""Helpers for turning HA temperature states into EKF observations."""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any

from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN

from ..const import MAX_SENSOR_STALENESS, UPDATE_INTERVAL
from ..control.thermal_model import TemperatureObservation
from ..utils.sensor_utils import sensor_observation_age, sensor_observation_timestamp


@dataclass(frozen=True, slots=True)
class SensorBiasState:
    """Online temperature bias estimate for one auxiliary sensor."""

    static_c: float = 0.0
    active_c: float = 0.0
    k_mix: float = 0.0


@dataclass(frozen=True, slots=True)
class FusedTemperatureEstimate:
    """Precision-weighted theoretical room temperature and per-sensor weights."""

    value: float | None
    raw_primary: float | None
    weights: dict[str, float]
    ekf_weight: float = 0.0


class SensorFusionManager:
    """Build EKF-ready temperature observations with HA freshness metadata."""

    _PRIMARY_VARIANCE = 0.04
    _EXTERNAL_AUX_VARIANCE = 0.12
    _HVAC_INTERNAL_VARIANCE = 0.64
    _AUXILIARY_VARIANCE = _EXTERNAL_AUX_VARIANCE
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
    _ETA_MIX = 0.003
    _K_MIX_MIN = 0.0
    _K_MIX_MAX = 0.85
    _CADENCE_MIN_S = 30.0
    _CADENCE_MAX_S = 900.0
    _HUMIDITY_ETA = 0.01
    _HUMIDITY_BIAS_MAX = 25.0

    def __init__(self) -> None:
        self._biases: dict[str, SensorBiasState] = {}
        self._cadences_s: dict[str, float] = {}
        self._last_obs_ts: dict[str, float] = {}
        self._humidity_biases: dict[str, float] = {}

    @staticmethod
    def sensor_class(entity_id: str | None, *, is_primary: bool) -> str:
        """Classify a sensor by its trust tier."""
        if is_primary:
            return "primary"
        if entity_id and entity_id.startswith("climate."):
            return "hvac_internal"
        return "external"

    @classmethod
    def base_variance(cls, entity_id: str | None, *, is_primary: bool) -> float:
        """Return base measurement variance for a sensor's trust tier."""
        kind = cls.sensor_class(entity_id, is_primary=is_primary)
        if kind == "primary":
            return cls._PRIMARY_VARIANCE
        if kind == "hvac_internal":
            return cls._HVAC_INTERNAL_VARIANCE
        return cls._EXTERNAL_AUX_VARIANCE

    def get_cadence(self, entity_id: str | None) -> float | None:
        """Return learned report cadence in seconds, if established."""
        return self._cadences_s.get(entity_id) if entity_id else None

    def _aging_threshold_s(self, entity_id: str | None) -> float:
        default_threshold = float(UPDATE_INTERVAL * 2)
        cadence = self.get_cadence(entity_id)
        if cadence is None:
            return default_threshold
        return max(default_threshold, 2.0 * cadence)

    def _record_cadence(self, entity_id: str | None, timestamp: datetime | None) -> None:
        if not entity_id or timestamp is None:
            return
        ts_epoch = timestamp.timestamp()
        prev_ts = self._last_obs_ts.get(entity_id)
        if prev_ts is not None and ts_epoch > prev_ts:
            dt = ts_epoch - prev_ts
            if 5.0 <= dt <= 1800.0:
                sample = self._clamp(dt, self._CADENCE_MIN_S, self._CADENCE_MAX_S)
                prev_cad = self._cadences_s.get(entity_id)
                self._cadences_s[entity_id] = (
                    sample if prev_cad is None else (0.75 * prev_cad + 0.25 * sample)
                )
        self._last_obs_ts[entity_id] = ts_epoch

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
        if state is None or value_c is None or not math.isfinite(value_c):
            return None
        if state.state in (STATE_UNKNOWN, STATE_UNAVAILABLE):
            return None

        attribute = "current_temperature" if entity_id.startswith("climate.") else None
        timestamp, source = sensor_observation_timestamp(state, attribute=attribute)
        age_s = sensor_observation_age(state, now=now, attribute=attribute)
        if age_s is None:
            return None

        self._record_cadence(entity_id, timestamp)
        variance = self.base_variance(entity_id, is_primary=is_primary)
        aging_threshold = self._aging_threshold_s(entity_id)
        if age_s > aging_threshold:
            variance *= age_s / aging_threshold

        return TemperatureObservation(
            value=value_c,
            variance=variance,
            entity_id=entity_id,
            age_s=age_s,
            last_reported=getattr(state, "last_reported", None),
            last_updated=getattr(state, "last_updated", None),
            last_changed=getattr(state, "last_changed", None),
            is_primary=is_primary,
            observed_at=timestamp if source.endswith("observed_at") else None,
            freshness_source=source,
        )

    def corrected_observation(
        self,
        observation: TemperatureObservation,
        *,
        power_fraction: float,
        q_fan_mix: float = 0.0,
    ) -> tuple[float, float]:
        """Return (bias_corrected_temp, effective_variance) without mutating learned state."""
        if observation.is_primary or not observation.entity_id:
            return observation.value, max(0.02, observation.variance)
        pf = max(0.0, min(1.0, power_fraction))
        mix = max(0.0, min(1.0, q_fan_mix))
        bias = self.get_bias(observation.entity_id)
        effective_k_mix = bias.k_mix if bias.k_mix > 0.0 else self._MIX_ACTIVE_BIAS_REDUCTION
        correction_pf = pf * (1.0 - effective_k_mix * mix)
        variance_scale = 1.0 - min(self._MIX_VARIANCE_REDUCTION, effective_k_mix) * mix
        corrected_val = observation.value - (bias.static_c + bias.active_c * correction_pf)
        effective_var = max(self._AUXILIARY_VARIANCE_MIN, observation.variance * variance_scale)
        return corrected_val, effective_var

    def fuse_temperature(
        self,
        observations: Sequence[TemperatureObservation],
        *,
        power_fraction: float = 0.0,
        q_fan_mix: float = 0.0,
        ekf_predicted_temp: float | None = None,
        ekf_prediction_var: float | None = None,
    ) -> FusedTemperatureEstimate:
        """Compute precision-weighted theoretical room temperature across channels."""
        if not observations:
            return FusedTemperatureEstimate(value=None, raw_primary=None, weights={})

        raw_primary = next((obs.value for obs in observations if obs.is_primary), None)
        primary_obs = next((obs for obs in observations if obs.is_primary), None)
        primary_is_fresh = primary_obs is not None and primary_obs.age_s <= self._aging_threshold_s(primary_obs.entity_id)

        weighted_channels: list[tuple[str, float, float]] = []
        min_age = min(obs.age_s for obs in observations)
        for idx, observation in enumerate(observations):
            entity_id = observation.entity_id
            # When a healthy primary reference sensor is available, exclude
            # uncalibrated auxiliary channels and noisy AC internal intake
            # sensors from shifting room truth (they stay calibrated in the
            # background as a bias-corrected fallback if the primary drops out).
            if primary_is_fresh and not observation.is_primary:
                s_class = self.sensor_class(entity_id, is_primary=False)
                if s_class == "hvac_internal" or not entity_id or entity_id not in self._biases:
                    continue
            corrected, variance = self.corrected_observation(
                observation, power_fraction=power_fraction, q_fan_mix=q_fan_mix
            )
            key = entity_id or f"_anon_{idx}"
            precision = 1.0 / max(0.02, variance)
            weighted_channels.append((key, corrected, precision))

        if not weighted_channels:
            for idx, observation in enumerate(observations):
                corrected, variance = self.corrected_observation(
                    observation, power_fraction=power_fraction, q_fan_mix=q_fan_mix
                )
                key = observation.entity_id or f"_anon_{idx}"
                weighted_channels.append((key, corrected, 1.0 / max(0.02, variance)))

        ekf_precision = 0.0
        # Blend EKF physics prior only between sparse/slow updates (all sensors aging),
        # so fresh physical measurements remain responsive and exact.
        if (
            min_age > UPDATE_INTERVAL * 1.5
            and ekf_predicted_temp is not None
            and math.isfinite(ekf_predicted_temp)
            and ekf_prediction_var is not None
            and math.isfinite(ekf_prediction_var)
            and ekf_prediction_var > 0.0
        ):
            ekf_precision = 1.0 / max(0.25, float(ekf_prediction_var))

        total_precision = sum(p for _, _, p in weighted_channels) + ekf_precision
        if total_precision <= 0.0:
            return FusedTemperatureEstimate(value=raw_primary, raw_primary=raw_primary, weights={})

        weighted_sum = sum(val * p for _, val, p in weighted_channels)
        if ekf_precision > 0.0 and ekf_predicted_temp is not None:
            weighted_sum += float(ekf_predicted_temp) * ekf_precision

        weights = {key: round(p / total_precision, 3) for key, _, p in weighted_channels}
        fused_value = round(weighted_sum / total_precision, 2)
        return FusedTemperatureEstimate(
            value=fused_value,
            raw_primary=raw_primary,
            weights=weights,
            ekf_weight=round(ekf_precision / total_precision, 3),
        )

    def fuse_humidity(
        self,
        observations: Sequence[tuple[str, float, float, bool]],
        *,
        learn: bool = True,
    ) -> tuple[float | None, list[str], bool]:
        """Fuse humidity channels with primary-anchored static bias and cadence weights."""
        if not observations:
            return None, [], False

        primary_val = next((val for _, val, _, is_prim in observations if is_prim), None)
        sources: list[str] = []
        weighted: list[tuple[float, float]] = []
        primary_available = primary_val is not None

        for entity_id, value, age_s, is_primary in observations:
            if not math.isfinite(value):
                continue
            sources.append(entity_id)
            bias = self._humidity_biases.get(entity_id, 0.0)
            if not is_primary:
                if learn and primary_val is not None:
                    epsilon = value - (primary_val + bias)
                    bias = self._clamp(
                        bias + self._HUMIDITY_ETA * epsilon,
                        -self._HUMIDITY_BIAS_MAX,
                        self._HUMIDITY_BIAS_MAX,
                    )
                    self._humidity_biases[entity_id] = bias
                corrected = max(0.0, min(100.0, value - bias))
            else:
                corrected = value

            base_var = 1.0 if is_primary else (9.0 if entity_id.startswith("climate.") else 2.25)
            knee = self._aging_threshold_s(entity_id)
            eff_var = base_var * (age_s / knee) if age_s > knee else base_var
            weighted.append((corrected, 1.0 / max(0.25, eff_var)))

        if not weighted:
            return None, [], False
        total_w = sum(w for _, w in weighted)
        if total_w <= 0.0:
            return None, [], False
        fused = round(sum(v * w for v, w in weighted) / total_w, 2)
        return fused, sources, primary_available

    def calibrate_observations(
        self,
        observations: Sequence[TemperatureObservation],
        *,
        mode: str,
        power_fraction: float,
        q_fan_mix: float = 0.0,
    ) -> list[TemperatureObservation]:
        """Apply online auxiliary-sensor bias correction against the primary observation."""
        primary = next((observation for observation in observations if observation.is_primary), None)
        if primary is None:
            return list(observations)

        corrected: list[TemperatureObservation] = []
        pf = max(0.0, min(1.0, power_fraction))
        mix = max(0.0, min(1.0, q_fan_mix))
        for observation in observations:
            entity_id = observation.entity_id
            if observation.is_primary or not entity_id:
                corrected.append(observation)
                continue

            bias = self._biases.get(entity_id, SensorBiasState())
            k_mix = self._clamp(bias.k_mix or self._MIX_ACTIVE_BIAS_REDUCTION, self._K_MIX_MIN, self._K_MIX_MAX)
            if bias.k_mix > 0.0:
                k_mix = bias.k_mix
            bias_pf = pf * (1.0 - k_mix * mix)
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
            learned_k_mix = bias.k_mix
            if mix > 0.0 and pf > 0.0 and abs(bias.active_c) > 0.05:
                derivative = -bias.active_c * pf * mix
                learned_k_mix = self._clamp(
                    learned_k_mix + self._ETA_MIX * epsilon * derivative,
                    self._K_MIX_MIN,
                    self._K_MIX_MAX,
                )

            updated = SensorBiasState(static_c=static_c, active_c=active_c, k_mix=learned_k_mix)
            self._biases[entity_id] = updated
            effective_k_mix = updated.k_mix if updated.k_mix > 0.0 else self._MIX_ACTIVE_BIAS_REDUCTION
            correction_pf = pf * (1.0 - effective_k_mix * mix)
            variance_scale = 1.0 - min(self._MIX_VARIANCE_REDUCTION, effective_k_mix) * mix
            corrected.append(
                replace(
                    observation,
                    value=observation.value - (updated.static_c + updated.active_c * correction_pf),
                    variance=max(self._AUXILIARY_VARIANCE_MIN, observation.variance * variance_scale),
                )
            )

        return corrected

    def get_bias(self, entity_id: str) -> SensorBiasState:
        """Return the current learned bias for an auxiliary sensor."""
        return self._biases.get(entity_id, SensorBiasState())

    def diagnostics(
        self,
        observations: Sequence[TemperatureObservation],
        *,
        power_fraction: float,
        q_fan_mix: float = 0.0,
    ) -> list[dict[str, Any]]:
        """Return read-only diagnostics for current temperature fusion state."""
        pf = max(0.0, min(1.0, power_fraction))
        mix = max(0.0, min(1.0, q_fan_mix))
        fused = self.fuse_temperature(observations, power_fraction=pf, q_fan_mix=mix)
        result: list[dict[str, Any]] = []
        for observation in observations:
            entity_id = observation.entity_id or ""
            bias = self.get_bias(entity_id)
            effective_k_mix = bias.k_mix if bias.k_mix > 0.0 else self._MIX_ACTIVE_BIAS_REDUCTION
            correction_pf = pf * (1.0 - effective_k_mix * mix)
            active_c = 0.0 if observation.is_primary else bias.active_c * correction_pf
            static_c = 0.0 if observation.is_primary else bias.static_c
            corrected = observation.value - (static_c + active_c)
            aging_threshold = self._aging_threshold_s(entity_id)
            cadence = self.get_cadence(entity_id)
            result.append(
                {
                    "entity_id": entity_id,
                    "is_primary": observation.is_primary,
                    "sensor_class": self.sensor_class(entity_id, is_primary=observation.is_primary),
                    "value": round(observation.value, 3),
                    "corrected_value": round(corrected, 3),
                    "static_bias": round(static_c, 3),
                    "active_bias": round(active_c, 3),
                    "k_mix": round(0.0 if observation.is_primary else effective_k_mix, 3),
                    "weight": fused.weights.get(entity_id, 0.0),
                    "cadence_s": round(cadence, 1) if cadence is not None else None,
                    "age_s": round(observation.age_s, 1),
                    "variance": round(observation.variance, 4),
                    "freshness_source": self._freshness_source(observation),
                    "freshness_status": self._freshness_status(observation.age_s, aging_threshold),
                    "last_reported": self._timestamp_iso(observation.last_reported),
                    "last_updated": self._timestamp_iso(observation.last_updated),
                    "last_changed": self._timestamp_iso(observation.last_changed),
                    **({"observed_at": observation.observed_at.isoformat()} if observation.observed_at else {}),
                }
            )
        return result

    def to_dict(self) -> dict:
        """Serialize learned auxiliary sensor biases and cadences."""
        return {
            "biases": {
                entity_id: {"static_c": bias.static_c, "active_c": bias.active_c, "k_mix": bias.k_mix}
                for entity_id, bias in self._biases.items()
            },
            "cadences_s": {entity_id: round(cadence, 1) for entity_id, cadence in self._cadences_s.items()},
            "humidity_biases": {entity_id: round(bias, 3) for entity_id, bias in self._humidity_biases.items()},
        }

    @classmethod
    def from_dict(cls, data: dict | None) -> SensorFusionManager:
        """Restore learned auxiliary sensor biases and cadences."""
        manager = cls()
        if not isinstance(data, dict):
            return manager
        biases = data.get("biases", data)
        if isinstance(biases, dict):
            for entity_id, raw_bias in biases.items():
                if not isinstance(entity_id, str) or not isinstance(raw_bias, dict):
                    continue
                try:
                    static_c = float(raw_bias.get("static_c", 0.0))
                    active_c = float(raw_bias.get("active_c", 0.0))
                    k_mix = float(raw_bias.get("k_mix", 0.0))
                except TypeError, ValueError:
                    continue
                manager._biases[entity_id] = SensorBiasState(
                    static_c=manager._clamp(static_c, manager._STATIC_MIN, manager._STATIC_MAX),
                    active_c=manager._clamp(
                        active_c,
                        manager._ACTIVE_COOL_MIN,
                        manager._ACTIVE_HEAT_MAX,
                    ),
                    k_mix=manager._clamp(k_mix, manager._K_MIX_MIN, manager._K_MIX_MAX),
                )
        raw_cadences = data.get("cadences_s")
        if isinstance(raw_cadences, dict):
            for entity_id, raw_cad in raw_cadences.items():
                if not isinstance(entity_id, str):
                    continue
                try:
                    cad = float(raw_cad)
                except TypeError, ValueError:
                    continue
                manager._cadences_s[entity_id] = manager._clamp(cad, manager._CADENCE_MIN_S, manager._CADENCE_MAX_S)
        raw_hum_biases = data.get("humidity_biases")
        if isinstance(raw_hum_biases, dict):
            for entity_id, raw_hb in raw_hum_biases.items():
                if not isinstance(entity_id, str):
                    continue
                try:
                    hb = float(raw_hb)
                except TypeError, ValueError:
                    continue
                manager._humidity_biases[entity_id] = manager._clamp(
                    hb, -manager._HUMIDITY_BIAS_MAX, manager._HUMIDITY_BIAS_MAX
                )
        return manager

    @staticmethod
    def _freshness_source(observation: TemperatureObservation) -> str:
        """Return which source timestamp is driving observation age."""
        if observation.freshness_source is not None:
            return observation.freshness_source
        if observation.last_reported is not None:
            return "last_reported"
        if observation.last_updated is not None:
            return "last_updated"
        if observation.last_changed is not None:
            return "last_changed"
        return "none"

    @staticmethod
    def _freshness_status(age_s: float, aging_threshold_s: float | None = None) -> str:
        """Return a coarse freshness bucket for UI diagnostics."""
        if age_s > MAX_SENSOR_STALENESS:
            return "stale"
        threshold = float(UPDATE_INTERVAL * 2) if aging_threshold_s is None else aging_threshold_s
        if age_s > threshold:
            return "aging"
        return "fresh"

    @staticmethod
    def _timestamp_iso(value: datetime | None) -> str | None:
        """Serialize HA timestamps for frontend diagnostics."""
        return value.isoformat() if isinstance(value, datetime) else None

    def _clamp(self, value: float, lower: float, upper: float) -> float:
        """Clamp *value* to the inclusive range [lower, upper]."""
        return max(lower, min(upper, value))
