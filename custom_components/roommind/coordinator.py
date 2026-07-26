"""DataUpdateCoordinator for RoomMind."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from functools import partial
from typing import Any

from homeassistant.components.persistent_notification import async_create as async_create_notification
from homeassistant.components.persistent_notification import async_dismiss as async_dismiss_notification
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import (
    AC_COOLING_BOOST_TARGET,
    AC_HEATING_BOOST_TARGET,
    CLIMATE_MODE_COOL_ONLY,
    CLIMATE_MODE_HEAT_ONLY,
    DEFAULT_OUTDOOR_HEATING_MAX,
    DOMAIN,
    HEATING_BOOST_TARGET,
    HISTORY_ROTATE_CYCLES,
    HISTORY_WRITE_CYCLES,
    MAX_PREDICTION_DELTA,
    MAX_SENSOR_STALENESS,
    MODE_COOLING,
    MODE_HEATING,
    MODE_IDLE,
    OBSERVATION_INTERVAL_RETENTION_DAYS,
    OBSERVED_SUMMARY_BUCKET_SECONDS,
    OBSERVED_SUMMARY_RETENTION_DAYS,
    OUTDOOR_UNAVAILABLE_NOTIFICATION_ID,
    OUTDOOR_UNAVAILABLE_NOTIFY_CYCLES,
    RAW_OBSERVATION_PRUNE_CYCLES,
    RAW_OBSERVATION_RETENTION_DAYS,
    THERMAL_EPISODE_MAX_GAP_SECONDS,
    THERMAL_EPISODE_MIN_DURATION_SECONDS,
    THERMAL_EPISODE_RETENTION_DAYS,
    THERMAL_SAVE_CYCLES,
    UPDATE_INTERVAL,
    build_override_live,
    is_override_active,
    is_override_suppressed,
    make_roommind_context,
)
from .control.constraints import ConstraintInput, ConstraintReducer
from .control.mpc_controller import (
    DEFAULT_OUTDOOR_TEMP_FALLBACK,
    AppliedCommandReport,
    MPCController,
    check_acs_can_heat,
    get_can_heat_cool,
    is_mpc_active,
)
from .control.perceived_temperature import perceived_temperature
from .control.rapid_recovery import resolve_rapid_recovery_mode
from .control.solar import SolarExposure, compute_q_solar_norm
from .control.thermal_model import (
    RoomModelManager,
    RoomModelSimulationContext,
    TemperatureObservation,
)
from .managers.airflow_control_manager import AirflowControlManager, AirflowRuntimeContext
from .managers.compressor_group_manager import (
    CompressorCommandOutcome,
    CompressorGroupConfig,
    CompressorGroupManager,
    CompressorGroupState,
    resolve_master_action,
)
from .managers.cover_orchestrator import CoverOrchestrator, CoverResult
from .managers.ekf_training_manager import EkfTrainingManager
from .managers.environmental_factor_manager import (
    AIRFLOW_ROLE_VENTILATION,
    AirflowFactors,
    EnvironmentalFactorManager,
    airflow_sensor_conflict,
)
from .managers.heat_source_orchestrator import HeatSourcePlan, evaluate_heat_sources
from .managers.hvac_output_observer import HVACOutputObserver
from .managers.mold_manager import MoldManager
from .managers.night_mode_manager import NightModeManager
from .managers.residual_heat_tracker import ResidualHeatSimulationState, ResidualHeatTracker
from .managers.room_coupling_manager import RoomCouplingManager
from .managers.sensor_fusion_manager import SensorFusionManager
from .managers.valve_manager import ValveManager
from .managers.weather_manager import WeatherManager
from .managers.window_manager import WindowManager
from .settings_config import mpc_control_enabled
from .utils.device_utils import (
    build_rooms_devices_map,
    get_ac_eids,
    get_all_entity_ids,
    get_direct_setpoint_eids,
    get_trv_eids,
    room_contributes_to_group,
)
from .utils.history_store import HistoryStore
from .utils.i18n import get_translation
from .utils.notification_payloads import build_outdoor_unavailable_payload
from .utils.observation_store import ObservationStore
from .utils.schedule_utils import (
    resolve_schedule_index,
)
from .utils.sensor_utils import read_sensor_value
from .utils.target_resolution import ControlTargetPlan, prepare_control_target_plan
from .utils.temp_utils import celsius_delta_to_ha, ha_temp_to_celsius, ha_temp_unit_str

_LOGGER = logging.getLogger(__name__)


class EntityPlatform(StrEnum):
    """RoomMind entity groups tracked for dynamic room registration."""

    SENSOR = "sensor"
    CLIMATE = "climate"
    CLIMATE_CONTROL_SWITCH = "climate_control_switch"
    COVER_SWITCH = "cover_switch"
    COVER_BINARY_SENSOR = "cover_binary_sensor"


@dataclass
class _EntityPlatformRegistration:
    """Callback and registered rooms for one Home Assistant entity platform."""

    callback: Callable[[list[Any]], None] | None = None
    factory: Callable[[RoomMindCoordinator, str], list[Any]] | None = None
    area_ids: set[str] = field(default_factory=set)


@dataclass(frozen=True, slots=True)
class AnalyticsRuntimeSnapshot:
    """Coordinator-owned runtime values consumed by analytics."""

    live: dict[str, Any]
    model_info: dict[str, Any]
    simulation_context: RoomModelSimulationContext | None
    mpc_active: bool
    acs_can_heat: bool | None
    outdoor_temp: float | None
    weather_forecast: list[dict[str, Any]]
    residual: ResidualHeatSimulationState
    window_open: bool


@dataclass(frozen=True, slots=True)
class RoomDiagnosticsRuntimeSnapshot:
    """Coordinator-owned runtime diagnostics for one room."""

    live: dict[str, Any]
    previous_mode: str
    mode_active_for_s: int | None
    cached_temp: float | None
    cached_temp_age_s: int | None
    q_residual: float
    model: dict[str, Any] | None
    window: dict[str, bool | int]
    cover: dict[str, int | bool | None] | None
    heat_source_routing: str | None


@dataclass(frozen=True, slots=True)
class CoordinatorDiagnosticsRuntimeSnapshot:
    """Point-in-time coordinator diagnostics without exposing managers."""

    rooms: dict[str, RoomDiagnosticsRuntimeSnapshot]
    outdoor_temp: float | None
    outdoor_humidity: float | None
    forecast_available: bool
    forecast_points: int
    compressor_groups: dict[str, dict[str, Any]]
    valve_protection: dict[str, dict[str, int]]


@dataclass(frozen=True, slots=True)
class ClimateDeviceSnapshot:
    """Room climate-device inventory and conservative temperature limits."""

    trv_entity_ids: tuple[str, ...]
    ac_entity_ids: tuple[str, ...]
    all_entity_ids: tuple[str, ...]
    heating_boost_target: float | None
    ac_heating_boost_target: float | None
    cooling_boost_target: float | None


@dataclass(frozen=True, slots=True)
class HumiditySensorSnapshot:
    """Humidity value and source metadata captured in one read."""

    value: float | None
    sources: tuple[str, ...] = ()
    primary_available: bool = False

    def as_live_status(self) -> dict[str, Any]:
        """Return the stable live-state representation."""
        return {
            "humidity_sources": "|".join(self.sources),
            "humidity_source_count": len(self.sources),
            "humidity_primary_available": self.primary_available,
        }


@dataclass(frozen=True, slots=True)
class RoomSensorSnapshot:
    """Temperature and humidity inputs captured for one room cycle."""

    current_temp: float | None
    current_temp_raw: float | None
    humidity: HumiditySensorSnapshot
    has_external_sensor: bool
    temperature_observations: list[TemperatureObservation]


def _get_area_name(hass: HomeAssistant, area_id: str) -> str:
    """Get human-readable area name from area registry."""
    try:
        area_reg = ar.async_get(hass)
        area = area_reg.async_get_area(area_id)
        return area.name if area else area_id
    except Exception:  # noqa: BLE001
        return area_id


class RoomMindCoordinator(DataUpdateCoordinator):
    """Central coordinator for RoomMind room data and state."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=UPDATE_INTERVAL),
        )
        self.entry = entry
        self.rooms: dict = {}
        self.outdoor_temp: float | None = None
        self.outdoor_temp_effective: float | None = None
        self.outdoor_temp_source: str = "none"
        self.outdoor_humidity: float | None = None
        self._outdoor_unavailable_cycles: int = 0
        self._outdoor_warning_sent: bool = False
        self._window_manager = WindowManager()
        self._previous_modes: dict[str, str] = {}
        self._model_manager: RoomModelManager = RoomModelManager()
        self._model_loaded = False
        self._thermal_save_count: int = 0
        self._history_store: HistoryStore | None = None
        self._history_write_count: int = 0
        self._history_rotate_count: int = 0
        self._pending_predictions: dict[str, float] = {}
        self._weather_manager = WeatherManager(hass)
        self._current_q_solar: float = 0.0
        self._constraint_reducer = ConstraintReducer()
        # Valve protection (anti-seize)
        self._valve_manager = ValveManager(hass)
        # Mold risk tracking
        self._mold_manager = MoldManager(hass)
        # Residual heat tracking (heating → idle transition)
        self._residual_tracker = ResidualHeatTracker()
        # EKF training accumulation
        self._ekf_training = EkfTrainingManager(self._model_manager)
        self._sensor_fusion = SensorFusionManager()
        self._observation_store: ObservationStore | None = None
        self._raw_observation_buffer: list[dict] = []
        self._raw_observation_prune_count: int = 0
        self._environmental_factors = EnvironmentalFactorManager(hass)
        self._airflow_control = AirflowControlManager(hass)
        self._hvac_output_observer = HVACOutputObserver(hass)
        self._night_mode_manager = NightModeManager(hass)
        self._room_coupling = RoomCouplingManager()
        self._room_coupling_last_temps: dict[str, tuple[float, float]] = {}
        # Cover/blind automatic control
        from .managers.cover_manager import CoverManager

        self._cover_manager = CoverManager()
        self._cover_orchestrator = CoverOrchestrator(hass, self._cover_manager, self._model_manager)
        # Compressor group management (min-run / min-off protection)
        self._compressor_manager = CompressorGroupManager()
        # Heat source orchestration state (per room)
        self._heat_source_states: dict[str, str] = {}
        self._entity_platforms = {platform: _EntityPlatformRegistration() for platform in EntityPlatform}
        # Min-run enforcement: timestamp when current non-idle mode started
        self._mode_on_since: dict[str, float] = {}
        # Sensor dropout fallback: last valid temperature per room
        self._last_valid_temps: dict[str, tuple[float, float]] = {}  # {area_id: (celsius, monotonic_ts)}
        # Per-entity cache of schedule blocks; fallback when schedule.get_schedule fails (#308)
        self._schedule_blocks_cache: dict[str, dict] = {}

    def register_entity_platform(
        self,
        platform: EntityPlatform,
        callback: Callable[[list[Any]], None],
        factory: Callable[[RoomMindCoordinator, str], list[Any]],
        area_ids: Iterable[str] = (),
    ) -> None:
        """Register a platform's entity factory, callback, and existing rooms."""
        registration = self._entity_platforms[platform]
        registration.callback = callback
        registration.factory = factory
        registration.area_ids.update(area_ids)

    def is_entity_platform_registered(
        self,
        platform: EntityPlatform,
        area_id: str,
    ) -> bool:
        """Return whether a room already has entities for a platform group."""
        return area_id in self._entity_platforms[platform].area_ids

    def _add_entity_platform_room(
        self,
        platform: EntityPlatform,
        area_id: str,
    ) -> bool:
        """Add one room's entities once through its registered callback."""
        registration = self._entity_platforms[platform]
        if registration.callback is None or registration.factory is None or area_id in registration.area_ids:
            return False
        registration.callback(registration.factory(self, area_id))
        registration.area_ids.add(area_id)
        return True

    async def _async_update_data(self) -> dict:
        """Fetch and compute state for all rooms.

        This is the central loop that:
        1. Reads current temperatures from sensor entities
        2. Evaluates active schedule for each room
        3. Determines heating/cooling action per room
        4. Applies climate control commands
        5. Returns state dict consumed by sensor entities
        """
        store = self.hass.data[DOMAIN]["store"]
        rooms = store.get_rooms()

        # Read outdoor sensors from global settings
        settings = store.get_settings()
        outdoor_sensor_id = settings.get("outdoor_temp_sensor")
        raw_outdoor = read_sensor_value(self.hass, outdoor_sensor_id, "global", "outdoor temperature")
        self.outdoor_temp = (
            ha_temp_to_celsius(self.hass, raw_outdoor, entity_id=outdoor_sensor_id) if raw_outdoor is not None else None
        )
        self.outdoor_humidity = read_sensor_value(
            self.hass, settings.get("outdoor_humidity_sensor"), "global", "outdoor humidity"
        )

        # Effective outdoor temperature: sensor → weather entity → none.
        # The EKF must not train with a degenerate fallback (e.g. room temp);
        # see _async_process_room where this gates EKF updates.
        self.outdoor_temp_effective, self.outdoor_temp_source = self._resolve_outdoor_temp(settings)
        self._update_outdoor_unavailable_notification(settings)

        # Load compressor groups from settings (every cycle, cheap)
        self._compressor_manager.load_groups(settings.get("compressor_groups", []))

        # Load thermal model and valve actuation data from store (once)
        if not self._model_loaded:
            thermal_data = store.get_thermal_data()
            if thermal_data:
                model_data = thermal_data.get("models", thermal_data) if isinstance(thermal_data, dict) else {}
                if isinstance(model_data, dict):
                    self._model_manager = RoomModelManager.from_dict(model_data)
                self._ekf_training.set_model_manager(self._model_manager)
                self._cover_orchestrator.set_model_manager(self._model_manager)
                if isinstance(thermal_data, dict):
                    self._sensor_fusion = SensorFusionManager.from_dict(thermal_data.get("sensor_biases", {}))
            self._valve_manager.load_actuation_data(settings.get("valve_last_actuation", {}))
            self._model_loaded = True

        # Initialize history store (once)
        if self._history_store is None:
            self._history_store = HistoryStore(self.hass.config.path(".storage/roommind_history"))
        if self._observation_store is None:
            self._observation_store = ObservationStore(
                self.hass.config.path(".storage/roommind_observations.sqlite"),
                raw_retention_days=RAW_OBSERVATION_RETENTION_DAYS,
                interval_retention_days=OBSERVATION_INTERVAL_RETENTION_DAYS,
                summary_retention_days=OBSERVED_SUMMARY_RETENTION_DAYS,
                episode_retention_days=THERMAL_EPISODE_RETENTION_DAYS,
            )
        self._raw_observation_buffer = []
        self._record_raw_state_observation(
            "global",
            outdoor_sensor_id,
            "outdoor_temperature",
            self.hass.states.get(outdoor_sensor_id) if outdoor_sensor_id else None,
            is_primary=True,
        )
        outdoor_humidity_sensor_id = settings.get("outdoor_humidity_sensor")
        self._record_raw_state_observation(
            "global",
            outdoor_humidity_sensor_id,
            "outdoor_humidity",
            self.hass.states.get(outdoor_humidity_sensor_id) if outdoor_humidity_sensor_id else None,
            is_primary=True,
        )

        room_states: dict[str, dict] = {}

        # Read weather forecast once for all rooms
        outdoor_forecast = await self._weather_manager.async_read_forecast(settings)

        # Update cover orchestrator with cloud forecast for solar trajectory prediction
        self._cover_orchestrator.set_cloud_series(WeatherManager.extract_cloud_series(outdoor_forecast))

        # Compute solar irradiance once per cycle
        cloud_coverage = None
        weather_entity = settings.get("weather_entity")
        if weather_entity:
            ws = self.hass.states.get(weather_entity)
            if ws:
                cloud_coverage = ws.attributes.get("cloud_coverage")
        self._current_q_solar = compute_q_solar_norm(
            self.hass.config.latitude,
            self.hass.config.longitude,
            time.time(),
            cloud_coverage,
        )

        for area_id, room in rooms.items():
            try:
                room_state = await self._async_process_room(room, settings, outdoor_forecast)
                room_states[area_id] = room_state
            except Exception:  # noqa: BLE001
                _LOGGER.exception("Room '%s': processing failed, skipping", area_id)

        self._update_room_couplings(rooms, room_states)

        # Control master devices based on aggregate room demand
        await self._async_control_master_devices(room_states, rooms, settings)

        if self._observation_store and self._raw_observation_buffer:
            try:
                await self.hass.async_add_executor_job(
                    self._observation_store.record_many,
                    list(self._raw_observation_buffer),
                )
            except Exception:  # noqa: BLE001
                _LOGGER.warning("Raw observation record failed")

        # Record to history store (throttled)
        learning_disabled = set(settings.get("learning_disabled_rooms", []))
        self._history_write_count += 1
        if self._history_write_count >= HISTORY_WRITE_CYCLES and self._history_store:
            self._history_write_count = 0
            for area_id, rs in room_states.items():
                if area_id in learning_disabled:
                    continue
                current_temp = rs.get("current_temp")
                mode = rs.get("mode", MODE_IDLE)
                target_temp = rs.get("target_temp")
                # Use the prediction made *last* write cycle for the
                # current timestamp — this compares "what the model
                # predicted would happen" vs "what actually happened".
                predicted = self._pending_predictions.pop(area_id, None)
                try:
                    await self.hass.async_add_executor_job(
                        self._history_store.record,
                        area_id,
                        {
                            "room_temp": rs.get("current_temp_raw", current_temp),
                            "outdoor_temp": self.outdoor_temp_effective,
                            "target_temp": target_temp,
                            "mode": mode,
                            "predicted_temp": predicted,
                            "window_open": rs.get("window_open", False),
                            "heating_power": rs.get("heating_power", 0),
                            "solar_irradiance": round(self._current_q_solar, 3),
                            "blind_position": rs.get("blind_position"),
                            "cover_reason": rs.get("cover_reason", ""),
                            "device_setpoint": rs.get("device_setpoint"),
                            "occupancy": rs.get("q_occupancy", 0.0) > 0,
                            "room_humidity": rs.get("current_humidity"),
                            "outdoor_humidity": self.outdoor_humidity,
                            "perceived_temp": rs.get("perceived_temp"),
                            "q_fan_mix": rs.get("q_fan_mix", 0.0),
                            "q_vent": rs.get("q_vent", 0.0),
                            "airflow_ach": rs.get("airflow_ach", 0.0),
                            "airflow_plan_level": rs.get("airflow_plan_level", 0.0),
                            "airflow_mix_plan_level": rs.get("airflow_mix_plan_level", 0.0),
                            "airflow_vent_plan_level": rs.get("airflow_vent_plan_level", 0.0),
                            "night_mode_active": rs.get("night_mode", {}).get("active", False),
                            "rapid_recovery_active": rs.get("rapid_recovery_active", False),
                            "hvac_stage": (rs.get("hvac_output_status") or {}).get("stage"),
                            "sensor_conflict": rs.get("sensor_conflict", 0.0),
                            "mold_surface_rh": rs.get("mold_surface_rh"),
                            "mold_risk_level": rs.get("mold_risk_level", ""),
                            "effective_control_target": rs.get("effective_control_target"),
                            "heat_target": rs.get("heat_target"),
                            "cool_target": rs.get("cool_target"),
                            "override_active": rs.get("override_active", False),
                            "override_type": rs.get("override_type", ""),
                            "active_heat_sources": rs.get("active_heat_sources", ""),
                            "temperature_source": rs.get("temperature_source", ""),
                            "temperature_source_count": rs.get("temperature_source_count", 0),
                            "temperature_primary_available": rs.get("temperature_primary_available", False),
                            "humidity_sources": rs.get("humidity_sources", ""),
                            "humidity_source_count": rs.get("humidity_source_count", 0),
                            "humidity_primary_available": rs.get("humidity_primary_available", False),
                        },
                    )
                except Exception:  # noqa: BLE001
                    _LOGGER.warning("History record failed for '%s'", area_id)
                # Compute prediction for the *next* write cycle (~3 min ahead)
                room_config = rooms.get(area_id, {})
                if (
                    current_temp is not None
                    and self.outdoor_temp_effective is not None
                    and not room_config.get("is_outdoor", False)
                ):
                    try:
                        is_window_open = rs.get("window_open", False)
                        if is_window_open:
                            raw_pred = self._model_manager.predict_window_open(
                                area_id,
                                current_temp,
                                self.outdoor_temp_effective,
                                3.0,
                            )
                        else:
                            model = self._model_manager.get_model(area_id)
                            hp = rs.get("heating_power", 100) / 100.0
                            Q = (
                                hp * model.Q_heat
                                if mode == "heating"
                                else (-hp * model.Q_cool if mode == "cooling" else 0.0)
                            )
                            raw_pred = model.predict(
                                current_temp,
                                self.outdoor_temp_effective,
                                Q,
                                3.0,
                                q_solar=self._current_q_solar * rs.get("shading_factor", 1.0),
                                q_vent=rs.get("q_vent", 0.0),
                                q_occupancy=rs.get("q_occupancy", 0.0),
                                coupling_terms=rs.get("coupling_status", []),
                            )
                        # Sanity clamp: prevent unrealistic jumps in one prediction step
                        clamped = max(
                            current_temp - MAX_PREDICTION_DELTA, min(current_temp + MAX_PREDICTION_DELTA, raw_pred)
                        )
                        self._pending_predictions[area_id] = round(clamped, 2)
                    except Exception:  # noqa: BLE001
                        pass

        # Save thermal data periodically
        self._thermal_save_count += 1
        if self._thermal_save_count >= THERMAL_SAVE_CYCLES:
            self._thermal_save_count = 0
            await store.async_save_thermal_data(
                {
                    "models": self._model_manager.to_dict(),
                    "sensor_biases": self._sensor_fusion.to_dict(),
                }
            )

        # Rotate history periodically
        self._history_rotate_count += 1
        if self._history_rotate_count >= HISTORY_ROTATE_CYCLES and self._history_store:
            self._history_rotate_count = 0
            now_ts = time.time()
            for area_id in rooms:
                try:
                    await self.hass.async_add_executor_job(self._history_store.rotate, area_id)
                except Exception:  # noqa: BLE001
                    _LOGGER.warning("History rotation failed for '%s'", area_id)
                await self._async_store_observed_derivatives(area_id, now_ts=now_ts)
            await self._async_store_observation_summaries(
                "global",
                ("outdoor_temperature", "outdoor_humidity"),
                now_ts=now_ts,
            )
        self._raw_observation_prune_count += 1
        if self._raw_observation_prune_count >= RAW_OBSERVATION_PRUNE_CYCLES and self._observation_store:
            self._raw_observation_prune_count = 0
            try:
                await self.hass.async_add_executor_job(self._observation_store.prune_raw)
                await self.hass.async_add_executor_job(self._observation_store.prune_derived)
            except Exception:  # noqa: BLE001
                _LOGGER.warning("Raw observation pruning failed")

        # Valve protection: finish active cycles (runs every tick, cheap).
        # Pass a {eid: devices[]} map so idle_action is respected when the
        # cycle closes (idle_action="low" TRVs stay awake instead of being
        # hard-turned-off).
        await self._valve_manager.async_finish_cycles(build_rooms_devices_map(rooms))

        # Valve protection: check for stale valves (throttled)
        if self._valve_manager.should_run_cycle_check():
            await self._valve_manager.async_check_and_cycle(rooms, settings)

        # Persist valve actuation timestamps (piggyback on thermal save cycle)
        if self._valve_manager.actuation_dirty and self._thermal_save_count == 0:
            await store.async_save_settings({"valve_last_actuation": self._valve_manager.get_actuation_data()})
            self._valve_manager.actuation_dirty = False

        self.rooms = room_states
        return {"rooms": room_states}

    async def _async_store_observed_derivatives(self, area_id: str, *, now_ts: float) -> None:
        """Persist low-frequency observed summaries and thermal episodes."""
        await self._async_store_observation_summaries(
            area_id,
            ("temperature", "humidity"),
            now_ts=now_ts,
        )
        if not self._observation_store or not self._history_store:
            return

        start_ts = now_ts - RAW_OBSERVATION_RETENTION_DAYS * 24 * 3600
        try:
            detail_rows = await self.hass.async_add_executor_job(
                self._history_store.read_detail,
                area_id,
                None,
                start_ts,
                now_ts,
            )
            history_rows = await self.hass.async_add_executor_job(
                self._history_store.read_history,
                area_id,
                None,
                start_ts,
                now_ts,
            )
            rows = sorted([*history_rows, *detail_rows], key=HistoryStore.safe_timestamp)
            await self.hass.async_add_executor_job(
                partial(
                    self._observation_store.store_thermal_episodes,
                    room_id=area_id,
                    rows=rows,
                    min_duration_s=THERMAL_EPISODE_MIN_DURATION_SECONDS,
                    max_gap_s=THERMAL_EPISODE_MAX_GAP_SECONDS,
                )
            )
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Thermal episode derivation failed for '%s'", area_id)

    async def _async_store_observation_summaries(
        self,
        room_id: str,
        kinds: tuple[str, ...],
        *,
        now_ts: float,
    ) -> None:
        """Persist observed-only summaries for raw observation kinds."""
        if not self._observation_store:
            return

        start_ts = now_ts - RAW_OBSERVATION_RETENTION_DAYS * 24 * 3600
        for kind in kinds:
            try:
                await self.hass.async_add_executor_job(
                    partial(
                        self._observation_store.store_window_summaries,
                        room_id=room_id,
                        kind=kind,
                        bucket_seconds=OBSERVED_SUMMARY_BUCKET_SECONDS,
                        start_ts=start_ts,
                        end_ts=now_ts,
                    )
                )
            except Exception:  # noqa: BLE001
                _LOGGER.warning("Observed summary derivation failed for '%s' %s", room_id, kind)

    def _read_room_sensors(
        self,
        room: dict,
        area_id: str,
    ) -> RoomSensorSnapshot:
        """Read a complete sensor snapshot for one room control cycle."""
        primary_sensor_id = room.get("temperature_sensor")
        temp_sensor_ids = self._temperature_sensor_ids(room)
        has_external_sensor = bool(temp_sensor_ids)
        observations: list[TemperatureObservation] = []
        now = datetime.now(UTC)

        current_temp: float | None = None
        for temp_sensor_id in temp_sensor_ids:
            raw_temp = read_sensor_value(self.hass, temp_sensor_id, area_id, "temperature")
            temp_c = ha_temp_to_celsius(self.hass, raw_temp, entity_id=temp_sensor_id) if raw_temp is not None else None
            if current_temp is None and temp_c is not None:
                current_temp = temp_c
            state = self.hass.states.get(temp_sensor_id) if temp_sensor_id else None
            self._record_raw_state_observation(
                area_id,
                temp_sensor_id,
                "temperature",
                state,
                is_primary=(temp_sensor_id == primary_sensor_id),
            )
            observation = self._sensor_fusion.observation_from_state(
                temp_sensor_id,
                state,
                now=now,
                value_c=temp_c,
                is_primary=(temp_sensor_id == primary_sensor_id),
            )
            if observation is not None:
                observations.append(observation)

        # Fallback: read current_temperature from first thermostat/AC if no external sensor
        if current_temp is None and not has_external_sensor:
            raw_dev = self._read_device_temp(room)
            current_temp = ha_temp_to_celsius(self.hass, raw_dev) if raw_dev is not None else None

        # --- Sensor dropout fallback: use cached temp if fresh enough ---
        current_temp_raw = current_temp  # preserve original for EKF/history

        if current_temp is not None:
            self._last_valid_temps[area_id] = (current_temp, time.monotonic())
        elif area_id in self._last_valid_temps:
            cached_temp, cached_ts = self._last_valid_temps[area_id]
            if time.monotonic() - cached_ts < MAX_SENSOR_STALENESS:
                current_temp = cached_temp
                _LOGGER.debug(
                    "Room '%s': sensor unavailable, using cached temp %.1f°C (age %.0fs)",
                    area_id,
                    cached_temp,
                    time.monotonic() - cached_ts,
                )
            else:
                del self._last_valid_temps[area_id]

        humidity = self._read_room_humidity(room, area_id, now)

        return RoomSensorSnapshot(
            current_temp=current_temp,
            current_temp_raw=current_temp_raw,
            humidity=humidity,
            has_external_sensor=has_external_sensor,
            temperature_observations=observations,
        )

    def _record_raw_state_observation(
        self,
        area_id: str,
        entity_id: str | None,
        kind: str,
        state: Any | None,
        *,
        is_primary: bool,
        quality: float | None = None,
    ) -> None:
        """Append a raw HA state observation to the in-memory write buffer."""
        if not entity_id or state is None:
            return
        state_value = str(getattr(state, "state", ""))
        attrs = getattr(state, "attributes", {}) or {}
        raw_state = "ok" if state_value not in ("unknown", "unavailable") else state_value
        self._raw_observation_buffer.append(
            {
                "room_id": area_id,
                "entity_id": entity_id,
                "kind": kind,
                "observed_at": self._state_observed_at(state),
                "ingested_at": time.time(),
                "state": raw_state,
                "value": state_value,
                "unit": attrs.get("unit_of_measurement"),
                "source": "home_assistant_state",
                "is_primary": is_primary,
                "quality": quality if quality is not None else (0.0 if raw_state != "ok" else 1.0),
                "attributes": self._essential_raw_attributes(attrs),
            }
        )

    @staticmethod
    def _state_observed_at(state: Any) -> float:
        """Return the source observation timestamp for a HA state."""
        for attr in ("last_reported", "last_updated", "last_changed"):
            value = getattr(state, attr, None)
            if isinstance(value, datetime):
                return value.timestamp()
        return time.time()

    @staticmethod
    def _essential_raw_attributes(attrs: dict) -> dict:
        """Return compact attributes worth preserving in raw observation storage."""
        return {
            key: attrs[key]
            for key in ("device_class", "state_class", "unit_of_measurement", "friendly_name")
            if key in attrs
        }

    def _temperature_sensor_ids(self, room: dict) -> list[str]:
        """Return configured temperature sensors with the primary sensor first."""
        sensor_ids: list[str] = []
        primary = room.get("temperature_sensor")
        if primary:
            sensor_ids.append(primary)

        extra_sensors = room.get("temperature_sensors", []) or []
        if isinstance(extra_sensors, str):
            extra_sensors = [extra_sensors]
        for item in extra_sensors:
            entity_id = item.get("entity_id") if isinstance(item, dict) else item
            if entity_id and entity_id not in sensor_ids:
                sensor_ids.append(entity_id)

        return sensor_ids

    def _read_room_humidity(self, room: dict, area_id: str, now: datetime) -> HumiditySensorSnapshot:
        """Read configured humidity sources into an explicit weighted snapshot."""
        sensor_ids = self._humidity_sensor_ids(room)
        weighted_values: list[tuple[float, float, str]] = []
        fallback_values: list[tuple[float, str]] = []
        primary = room.get("humidity_sensor") or ""
        for sensor_id in sensor_ids:
            state = self.hass.states.get(sensor_id)
            self._record_raw_state_observation(
                area_id,
                sensor_id,
                "humidity",
                state,
                is_primary=(sensor_id == primary),
            )
            value = read_sensor_value(self.hass, sensor_id, area_id, "humidity")
            if value is None:
                continue
            fallback_values.append((value, sensor_id))
            freshness_ts = getattr(state, "last_reported", None) or getattr(state, "last_updated", None)
            weight = 1.0
            if isinstance(freshness_ts, datetime):
                age_s = max(0.0, (now - freshness_ts).total_seconds())
                if age_s > MAX_SENSOR_STALENESS:
                    continue
                weight = 1.0 / (1.0 + age_s / 900.0)
            if sensor_id == primary:
                weight *= 1.25
            weighted_values.append((value, weight, sensor_id))

        if weighted_values:
            sources = [sensor_id for _, _, sensor_id in weighted_values]
            total_weight = sum(weight for _, weight, _ in weighted_values)
            if total_weight > 0:
                return HumiditySensorSnapshot(
                    value=round(sum(value * weight for value, weight, _ in weighted_values) / total_weight, 2),
                    sources=tuple(sources),
                    primary_available=primary in sources,
                )
        if fallback_values:
            sources = [sensor_id for _, sensor_id in fallback_values]
            return HumiditySensorSnapshot(
                value=round(fallback_values[0][0], 2),
                sources=tuple(sources),
                primary_available=primary in sources,
            )
        return HumiditySensorSnapshot(value=None)

    def _humidity_sensor_ids(self, room: dict) -> list[str]:
        """Return configured humidity sensors with the primary sensor first."""
        sensor_ids: list[str] = []
        primary = room.get("humidity_sensor")
        if primary:
            sensor_ids.append(primary)

        extra_sensors = room.get("humidity_sensors", []) or []
        if isinstance(extra_sensors, str):
            extra_sensors = [extra_sensors]
        for item in extra_sensors:
            entity_id = item.get("entity_id") if isinstance(item, dict) else item
            if entity_id and entity_id not in sensor_ids:
                sensor_ids.append(entity_id)

        return sensor_ids

    def _resolve_outdoor_temp(self, settings: dict) -> tuple[float | None, str]:
        """Return (temp, source) for the current cycle.

        Source is one of:
          - "sensor": primary outdoor_temp_sensor delivered a value
          - "weather": weather_entity attribute "temperature" delivered a value
          - "none": neither source available

        ``self.outdoor_temp`` remains the raw sensor reading for diagnostics;
        the result of this method is stored in ``self.outdoor_temp_effective``
        and is the canonical value all consumers (EKF, MPC, cover, heat-source,
        analytics, mold) use. EKF training is gated on a non-None effective
        temperature so the filter never trains with a degenerate fallback
        (e.g. room temp), which would cause the alpha state to drift to the
        upper bound — see #301.
        """
        if self.outdoor_temp is not None:
            return self.outdoor_temp, "sensor"

        weather_eid = settings.get("weather_entity") or ""
        if weather_eid:
            ws = self.hass.states.get(weather_eid)
            if ws is not None and ws.state not in ("unavailable", "unknown"):
                temp_attr = ws.attributes.get("temperature")
                if isinstance(temp_attr, (int, float)) and not isinstance(temp_attr, bool):
                    converted = ha_temp_to_celsius(self.hass, float(temp_attr), entity_id=weather_eid)
                    if converted is not None:
                        return converted, "weather"

        return None, "none"

    def _update_outdoor_unavailable_notification(self, settings: dict) -> None:
        """Track consecutive cycles without a valid outdoor temperature.

        After OUTDOOR_UNAVAILABLE_NOTIFY_CYCLES (default 60 ≈ 30 min) raise a
        single HA persistent notification informing the user that EKF training
        is paused. The notification clears as soon as a valid outdoor source
        returns. Suppressed entirely when the user disables it via the
        ``outdoor_unavailable_notify`` global setting.
        """
        if self.outdoor_temp_effective is not None:
            self._outdoor_unavailable_cycles = 0
            if self._outdoor_warning_sent:
                self._outdoor_warning_sent = False
                async_dismiss_notification(self.hass, OUTDOOR_UNAVAILABLE_NOTIFICATION_ID)
            return

        self._outdoor_unavailable_cycles += 1

        if self._outdoor_warning_sent:
            return
        if self._outdoor_unavailable_cycles < OUTDOOR_UNAVAILABLE_NOTIFY_CYCLES:
            return
        if not settings.get("outdoor_unavailable_notify", True):
            return

        not_configured = get_translation(self.hass, "notifications.common.not_configured")
        sensor_id = settings.get("outdoor_temp_sensor") or not_configured
        weather_eid = settings.get("weather_entity") or not_configured
        payload = build_outdoor_unavailable_payload(
            lambda key, **placeholders: get_translation(self.hass, key, **placeholders),
            sensor_id=sensor_id,
            weather_entity=weather_eid,
        )
        _LOGGER.warning(
            "Outdoor temperature unavailable for %d cycles — EKF learning paused",
            self._outdoor_unavailable_cycles,
        )
        async_create_notification(
            self.hass,
            payload.message,
            title=payload.title,
            notification_id=OUTDOOR_UNAVAILABLE_NOTIFICATION_ID,
        )
        self._outdoor_warning_sent = True

    def _select_airflow_curve(self, room: dict, key: str) -> list[dict[str, float]]:
        """Merge airflow curves from configured climate/HVAC fan devices."""
        curves: list[dict[str, float]] = []
        for device in room.get("airflow_devices", []) or []:
            if not device.get(key):
                continue
            if device.get("role") not in {"hvac_fan", "circulation"}:
                continue
            for point in device.get(key) or []:
                if isinstance(point, dict):
                    curves.append(point)
            if curves:
                break
        return curves

    def _adjacent_gate(self, config: dict) -> float:
        sensor = config.get("link_sensor_entity") or config.get("door_sensor_entity") or ""
        if not sensor:
            return 1.0
        state = self.hass.states.get(sensor)
        if state is None or state.state in ("unavailable", "unknown"):
            return 0.0
        if str(state.state).lower() in {"on", "open", "opening", "true", "home"}:
            return 1.0
        return 0.0

    def _build_coupling_terms(self, area_id: str, room: dict) -> list[dict]:
        """Build adjacent-room RC coupling terms from config and learned k values."""
        temperatures: dict[str, float] = {}
        for rid, live in self.rooms.items():
            temp = live.get("current_temp_raw", live.get("current_temp")) if isinstance(live, dict) else None
            if isinstance(temp, (int, float)) and not isinstance(temp, bool):
                temperatures[rid] = float(temp)
        terms: list[dict] = []
        learned = {obs.adjacent_room_id: obs for obs in self._room_coupling.observations_for(area_id)}
        for adjacent in room.get("adjacent_rooms", []) or []:
            if not isinstance(adjacent, dict) or not adjacent.get("enabled", True):
                continue
            adjacent_id = str(adjacent.get("area_id") or "")
            if not adjacent_id or adjacent_id not in temperatures:
                continue
            if not adjacent.get("allow_borrowed_conditioning", True):
                continue
            gate = self._adjacent_gate(adjacent)
            if gate <= 0.0:
                continue
            configured_k = float(adjacent.get("coupling_weight") or 0.0)
            learned_obs = learned.get(adjacent_id)
            learned_k = learned_obs.k if learned_obs and learned_obs.confidence >= 0.7 else 0.0
            k = configured_k if configured_k > 0 else learned_k
            if k <= 0.0:
                continue
            terms.append({"area_id": adjacent_id, "temperature": temperatures[adjacent_id], "k": k, "gate": gate})
        return terms

    def _update_room_couplings(self, rooms: dict[str, dict], room_states: dict[str, dict]) -> None:
        """Train adjacent-room coupling coefficients and surface current link status."""
        now = time.time()
        for area_id, room in rooms.items():
            state = room_states.get(area_id, {})
            temp = state.get("current_temp_raw", state.get("current_temp"))
            if not isinstance(temp, (int, float)) or isinstance(temp, bool):
                continue
            previous = self._room_coupling_last_temps.get(area_id)
            for adjacent in room.get("adjacent_rooms", []) or []:
                if not isinstance(adjacent, dict) or not adjacent.get("enabled", True):
                    continue
                adjacent_id = str(adjacent.get("area_id") or "")
                adjacent_state = room_states.get(adjacent_id, {})
                adjacent_temp = adjacent_state.get("current_temp_raw", adjacent_state.get("current_temp"))
                if not isinstance(adjacent_temp, (int, float)) or isinstance(adjacent_temp, bool):
                    continue
                if previous is None or self.outdoor_temp_effective is None:
                    continue
                prev_temp, prev_ts = previous
                dt_h = max((now - prev_ts) / 3600.0, 1e-6)
                if dt_h > 1.0:
                    continue
                model = self._model_manager.get_model(area_id)
                self._room_coupling.update(
                    room_id=area_id,
                    adjacent_room_id=adjacent_id,
                    room_temp=float(temp),
                    adjacent_temp=float(adjacent_temp),
                    room_slope_c_per_h=(float(temp) - prev_temp) / dt_h,
                    outdoor_temp=self.outdoor_temp_effective,
                    outdoor_alpha=model.U / max(model.C, 0.001),
                    gate=self._adjacent_gate(adjacent),
                )
            self._room_coupling_last_temps[area_id] = (float(temp), now)

        for area_id, room in rooms.items():
            if area_id not in room_states:
                continue
            room_states[area_id]["coupling_status"] = self._build_coupling_terms(area_id, room)

    async def _evaluate_mold_risk(
        self,
        area_id: str,
        current_temp: float | None,
        current_humidity: float | None,
        settings: dict,
    ) -> tuple[str, float | None, bool, float]:
        """Evaluate mold risk for a room.

        Returns (mold_risk_level, mold_surface_rh, mold_prevention_active, mold_prevention_delta).
        """
        mold = await self._mold_manager.evaluate(
            area_id,
            _get_area_name(self.hass, area_id),
            current_temp,
            current_humidity,
            self.outdoor_temp_effective,
            settings,
            celsius_delta_to_ha_fn=lambda d: celsius_delta_to_ha(self.hass, d),
            ha_temp_unit_str_fn=lambda: ha_temp_unit_str(self.hass),
        )
        return mold.risk_level, mold.surface_rh, mold.prevention_active, mold.prevention_delta

    def _read_climate_device_snapshot(self, room: dict[str, Any]) -> ClimateDeviceSnapshot:
        """Capture one consistent climate-device view for the control cycle."""
        devices = room.get("devices", [])
        trv_entity_ids = tuple(get_trv_eids(devices))
        ac_entity_ids = tuple(get_ac_eids(devices))

        def read_limits(entity_ids: tuple[str, ...], attribute: str) -> list[float]:
            limits: list[float] = []
            for entity_id in entity_ids:
                state = self.hass.states.get(entity_id)
                raw_limit = state.attributes.get(attribute) if state is not None else None
                if raw_limit is None:
                    continue
                try:
                    limit = float(raw_limit)
                except TypeError, ValueError:
                    continue
                limits.append(ha_temp_to_celsius(self.hass, limit))
            return limits

        trv_max_temps = read_limits(trv_entity_ids, "max_temp")
        ac_min_temps = read_limits(ac_entity_ids, "min_temp")
        ac_max_temps = read_limits(ac_entity_ids, "max_temp")
        return ClimateDeviceSnapshot(
            trv_entity_ids=trv_entity_ids,
            ac_entity_ids=ac_entity_ids,
            all_entity_ids=tuple(get_all_entity_ids(devices)),
            heating_boost_target=min(trv_max_temps) if trv_max_temps else None,
            ac_heating_boost_target=min(ac_max_temps) if ac_max_temps else None,
            cooling_boost_target=max(ac_min_temps) if ac_min_temps else None,
        )

    async def _async_process_room(self, room: dict, settings: dict, outdoor_forecast: list[dict]) -> dict:
        """Process a single room: read sensor, evaluate schedule, apply control."""
        area_id = room.get("area_id", "unknown")

        sensor_snapshot = self._read_room_sensors(room, area_id)
        current_temp = sensor_snapshot.current_temp
        current_temp_raw = sensor_snapshot.current_temp_raw
        current_humidity = sensor_snapshot.humidity.value
        has_external_sensor = sensor_snapshot.has_external_sensor
        temperature_observations = sensor_snapshot.temperature_observations
        sensor_conflict = airflow_sensor_conflict(temperature_observations)

        # --- Outdoor room: skip all control logic ---
        if room.get("is_outdoor", False):
            sensor_fusion_status = self._sensor_fusion.diagnostics(
                temperature_observations,
                power_fraction=0.0,
                q_fan_mix=0.0,
            )
            temperature_sources = [
                status.get("entity_id", "") for status in sensor_fusion_status if status.get("entity_id")
            ]
            return {
                "area_id": area_id,
                "current_temp": current_temp,
                "current_temp_raw": current_temp_raw,
                "current_humidity": current_humidity,
                "target_temp": None,
                "heat_target": None,
                "cool_target": None,
                "mode": MODE_IDLE,
                "heating_power": 0,
                "device_setpoint": None,
                "window_open": False,
                "override_active": False,
                "override_type": None,
                "override_temp": None,
                "override_until": None,
                "override_suppressed": False,
                "active_schedule_index": -1,
                "confidence": None,
                "mpc_active": False,
                "presence_away": False,
                "force_off": False,
                "mold_risk_level": "ok",
                "mold_surface_rh": None,
                "mold_prevention_active": False,
                "mold_prevention_delta": 0,
                "shading_factor": 1.0,
                "n_observations": 0,
                "q_fan_mix": 0.0,
                "q_vent": 0.0,
                "airflow_active": False,
                "airflow_mix_plan_level": 0.0,
                "airflow_vent_plan_level": 0.0,
                "airflow_plan_level": 0.0,
                "airflow_devices_status": [],
                "airflow_command_status": [],
                "sensor_conflict": sensor_conflict,
                "sensor_fusion_status": sensor_fusion_status,
                "temperature_source": temperature_sources[0] if temperature_sources else "",
                "temperature_source_count": len(temperature_sources),
                "temperature_primary_available": any(status.get("is_primary") for status in sensor_fusion_status),
                **sensor_snapshot.humidity.as_live_status(),
                "hvac_output_status": None,
                "night_mode": {"active": False},
                "night_control_status": [],
                "rapid_recovery_active": False,
                "effective_control_target": room.get("control_target", "air_temperature"),
                "coupling_status": [],
                "blind_position": None,
                "cover_auto_paused": False,
                "cover_forced_reason": "",
                "active_cover_schedule_index": -1,
                "q_occupancy": 0.0,
                "active_heat_sources": None,
            }

        # --- Mold risk calculation ---
        (
            mold_risk_level,
            mold_surface_rh,
            mold_prevention_active_room,
            mold_prevention_temp_delta,
        ) = await self._evaluate_mold_risk(area_id, current_temp, current_humidity, settings)

        target_plan = await self.async_prepare_control_target_plan(
            room,
            settings,
            mold_prevention_active=mold_prevention_active_room,
            mold_prevention_delta=mold_prevention_temp_delta,
        )
        self._schedule_expired_target_state_cleanup(area_id, target_plan)
        targets = target_plan.targets
        force_off = target_plan.force_off
        presence_away = target_plan.presence_away
        target_resolver = target_plan.resolver
        night_mode_active = target_plan.night_active

        # --- Compute residual heat from previous cycle state ---
        system_type = room.get("heating_system_type", "")
        q_residual = self._residual_tracker.get_q_residual(
            area_id,
            system_type,
            self._previous_modes.get(area_id, MODE_IDLE),
        )

        # Read current cover positions for shading factor
        cover_pos_result = self._cover_orchestrator.read_positions(area_id, room)
        shading_factor = cover_pos_result.shading_factor
        solar_exposure = SolarExposure(
            raw_solar=self._current_q_solar,
            shading_factor=shading_factor,
        )

        # Read occupancy sensors for thermal model (OR logic: any sensor "on" → occupied)
        q_occupancy = 0.0
        for occ_eid in room.get("occupancy_sensors", []):
            occ_state = self.hass.states.get(occ_eid)
            if occ_state and occ_state.state == "on":
                q_occupancy = 1.0
                break
            # unavailable/unknown/off → skip (conservative: no occupancy heat)

        airflow = self._environmental_factors.read_room_airflow(room)
        airflow_has_ventilation = any(
            status.available and status.role == AIRFLOW_ROLE_VENTILATION for status in airflow.statuses
        )
        airflow_mix_score = max(airflow.q_fan_mix, sensor_conflict)
        airflow_capacity_curve = self._select_airflow_curve(room, "fan_capacity_curve")
        airflow_power_curve = self._select_airflow_curve(room, "fan_power_curve")
        coupling_terms = self._build_coupling_terms(area_id, room)

        # Determine and apply mode with MPC controller
        controller = MPCController(
            self.hass,
            room,
            model_manager=self._model_manager,
            outdoor_temp=self.outdoor_temp_effective,
            outdoor_forecast=outdoor_forecast,
            settings=settings,
            previous_mode=self._previous_modes.get(area_id, MODE_IDLE),
            mode_on_since=self._mode_on_since.get(area_id),
            has_external_sensor=has_external_sensor,
            target_resolver=target_resolver,
            q_solar=solar_exposure.raw_solar,
            latitude=self.hass.config.latitude,
            longitude=self.hass.config.longitude,
            cloud_series=WeatherManager.extract_cloud_series(outdoor_forecast),
            q_residual=q_residual,
            heating_system_type=system_type,
            shading_factor=shading_factor,
            q_occupancy=q_occupancy,
            q_vent=airflow.q_vent,
            airflow_levels=airflow.levels,
            mix_levels=airflow.mix_levels,
            vent_levels=airflow.vent_levels,
            airflow_has_ventilation=airflow_has_ventilation,
            airflow_has_hvac_fan=airflow.has_hvac_fan_control,
            airflow_mix_score=airflow_mix_score,
            airflow_capacity_curve=airflow_capacity_curve,
            airflow_power_curve=airflow_power_curve,
            control_target=room.get("control_target", "air_temperature"),
            current_humidity=current_humidity,
            night_active=night_mode_active,
            night_quiet_penalty=0.35,
            coupling_terms=coupling_terms,
        )
        mode, power_fraction = await controller.async_evaluate(current_temp, targets)

        # Compute effective single target_temp for display/history (mode + climate_mode aware)
        climate_mode = room.get("climate_mode", "auto")
        if climate_mode == CLIMATE_MODE_COOL_ONLY:
            target_temp = targets.cool
        elif climate_mode == CLIMATE_MODE_HEAT_ONLY:
            target_temp = targets.heat
        else:  # auto
            if mode == MODE_HEATING and targets.heat is not None:
                target_temp = targets.heat
            elif mode == MODE_COOLING and targets.cool is not None:
                target_temp = targets.cool
            else:
                target_temp = targets.heat if targets.heat is not None else targets.cool

        rapid_recovery_mode = resolve_rapid_recovery_mode(
            room,
            settings,
            current_temp=current_temp,
            targets=targets,
            night_active=night_mode_active,
            outdoor_temp=self.outdoor_temp_effective,
        )
        raw_open = self._is_window_open(room)
        window_open = self._window_manager.update(
            area_id,
            raw_open,
            room.get("window_open_delay", 0),
            room.get("window_close_delay", 0),
        )
        constraint_result = self._constraint_reducer.reduce(
            ConstraintInput(
                mode=mode,
                power_fraction=power_fraction,
                force_off=force_off,
                window_open=window_open,
                rapid_recovery_mode=rapid_recovery_mode,
            )
        )
        mode = constraint_result.mode
        power_fraction = constraint_result.power_fraction
        rapid_recovery_active = constraint_result.rapid_recovery_active
        if rapid_recovery_active:
            target_temp = targets.cool if mode == MODE_COOLING else targets.heat

        climate_active = settings.get("climate_control_active", True) and room.get("climate_control_enabled", True)
        airflow_mix_plan_level = 0.0 if window_open or force_off else controller.last_airflow_mix_level
        airflow_vent_plan_level = 0.0 if window_open or force_off else controller.last_airflow_vent_level
        if rapid_recovery_active and not window_open and not force_off and mode in (MODE_HEATING, MODE_COOLING):
            airflow_mix_plan_level = max(airflow_mix_plan_level, *(airflow.mix_levels or [1.0]))
        night_fan_limit = room.get("max_fan_level_night")
        if night_mode_active and not rapid_recovery_active and night_fan_limit is not None:
            airflow_mix_plan_level = min(airflow_mix_plan_level, max(0.0, min(1.0, float(night_fan_limit))))
        airflow_plan_level = max(airflow_mix_plan_level, airflow_vent_plan_level)
        airflow_command_status: list[dict[str, Any]] = []
        airflow_context = AirflowRuntimeContext(
            night_active=night_mode_active,
            presence_away=presence_away,
            rapid_recovery_active=rapid_recovery_active,
        )

        device_snapshot = self._read_climate_device_snapshot(room)

        # Exclude TRVs currently being valve-protection-cycled from normal control
        cycling_eids = {
            eid for eid in device_snapshot.trv_entity_ids if self._valve_manager.is_entity_cycling(eid)
        }

        # Heat source orchestration: smart routing for rooms with both TRVs and ACs
        heat_source_plan = None
        if (
            room.get("heat_source_orchestration", False)
            and mode == MODE_HEATING
            and has_external_sensor
            and device_snapshot.trv_entity_ids
            and device_snapshot.ac_entity_ids
        ):
            heat_source_plan = evaluate_heat_sources(
                room_config=room,
                mode=mode,
                power_fraction=power_fraction,
                current_temp=current_temp,
                target_temp=targets.heat,
                outdoor_temp=self.outdoor_temp_effective,
                previous_active_sources=self._heat_source_states.get(area_id, "none"),
                hass=self.hass,
            )
            if heat_source_plan is not None:
                self._heat_source_states[area_id] = heat_source_plan.active_sources
            else:
                # Orchestrator returned None (e.g. missing current/target temp).
                # The non-orchestrated async_apply path commands all devices,
                # so clear stale state to prevent the master-demand filter
                # from acting on a previous orchestration decision.
                self._heat_source_states.pop(area_id, None)
        else:
            # Orchestration not active for this room — remove stale state
            # so re-enabling starts fresh.
            self._heat_source_states.pop(area_id, None)

        # Compressor group constraints
        compressor_forced_on_f, compressor_forced_off_f = self._constraint_reducer.compressor_constraints(
            manager=self._compressor_manager,
            all_device_eids=device_snapshot.all_entity_ids,
            mode=mode,
            climate_active=climate_active,
            window_open=window_open,
            force_off=force_off,
        )

        compressor_constraint_result = self._constraint_reducer.reduce(
            ConstraintInput(
                mode=mode,
                power_fraction=power_fraction,
                force_off=force_off,
                window_open=window_open,
                rapid_recovery_active=rapid_recovery_active,
                all_device_eids=device_snapshot.all_entity_ids,
                compressor_forced_on=compressor_forced_on_f,
                compressor_forced_off=compressor_forced_off_f,
            )
        )
        mode = compressor_constraint_result.mode
        power_fraction = compressor_constraint_result.power_fraction
        rapid_recovery_active = compressor_constraint_result.rapid_recovery_active
        compressor_forced_on = set(compressor_constraint_result.compressor_forced_on)
        compressor_forced_off = set(compressor_constraint_result.compressor_forced_off)

        # --- Residual heat transition tracking ---
        # After compressor constraints may have changed mode to IDLE.
        if climate_active and system_type:
            self._residual_tracker.update(
                area_id,
                mode,
                power_fraction,
                self._previous_modes.get(area_id, MODE_IDLE),
                q_residual=q_residual,
            )

        if climate_active:
            applied_report: AppliedCommandReport | None = None
            try:
                applied_report = await controller.async_apply(
                    mode,
                    targets,
                    power_fraction=power_fraction,
                    current_temp=current_temp,
                    exclude_eids=cycling_eids,
                    heating_boost_target=device_snapshot.heating_boost_target,
                    ac_heating_boost_target=device_snapshot.ac_heating_boost_target,
                    cooling_boost_target=device_snapshot.cooling_boost_target,
                    heat_source_plan=heat_source_plan,
                    compressor_forced_on=compressor_forced_on or None,
                    compressor_forced_off=compressor_forced_off or None,
                )
            except Exception:  # noqa: BLE001
                _LOGGER.warning(
                    "Room '%s': climate service call failed",
                    area_id,
                    exc_info=True,
                )
            try:
                airflow_command_status = await self._airflow_control.async_apply(
                    area_id,
                    room,
                    mix_level=airflow_mix_plan_level,
                    vent_level=airflow_vent_plan_level,
                    mode=mode,
                    context=airflow_context,
                )
            except Exception:  # noqa: BLE001
                _LOGGER.warning(
                    "Room '%s': airflow service call failed",
                    area_id,
                    exc_info=True,
                )
            # Update compressor group member states (always, even after failed apply).
            routed_commands = heat_source_plan.commands if heat_source_plan is not None else ()
            self._compressor_manager.reconcile_command_outcome(
                CompressorCommandOutcome(
                    member_entity_ids=device_snapshot.all_entity_ids,
                    excluded=frozenset(cycling_eids),
                    forced_on=frozenset(compressor_forced_on),
                    forced_off=frozenset(compressor_forced_off),
                    applied_active=frozenset(applied_report.active_eids) if applied_report is not None else frozenset(),
                    applied_inactive=(
                        frozenset(applied_report.inactive_eids) if applied_report is not None else frozenset()
                    ),
                    routed_commanded=frozenset(command.entity_id for command in routed_commands),
                    routed_active=frozenset(command.entity_id for command in routed_commands if command.active),
                    default_active=mode != MODE_IDLE,
                ),
                is_entity_running=self._is_entity_running,
            )
        else:
            # Climate control disabled — stop RoomMind airflow outputs and any
            # RoomMind-owned climate fan_only state.
            mode = MODE_IDLE
            power_fraction = 0.0
            airflow_mix_plan_level = 0.0
            airflow_vent_plan_level = 0.0
            airflow_plan_level = 0.0
            airflow_command_status = await self._airflow_control.async_apply(
                area_id,
                room,
                mix_level=0.0,
                vent_level=0.0,
                mode=MODE_IDLE,
                context=airflow_context,
            )

        night_control_status: list[dict[str, Any]] = []
        try:
            night_control_status = await self._night_mode_manager.async_apply(
                area_id,
                room,
                active=night_mode_active,
            )
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Room '%s': night-mode accessory control failed", area_id, exc_info=True)

        # --- Cover/blind automatic control ---
        has_override = is_override_active(room)
        cover_result = await self._cover_orchestrator.async_process(
            area_id=area_id,
            room=room,
            targets=targets,
            mode=mode,
            current_temp=current_temp,
            outdoor_temp=self.outdoor_temp_effective,
            q_solar=solar_exposure.raw_solar,
            predicted_peak_temp=controller.predicted_peak_temp,
            has_override=has_override,
            solar_exposure=solar_exposure,
        )

        # Track valve actuation during normal heating (skip excluded entities)
        if mode == MODE_HEATING:
            excluded = set(room.get("valve_protection_exclude", []))
            heating_eids = [eid for eid in device_snapshot.trv_entity_ids if eid not in excluded]
            self._valve_manager.record_heating(heating_eids)

        mpc_active = False
        if has_external_sensor and mpc_control_enabled(settings):
            try:
                _ch, _cc = get_can_heat_cool(
                    room,
                    self.outdoor_temp_effective,
                    acs_can_heat=check_acs_can_heat(self.hass, room),
                    override_active=is_override_active(room),
                )
                _T_out = (
                    self.outdoor_temp_effective
                    if self.outdoor_temp_effective is not None
                    else DEFAULT_OUTDOOR_TEMP_FALLBACK
                )
                mpc_active = is_mpc_active(
                    self._model_manager,
                    area_id,
                    _ch,
                    _cc,
                    current_temp or 20.0,
                    _T_out,
                )
            except Exception:  # noqa: BLE001
                mpc_active = False

        display_mode, display_pf = await self._observe_and_train(
            area_id=area_id,
            room=room,
            settings=settings,
            current_temp_raw=current_temp_raw,
            temperature_observations=temperature_observations,
            mode=mode,
            power_fraction=power_fraction,
            window_open=window_open,
            raw_open=raw_open,
            q_residual=q_residual,
            shading_factor=shading_factor,
            q_occupancy=q_occupancy,
            q_fan_mix=airflow.q_fan_mix,
            q_vent=airflow.q_vent,
            has_external_sensor=has_external_sensor,
            heat_source_plan=heat_source_plan,
            climate_active=climate_active,
        )

        return self._build_room_state_dict(
            area_id=area_id,
            room=room,
            settings=settings,
            sensor_snapshot=sensor_snapshot,
            target_temp=target_temp,
            target_plan=target_plan,
            display_mode=display_mode,
            display_pf=display_pf,
            heat_source_plan=heat_source_plan,
            device_snapshot=device_snapshot,
            window_open=window_open,
            mode=mode,
            power_fraction=power_fraction,
            mold_risk_level=mold_risk_level,
            mold_surface_rh=mold_surface_rh,
            mold_prevention_active_room=mold_prevention_active_room,
            mold_prevention_temp_delta=mold_prevention_temp_delta,
            solar_exposure=solar_exposure,
            q_occupancy=q_occupancy,
            airflow=airflow,
            airflow_mix_plan_level=airflow_mix_plan_level,
            airflow_vent_plan_level=airflow_vent_plan_level,
            airflow_plan_level=airflow_plan_level,
            airflow_command_status=airflow_command_status,
            sensor_conflict=sensor_conflict,
            sensor_fusion_status=self._sensor_fusion.diagnostics(
                temperature_observations,
                power_fraction=power_fraction,
                q_fan_mix=airflow.q_fan_mix,
            ),
            hvac_output_status=self._observe_hvac_output(room, airflow.as_status_dicts(), current_temp_raw),
            night_control_status=night_control_status,
            rapid_recovery_active=rapid_recovery_active,
            coupling_status=coupling_terms,
            cover_result=cover_result,
            mpc_active=mpc_active,
        )

    async def _observe_and_train(
        self,
        *,
        area_id: str,
        room: dict,
        settings: dict,
        current_temp_raw: float | None,
        temperature_observations: list[TemperatureObservation],
        mode: str,
        power_fraction: float,
        window_open: bool,
        raw_open: bool,
        q_residual: float,
        shading_factor: float | None,
        q_occupancy: float,
        q_fan_mix: float = 0.0,
        q_vent: float = 0.0,
        has_external_sensor: bool,
        heat_source_plan: Any | None,
        climate_active: bool,
    ) -> tuple[str, float]:
        """Observe device state, train EKF, compute display mode.

        Returns (display_mode, display_pf).
        """
        # observed_mode/observed_pf: only populated when climate control is off
        observed_mode: str | None = None
        observed_pf = 0.0

        if not climate_active:
            # Climate control disabled (learn-only) — observe device state
            # for training and display.
            observed_mode, observed_pf = self._observe_device_action(room)
            if observed_mode is None and self._devices_lack_hvac_action(room):
                # No hvac_action on any device — fall back to temp-vs-setpoint
                # inference for approximate training (better than skipping).
                # Don't infer for other None reasons (conflicts, unavailable).
                inferred = self._infer_device_mode(room)
                observed_mode = inferred
                observed_pf = 1.0 if inferred != MODE_IDLE else 0.0
            if observed_mode is not None and observed_mode != MODE_IDLE:
                _LOGGER.debug(
                    "Room '%s': device self-regulating (%s), using for training",
                    area_id,
                    observed_mode,
                )

        # For Managed Mode rooms, observe actual device state for display + training.
        # The controller's mode is "intent" (device told to heat), but the device
        # self-regulates and may be idle at setpoint.  See #69.
        managed_display_mode: str | None = None
        managed_display_pf = 0.0
        if climate_active and not has_external_sensor:
            obs_mode, obs_pf = self._observe_device_action(room)
            if obs_mode is not None:
                managed_display_mode = obs_mode
                managed_display_pf = obs_pf
            else:
                managed_display_mode = self._infer_device_mode(room)
                managed_display_pf = 1.0 if managed_display_mode != MODE_IDLE else 0.0

        # Determine mode for EKF training: use observed device state when
        # RoomMind doesn't directly control the device (see #36, #69).
        if climate_active:
            if has_external_sensor:
                # Full Control: controller's commanded mode is truth
                ekf_mode: str | None = mode
                ekf_pf = power_fraction
                # When heat source orchestration is active, adjust ekf_pf to
                # reflect the actual power delivered (not all devices may be
                # heating).  Use the mean of per-device power_fractions so the
                # EKF learns an accurate aggregated beta_h.
                if heat_source_plan is not None and heat_source_plan.commands:
                    ekf_pf = sum(c.power_fraction for c in heat_source_plan.commands) / len(heat_source_plan.commands)
            else:
                # Managed Mode: device self-regulates, use observed/inferred
                # state to avoid training "always heating" (#69).
                ekf_mode = managed_display_mode
                ekf_pf = managed_display_pf
        else:
            ekf_mode = observed_mode  # may be None → skip training
            ekf_pf = observed_pf

        # --- Observation-based corrections on the training mode (#150, #241) ---
        # Ghost-heating guard: in Full Control the controller's commanded mode
        # can diverge from what the device actually does.  Near target with
        # setpoint_mode="direct" a device's internal hysteresis can block
        # firing even while RoomMind commands heating/cooling.  Without this
        # guard the EKF receives a heating/cooling label for a period where no
        # energy actually entered the room, which drives alpha toward its
        # upper bound via cross-covariance with a negative innovation.
        # We only override to idle when all active devices unambiguously
        # report idle/off — heating/cooling observations keep the commanded
        # power_fraction so MPC throttling (e.g. pf=0.3) is preserved.
        q_residual_training = q_residual
        if climate_active and has_external_sensor and ekf_mode in (MODE_HEATING, MODE_COOLING):
            obs_mode, _ = self._observe_device_action(room)
            if obs_mode == MODE_IDLE:
                _LOGGER.debug(
                    "Room '%s': ghost-heating guard — commanded %s but devices idle, training as idle",
                    area_id,
                    ekf_mode,
                )
                ekf_mode = MODE_IDLE
                ekf_pf = 0.0
                q_residual_training = 0.0

        # Zero-power normalization: heat source orchestration may yield
        # mean(pf)=0 while the commanded mode is still heating/cooling.
        # Without this the predict step inflates Q_BETA_H through a zero
        # Jacobian (F[0][2]=pf=0) — variance grows without an observable
        # signal and destabilises the alpha↔beta coupling.  Downgrade to idle
        # for a consistent training batch.
        if ekf_mode in (MODE_HEATING, MODE_COOLING) and ekf_pf == 0.0:
            ekf_mode = MODE_IDLE
            q_residual_training = 0.0

        # Update thermal model with observation (EKF online learning).
        # The filter must NOT train with a degenerate outdoor fallback (e.g.
        # using room temp when the sensor is unavailable): F[0][1] collapses
        # toward 0, alpha drifts under process noise and eventually pegs at
        # the upper bound (see #301).  Skip the update — and flush any
        # accumulated batch — when no real outdoor source is available.
        learning_disabled = settings.get("learning_disabled_rooms", [])
        learning_active = area_id not in learning_disabled
        if learning_active and current_temp_raw is not None and self.outdoor_temp_effective is not None:
            can_heat, can_cool = get_can_heat_cool(room, acs_can_heat=check_acs_can_heat(self.hass, room))
            training_observations = self._sensor_fusion.calibrate_observations(
                temperature_observations,
                mode=ekf_mode or MODE_IDLE,
                power_fraction=ekf_pf,
                q_fan_mix=q_fan_mix,
            )
            self._ekf_training.process(
                area_id=area_id,
                current_temp=current_temp_raw,
                current_observations=training_observations,
                T_outdoor=self.outdoor_temp_effective,
                ekf_mode=ekf_mode,
                ekf_pf=ekf_pf,
                window_open=window_open,
                raw_open=raw_open,
                q_residual=q_residual_training,
                shading_factor=shading_factor if shading_factor is not None else 0.0,
                q_solar=self._current_q_solar,
                can_heat=can_heat,
                can_cool=can_cool,
                dt_minutes=UPDATE_INTERVAL / 60.0,
                q_occupancy=q_occupancy,
                q_vent=q_vent,
            )
        else:
            self._ekf_training.clear(area_id)

        # Update mode-start tracking for min-run enforcement in the next cycle
        _prev_mode = self._previous_modes.get(area_id, MODE_IDLE)
        if mode != MODE_IDLE and _prev_mode != mode:
            self._mode_on_since[area_id] = time.time()
        elif mode == MODE_IDLE:
            self._mode_on_since.pop(area_id, None)
        self._previous_modes[area_id] = mode

        # Compute display mode: show actual device state when RoomMind doesn't
        # directly control the device, without affecting internal tracking
        # (residual heat, valve actuation, _previous_modes).  See #36, #69.
        if climate_active:
            if has_external_sensor:
                # Full Control: controller's mode is authoritative
                display_mode = mode
                display_pf = power_fraction
            else:
                # Managed Mode: show observed/inferred device state (#69)
                display_mode = managed_display_mode if managed_display_mode is not None else mode
                display_pf = managed_display_pf if managed_display_mode is not None else power_fraction
        else:
            if observed_mode is not None and observed_mode != MODE_IDLE:
                display_mode = observed_mode
                display_pf = observed_pf
            elif observed_mode is None:
                display_mode = self._infer_device_mode(room)
                display_pf = 1.0 if display_mode != MODE_IDLE else 0.0
            else:
                display_mode = MODE_IDLE
                display_pf = 0.0

        return display_mode, display_pf

    def _build_room_state_dict(
        self,
        *,
        area_id: str,
        room: dict,
        settings: dict,
        sensor_snapshot: RoomSensorSnapshot,
        target_temp: float | None,
        target_plan: ControlTargetPlan,
        display_mode: str,
        display_pf: float,
        heat_source_plan: HeatSourcePlan | None,
        device_snapshot: ClimateDeviceSnapshot,
        window_open: bool,
        mode: str,
        power_fraction: float,
        mold_risk_level: str | None,
        mold_surface_rh: float | None,
        mold_prevention_active_room: bool,
        mold_prevention_temp_delta: float,
        solar_exposure: SolarExposure,
        q_occupancy: float,
        airflow: AirflowFactors,
        airflow_mix_plan_level: float,
        airflow_vent_plan_level: float,
        airflow_plan_level: float,
        airflow_command_status: list[dict],
        sensor_conflict: float,
        sensor_fusion_status: list[dict],
        hvac_output_status: dict | None,
        night_control_status: list[dict],
        rapid_recovery_active: bool,
        coupling_status: list[dict],
        cover_result: CoverResult,
        mpc_active: bool,
    ) -> dict:
        """Build the final room state dictionary."""
        current_temp = sensor_snapshot.current_temp
        current_temp_raw = sensor_snapshot.current_temp_raw
        current_humidity = sensor_snapshot.humidity.value
        targets = target_plan.targets
        q_fan_mix = airflow.q_fan_mix
        q_vent = airflow.q_vent
        cover_eids = room.get("covers", [])
        _room_devices = room.get("devices", [])
        _direct_eids = get_direct_setpoint_eids(_room_devices)
        _devs_with_eid = [d for d in _room_devices if d.get("entity_id")]
        _all_direct = bool(_devs_with_eid) and len(_direct_eids) == len(_devs_with_eid)
        temperature_sources = [
            status.get("entity_id", "") for status in sensor_fusion_status if status.get("entity_id")
        ]
        return {
            "area_id": area_id,
            "current_temp": current_temp,
            "current_temp_raw": current_temp_raw,
            "current_humidity": current_humidity,
            "target_temp": target_temp,
            "heat_target": targets.heat,
            "cool_target": targets.cool,
            "mode": display_mode,
            "commanded_mode": mode,
            "heating_power": round(display_pf * 100) if display_mode != MODE_IDLE else 0,
            "device_setpoint": self._compute_device_setpoint_orchestrated(
                heat_source_plan,
                current_temp,
                target_temp,
                device_snapshot.heating_boost_target,
                device_snapshot.ac_heating_boost_target,
                direct_eids=_direct_eids,
            )
            if heat_source_plan is not None
            else self._compute_device_setpoint(
                mode,
                power_fraction,
                current_temp,
                target_temp,
                sensor_snapshot.has_external_sensor,
                device_max_temp=device_snapshot.heating_boost_target,
                device_min_temp=device_snapshot.cooling_boost_target,
                has_thermostats=bool(device_snapshot.trv_entity_ids),
                has_acs=bool(device_snapshot.ac_entity_ids),
                all_direct=_all_direct,
            ),
            "window_open": window_open,
            **build_override_live(
                room,
                suppressed=is_override_suppressed(room, settings, target_plan.presence_away),
            ),
            "active_schedule_index": self._get_active_schedule_index(room),
            "confidence": self._model_manager.get_confidence(area_id),
            "mpc_active": mpc_active,
            "presence_away": target_plan.presence_away,
            "force_off": target_plan.force_off,
            "mold_risk_level": mold_risk_level,
            "mold_surface_rh": (round(mold_surface_rh, 1) if mold_surface_rh is not None else None),
            "mold_prevention_active": mold_prevention_active_room,
            "mold_prevention_delta": mold_prevention_temp_delta,
            "shading_factor": solar_exposure.shading_factor,
            "q_occupancy": q_occupancy,
            "q_fan_mix": q_fan_mix,
            "q_vent": q_vent,
            "airflow_ach": airflow.airflow_ach,
            "perceived_temp": (
                perceived_temperature(
                    air_temp_c=current_temp,
                    humidity=current_humidity,
                    q_mix=q_fan_mix,
                    mode=mode,
                )
                if current_temp is not None
                else None
            ),
            "airflow_active": q_fan_mix > 0.0 or q_vent > 0.0,
            "airflow_mix_plan_level": airflow_mix_plan_level,
            "airflow_vent_plan_level": airflow_vent_plan_level,
            "airflow_plan_level": airflow_plan_level,
            "airflow_devices_status": airflow.as_status_dicts(),
            "airflow_command_status": airflow_command_status,
            "sensor_conflict": sensor_conflict,
            "sensor_fusion_status": sensor_fusion_status,
            "temperature_source": temperature_sources[0] if temperature_sources else "",
            "temperature_source_count": len(temperature_sources),
            "temperature_primary_available": any(status.get("is_primary") for status in sensor_fusion_status),
            **sensor_snapshot.humidity.as_live_status(),
            "hvac_output_status": hvac_output_status,
            "night_mode": {
                "active": target_plan.night_active,
                "quiet_hours": room.get("quiet_hours"),
                "sleep_temp_ramp_c": room.get("sleep_temp_ramp_c", 0.0),
                "max_fan_level": room.get("max_fan_level_night"),
            },
            "night_control_status": night_control_status,
            "rapid_recovery_active": rapid_recovery_active,
            "effective_control_target": room.get("control_target", "air_temperature"),
            "coupling_status": coupling_status,
            "n_observations": self._model_manager.get_n_observations(area_id),
            "blind_position": (self._cover_orchestrator.get_current_position(area_id) if cover_eids else None),
            "cover_auto_paused": (self._cover_orchestrator.is_user_override_active(area_id) if cover_eids else False),
            "cover_reason": (cover_result.decision.reason if cover_eids else ""),
            "cover_forced_reason": (cover_result.forced_reason if cover_eids else ""),
            "active_cover_schedule_index": (cover_result.active_cover_schedule_index if cover_eids else -1),
            "active_heat_sources": self._heat_source_states.get(area_id),
        }

    def _observe_hvac_output(
        self,
        room: dict,
        airflow_statuses: list[dict],
        current_temp_raw: float | None,
    ) -> dict | None:
        """Return a coarse HVAC output observation for the first configured climate airflow device."""
        status_by_entity = {status.get("entity_id"): status for status in airflow_statuses}
        for device in room.get("airflow_devices", []) or []:
            entity_id = device.get("entity_id", "")
            if not entity_id.startswith("climate."):
                continue
            state = self.hass.states.get(entity_id)
            attrs = state.attributes if state else {}
            observation = self._hvac_output_observer.observe(
                device,
                hvac_action=attrs.get("hvac_action"),
                fan_q=float(status_by_entity.get(entity_id, {}).get("q") or 0.0),
                temp_slope_c_per_h=None if current_temp_raw is None else 0.0,
            )
            return {
                "entity_id": entity_id,
                "stage": observation.stage,
                "delivered_capacity_factor": observation.delivered_capacity_factor,
                "electric_power_w": observation.electric_power_w,
                "confidence": observation.confidence,
            }
        return None

    @staticmethod
    def _compute_device_setpoint_orchestrated(
        heat_source_plan: HeatSourcePlan,
        current_temp: float | None,
        target_temp: float | None,
        device_max_temp: float | None,
        ac_device_max_temp: float | None,
        direct_eids: set[str] | None = None,
    ) -> float | None:
        """Compute device setpoint from the orchestrated heat source plan."""
        if current_temp is None or target_temp is None:
            return None
        # Find the most representative active command
        active_cmds = [c for c in heat_source_plan.commands if c.active]
        if not active_cmds:
            return None
        # Pick the first active command (primary preferred, then secondary)
        cmd = active_cmds[0]
        if direct_eids and cmd.entity_id in direct_eids:
            return target_temp
        if cmd.device_type == "thermostat":
            boost = device_max_temp if device_max_temp is not None else HEATING_BOOST_TARGET
        else:
            boost = ac_device_max_temp if ac_device_max_temp is not None else AC_HEATING_BOOST_TARGET
        sp = round(current_temp + cmd.power_fraction * (boost - current_temp), 1)
        sp = max(target_temp, sp)
        sp = min(boost, sp)
        return sp

    @staticmethod
    def _compute_device_setpoint(
        mode: str,
        power_fraction: float,
        current_temp: float | None,
        target_temp: float | None,
        has_external_sensor: bool,
        device_max_temp: float | None = None,
        device_min_temp: float | None = None,
        has_thermostats: bool = True,
        has_acs: bool = False,
        all_direct: bool = False,
    ) -> float | None:
        """Compute the device setpoint for UI display (Full Control only)."""
        if not has_external_sensor or current_temp is None or target_temp is None:
            return None
        if all_direct:
            return target_temp

        if mode == MODE_HEATING:
            default_boost = HEATING_BOOST_TARGET if has_thermostats else AC_HEATING_BOOST_TARGET
            boost = device_max_temp if device_max_temp is not None else default_boost
            if not has_thermostats and not has_acs:
                return None
            sp = round(current_temp + power_fraction * (boost - current_temp), 1)
            sp = max(target_temp, sp)
            sp = min(boost, sp)
            return sp

        if mode == MODE_COOLING and has_acs:
            boost = device_min_temp if device_min_temp is not None else AC_COOLING_BOOST_TARGET
            sp = round(current_temp - power_fraction * (current_temp - boost), 1)
            sp = max(boost, sp)
            sp = min(target_temp, sp)
            return sp

        return None

    def _read_device_temp(self, room: dict) -> float | None:
        """Read current_temperature from the first thermostat or AC entity."""
        for entity_id in get_all_entity_ids(room.get("devices", [])):
            state = self.hass.states.get(entity_id)
            if state and state.attributes.get("current_temperature") is not None:
                try:
                    return float(state.attributes["current_temperature"])
                except ValueError, TypeError:
                    continue
        return None

    def _is_entity_running(self, entity_id: str) -> bool:
        """Return whether an entity currently reports an active state."""
        state = self.hass.states.get(entity_id)
        return state is not None and state.state not in (
            "off",
            "unavailable",
            "unknown",
        )

    def _observe_device_action(self, room: dict) -> tuple[str | None, float]:
        """Observe actual hvac_action from climate devices for model training.

        When climate control is disabled, devices may still self-regulate.
        This method reads the actual device state so the EKF receives
        correct mode information instead of blindly assuming idle.

        Returns (observed_mode, power_fraction):
          - ("heating", 1.0) / ("cooling", 1.0) / ("idle", 0.0) when conclusive
          - (None, 0.0) when state is unobservable (caller should skip training)
        """
        dominated: str | None = None

        for eid in get_all_entity_ids(room.get("devices", [])):
            state = self.hass.states.get(eid)
            if state is None or state.state in ("unavailable", "unknown"):
                continue

            # Device explicitly off → conclusively idle
            if state.state == "off":
                if dominated is None:
                    dominated = "idle"
                continue

            # Device in an active hvac_mode → need hvac_action to determine firing
            action = state.attributes.get("hvac_action")
            if action is None:
                # No hvac_action attribute → can't tell if firing → unobservable
                return (None, 0.0)

            if action in ("heating", "preheating"):
                if dominated == "cooling":
                    return (None, 0.0)  # conflicting → skip
                dominated = "heating"
            elif action == "cooling":
                if dominated == "heating":
                    return (None, 0.0)  # conflicting → skip
                dominated = "cooling"
            elif action in ("idle", "off"):
                if dominated is None:
                    dominated = "idle"
            else:
                # drying, fan, etc. — unknown thermal effect → skip
                return (None, 0.0)

        if dominated is None:
            return (None, 0.0)  # no devices or all unavailable

        pf = 1.0 if dominated in ("heating", "cooling") else 0.0
        return (dominated, pf)

    def _devices_lack_hvac_action(self, room: dict) -> bool:
        """Return True if at least one active device lacks hvac_action.

        Used to distinguish 'missing attribute' from other reasons
        _observe_device_action returns None (conflicts, unavailable, etc.).
        """
        for eid in get_all_entity_ids(room.get("devices", [])):
            state = self.hass.states.get(eid)
            if state is None or state.state in ("unavailable", "unknown", "off"):
                continue
            if state.attributes.get("hvac_action") is None:
                return True
        return False

    def _infer_device_mode(self, room: dict) -> str:
        """Infer heating/cooling from hvac_mode when hvac_action is unavailable.

        Compares current_temperature to the device setpoint to avoid showing
        'Heating' when the thermostat is in heat mode but already at target.
        Used for display and as a fallback for EKF training when hvac_action
        is missing (Managed Mode and learn-only mode).  See #69.
        """
        for eid in get_all_entity_ids(room.get("devices", [])):
            state = self.hass.states.get(eid)
            if state is None or state.state in ("unavailable", "unknown", "off"):
                continue
            current = state.attributes.get("current_temperature")
            setpoint = state.attributes.get("temperature")
            if state.state == "heat":
                if current is not None and setpoint is not None and current >= setpoint:
                    continue  # at or above setpoint — not actively heating
                return MODE_HEATING
            if state.state == "cool":
                if current is not None and setpoint is not None and current <= setpoint:
                    continue  # at or below setpoint — not actively cooling
                return MODE_COOLING
        return MODE_IDLE

    def _is_window_open(self, room: dict) -> bool:
        """Return True if any configured window/door sensor reports 'on' (open)."""
        for entity_id in room.get("window_sensors", []):
            state = self.hass.states.get(entity_id)
            if state and state.state == "on":
                return True
        return False

    def _get_active_schedule_index(self, room: dict) -> int:
        """Return the index of the active schedule in room['schedules'].

        Returns -1 if there are no schedules.
        """

        return resolve_schedule_index(self.hass, room)

    def _schedule_expired_target_state_cleanup(self, area_id: str, plan: ControlTargetPlan) -> None:
        """Apply storage cleanup intents emitted by target resolution."""
        if plan.clear_expired_override:
            store = self.hass.data[DOMAIN]["store"]
            self.hass.async_create_task(
                store.async_update_room(
                    area_id,
                    {
                        "override_temp": None,
                        "override_until": None,
                        "override_type": None,
                    },
                )
            )

        if plan.clear_expired_vacation:
            self.hass.async_create_task(
                self.hass.data[DOMAIN]["store"].async_save_settings(
                    {
                        "vacation_until": None,
                    }
                )
            )

    async def async_room_added(self, room: dict) -> None:
        """Create entity platform entities for a newly added/updated room and refresh data."""
        area_id = room["area_id"]
        has_covers = bool(room.get("covers"))

        self._add_entity_platform_room(EntityPlatform.SENSOR, area_id)
        self._add_entity_platform_room(EntityPlatform.CLIMATE, area_id)
        self._add_entity_platform_room(EntityPlatform.CLIMATE_CONTROL_SWITCH, area_id)

        # Cover entities: only create when covers are configured.
        # Not removed on save — cleanup_orphaned_entities() handles that at startup
        # so brief config changes don't break user automations.
        if has_covers:
            self._add_entity_platform_room(EntityPlatform.COVER_SWITCH, area_id)
            self._add_entity_platform_room(EntityPlatform.COVER_BINARY_SENSOR, area_id)

        await self.async_request_refresh()

    async def async_room_removed(self, area_id: str) -> None:
        """Remove sensor entities for a deleted room and refresh data."""
        from homeassistant.helpers import entity_registry as er

        registry = er.async_get(self.hass)

        # Find and remove all entities whose unique_id belongs to this area
        entries_to_remove = [
            entity_entry.entity_id
            for entity_entry in registry.entities.values()
            if entity_entry.unique_id and entity_entry.unique_id.startswith(f"{DOMAIN}_{area_id}_")
        ]

        for entity_id in entries_to_remove:
            registry.async_remove(entity_id)

        # Clean up in-memory state
        self._window_manager.remove_room(area_id)
        self._previous_modes.pop(area_id, None)
        self._last_valid_temps.pop(area_id, None)
        self._ekf_training.remove_room(area_id)
        self._pending_predictions.pop(area_id, None)
        self._residual_tracker.remove_room(area_id)
        self._cover_orchestrator.remove_room(area_id)
        self._mode_on_since.pop(area_id, None)
        for registration in self._entity_platforms.values():
            registration.area_ids.discard(area_id)
        self._model_manager.remove_room(area_id)
        self._heat_source_states.pop(area_id, None)
        if self._history_store:
            await self.hass.async_add_executor_job(self._history_store.remove_room, area_id)

        await self.async_request_refresh()

    def cleanup_orphaned_entities(self) -> None:
        """Remove entities that no longer match any registered entity type.

        Called at startup to clean up entities from removed features.
        """
        from homeassistant.helpers import entity_registry as er

        store = self.hass.data[DOMAIN]["store"]
        rooms = store.get_rooms()
        registry = er.async_get(self.hass)

        # Known valid suffixes for each condition
        always_valid = ("_target_temp", "_mode", "_override", "_climate_control")
        cover_only = ("_cover_auto", "_cover_paused")
        # Global entities (not per-room) that should never be cleaned up
        global_uids = {f"{DOMAIN}_vacation"}

        to_remove: list[str] = []
        for entity_entry in registry.entities.values():
            uid = entity_entry.unique_id
            if not isinstance(uid, str) or not uid.startswith(f"{DOMAIN}_"):
                continue
            if uid in global_uids:
                continue

            # Extract area_id: roommind_{area_id}_{suffix}
            parts = uid.removeprefix(f"{DOMAIN}_")
            # Find which room this belongs to
            matched_area = None
            for area_id in rooms:
                if parts.startswith(f"{area_id}_"):
                    matched_area = area_id
                    break

            if matched_area is None:
                # Room no longer exists — orphaned entity
                to_remove.append(entity_entry.entity_id)
                continue

            suffix = parts.removeprefix(f"{matched_area}")
            room = rooms[matched_area]

            if suffix in always_valid:
                continue
            if suffix in cover_only and room.get("covers"):
                continue

            # Entity doesn't match any valid type — orphaned
            to_remove.append(entity_entry.entity_id)

        for eid in to_remove:
            _LOGGER.info("Removing orphaned entity: %s", eid)
            registry.async_remove(eid)

    # ------------------------------------------------------------------
    # Public thermal API
    # ------------------------------------------------------------------

    def reset_thermal_room(self, area_id: str) -> None:
        """Reset thermal model, EKF state, and residual tracking for one room."""
        self._model_manager.remove_room(area_id)
        self._ekf_training.last_temps.pop(area_id, None)
        self._residual_tracker.clear_room(area_id)

    def reset_thermal_all(self) -> list[str]:
        """Reset all thermal models. Returns list of affected room IDs."""
        room_ids = self._model_manager.get_room_ids()
        self._model_manager = RoomModelManager()
        self._ekf_training.set_model_manager(self._model_manager)
        self._cover_orchestrator.set_model_manager(self._model_manager)
        self._ekf_training.last_temps.clear()
        self._residual_tracker.clear_all()
        return room_ids

    def boost_learning(self, area_id: str) -> int:
        """Boost EKF covariance for a room. Returns n_observations."""
        return self._model_manager.boost_learning(area_id)

    @property
    def history_store(self) -> HistoryStore | None:
        """Access to history store for cleanup operations."""
        return self._history_store

    async def async_prepare_control_target_plan(
        self,
        room: dict[str, Any],
        settings: dict[str, Any],
        *,
        mold_prevention_active: bool = False,
        mold_prevention_delta: float = 0.0,
    ) -> ControlTargetPlan:
        """Prepare targets while keeping the schedule cache coordinator-owned."""
        return await prepare_control_target_plan(
            self.hass,
            room,
            settings,
            schedule_blocks_cache=self._schedule_blocks_cache,
            mold_prevention_active=mold_prevention_active,
            mold_prevention_delta=mold_prevention_delta,
        )

    def analytics_runtime_snapshot(
        self,
        area_id: str,
        room_config: dict[str, Any],
        settings: dict[str, Any] | None = None,
    ) -> AnalyticsRuntimeSnapshot:
        """Return immutable-owner analytics inputs without exposing managers."""
        model_info = self._model_manager.analytics_snapshot(area_id) or {}
        acs_can_heat: bool | None = None
        mpc_active = False
        if model_info and room_config.get("temperature_sensor") and mpc_control_enabled(settings or {}):
            acs_can_heat = check_acs_can_heat(self.hass, room_config)
            can_heat, can_cool = get_can_heat_cool(
                room_config,
                self.outdoor_temp_effective,
                acs_can_heat=acs_can_heat,
            )
            outdoor_temp = (
                self.outdoor_temp_effective
                if self.outdoor_temp_effective is not None
                else DEFAULT_OUTDOOR_TEMP_FALLBACK
            )
            mpc_active = is_mpc_active(
                self._model_manager,
                area_id,
                can_heat,
                can_cool,
                20.0,
                outdoor_temp,
            )
        if model_info:
            model_info["mpc_active"] = mpc_active
            model_info["has_occupancy_sensors"] = bool(room_config.get("occupancy_sensors"))

        system_type = room_config.get("heating_system_type", "")
        return AnalyticsRuntimeSnapshot(
            live=dict(self.rooms.get(area_id, {})),
            model_info=model_info,
            simulation_context=self._model_manager.simulation_context(area_id),
            mpc_active=mpc_active,
            acs_can_heat=acs_can_heat,
            outdoor_temp=self.outdoor_temp_effective,
            weather_forecast=[dict(point) for point in self._weather_manager.forecast],
            residual=self._residual_tracker.simulation_snapshot(area_id, system_type),
            window_open=self._window_manager.is_paused(area_id),
        )

    def diagnostics_runtime_snapshot(
        self,
        room_configs: dict[str, dict[str, Any]],
    ) -> CoordinatorDiagnosticsRuntimeSnapshot:
        """Capture all runtime diagnostics before asynchronous report work."""
        wall_now = time.time()
        monotonic_now = time.monotonic()
        rooms: dict[str, RoomDiagnosticsRuntimeSnapshot] = {}

        for area_id, config in room_configs.items():
            previous_mode = self._previous_modes.get(area_id, MODE_IDLE)
            mode_on_since = self._mode_on_since.get(area_id)
            cached = self._last_valid_temps.get(area_id)
            rooms[area_id] = RoomDiagnosticsRuntimeSnapshot(
                live=dict(self.rooms.get(area_id, {})),
                previous_mode=previous_mode,
                mode_active_for_s=round(wall_now - mode_on_since) if mode_on_since is not None else None,
                cached_temp=cached[0] if cached is not None else None,
                cached_temp_age_s=round(monotonic_now - cached[1]) if cached is not None else None,
                q_residual=round(
                    self._residual_tracker.get_q_residual(
                        area_id,
                        config.get("heating_system_type", ""),
                        previous_mode,
                        now=wall_now,
                    ),
                    4,
                ),
                model=self._model_manager.diagnostics_snapshot(area_id),
                window=self._window_manager.diagnostics_snapshot(area_id, now=wall_now),
                cover=self._cover_manager.diagnostics_snapshot(area_id, now=wall_now),
                heat_source_routing=self._heat_source_states.get(area_id),
            )

        forecast = self._weather_manager.forecast
        return CoordinatorDiagnosticsRuntimeSnapshot(
            rooms=rooms,
            outdoor_temp=self.outdoor_temp,
            outdoor_humidity=self.outdoor_humidity,
            forecast_available=bool(forecast),
            forecast_points=len(forecast),
            compressor_groups=self._compressor_manager.diagnostics_snapshot(now=monotonic_now),
            valve_protection=self._valve_manager.diagnostics_snapshot(now=wall_now),
        )

    # ------------------------------------------------------------------
    # Master device control
    # ------------------------------------------------------------------

    def _collect_member_room_modes(
        self,
        members: list[str],
        room_states: dict[str, dict],
        rooms_config: dict[str, dict],
        settings: dict,
    ) -> list[str]:
        """Collect room modes for rooms containing group member devices.

        When heat-source orchestration is active for a room, the room is
        only counted if the orchestration decision includes this group's
        device types.  Prevents a boiler master from activating when only
        the AC (secondary) is heating, and vice versa. (#168)
        """
        if not settings.get("climate_control_active", True):
            return []
        member_set = set(members)
        modes: list[str] = []
        for area_id, room in rooms_config.items():
            if not room.get("climate_control_enabled", True):
                continue
            if room.get("is_outdoor", False):
                continue
            device_eids = {d.get("entity_id", "") for d in room.get("devices", [])}
            if not (device_eids & member_set):
                continue
            rs = room_states.get(area_id)
            if not rs:
                continue
            commanded = rs.get("commanded_mode", rs.get("mode", MODE_IDLE))

            # Orchestration filter (heating only): skip this room when its
            # active heat sources don't include this group's device types.
            if (
                commanded == MODE_HEATING
                and room.get("heat_source_orchestration", False)
                and not room_contributes_to_group(
                    room.get("devices", []),
                    member_set,
                    rs.get("active_heat_sources"),
                )
            ):
                continue

            modes.append(commanded)
        return modes

    def _resolve_master_hvac_mode(self, master_entity: str, action: str) -> str | None:
        """Map action to supported hvac_mode for master entity. Returns None if unsupported."""
        state = self.hass.states.get(master_entity)
        if state is None or state.state in ("unavailable", "unknown"):
            return None
        supported = state.attributes.get("hvac_modes", [])
        if action == "idle":
            if "off" in supported:
                return "off"
            _LOGGER.warning(
                "Master '%s': 'off' not supported, cannot turn idle (available: %s)",
                master_entity,
                supported,
            )
            return None
        if action in supported:
            return action
        if "heat_cool" in supported:
            return "heat_cool"
        if "auto" in supported:
            return "auto"
        _LOGGER.warning(
            "Master '%s': mode '%s' not supported (available: %s)",
            master_entity,
            action,
            supported,
        )
        return None

    async def _async_wake_member_zone(
        self,
        group: CompressorGroupConfig,
        room_states: dict[str, dict],
        rooms_config: dict[str, dict],
    ) -> None:
        """Pre-activate a member zone for ducted multi-zone systems.

        Ducted systems (e.g. AirTouch) require at least one active zone
        before the outdoor unit can start.  When all zones are off, set
        one to fan_only (always available) to enable outdoor unit startup.
        """
        for eid in group.members:
            state = self.hass.states.get(eid)
            if state is not None and state.state not in ("off", "unavailable", "unknown"):
                return

        member_set = set(group.members)
        wake_eid: str | None = None

        for area_id, room in rooms_config.items():
            if not room.get("climate_control_enabled", True):
                continue
            if room.get("is_outdoor", False):
                continue
            rs = room_states.get(area_id)
            if not rs:
                continue
            commanded = rs.get("commanded_mode", rs.get("mode", MODE_IDLE))
            if commanded == MODE_IDLE:
                continue
            for dev in room.get("devices", []):
                eid = dev.get("entity_id", "")
                if eid not in member_set:
                    continue
                zone_state = self.hass.states.get(eid)
                if zone_state and "fan_only" in (zone_state.attributes.get("hvac_modes") or []):
                    wake_eid = eid
                    break
            if wake_eid:
                break

        if not wake_eid:
            for eid in group.members:
                zone_state = self.hass.states.get(eid)
                if zone_state and "fan_only" in (zone_state.attributes.get("hvac_modes") or []):
                    wake_eid = eid
                    break

        if not wake_eid:
            _LOGGER.debug(
                "Group '%s': no zone supports fan_only for pre-activation",
                group.name,
            )
            return

        try:
            await self.hass.services.async_call(
                "climate",
                "set_hvac_mode",
                {"entity_id": wake_eid, "hvac_mode": "fan_only"},
                blocking=True,
                context=make_roommind_context(),
            )
            self._compressor_manager.update_member(wake_eid, True)
            _LOGGER.debug(
                "Master '%s' (group '%s'): pre-activated zone '%s' (fan_only)",
                group.master_entity,
                group.name,
                wake_eid,
            )
        except Exception:  # noqa: BLE001
            _LOGGER.warning(
                "Master '%s' (group '%s'): failed to pre-activate zone '%s'",
                group.master_entity,
                group.name,
                wake_eid,
                exc_info=True,
            )

    async def _async_control_master_devices(
        self,
        room_states: dict[str, dict],
        rooms_config: dict[str, dict],
        settings: dict,
    ) -> None:
        """Control master devices based on aggregate demand from member rooms.

        Groups with master_entity get climate commands + optional script.
        Groups with only action_script (no master_entity) get script-only mode.
        """
        if not settings.get("climate_control_active", True):
            return
        for gid, group in self._compressor_manager.get_groups().items():
            if not group.master_entity and not group.action_script and not group.enforce_uniform_mode:
                continue
            try:
                has_master = bool(group.master_entity)

                # 1. Check master entity availability (only when configured)
                master_state = None
                if has_master:
                    master_state = self.hass.states.get(group.master_entity)
                    if master_state is None or master_state.state in (
                        "unavailable",
                        "unknown",
                    ):
                        _LOGGER.warning(
                            "Master '%s' (group '%s'): entity unavailable, skipping",
                            group.master_entity,
                            group.name,
                        )
                        continue

                # 2. Collect member room modes
                modes = self._collect_member_room_modes(
                    group.members,
                    room_states,
                    rooms_config,
                    settings,
                )

                # 3. Resolve desired action
                new_action = resolve_master_action(
                    modes,
                    group.conflict_resolution,
                    self.outdoor_temp_effective,
                    settings.get("outdoor_heating_max", DEFAULT_OUTDOOR_HEATING_MAX),
                )

                # 4. Get previous state for transition detection
                state = self._compressor_manager.get_state(gid)
                prev_action = state.master_action if state else None

                # 5. Control master climate entity (when configured)
                if has_master:
                    # Min-run/min-off guard: prevent master short-cycling
                    if not self._compressor_manager.check_master_can_switch(gid, new_action):
                        continue

                    resolved_mode = self._resolve_master_hvac_mode(group.master_entity, new_action)

                    # Skip when mode is unsupported
                    if resolved_mode is None:
                        if new_action != "idle":
                            _LOGGER.warning(
                                "Master '%s' (group '%s'): cannot resolve mode for action '%s', skipping",
                                group.master_entity,
                                group.name,
                                new_action,
                            )
                        continue

                    # Redundancy check — compare resolved mode with actual entity state
                    if master_state is not None and master_state.state == resolved_mode:
                        self._compressor_manager.set_master_action(gid, new_action)
                        # Still call script if action changed
                        if new_action != prev_action and group.action_script:
                            await self._call_action_script(group, state, new_action)
                        continue

                    # Pre-activate a zone for ducted multi-zone systems where
                    # the outdoor unit requires at least one active zone (#135).
                    if new_action != "idle" and (prev_action is None or prev_action == "idle"):
                        await self._async_wake_member_zone(group, room_states, rooms_config)

                    # Send climate command
                    try:
                        await self.hass.services.async_call(
                            "climate",
                            "set_hvac_mode",
                            {
                                "entity_id": group.master_entity,
                                "hvac_mode": resolved_mode,
                            },
                            blocking=True,
                            context=make_roommind_context(),
                        )
                    except Exception:  # noqa: BLE001
                        _LOGGER.warning(
                            "Master '%s' (group '%s'): failed to set hvac_mode '%s'",
                            group.master_entity,
                            group.name,
                            resolved_mode,
                            exc_info=True,
                        )
                        continue  # don't update state on failed command

                # 6. Call action script on transition
                if new_action != prev_action and group.action_script:
                    await self._call_action_script(group, state, new_action)

                # 7. Update state + log transition
                if new_action != prev_action:
                    label = group.master_entity or group.action_script or f"group:{group.id}"
                    _LOGGER.info(
                        "Master '%s' (group '%s'): %s -> %s",
                        label,
                        group.name,
                        prev_action,
                        new_action,
                    )
                self._compressor_manager.set_master_action(gid, new_action)

            except Exception:  # noqa: BLE001
                _LOGGER.warning(
                    "Master device control failed for group '%s'",
                    group.name,
                    exc_info=True,
                )

    async def _call_action_script(
        self,
        group: CompressorGroupConfig,
        state: CompressorGroupState | None,
        new_action: str,
    ) -> None:
        """Call the group's action script with transition variables."""
        script_state = self.hass.states.get(group.action_script)
        if script_state is None:
            _LOGGER.warning(
                "Master group '%s': action script '%s' not found",
                group.name,
                group.action_script,
            )
            return
        try:
            await self.hass.services.async_call(
                "script",
                "turn_on",
                {
                    "entity_id": group.action_script,
                    "variables": {
                        "action": new_action,
                        "master_entity": group.master_entity,
                        "members": group.members,
                        "active_members": [eid for eid in group.members if state and eid in state.active_members],
                    },
                },
                blocking=False,
                context=make_roommind_context(),
            )
        except Exception:  # noqa: BLE001
            _LOGGER.warning(
                "Master group '%s': action script '%s' failed",
                group.name,
                group.action_script,
                exc_info=True,
            )
