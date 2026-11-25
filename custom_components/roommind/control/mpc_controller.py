"""MPC-based climate controller for RoomMind."""

from __future__ import annotations

import logging
import math
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, cast

from homeassistant.core import HomeAssistant

from ..const import (
    AC_COOLING_BOOST_TARGET,
    AC_HEATING_BOOST_TARGET,
    BANGBANG_COOL_HYSTERESIS,
    BANGBANG_HEAT_HYSTERESIS,
    CLIMATE_MODE_COOL_ONLY,
    CLIMATE_MODE_DRY,
    CLIMATE_MODE_FAN_ONLY,
    CLIMATE_MODE_HEAT_ONLY,
    CLIMATE_MODE_OFF,
    DEFAULT_OUTDOOR_COOLING_MIN,
    DEFAULT_OUTDOOR_HEATING_MAX,
    HEATING_BOOST_TARGET,
    MODE_COOLING,
    MODE_DRY,
    MODE_FAN_ONLY,
    MODE_HEATING,
    MODE_IDLE,
    TargetTemps,
    is_override_active,
)
from ..managers.airflow_levels import resolve_fan_mode_for_policy
from ..room_config import resolve_setback_offset
from ..settings_config import mpc_control_enabled
from ..utils.device_utils import (
    SETPOINT_MODE_ADAPTIVE,
    get_ac_eids,
    get_device_by_eid,
    get_direct_setpoint_eids,
    get_idle_action,
    get_trv_eids,
    has_reliable_hvac_modes,
)
from ..utils.entity_snapshot import EntitySnapshots, capture_entity_snapshots
from ..utils.temp_utils import celsius_delta_to_ha, celsius_to_ha_temp, ha_temp_to_celsius
from .ac_overdrive import ACOverdriveManager
from .actuation import ActuationLedger, DeviceActuationResult, DispatchStatus, plan_active_temperature
from .climate_actuator import (  # noqa: F401 -- Preserve previous helper import paths.
    _command_payload_matches,
    _last_commands,
    _normalize_temperature_payload,
    _resolve_idle_setpoint,
    _send_idle_setpoint,
    _should_use_cache,
    _snap_to_step,
    async_dispatch_climate,
    async_idle_device,
    async_turn_off_climate,
    clear_command_cache,
    last_command_snapshot,
    match_fan_mode,
    remember_temperature_dispatch,
    resolve_hvac_mode,
    setpoint_delay_reason,
    temperature_feedback_tolerance,
)
from .forecast_series import build_outdoor_temperature_series
from .mpc_optimizer import MPCOptimizer, MPCPlan
from .rapid_recovery import resolve_rapid_recovery_mode
from .residual_heat import get_min_run_blocks
from .solar import SolarExposure
from .thermal_model import RoomModelManager

if TYPE_CHECKING:
    from ..managers.heat_source_orchestrator import HeatSourcePlan
    from ..managers.sensor_fusion_manager import SensorFusionManager

_LOGGER = logging.getLogger(__name__)


@dataclass
class AppliedCommandReport:
    """Commanded activity supported by dispatch evidence, separate from physical state."""

    active_eids: set[str] = field(default_factory=set)
    inactive_eids: set[str] = field(default_factory=set)
    failed_eids: set[str] = field(default_factory=set)
    deferred_eids: set[str] = field(default_factory=set)
    results: dict[str, DeviceActuationResult] = field(default_factory=dict)
    operation_results: dict[str, tuple[DeviceActuationResult, ...]] = field(default_factory=dict)

    def mark_active(self, entity_id: str) -> None:
        """Record an entity as commanded active."""
        self.active_eids.add(entity_id)
        self.inactive_eids.discard(entity_id)

    def mark_inactive(self, entity_id: str) -> None:
        """Record an entity as commanded inactive/idle."""
        self.inactive_eids.add(entity_id)
        self.active_eids.discard(entity_id)

    def record(
        self,
        entity_id: str,
        *,
        active: bool,
        operations: tuple[DeviceActuationResult, ...],
    ) -> None:
        """Record activity only when every required operation was effective."""
        result = DeviceActuationResult.combine(entity_id, operations)
        self.results[entity_id] = result
        self.operation_results[entity_id] = operations
        self.deferred_eids.discard(entity_id)
        if result.dispatch is DispatchStatus.DEFERRED:
            self.deferred_eids.add(entity_id)
            self.failed_eids.discard(entity_id)
            self.active_eids.discard(entity_id)
            self.inactive_eids.discard(entity_id)
            return
        if not result.effective:
            self.failed_eids.add(entity_id)
            self.active_eids.discard(entity_id)
            self.inactive_eids.discard(entity_id)
            return
        self.failed_eids.discard(entity_id)
        if active:
            self.mark_active(entity_id)
        else:
            self.mark_inactive(entity_id)


@dataclass(frozen=True, slots=True)
class DeviceApplyContext:
    """Resolved controller inputs shared by climate-device strategies."""

    mode: str
    targets: TargetTemps
    current_temp: float | None
    effective_target: float
    power_fraction: float
    thermostats: tuple[str, ...]
    excluded: frozenset[str]
    forced_on: frozenset[str]
    forced_off: frozenset[str]
    trv_heat_boost: float
    ac_heat_boost: float
    ac_cool_boost: float


# Assumed full mode set for devices whose hvac_modes attribute is unreliable.
# Deliberately excludes "heat_cool" so the cascade falls through to separate
# "heat"/"cool" branches which work for more device types.
_ASSUMED_FULL_MODES: list[str] = ["off", "heat", "cool", "fan_only"]


def _effective_ac_modes(state: Any) -> list[str]:
    """Return hvac_modes, assuming full capability when modes appear unreliable.

    When a device reports no active modes (heat/cool/heat_cool/auto),
    the integration likely hides modes or is misconfigured.  Return a
    generous assumed set so the command cascade picks the right mode.  The actual
    service call may still fail — the caller's try/except handles that safely.
    """
    if state is None:
        return []
    modes = state.attributes.get("hvac_modes") or []
    if has_reliable_hvac_modes(state):
        return modes
    return _ASSUMED_FULL_MODES


# Maximum prediction uncertainty (degC) for MPC to be used.
# Physical meaning: "use MPC when the 5-min prediction is accurate to ±0.5°C."
MPC_MAX_PREDICTION_STD = 0.5

# Planning parameters
PLAN_DT_MINUTES = 5
MIN_HORIZON_HOURS = 2
HORIZON_MULTIPLIER = 2.5
DEFAULT_OUTDOOR_TEMP_FALLBACK = 10.0
SAFETY_GUARD_MIN_BLOCKS = 6  # Minimum guard horizon (30 min floor)
GUARD_PREDICTION_MARGIN = 0.2  # °C margin for prediction-based guard bypass
HARD_OVERSHOOT_CEILING = 1.0  # °C — model-independent max overshoot before forced idle

# Minimum sample counts before MPC is allowed.
# Each EKF update covers ~3 min (EKF_UPDATE_MIN_DT), so these correspond
# to real-time requirements of ~3 h idle + ~1 h active-mode data.
MIN_IDLE_UPDATES = 60  # ~3 h of idle data at 3-min EKF intervals
MIN_ACTIVE_UPDATES = 20  # ~1 h of heating or cooling data


def check_acs_can_heat(hass: HomeAssistant, room_config: dict) -> bool:
    """Check if any AC entity in the room supports heating."""
    for eid in get_ac_eids(room_config.get("devices", [])):
        state = hass.states.get(eid)
        if state is None:
            continue
        modes = _effective_ac_modes(state)
        if "heat" in modes or "heat_cool" in modes or "auto" in modes:
            return True
    return False


def get_can_heat_cool(
    room_config: dict,
    outdoor_temp: float | None = None,
    outdoor_cooling_min: float = DEFAULT_OUTDOOR_COOLING_MIN,
    outdoor_heating_max: float = DEFAULT_OUTDOOR_HEATING_MAX,
    acs_can_heat: bool = False,
    *,
    override_active: bool = False,
) -> tuple[bool, bool]:
    """Determine whether heating/cooling are allowed for a room.

    Accounts for climate_mode, device availability, and outdoor temperature
    gating.  This is the single source of truth — used by coordinator,
    controller, and analytics.

    When *acs_can_heat* is True, ACs that support heating (heat pumps)
    contribute to the heating capability of the room.

    When *override_active* is True, outdoor temperature gating is bypassed
    because the user has explicitly requested a specific target temperature.
    """
    climate_mode = room_config.get("climate_mode", "auto")
    if climate_mode in (CLIMATE_MODE_DRY, CLIMATE_MODE_FAN_ONLY, CLIMATE_MODE_OFF):
        return False, False
    can_heat = climate_mode != CLIMATE_MODE_COOL_ONLY and (
        bool(get_trv_eids(room_config.get("devices", []))) or acs_can_heat
    )
    can_cool = climate_mode != CLIMATE_MODE_HEAT_ONLY and bool(get_ac_eids(room_config.get("devices", [])))

    if outdoor_temp is not None and not override_active:
        if outdoor_temp > outdoor_heating_max:
            can_heat = False
        if outdoor_temp < outdoor_cooling_min:
            can_cool = False

    return can_heat, can_cool


def is_mpc_active(
    model_manager: RoomModelManager,
    area_id: str,
    can_heat: bool,
    can_cool: bool,
    current_temp: float,
    outdoor_temp: float,
) -> bool:
    """Check if MPC control is active for a room.

    Single source of truth for MPC activation — used by coordinator
    and analytics.
    """
    model = model_manager.get_model(area_id)
    Q_check = model.Q_heat if can_heat else (-model.Q_cool if can_cool else 0.0)
    pred_std = model_manager.get_prediction_std(area_id, Q_check, current_temp, outdoor_temp, PLAN_DT_MINUTES)
    if pred_std >= MPC_MAX_PREDICTION_STD:
        return False

    n_idle, n_heating, n_cooling = model_manager.get_mode_counts(area_id)
    if n_idle < MIN_IDLE_UPDATES:
        return False
    if can_heat and n_heating < MIN_ACTIVE_UPDATES:
        return False
    if can_cool and n_cooling < MIN_ACTIVE_UPDATES:
        return False
    return True


class MPCController:
    """MPC-based climate controller for a single room.

    Falls back to bang-bang with hysteresis when model confidence is low.
    """

    def __init__(
        self,
        hass: HomeAssistant,
        room_config: dict,
        *,
        model_manager: RoomModelManager,
        actuation_ledger: ActuationLedger | None = None,
        actuator_observations: EntitySnapshots | None = None,
        outdoor_temp: float | None = None,
        outdoor_forecast: list[dict] | None = None,
        settings: dict | None = None,
        setback_offset: float | None = None,
        previous_mode: str = MODE_IDLE,
        has_external_sensor: bool = True,
        acs_can_heat: bool | None = None,
        target_resolver: Callable[[float], TargetTemps | float] | None = None,
        q_solar: float = 0.0,
        solar_exposure: SolarExposure | None = None,
        latitude: float = 0.0,
        longitude: float = 0.0,
        cloud_series: list[float | None] | None = None,
        q_residual: float = 0.0,
        heating_system_type: str = "",
        mode_on_since: float | None = None,
        shading_factor: float = 1.0,
        q_occupancy: float = 0.0,
        q_vent: float = 0.0,
        airflow_levels: list[float] | None = None,
        mix_levels: list[float] | None = None,
        vent_levels: list[float] | None = None,
        airflow_has_ventilation: bool = False,
        airflow_has_hvac_fan: bool = False,
        airflow_mix_score: float = 0.0,
        airflow_capacity_curve: list[dict[str, float]] | None = None,
        airflow_power_curve: list[dict[str, float]] | None = None,
        control_target: str = "air_temperature",
        current_humidity: float | None = None,
        night_active: bool = False,
        night_quiet_penalty: float = 0.0,
        coupling_terms: list[dict] | None = None,
        ac_overdrive: ACOverdriveManager | None = None,
        sensor_fusion: SensorFusionManager | None = None,
        inverter_regime: str | None = None,
    ) -> None:
        self.hass = hass
        self.room_config = room_config
        self.thermostats: list[str] = get_trv_eids(room_config.get("devices", []))
        self.acs: list[str] = get_ac_eids(room_config.get("devices", []))
        self._devices: list[dict] = room_config.get("devices", [])
        self._direct_eids: set[str] = get_direct_setpoint_eids(self._devices)
        self.climate_mode: str = room_config.get("climate_mode", "auto")
        self.outdoor_temp = outdoor_temp
        self.outdoor_forecast = outdoor_forecast or []
        self.previous_mode = previous_mode
        self.has_external_sensor = has_external_sensor
        self._acs_can_heat = acs_can_heat
        self._model_manager = model_manager
        self._actuation_ledger = actuation_ledger
        self._actuator_observations = actuator_observations
        self._cycle_observations: EntitySnapshots | None = None
        self._paced_entities: set[str] = set()
        self._area_id = room_config.get("area_id", "unknown")
        self._dispatch_results: dict[str, list[DeviceActuationResult]] = {}
        self._overdrive_statuses: dict[str, dict[str, Any]] = {}
        self._ac_overdrive = ac_overdrive
        self._sensor_fusion = sensor_fusion
        self._inverter_regime = inverter_regime
        self._target_resolver = target_resolver
        self.last_plan: MPCPlan | None = None
        self._solar_exposure = solar_exposure or SolarExposure(raw_solar=q_solar, shading_factor=shading_factor)
        self.q_solar = self._solar_exposure.raw_solar
        self._latitude = latitude
        self._longitude = longitude
        self._cloud_series = cloud_series or []
        self.q_residual = q_residual
        self._heating_system_type = heating_system_type
        self._mode_on_since = mode_on_since
        self.q_occupancy = q_occupancy
        self.q_vent = q_vent
        self.airflow_levels = airflow_levels or [0.0]
        self.mix_levels = mix_levels if mix_levels is not None else self.airflow_levels
        self.vent_levels = (
            vent_levels if vent_levels is not None else ([0.0] if not airflow_has_ventilation else self.airflow_levels)
        )
        self.airflow_has_ventilation = airflow_has_ventilation
        self.airflow_has_hvac_fan = airflow_has_hvac_fan
        self.airflow_mix_score = airflow_mix_score
        self.airflow_capacity_curve = airflow_capacity_curve or []
        self.airflow_power_curve = airflow_power_curve or []
        self.control_target = control_target
        self.current_humidity = current_humidity
        self.night_active = night_active
        self.night_quiet_penalty = night_quiet_penalty
        self.coupling_terms = coupling_terms or []
        self.last_airflow_level = 0.0
        self.last_airflow_mix_level = 0.0
        self.last_airflow_vent_level = 0.0
        self._idle_targets: TargetTemps | None = None
        self.preheat: dict[str, Any] | None = None

        s = settings or {}
        self._settings = s
        self._setback_offset = setback_offset if setback_offset is not None else resolve_setback_offset(room_config, s)
        self.outdoor_cooling_min = s.get("outdoor_cooling_min", DEFAULT_OUTDOOR_COOLING_MIN)
        self.outdoor_heating_max = s.get("outdoor_heating_max", DEFAULT_OUTDOOR_HEATING_MAX)

        # Comfort weight from UI slider (0-100, default 70 = comfort-biased).
        # Maps to optimizer w_comfort / w_energy ratio.
        cw = s.get("comfort_weight", 70)
        self._w_comfort = max(1.0, cw / 10.0)
        self._w_energy = max(1.0, (100 - cw) / 10.0)
        self._optimizer_strategy = str(s.get("optimizer_strategy", "greedy"))
        self._mpc_enabled = mpc_control_enabled(s)

    async def async_evaluate(
        self,
        current_temp: float | None,
        targets: TargetTemps,
    ) -> tuple[str, float]:
        """Evaluate dual-target control intent as ``(mode, power_fraction)``."""
        if self.climate_mode in (CLIMATE_MODE_OFF, CLIMATE_MODE_DRY, CLIMATE_MODE_FAN_ONLY):
            self.last_airflow_level = 0.0
            self.last_airflow_mix_level = 0.0
            self.last_airflow_vent_level = 0.0
            if self.climate_mode == CLIMATE_MODE_OFF or not self.acs:
                return MODE_IDLE, 0.0
            if self.climate_mode == CLIMATE_MODE_DRY:
                return MODE_DRY, 1.0
            return MODE_FAN_ONLY, 1.0

        if not self.has_external_sensor:
            self.last_airflow_level = 0.0
            self.last_airflow_mix_level = 0.0
            self.last_airflow_vent_level = 0.0
            mode = self._evaluate_managed_mode(targets)
            return mode, 1.0  # managed mode: device self-regulates

        if not self._mpc_enabled:
            return self._bangbang_result(current_temp, targets)

        # Use the model's prediction uncertainty to decide MPC vs bang-bang.
        # Compute std for the actual operating conditions (heating power as proxy).
        model = self._model_manager.get_model(self._area_id)
        can_heat, can_cool = self._get_can_heat_cool()
        Q_check = model.Q_heat if can_heat else (-model.Q_cool if can_cool else 0.0)
        T_out = self.outdoor_temp if self.outdoor_temp is not None else DEFAULT_OUTDOOR_TEMP_FALLBACK
        pred_std = self._model_manager.get_prediction_std(
            self._area_id,
            Q_check,
            current_temp if current_temp is not None else 20.0,
            T_out,
            PLAN_DT_MINUTES,
            q_solar=self.q_solar,
            q_residual=self.q_residual,
            q_occupancy=self.q_occupancy,
            q_vent=self.q_vent,
        )
        if pred_std < MPC_MAX_PREDICTION_STD and self._has_enough_data(can_heat, can_cool):
            return self._evaluate_mpc(current_temp, targets)
        # Bang-bang fallback: binary control (1.0 power) for fast EKF learning
        return self._bangbang_result(current_temp, targets)

    def _bangbang_result(
        self,
        current_temp: float | None,
        targets: TargetTemps,
    ) -> tuple[str, float]:
        """Evaluate deterministic hysteresis control and clear MPC airflow."""
        self.last_airflow_level = 0.0
        self.last_airflow_mix_level = 0.0
        self.last_airflow_vent_level = 0.0
        mode = self._evaluate_bangbang(current_temp, targets)
        return mode, 1.0 if mode != MODE_IDLE else 0.0

    def _has_enough_data(self, can_heat: bool, can_cool: bool) -> bool:
        """Check if the model has enough samples for reliable MPC."""
        n_idle, n_heating, n_cooling = self._model_manager.get_mode_counts(self._area_id)
        if n_idle < MIN_IDLE_UPDATES:
            return False
        # Require active-mode data for the modes this room can actually use
        if can_heat and n_heating < MIN_ACTIVE_UPDATES:
            return False
        if can_cool and n_cooling < MIN_ACTIVE_UPDATES:
            return False
        return True

    def _within_min_run(self, mode: str) -> bool:
        """Return True if the given mode is currently active and within its minimum run window.

        Used to prevent premature shutdown of slow heating systems (e.g. underfloor)
        that need a guaranteed minimum run time before being allowed to idle.
        """
        if self.previous_mode != mode or self._mode_on_since is None:
            return False
        min_run_seconds = get_min_run_blocks(self._heating_system_type, PLAN_DT_MINUTES) * PLAN_DT_MINUTES * 60
        return (time.time() - self._mode_on_since) < min_run_seconds

    def _predict_idle_drift(self, current_temp: float, dt_minutes: float) -> float:
        """Predict room temperature assuming no active HVAC over *dt_minutes*.

        Used by the safety guard to check whether temperature will drift below
        (or above) target before suppressing optimizer recommendations.
        """
        model = self._model_manager.get_model(self._area_id)
        T_out = self.outdoor_temp if self.outdoor_temp is not None else DEFAULT_OUTDOOR_TEMP_FALLBACK
        return model.predict(
            current_temp,
            T_out,
            Q_active=0.0,
            dt_minutes=dt_minutes,
            q_solar=self._solar_exposure.shaded_solar,
            q_residual=self.q_residual,
            q_occupancy=self.q_occupancy,
            q_vent=self.q_vent,
        )

    def _build_target_series(
        self,
        current_temp: float,
        targets: TargetTemps,
        horizon_blocks: int,
    ) -> tuple[list[float], list[float]]:
        """Build heat and cool target temperature horizons for the optimizer."""
        if self._target_resolver is not None and self.room_config.get("preheat_enabled", True):
            now = time.time()
            dt_seconds = PLAN_DT_MINUTES * 60
            raw_targets = [self._target_resolver(now + i * dt_seconds) for i in range(horizon_blocks)]
            if raw_targets and isinstance(raw_targets[0], TargetTemps):
                tt_targets = cast(list[TargetTemps], raw_targets)
                return (
                    [t.heat if t.heat is not None else current_temp for t in tt_targets],
                    [t.cool if t.cool is not None else current_temp for t in tt_targets],
                )
            float_targets = cast(list[float | None], raw_targets)
            heat_series = [t if t is not None else current_temp for t in float_targets]
            return heat_series, list(heat_series)
        fallback_h = targets.heat if targets.heat is not None else current_temp
        fallback_c = targets.cool if targets.cool is not None else current_temp
        return [fallback_h] * horizon_blocks, [fallback_c] * horizon_blocks

    def _apply_mpc_safety_guard(
        self,
        *,
        action: str,
        power_fraction: float,
        current_temp: float,
        near_heat: list[float],
        near_cool: list[float],
        guard_blocks: int,
    ) -> tuple[str, float]:
        """Suppress active conditioning past upcoming target bounds unless drift warrants pre-actuation."""
        guard_horizon_minutes = guard_blocks * PLAN_DT_MINUTES
        if near_heat and action == MODE_HEATING and current_temp > max(near_heat) + HARD_OVERSHOOT_CEILING:
            _LOGGER.info(
                "Hard ceiling: suppressing HEATING for %s at %.1f°C (target max %.1f°C + %.1f°C ceiling)",
                self._area_id,
                current_temp,
                max(near_heat),
                HARD_OVERSHOOT_CEILING,
            )
            return MODE_IDLE, 0.0
        if near_cool and action == MODE_COOLING and current_temp < min(near_cool) - HARD_OVERSHOOT_CEILING:
            _LOGGER.info(
                "Hard ceiling: suppressing COOLING for %s at %.1f°C (target min %.1f°C - %.1f°C ceiling)",
                self._area_id,
                current_temp,
                min(near_cool),
                HARD_OVERSHOOT_CEILING,
            )
            return MODE_IDLE, 0.0
        if near_heat and action == MODE_HEATING and current_temp >= max(near_heat):
            predicted = self._predict_idle_drift(current_temp, guard_horizon_minutes)
            if predicted >= min(near_heat) - GUARD_PREDICTION_MARGIN and not self._within_min_run(MODE_HEATING):
                return MODE_IDLE, 0.0
        elif near_cool and action == MODE_COOLING and current_temp <= min(near_cool):
            predicted = self._predict_idle_drift(current_temp, guard_horizon_minutes)
            if predicted <= max(near_cool) + GUARD_PREDICTION_MARGIN and not self._within_min_run(MODE_COOLING):
                return MODE_IDLE, 0.0
        return action, power_fraction

    @staticmethod
    def _detect_preheat_state(
        *,
        action: str,
        current_temp: float,
        targets: TargetTemps,
        near_heat: list[float],
        near_cool: list[float],
    ) -> dict[str, Any] | None:
        """Return active preheat/precool metadata when preparing for a scheduled step change."""
        if action == MODE_HEATING and near_heat:
            max_upcoming = max(near_heat)
            if (targets.heat is None and current_temp < max_upcoming) or (
                targets.heat is not None and max_upcoming > targets.heat and current_temp >= targets.heat
            ):
                return {"mode": MODE_HEATING, "target": round(max_upcoming, 1)}
        elif action == MODE_COOLING and near_cool:
            min_upcoming = min(near_cool)
            if (targets.cool is None and current_temp > min_upcoming) or (
                targets.cool is not None and min_upcoming < targets.cool and current_temp <= targets.cool
            ):
                return {"mode": MODE_COOLING, "target": round(min_upcoming, 1)}
        return None

    def _evaluate_mpc(
        self,
        current_temp: float | None,
        targets: TargetTemps,
    ) -> tuple[str, float]:
        """MPC evaluation — use optimizer to determine action and power fraction."""
        if current_temp is None or (targets.heat is None and targets.cool is None):
            return MODE_IDLE, 0.0

        model = self._model_manager.get_model(self._area_id)
        can_heat, can_cool = self._get_can_heat_cool()
        horizon_target = targets.heat if targets.heat is not None else targets.cool
        horizon_blocks = self._compute_horizon_blocks(model, current_temp, horizon_target)
        heat_target_series, cool_target_series = self._build_target_series(current_temp, targets, horizon_blocks)

        from .residual_heat import get_min_run_blocks

        min_run = get_min_run_blocks(self._heating_system_type, PLAN_DT_MINUTES)
        recovery = resolve_rapid_recovery_mode(
            self.room_config,
            self._settings,
            current_temp=current_temp,
            targets=targets,
            night_active=self.night_active,
            outdoor_temp=self.outdoor_temp,
        )
        recovery_allowed = (recovery == MODE_HEATING and can_heat) or (recovery == MODE_COOLING and can_cool)
        mix_levels = self.mix_levels
        night_limit = self.room_config.get("max_fan_level_night")
        if self.night_active and night_limit is not None:
            mix_levels = [level for level in mix_levels if level <= float(night_limit)] or [0.0]

        optimizer = MPCOptimizer(
            model=model,
            can_heat=can_heat,
            can_cool=can_cool,
            w_comfort=self._w_comfort * (2.0 if recovery_allowed else 1.0),
            w_energy=self._w_energy,
            outdoor_cooling_min=self.outdoor_cooling_min,
            outdoor_heating_max=self.outdoor_heating_max,
            min_run_blocks=min_run,
            override_active=is_override_active(self.room_config),
            heating_system_type=self._heating_system_type,
            airflow_levels=self.airflow_levels,
            mix_levels=mix_levels,
            vent_levels=self.vent_levels,
            airflow_has_ventilation=self.airflow_has_ventilation,
            airflow_has_hvac_fan=self.airflow_has_hvac_fan,
            airflow_mix_score=self.airflow_mix_score,
            airflow_capacity_curve=self.airflow_capacity_curve,
            airflow_power_curve=self.airflow_power_curve,
            control_target=self.control_target,
            current_humidity=self.current_humidity,
            night_quiet_penalty=self.night_quiet_penalty if self.night_active else 0.0,
            coupling_terms=self.coupling_terms,
            optimizer_strategy=self._optimizer_strategy,
        )
        plan = optimizer.optimize(
            T_room=current_temp,
            T_outdoor_series=self._build_outdoor_series(horizon_blocks),
            heat_target_series=heat_target_series,
            cool_target_series=cool_target_series,
            dt_minutes=PLAN_DT_MINUTES,
            solar_series=self._build_solar_series(horizon_blocks),
            residual_series=self._build_residual_series(horizon_blocks),
            occupancy_series=[self.q_occupancy] * horizon_blocks,
        )
        self.last_plan = plan

        action = plan.get_current_action()
        power_fraction = plan.get_current_power_fraction()
        self.last_airflow_level = plan.get_current_airflow_level()
        self.last_airflow_mix_level = plan.get_current_mix_level()
        self.last_airflow_vent_level = plan.get_current_vent_level()
        if action == MODE_FAN_ONLY:
            action = MODE_IDLE
            power_fraction = 0.0

        guard_blocks = max(SAFETY_GUARD_MIN_BLOCKS, min_run, plan.lookahead_blocks)
        near_heat = heat_target_series[:guard_blocks]
        near_cool = cool_target_series[:guard_blocks]
        action, power_fraction = self._apply_mpc_safety_guard(
            action=action,
            power_fraction=power_fraction,
            current_temp=current_temp,
            near_heat=near_heat,
            near_cool=near_cool,
            guard_blocks=guard_blocks,
        )
        self.preheat = self._detect_preheat_state(
            action=action,
            current_temp=current_temp,
            targets=targets,
            near_heat=near_heat,
            near_cool=near_cool,
        )
        return action, power_fraction

    def _evaluate_bangbang(
        self,
        current_temp: float | None,
        targets: TargetTemps,
    ) -> str:
        """Fallback: bang-bang with hysteresis and dead-band support."""
        if current_temp is None:
            return MODE_IDLE

        can_heat, can_cool = self._get_can_heat_cool()
        heat_target = targets.heat
        cool_target = targets.cool

        # Mode stickiness
        if self.previous_mode == MODE_HEATING and can_heat and heat_target is not None:
            if current_temp < heat_target or self._within_min_run(MODE_HEATING):
                return MODE_HEATING
            return MODE_IDLE

        if self.previous_mode == MODE_COOLING and can_cool and cool_target is not None:
            if current_temp > cool_target or self._within_min_run(MODE_COOLING):
                return MODE_COOLING
            return MODE_IDLE

        # From idle: threshold to start
        if can_heat and heat_target is not None and current_temp < heat_target - BANGBANG_HEAT_HYSTERESIS:
            return MODE_HEATING

        if can_cool and cool_target is not None and current_temp > cool_target + BANGBANG_COOL_HYSTERESIS:
            return MODE_COOLING

        return MODE_IDLE

    def _evaluate_managed_mode(self, targets: TargetTemps) -> str:
        """Managed Mode: device self-regulates.

        In auto mode with both thermostats and ACs, both device types
        are activated (each with its own target temp) and self-regulate
        independently.  async_apply handles this via has_external_sensor.
        The returned mode is used for display and outdoor gating only.
        """
        if targets.heat is None and targets.cool is None:
            return MODE_IDLE

        can_heat, can_cool = self._get_can_heat_cool()

        if self.climate_mode in (CLIMATE_MODE_OFF, CLIMATE_MODE_DRY, CLIMATE_MODE_FAN_ONLY):
            return MODE_IDLE

        if self.climate_mode == CLIMATE_MODE_COOL_ONLY:
            return MODE_COOLING if can_cool else MODE_IDLE

        if self.climate_mode == CLIMATE_MODE_HEAT_ONLY:
            return MODE_HEATING if can_heat else MODE_IDLE

        # Auto mode: activate all available, non-gated device types.
        # Both thermostats and ACs get their respective target temps and self-regulate.
        if can_heat and can_cool:
            # Both available — display mode based on season heuristic
            return MODE_HEATING
        if can_heat:
            return MODE_HEATING
        if can_cool:
            return MODE_COOLING
        return MODE_IDLE

    def _get_can_heat_cool(self) -> tuple[bool, bool]:
        """Determine whether heating/cooling are allowed based on climate mode."""
        _override = is_override_active(self.room_config)
        can_heat, can_cool = get_can_heat_cool(
            self.room_config,
            self.outdoor_temp,
            self.outdoor_cooling_min,
            self.outdoor_heating_max,
            acs_can_heat=(
                self._acs_can_heat
                if self._acs_can_heat is not None
                else check_acs_can_heat(self.hass, self.room_config)
            ),
            override_active=_override,
        )

        if self.outdoor_temp is not None:
            if _override and (
                self.outdoor_temp < self.outdoor_cooling_min or self.outdoor_temp > self.outdoor_heating_max
            ):
                _LOGGER.debug(
                    "%s: override active, outdoor gate bypassed (outdoor=%.1f, cooling_min=%.1f, heating_max=%.1f)",
                    self._area_id,
                    self.outdoor_temp,
                    self.outdoor_cooling_min,
                    self.outdoor_heating_max,
                )
            elif not _override:
                if self.outdoor_temp < self.outdoor_cooling_min:
                    _LOGGER.debug(
                        "%s: outdoor gate blocking cooling (outdoor=%.1f < cooling_min=%.1f)",
                        self._area_id,
                        self.outdoor_temp,
                        self.outdoor_cooling_min,
                    )
                if self.outdoor_temp > self.outdoor_heating_max:
                    _LOGGER.debug(
                        "%s: outdoor gate blocking heating (outdoor=%.1f > heating_max=%.1f)",
                        self._area_id,
                        self.outdoor_temp,
                        self.outdoor_heating_max,
                    )

        return can_heat, can_cool

    def _compute_horizon_blocks(self, model: Any, current_temp: float, target_temp: float | None) -> int:
        """Compute adaptive horizon in blocks.

        target_temp can be a single value or the primary target from TargetTemps.
        """
        if target_temp is None:
            return int(MIN_HORIZON_HOURS * 60 / PLAN_DT_MINUTES)
        delta = abs(current_temp - target_temp) + 3.0  # extra margin
        Q_max = max(model.Q_heat, model.Q_cool)
        if Q_max > 0:
            rate = Q_max / (model.C * 60)  # °C/min approx
            if rate > 0:
                est_minutes = delta / rate
                horizon_minutes = max(MIN_HORIZON_HOURS * 60, est_minutes * HORIZON_MULTIPLIER)
                return max(24, int(horizon_minutes / PLAN_DT_MINUTES))
        return int(MIN_HORIZON_HOURS * 60 / PLAN_DT_MINUTES)  # default 24 blocks = 2h

    def _build_outdoor_series(self, n_blocks: int) -> list[float]:
        """Build outdoor temperature series from forecast or current value."""
        return build_outdoor_temperature_series(
            self.outdoor_forecast,
            self.outdoor_temp,
            n_blocks,
            fallback=DEFAULT_OUTDOOR_TEMP_FALLBACK,
        )

    def _build_solar_series(self, n_blocks: int) -> list[float]:
        """Build solar irradiance series for MPC horizon from forecast cloud data."""
        from .solar import build_solar_series

        # Expand hourly cloud coverage to 5-min blocks (×12 per hour)
        cloud_per_block: list[float | None] | None = None
        if self._cloud_series:
            expanded: list[float | None] = []
            for cc in self._cloud_series:
                expanded.extend([cc] * 12)
            cloud_per_block = expanded[:n_blocks]
            while len(cloud_per_block) < n_blocks:
                cloud_per_block.append(cloud_per_block[-1] if cloud_per_block else None)

        series = build_solar_series(
            self._latitude,
            self._longitude,
            n_blocks,
            dt_minutes=PLAN_DT_MINUTES,
            cloud_series=cloud_per_block,
        )
        # MPC uses unshaded solar to avoid oscillation feedback loop:
        # covers deployed → low solar prediction → retract → high solar → deploy
        return series

    @property
    def predicted_peak_temp(self) -> float | None:
        """Return the maximum predicted temperature over the MPC lookahead horizon.

        Available after async_evaluate() has been called.
        Returns None if no MPC plan was computed (bang-bang mode or insufficient data).
        """
        plan = self.last_plan
        if plan is None or not plan.temperatures or len(plan.temperatures) < 2:
            return None
        return max(plan.temperatures[1:])  # Skip index 0 (current T)

    def _build_residual_series(self, n_blocks: int) -> list[float] | None:
        """Build decaying residual heat series for MPC horizon."""
        if self.q_residual <= 0 or not self._heating_system_type:
            return None
        from ..const import HEATING_SYSTEM_PROFILES, RESIDUAL_HEAT_CUTOFF

        profile = HEATING_SYSTEM_PROFILES.get(self._heating_system_type)
        if not profile:
            return None
        tau = profile["tau_minutes"]
        if tau <= 0:
            return None
        series: list[float] = []
        for i in range(n_blocks):
            q = self.q_residual * math.exp(-i * PLAN_DT_MINUTES / tau)
            series.append(q if q >= RESIDUAL_HEAT_CUTOFF else 0.0)
        return series

    async def _async_apply_managed_auto(
        self,
        context: DeviceApplyContext,
        *,
        can_heat: bool,
        can_cool: bool,
    ) -> AppliedCommandReport:
        """Let devices self-regulate in managed auto mode.

        Range-capable ACs intentionally receive both targets in ``heat_cool``
        mode. Devices without range mode fall back to a gated single direction.
        """
        report = AppliedCommandReport()
        mode = context.mode
        targets = context.targets
        thermostats = context.thermostats
        forced_off = context.forced_off
        ha_heat_target = celsius_to_ha_temp(self.hass, targets.heat) if targets.heat is not None else None
        ha_cool_target = celsius_to_ha_temp(self.hass, targets.cool) if targets.cool is not None else None
        selected_target = ha_cool_target if mode == MODE_COOLING else ha_heat_target
        selected_intent = "cool" if mode == MODE_COOLING else "heat"
        if selected_target is None:
            selected_target = ha_heat_target if ha_heat_target is not None else ha_cool_target

        for eid in thermostats:
            if eid in forced_off:
                await self._async_idle_device(eid, targets=targets, report=report)
                continue
            if can_heat and ha_heat_target is not None:
                mode_result = await self._call("set_hvac_mode", {"entity_id": eid, "hvac_mode": "heat"})
                temperature_result = await self._call(
                    "set_temperature",
                    {"entity_id": eid, "temperature": ha_heat_target, "hvac_mode": "heat"},
                    temp_intent="heat",
                )
                report.record(
                    eid,
                    active=True,
                    operations=(mode_result, temperature_result),
                )
            else:
                await self._async_idle_device(eid, targets=self._idle_targets, report=report)

        for eid in self.acs:
            if eid in forced_off:
                await self._async_idle_device(eid, targets=targets, report=report)
                continue
            ac_state = self._device_state(eid)
            ac_modes = _effective_ac_modes(ac_state)
            ac_heat_target = ha_heat_target if ha_heat_target is not None else ha_cool_target
            if selected_target is None:
                await self._async_idle_device(eid, targets=self._idle_targets, report=report)
            elif "heat_cool" in ac_modes:
                await self._call("set_hvac_mode", {"entity_id": eid, "hvac_mode": "heat_cool"})
                ac_state_now = self._device_state(eid)
                is_range = ac_state_now and ac_state_now.attributes.get("target_temp_low") is not None
                if is_range and ha_heat_target is not None and ha_cool_target is not None:
                    await self._call(
                        "set_temperature",
                        {
                            "entity_id": eid,
                            "target_temp_low": min(ha_heat_target, ha_cool_target),
                            "target_temp_high": max(ha_heat_target, ha_cool_target),
                            "hvac_mode": "heat_cool",
                        },
                    )
                else:
                    await self._call(
                        "set_temperature",
                        {"entity_id": eid, "temperature": selected_target, "hvac_mode": "heat_cool"},
                        temp_intent=selected_intent,
                    )
                report.mark_active(eid)
            elif not thermostats and can_heat and can_cool and "heat" in ac_modes and "cool" in ac_modes:
                dev_temp = ac_state.attributes.get("current_temperature") if ac_state else None
                if dev_temp is not None and ha_cool_target is not None and dev_temp > ha_cool_target:
                    await self._call("set_hvac_mode", {"entity_id": eid, "hvac_mode": "cool"})
                    await self._call(
                        "set_temperature",
                        {"entity_id": eid, "temperature": ha_cool_target, "hvac_mode": "cool"},
                        temp_intent="cool",
                    )
                else:
                    ac_heat_t = ha_heat_target if ha_heat_target is not None else ha_cool_target
                    await self._call("set_hvac_mode", {"entity_id": eid, "hvac_mode": "heat"})
                    await self._call(
                        "set_temperature",
                        {"entity_id": eid, "temperature": ac_heat_t, "hvac_mode": "heat"},
                        temp_intent="heat",
                    )
                report.mark_active(eid)
            elif can_cool and "cool" in ac_modes:
                await self._call("set_hvac_mode", {"entity_id": eid, "hvac_mode": "cool"})
                await self._call(
                    "set_temperature",
                    {"entity_id": eid, "temperature": selected_target, "hvac_mode": "cool"},
                    temp_intent="cool",
                )
                report.mark_active(eid)
            elif can_heat and "heat" in ac_modes:
                await self._call("set_hvac_mode", {"entity_id": eid, "hvac_mode": "heat"})
                await self._call(
                    "set_temperature",
                    {"entity_id": eid, "temperature": ac_heat_target, "hvac_mode": "heat"},
                    temp_intent="heat",
                )
                report.mark_active(eid)
            elif "auto" in ac_modes:
                await self._call("set_hvac_mode", {"entity_id": eid, "hvac_mode": "auto"})
                await self._call(
                    "set_temperature",
                    {"entity_id": eid, "temperature": selected_target, "hvac_mode": "auto"},
                    temp_intent=selected_intent,
                )
                report.mark_active(eid)
            else:
                await self._async_idle_device(eid, targets=self._idle_targets, report=report)
        return report

    async def _async_apply_heat_source_plan(
        self,
        plan: HeatSourcePlan,
        context: DeviceApplyContext,
    ) -> AppliedCommandReport:
        """Route heating commands through an explicit heat-source plan."""
        report = AppliedCommandReport()
        targets = context.targets

        for cmd in plan.commands:
            if cmd.entity_id in context.excluded:
                continue
            if cmd.entity_id in context.forced_on and not cmd.active:
                # Compressor protection: keep device running at target temp
                # to prevent overshoot (defensive — currently unreachable
                # because forced_on is only populated for IDLE mode).
                if targets.heat is not None:
                    ha_t = celsius_to_ha_temp(self.hass, targets.heat)
                    if cmd.device_type == "thermostat":
                        await self._call(
                            "set_hvac_mode",
                            {"entity_id": cmd.entity_id, "hvac_mode": "heat"},
                        )
                        await self._call(
                            "set_temperature",
                            {"entity_id": cmd.entity_id, "temperature": ha_t, "hvac_mode": "heat"},
                            temp_intent="heat",
                        )
                    else:
                        ac_state = self._device_state(cmd.entity_id)
                        ac_modes = _effective_ac_modes(ac_state)
                        if "heat" in ac_modes:
                            ac_mode = "heat"
                        elif "heat_cool" in ac_modes:
                            ac_mode = "heat_cool"
                        elif "auto" in ac_modes:
                            ac_mode = "auto"
                        else:
                            continue
                        await self._call(
                            "set_hvac_mode",
                            {"entity_id": cmd.entity_id, "hvac_mode": ac_mode},
                        )
                        await self._call(
                            "set_temperature",
                            {"entity_id": cmd.entity_id, "temperature": ha_t, "hvac_mode": ac_mode},
                            temp_intent="heat",
                        )
                    report.mark_active(cmd.entity_id)
                continue
            if cmd.entity_id in context.forced_off and cmd.active:
                await self._async_idle_device(cmd.entity_id, targets=targets, report=report)
                continue
            if cmd.active:
                if cmd.device_type == "thermostat":
                    ha_t = self._plan_device_temperature(
                        cmd.entity_id, context, heating=True, demand=cmd.power_fraction
                    )
                    await self._call("set_hvac_mode", {"entity_id": cmd.entity_id, "hvac_mode": "heat"})
                    await self._call(
                        "set_temperature",
                        {"entity_id": cmd.entity_id, "temperature": ha_t, "hvac_mode": "heat"},
                        temp_intent="heat",
                    )
                    report.mark_active(cmd.entity_id)
                else:  # ac
                    ha_t = self._plan_device_temperature(
                        cmd.entity_id, context, heating=True, demand=cmd.power_fraction
                    )
                    ac_state = self._device_state(cmd.entity_id)
                    ac_modes = _effective_ac_modes(ac_state)
                    if "heat" in ac_modes:
                        ac_mode = "heat"
                    elif "heat_cool" in ac_modes:
                        ac_mode = "heat_cool"
                    elif "auto" in ac_modes:
                        ac_mode = "auto"
                    else:
                        ac_mode = ""
                    if ac_mode:
                        await self._call("set_hvac_mode", {"entity_id": cmd.entity_id, "hvac_mode": ac_mode})
                        await self._call(
                            "set_temperature",
                            {"entity_id": cmd.entity_id, "temperature": ha_t, "hvac_mode": ac_mode},
                            temp_intent="heat",
                        )
                        report.mark_active(cmd.entity_id)
                    else:
                        await self._async_idle_device(cmd.entity_id, targets=self._idle_targets, report=report)
            elif cmd.device_type == "thermostat":
                # Idle inactive TRVs via the configured idle_action. Keeping
                # them at current_temp can reopen a stepped valve on sensor
                # fluctuation and cause mechanical twitching (#168).
                await self._async_idle_device(cmd.entity_id, targets=targets, report=report)
            else:
                await self._async_idle_device(cmd.entity_id, targets=self._idle_targets, report=report)
        return report

    async def _async_apply_standard(self, context: DeviceApplyContext) -> AppliedCommandReport:
        """Dispatch the standard device strategy for the requested mode."""
        if context.mode == MODE_IDLE:
            if self.climate_mode == CLIMATE_MODE_OFF:
                return await self._async_apply_force_off(context)
            return await self._async_apply_idle(context)
        if context.mode == MODE_DRY:
            return await self._async_apply_dry(context)
        if context.mode == MODE_FAN_ONLY:
            return await self._async_apply_fan_only(context)
        if context.mode == MODE_COOLING:
            return await self._async_apply_cooling(context)
        return await self._async_apply_heating(context)

    async def _async_apply_force_off(self, context: DeviceApplyContext) -> AppliedCommandReport:
        """Turn all climate devices off when the room mode is explicitly Off."""
        report = AppliedCommandReport()
        for eid in (*context.thermostats, *self.acs):
            if eid in context.forced_on:
                await self._async_idle_device(eid, targets=context.targets, report=report)
                continue
            state = self._device_state(eid)
            hvac_modes = (state.attributes.get("hvac_modes") or []) if state else []
            if not hvac_modes or "off" in hvac_modes:
                ops = await async_turn_off_climate(
                    self.hass,
                    eid,
                    area_id=self._area_id,
                    protect_valve=(eid in context.thermostats),
                    observations=self._cycle_observations,
                )
                for result in ops:
                    self._record_dispatch_result(result)
                report.record(eid, active=False, operations=ops)
            else:
                await self._async_idle_device(eid, targets=context.targets, report=report)
        return report

    async def _async_apply_dry(self, context: DeviceApplyContext) -> AppliedCommandReport:
        """Command ACs to dehumidify (dry), falling back to cooling if dry is unsupported."""
        report = AppliedCommandReport()
        for eid in self.acs:
            if eid in context.forced_off:
                await self._async_idle_device(eid, targets=context.targets, report=report)
                continue
            ac_state = self._device_state(eid)
            ac_modes = _effective_ac_modes(ac_state)
            if not ac_modes or "dry" in ac_modes:
                mode_result = await self._call("set_hvac_mode", {"entity_id": eid, "hvac_mode": "dry"})
                report.record(eid, active=True, operations=(mode_result,))
            elif "cool" in ac_modes:
                mode_result = await self._call("set_hvac_mode", {"entity_id": eid, "hvac_mode": "cool"})
                if context.targets.cool is not None:
                    ha_t = self._plan_device_temperature(eid, context, heating=False)
                    temp_result = await self._call(
                        "set_temperature",
                        {"entity_id": eid, "temperature": ha_t, "hvac_mode": "cool"},
                        temp_intent="cool",
                    )
                    report.record(eid, active=True, operations=(mode_result, temp_result))
                else:
                    report.record(eid, active=True, operations=(mode_result,))
            else:
                await self._async_idle_device(eid, targets=self._idle_targets, report=report)
        for eid in context.thermostats:
            await self._async_idle_device(eid, targets=self._idle_targets, report=report)
        return report

    async def _async_apply_fan_only(self, context: DeviceApplyContext) -> AppliedCommandReport:
        """Command ACs to fan-only circulation mode while idling TRVs."""
        report = AppliedCommandReport()
        for eid in self.acs:
            if eid in context.forced_off:
                await self._async_idle_device(eid, targets=context.targets, report=report)
                continue
            ac_state = self._device_state(eid)
            ac_modes = _effective_ac_modes(ac_state)
            if not ac_modes or "fan_only" in ac_modes:
                operations: list[DeviceActuationResult] = []
                mode_result = await self._call("set_hvac_mode", {"entity_id": eid, "hvac_mode": "fan_only"})
                operations.append(mode_result)
                _, idle_fan_mode = get_idle_action(self._devices, eid)
                attrs = ac_state.attributes if ac_state else {}
                fan_modes = [str(item) for item in attrs.get("fan_modes") or []]
                fan_policy = str(self.room_config.get("fan_speed_mode") or "auto").strip()
                target_fan = (
                    resolve_fan_mode_for_policy(fan_policy, fan_modes) or idle_fan_mode
                    if fan_policy.lower() != "auto"
                    else idle_fan_mode
                )
                if target_fan and target_fan in fan_modes and attrs.get("fan_mode") != target_fan:
                    fan_result = await self._call(
                        "set_fan_mode",
                        {"entity_id": eid, "fan_mode": target_fan},
                    )
                    operations.append(fan_result)
                report.record(eid, active=True, operations=tuple(operations))
            else:
                await self._async_idle_device(eid, targets=self._idle_targets, report=report)
        for eid in context.thermostats:
            await self._async_idle_device(eid, targets=self._idle_targets, report=report)
        return report

    async def _async_apply_heating(self, context: DeviceApplyContext) -> AppliedCommandReport:
        """Apply standard heating commands to thermostats and capable ACs."""
        report = AppliedCommandReport()
        mode = context.mode
        targets = context.targets

        if mode == MODE_HEATING:
            for eid in context.thermostats:
                if eid in context.forced_off:
                    await self._async_idle_device(eid, targets=targets, report=report)
                    continue
                ha_t = self._plan_device_temperature(eid, context, heating=True)
                mode_result = await self._call("set_hvac_mode", {"entity_id": eid, "hvac_mode": "heat"})
                temperature_result = await self._call(
                    "set_temperature",
                    {"entity_id": eid, "temperature": ha_t, "hvac_mode": "heat"},
                    temp_intent="heat",
                )
                report.record(
                    eid,
                    active=True,
                    operations=(mode_result, temperature_result),
                )

            for eid in self.acs:
                if eid in context.forced_off:
                    await self._async_idle_device(eid, targets=targets, report=report)
                    continue
                ha_t = self._plan_device_temperature(eid, context, heating=True)
                ac_state = self._device_state(eid)
                ac_modes = _effective_ac_modes(ac_state)
                if "heat" in ac_modes:
                    ac_mode = "heat"
                elif "heat_cool" in ac_modes:
                    ac_mode = "heat_cool"
                elif "auto" in ac_modes:
                    ac_mode = "auto"
                else:
                    ac_mode = ""
                if ac_mode:
                    mode_result = await self._call("set_hvac_mode", {"entity_id": eid, "hvac_mode": ac_mode})
                    temperature_result = await self._call(
                        "set_temperature",
                        {"entity_id": eid, "temperature": ha_t, "hvac_mode": ac_mode},
                        temp_intent="heat",
                    )
                    report.record(
                        eid,
                        active=True,
                        operations=(mode_result, temperature_result),
                    )
                else:
                    await self._async_idle_device(eid, targets=self._idle_targets, report=report)
        return report

    async def _async_apply_cooling(self, context: DeviceApplyContext) -> AppliedCommandReport:
        """Apply standard cooling commands and idle non-cooling thermostats."""
        report = AppliedCommandReport()
        for eid in self.acs:
            if eid in context.forced_off:
                await self._async_idle_device(eid, targets=context.targets, report=report)
                continue
            ha_t = self._plan_device_temperature(eid, context, heating=False)
            mode_result = await self._call("set_hvac_mode", {"entity_id": eid, "hvac_mode": "cool"})
            temperature_result = await self._call(
                "set_temperature",
                {"entity_id": eid, "temperature": ha_t, "hvac_mode": "cool"},
                temp_intent="cool",
            )
            report.record(
                eid,
                active=True,
                operations=(mode_result, temperature_result),
            )
        for eid in context.thermostats:
            if eid in context.forced_off:
                await self._async_idle_device(eid, targets=context.targets, report=report)
                continue
            await self._async_idle_device(eid, targets=self._idle_targets, report=report)
        return report

    async def _async_apply_idle(self, context: DeviceApplyContext) -> AppliedCommandReport:
        """Idle devices while honoring compressor minimum-run constraints."""
        report = AppliedCommandReport()
        targets = context.targets
        for eid in (*context.thermostats, *self.acs):
            if eid in context.forced_on:
                dev_state = self._device_state(eid)
                current_hvac = dev_state.state if dev_state else None
                if current_hvac == "heat" and targets.heat is not None:
                    ha_t = celsius_to_ha_temp(self.hass, targets.heat)
                    await self._call(
                        "set_temperature",
                        {"entity_id": eid, "temperature": ha_t, "hvac_mode": "heat"},
                        temp_intent="heat",
                    )
                elif current_hvac == "cool" and targets.cool is not None:
                    ha_t = celsius_to_ha_temp(self.hass, targets.cool)
                    await self._call(
                        "set_temperature",
                        {"entity_id": eid, "temperature": ha_t, "hvac_mode": "cool"},
                        temp_intent="cool",
                    )
                elif current_hvac in ("heat_cool", "auto"):
                    if targets.heat is not None:
                        ha_t = celsius_to_ha_temp(self.hass, targets.heat)
                        await self._call(
                            "set_temperature",
                            {"entity_id": eid, "temperature": ha_t, "hvac_mode": current_hvac},
                            temp_intent="heat",
                        )
                    elif targets.cool is not None:
                        ha_t = celsius_to_ha_temp(self.hass, targets.cool)
                        await self._call(
                            "set_temperature",
                            {"entity_id": eid, "temperature": ha_t, "hvac_mode": current_hvac},
                            temp_intent="cool",
                        )
                _LOGGER.debug(
                    "Area '%s': keeping '%s' active (compressor min-run protection)",
                    self._area_id,
                    eid,
                )
                report.mark_active(eid)
                continue
            await self._async_idle_device(eid, targets=targets, report=report)
        return report

    async def async_apply(
        self,
        mode: str,
        targets: TargetTemps,
        power_fraction: float = 1.0,
        current_temp: float | None = None,
        exclude_eids: set[str] | None = None,
        *,
        heating_boost_target: float | None = None,
        ac_heating_boost_target: float | None = None,
        cooling_boost_target: float | None = None,
        heat_source_plan: HeatSourcePlan | None = None,
        compressor_forced_on: set[str] | None = None,
        compressor_forced_off: set[str] | None = None,
        urgent: bool = False,
    ) -> AppliedCommandReport:
        """Apply a controller intent and return the actual command report."""
        self._dispatch_results = {}
        self._overdrive_statuses = {}
        self._cycle_observations = (
            self._actuator_observations
            if self._actuator_observations is not None
            else capture_entity_snapshots(self.hass, (*self.thermostats, *self.acs))
        )
        _forced_on = compressor_forced_on or set()
        _forced_off = compressor_forced_off or set()

        # Store targets for _call delegation (setback idle_action).
        self._idle_targets = targets

        # Resolve effective target_temp for the current mode
        if mode == MODE_HEATING:
            target_temp = targets.heat
        elif mode == MODE_COOLING:
            target_temp = targets.cool
        else:
            target_temp = targets.heat if targets.heat is not None else targets.cool

        if mode not in (MODE_IDLE, MODE_DRY, MODE_FAN_ONLY) and target_temp is None:
            mode = MODE_IDLE

        self._paced_entities = (
            set(self.acs) - self._direct_eids - _forced_on - _forced_off
            if mode != MODE_IDLE and self.has_external_sensor and not urgent
            else set()
        )

        # After the guard above, target_temp is guaranteed non-None for HEATING/COOLING.
        # We assign a typed local for downstream use.
        effective_target: float = target_temp if target_temp is not None else 0.0

        # Dynamic boost: use device-reported limits, fall back to constants
        trv_heat_boost = heating_boost_target if heating_boost_target is not None else HEATING_BOOST_TARGET
        ac_heat_boost = ac_heating_boost_target if ac_heating_boost_target is not None else AC_HEATING_BOOST_TARGET
        ac_cool_boost = cooling_boost_target if cooling_boost_target is not None else AC_COOLING_BOOST_TARGET

        can_heat, can_cool = self._get_can_heat_cool()

        _exclude = exclude_eids or set()
        thermostats = [e for e in self.thermostats if e not in _exclude]
        apply_context = DeviceApplyContext(
            mode=mode,
            targets=targets,
            current_temp=current_temp,
            effective_target=effective_target,
            power_fraction=power_fraction,
            thermostats=tuple(thermostats),
            excluded=frozenset(_exclude),
            forced_on=frozenset(_forced_on),
            forced_off=frozenset(_forced_off),
            trv_heat_boost=trv_heat_boost,
            ac_heat_boost=ac_heat_boost,
            ac_cool_boost=ac_cool_boost,
        )

        # Managed mode (no external sensor) with auto climate mode and
        # both device types: activate each device in its natural mode so
        # both can self-regulate against the target temperature.
        if (
            not self.has_external_sensor
            and self.climate_mode
            not in (
                CLIMATE_MODE_HEAT_ONLY,
                CLIMATE_MODE_COOL_ONLY,
                CLIMATE_MODE_DRY,
                CLIMATE_MODE_FAN_ONLY,
                CLIMATE_MODE_OFF,
            )
            and mode != MODE_IDLE
        ):
            report = await self._async_apply_managed_auto(
                apply_context,
                can_heat=can_heat,
                can_cool=can_cool,
            )
        elif mode == MODE_HEATING and heat_source_plan is not None:
            report = await self._async_apply_heat_source_plan(heat_source_plan, apply_context)
        else:
            report = await self._async_apply_standard(apply_context)
        self._reconcile_dispatch_results(report)
        return report

    def _device_state(self, entity_id: str) -> Any:
        """Use one observation throughout a plan, including after dispatch awaits."""
        if self._cycle_observations is not None:
            return self._cycle_observations.get(entity_id)
        return self.hass.states.get(entity_id)

    @property
    def last_overdrive_status(self) -> list[dict[str, Any]]:
        """Return diagnostic details for adaptive AC overdrive decisions in this cycle."""
        return list(self._overdrive_statuses.values())

    def _plan_device_temperature(
        self, entity_id: str, context: DeviceApplyContext, *, heating: bool, demand: float | None = None
    ) -> float:
        """Resolve the device's modulation range without changing room targets."""
        is_trv = entity_id in self.thermostats
        limit = context.trv_heat_boost if is_trv else context.ac_heat_boost if heating else context.ac_cool_boost
        device = get_device_by_eid(self._devices, entity_id) or {}
        eff_demand = context.power_fraction if demand is None else demand
        if (
            not is_trv
            and device.get("setpoint_mode") == SETPOINT_MODE_ADAPTIVE
            and self.has_external_sensor
            and context.current_temp is not None
            and self._ac_overdrive is not None
        ):
            ac_state = self._device_state(entity_id)
            raw_ac_temp = ac_state.attributes.get("current_temperature") if ac_state else None
            ac_internal_c: float | None = None
            if isinstance(raw_ac_temp, (int, float)) and not isinstance(raw_ac_temp, bool):
                ac_internal_c = ha_temp_to_celsius(self.hass, float(raw_ac_temp), entity_id=entity_id)
            learned_bias_c: float | None = None
            if self._sensor_fusion is not None:
                bias = self._sensor_fusion.get_bias(entity_id)
                learned_bias_c = bias.static_c + bias.active_c * eff_demand
            temperature, diag = self._ac_overdrive.plan_setpoint(
                entity_id,
                target_c=context.effective_target,
                room_temp_c=context.current_temp,
                ac_internal_temp_c=ac_internal_c,
                demand=eff_demand,
                heating=heating,
                limit_c=limit,
                max_offset_c=device.get("max_setpoint_offset_c"),
                learned_sensor_bias_c=learned_bias_c,
                regime=self._inverter_regime,
            )
            self._overdrive_statuses[entity_id] = diag
            return celsius_to_ha_temp(self.hass, round(temperature, 1))

        temperature = plan_active_temperature(
            target=context.effective_target,
            current_temp=context.current_temp,
            demand=eff_demand,
            limit=limit,
            heating=heating,
            direct=(
                entity_id in self._direct_eids
                or not self.has_external_sensor
                or (not is_trv and context.current_temp is None)
            ),
            max_offset=device.get("max_setpoint_offset_c"),
        )
        return celsius_to_ha_temp(self.hass, round(temperature, 1))

    def _record_dispatch_result(self, result: DeviceActuationResult) -> DeviceActuationResult:
        """Retain immediate evidence for the current apply operation."""
        self._dispatch_results.setdefault(result.entity_id, []).append(result)
        if self._actuation_ledger is not None:
            self._actuation_ledger.record_dispatch(result)
        return result

    def _reconcile_dispatch_results(self, report: AppliedCommandReport) -> None:
        """Remove activity claims contradicted by dispatch evidence."""
        for entity_id in tuple(report.active_eids):
            operations = tuple(self._dispatch_results.get(entity_id, ()))
            if operations:
                report.record(entity_id, active=True, operations=operations)

    async def _async_idle_device(
        self,
        entity_id: str,
        *,
        targets: TargetTemps | None,
        report: AppliedCommandReport | None = None,
    ) -> DeviceActuationResult:
        """Retain each idle operation so partial failures cannot imply inactivity."""
        operations = await async_idle_device(
            self.hass,
            entity_id,
            self._devices,
            area_id=self._area_id,
            targets=targets,
            setback_offset=self._setback_offset,
            observations=self._cycle_observations,
        )
        for result in operations:
            self._record_dispatch_result(result)
        if report is not None:
            report.record(entity_id, active=False, operations=operations)
        return DeviceActuationResult.combine(entity_id, operations)

    def _resolve_hvac_mode_payload(
        self,
        eid: str | None,
        state: Any,
        data: dict,
    ) -> tuple[dict | None, DeviceActuationResult | None]:
        """Resolve requested hvac_mode against device capabilities."""
        if not state:
            return data, None
        hvac_modes = state.attributes.get("hvac_modes") or []
        resolved = resolve_hvac_mode(data["hvac_mode"], hvac_modes)
        if resolved is None:
            if not has_reliable_hvac_modes(state):
                if state.state == "off" and data["hvac_mode"] not in ("off", "fan_only") and "fan_only" in hvac_modes:
                    resolved = "fan_only"
                    _LOGGER.debug(
                        "Area '%s': device '%s' is off with incomplete modes, pre-activating via fan_only (#135)",
                        self._area_id,
                        eid,
                    )
                else:
                    resolved = data["hvac_mode"]
                    _LOGGER.debug(
                        "Area '%s': device '%s' has incomplete modes, sending '%s' directly",
                        self._area_id,
                        eid,
                        resolved,
                    )
            else:
                _LOGGER.debug(
                    "Area '%s': device '%s' does not support '%s' or any fallback, skipping",
                    self._area_id,
                    eid,
                    data["hvac_mode"],
                )
                return None, self._record_dispatch_result(
                    DeviceActuationResult(
                        entity_id=eid or "",
                        dispatch=DispatchStatus.UNSUPPORTED,
                        service="set_hvac_mode",
                        desired=dict(data),
                        diagnostic=f"unsupported HVAC mode: {data['hvac_mode']}",
                    )
                )
        if resolved != data["hvac_mode"]:
            _LOGGER.debug("Area '%s': device '%s' resolved '%s' -> '%s'", self._area_id, eid, data["hvac_mode"], resolved)
            data = {**data, "hvac_mode": resolved}
        return data, None

    def _apply_setpoint_offset_bound(
        self,
        eid: str | None,
        state: Any,
        data: dict,
        temp_intent: str,
    ) -> tuple[dict | None, DeviceActuationResult | None]:
        """Clamp target temperature by device max_setpoint_offset_c and device min/max bounds."""
        if "temperature" not in data or self._idle_targets is None:
            return data, None
        device = next((d for d in self._devices if d.get("entity_id") == eid), {})
        offset = device.get("max_setpoint_offset_c")
        target = (
            self._idle_targets.heat
            if temp_intent == "heat"
            else self._idle_targets.cool
            if temp_intent == "cool"
            else None
        )
        if offset is None or target is None:
            return data, None
        limit_c = target + float(offset) * (1 if temp_intent == "heat" else -1)
        native_step = state.attributes.get("target_temp_step_c") if state else None
        limit = limit_c if native_step is not None else celsius_to_ha_temp(self.hass, limit_c)
        step = float(native_step or state.attributes.get("target_temp_step") or 0) if state else 0.0
        if step > 0:
            limit = round((math.floor(limit / step) if temp_intent == "heat" else math.ceil(limit / step)) * step, 2)
        if native_step is not None:
            limit = celsius_to_ha_temp(self.hass, limit)
        device_bound = state.attributes.get("min_temp" if temp_intent == "heat" else "max_temp") if state else None
        if device_bound is not None and (limit < device_bound if temp_intent == "heat" else limit > device_bound):
            return None, self._record_dispatch_result(
                DeviceActuationResult(
                    entity_id=eid or "",
                    dispatch=DispatchStatus.UNSUPPORTED,
                    service="set_temperature",
                    desired=dict(data),
                    diagnostic="no device setpoint within configured offset",
                )
            )
        bounded = min(data["temperature"], limit) if temp_intent == "heat" else max(data["temperature"], limit)
        return {**data, "temperature": bounded}, None

    def _is_redundant_command(self, eid: str | None, state: Any, service: str, data: dict) -> bool:
        """Return True if live device state or optimistic IR cache already matches the command."""
        skip = bool(
            state
            and _command_payload_matches(
                {**state.attributes, "hvac_mode": state.state},
                service,
                data,
                temperature_tolerance=temperature_feedback_tolerance(self.hass, state),
            )
        )
        if not skip and eid and _should_use_cache(state):
            cached = _last_commands.get(eid)
            skip = bool(cached and cached.get("service") == service and _command_payload_matches(cached, service, data))
        return skip

    def _check_temperature_pacing(
        self,
        eid: str | None,
        state: Any,
        service: str,
        data: dict,
        temp_intent: str,
    ) -> tuple[tuple[Any, ...], DeviceActuationResult | None]:
        """Return active pacing policy key and optional deferred result for paced temperature writes."""
        if service != "set_temperature" or eid not in self._paced_entities or self._idle_targets is None:
            return (), None
        device = get_device_by_eid(self._devices, eid) or {}
        policy: tuple[Any, ...] = (
            self._idle_targets.heat,
            self._idle_targets.cool,
            device.get("max_setpoint_offset_c"),
            temp_intent,
        )
        reason = setpoint_delay_reason(
            eid,
            data,
            state,
            policy=policy,
            interval=300.0 if self.night_active else 120.0,
            large_delta=celsius_delta_to_ha(self.hass, 2.0),
            heating=temp_intent == "heat",
            temperature_tolerance=temperature_feedback_tolerance(self.hass, state),
        )
        if reason is not None:
            return policy, self._record_dispatch_result(
                DeviceActuationResult(eid, DispatchStatus.DEFERRED, service, dict(data), reason)
            )
        return policy, None

    async def _call(self, service: str, data: dict, *, temp_intent: str = "") -> DeviceActuationResult:
        eid = data.get("entity_id")
        state = self._device_state(eid) if eid else None

        if service == "set_hvac_mode" and data.get("hvac_mode") == "off" and eid:
            return await self._async_idle_device(eid, targets=self._idle_targets)

        if service == "set_hvac_mode":
            resolved_data, early = self._resolve_hvac_mode_payload(eid, state, data)
            if early is not None:
                return early
            assert resolved_data is not None
            data = resolved_data

        if service == "set_temperature":
            bounded_data, early = self._apply_setpoint_offset_bound(eid, state, data, temp_intent)
            if early is not None:
                return early
            assert bounded_data is not None
            data = _normalize_temperature_payload(state, bounded_data, temp_intent, hass=self.hass) if state else bounded_data

        if self._is_redundant_command(eid, state, service, data):
            return self._record_dispatch_result(
                DeviceActuationResult(
                    entity_id=eid or "",
                    dispatch=DispatchStatus.SKIPPED,
                    service=service,
                    desired=dict(data),
                )
            )

        policy, deferred = self._check_temperature_pacing(eid, state, service, data, temp_intent)
        if deferred is not None:
            return deferred

        result = await async_dispatch_climate(self.hass, service, data, area_id=self._area_id)
        if policy and eid:
            remember_temperature_dispatch(eid, data, state, policy, result)
        return self._record_dispatch_result(result)
