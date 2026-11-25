"""DataUpdateCoordinator for RoomMind."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from homeassistant.components.persistent_notification import async_create as async_create_notification
from homeassistant.components.persistent_notification import async_dismiss as async_dismiss_notification
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import (
    CLIMATE_MODE_COOL_ONLY,
    CLIMATE_MODE_DRY,
    CLIMATE_MODE_FAN_ONLY,
    CLIMATE_MODE_HEAT_ONLY,
    CLIMATE_MODE_OFF,
    DEFAULT_CO2_THRESHOLD,
    DEFAULT_PM25_CLEAR_THRESHOLD,
    DEFAULT_PM25_THRESHOLD,
    DOMAIN,
    EVENT_ROOMMIND_ALERT,
    HISTORY_ROTATE_CYCLES,
    HISTORY_WRITE_CYCLES,
    MAX_PREDICTION_DELTA,
    MAX_SENSOR_STALENESS,
    MODE_COOLING,
    MODE_HEATING,
    MODE_IDLE,
    OBSERVATION_INTERVAL_RETENTION_DAYS,
    OBSERVED_SUMMARY_RETENTION_DAYS,
    OUTDOOR_UNAVAILABLE_NOTIFICATION_ID,
    OUTDOOR_UNAVAILABLE_NOTIFY_CYCLES,
    OVERRIDE_CUSTOM,
    RAW_OBSERVATION_PRUNE_CYCLES,
    RAW_OBSERVATION_RETENTION_DAYS,
    THERMAL_EPISODE_RETENTION_DAYS,
    THERMAL_SAVE_CYCLES,
    UPDATE_INTERVAL,
    TargetTemps,
    build_override_live,
    is_override_active,
    is_override_suppressed,
)
from .control.ac_overdrive import ACOverdriveManager
from .control.actuation import ActuationLedger
from .control.constraints import ConstraintInput, ConstraintReducer
from .control.hvac_observation import HVACOutputObservation, SoftThermalLoadEstimate, observed_room_activity
from .control.inverter_regime import InverterRegimeDecision, InverterRegimeManager
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
from .managers.ac_coil_dry_manager import AcCoilDryManager
from .managers.air_quality_manager import AirQualityTracker, VentilationController, read_pm25_value
from .managers.airflow_control_manager import AirflowControlManager, AirflowRuntimeContext
from .managers.compressor_group_manager import (
    CompressorCommandOutcome,
    CompressorGroupManager,
)
from .managers.cover_orchestrator import CoverOrchestrator, CoverResult
from .managers.device_setpoint_tracker import DeviceSetpointTracker
from .managers.ekf_training_manager import EkfTrainingManager
from .managers.environmental_factor_manager import (
    AIRFLOW_ROLE_VENTILATION,
    AirflowFactors,
    EnvironmentalFactorManager,
    airflow_sensor_conflict,
)
from .managers.heat_source_orchestrator import evaluate_heat_sources
from .managers.hvac_output_observer import HVACOutputObserver
from .managers.master_device_manager import MasterDeviceManager
from .managers.mold_manager import MoldManager
from .managers.night_mode_manager import NightModeManager
from .managers.observation_pipeline import (
    async_store_observation_summaries,
    async_store_observed_derivatives,
    build_raw_state_observation,
    reconcile_room_evidence,
)
from .managers.price_manager import PriceManager
from .managers.residual_heat_tracker import ResidualHeatSimulationState, ResidualHeatTracker
from .managers.room_coupling_manager import RoomCouplingManager
from .managers.sensor_fusion_manager import SensorFusionManager
from .managers.valve_manager import ValveManager
from .managers.weather_manager import WeatherManager, resolve_weather_entity
from .managers.window_manager import WindowManager
from .room_config import resolve_setback_offset
from .settings_config import mpc_control_enabled
from .store import RoomMindStore
from .utils.device_utils import (
    build_rooms_devices_map,
    get_ac_eids,
    get_all_entity_ids,
    get_trv_eids,
)
from .utils.entity_snapshot import EntitySnapshots, capture_entity_snapshots
from .utils.history_store import HistoryStore
from .utils.i18n import get_translation
from .utils.notification_payloads import build_outdoor_unavailable_payload
from .utils.observation_store import ObservationStore
from .utils.schedule_utils import (
    override_hold_until,
    resolve_schedule_index,
)
from .utils.sensor_utils import read_sensor_value, sensor_observation_age
from .utils.sleep_device import inspect_sleep_device_state
from .utils.target_resolution import ControlTargetPlan, prepare_control_target_plan
from .utils.temp_utils import celsius_delta_to_ha, ha_temp_to_celsius, ha_temp_unit_str

_LOGGER = logging.getLogger(__name__)


class EntityPlatform(StrEnum):
    """RoomMind entity groups tracked for dynamic room registration."""

    SENSOR = "sensor"
    CLIMATE = "climate"
    CLIMATE_MODE_SELECT = "climate_mode_select"
    CLIMATE_CONTROL_SWITCH = "climate_control_switch"
    COVER_SWITCH = "cover_switch"
    COVER_BINARY_SENSOR = "cover_binary_sensor"
    AIR_QUALITY_BINARY_SENSOR = "air_quality_binary_sensor"


_NO_AIR_QUALITY: dict[str, Any] = {
    "co2": None,
    "voc": None,
    "pm25": None,
    "air_quality_bad": False,
    "air_quality_reason": None,
    "ventilation_active": False,
}


def has_air_quality_sensor(room: dict) -> bool:
    """Return True if an indoor room monitors CO2, VOC, or PM2.5."""
    return (
        bool(room.get("co2_sensor") or room.get("voc_sensor") or room.get("pm25_sensor") or room.get("pm25_sensors"))
        and not room.get("is_outdoor", False)
    )


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
    acs_can_heat: bool


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
    temperature_observations: tuple[TemperatureObservation, ...]


@dataclass(frozen=True, slots=True)
class RoomControlObservation:
    """Primary room inputs frozen before any room actuation begins."""

    sensors: RoomSensorSnapshot
    climate_devices: ClimateDeviceSnapshot
    actuator_states: EntitySnapshots
    device_action: tuple[str | None, float]
    airflow: AirflowFactors
    hvac_output: HVACOutputObservation | None
    raw_window_open: bool
    q_occupancy: float
    shading_factor: float


_OBSERVED_STATE_ATTRS = frozenset(
    {
        "temperature",
        "target_temp_low",
        "target_temp_high",
        "current_temperature",
        "current_humidity",
        "hvac_action",
        "fan_mode",
        "swing_mode",
        "preset_mode",
        "hvac_mode_observed_at",
        "hvac_action_observed_at",
        "assumed_state",
        "observed_at",
    }
)
_OBS_SYNC_DEBOUNCE_SECONDS = 0.15


def _get_area_name(hass: HomeAssistant, area_id: str) -> str:
    """Get human-readable area name from area registry."""
    try:
        area_reg = ar.async_get(hass)
        area = area_reg.async_get_area(area_id)
        return area.name if area else area_id
    except Exception:  # noqa: BLE001
        return area_id


class RoomMindCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Central coordinator for RoomMind room data and state."""

    data: dict[str, Any]

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=UPDATE_INTERVAL),
        )
        self.entry = entry
        self._actuation_ledger = ActuationLedger()
        self._remove_tcl_command_listener = hass.bus.async_listen(
            "tcl_udp_ac_command_result",
            self._handle_tcl_command_result,
        )
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
        self._ac_overdrive = ACOverdriveManager()
        self._inverter_regime = InverterRegimeManager()
        self._prev_slope_sample: dict[str, tuple[float, float]] = {}
        self._coil_dry_manager = AcCoilDryManager(hass)
        self._air_quality = AirQualityTracker()
        self._ventilation = VentilationController(hass)
        self._price_manager = PriceManager(hass)
        self.device_setpoints: DeviceSetpointTracker = hass.data.setdefault(DOMAIN, {}).setdefault(
            "device_setpoints", DeviceSetpointTracker(time.monotonic)
        )
        self._tracked_entity_areas: dict[str, set[str]] = {}
        self._remove_state_listeners: Callable[[], None] | None = None
        self._pending_obs_areas: set[str] = set()
        self._obs_sync_handle: asyncio.TimerHandle | None = None
        self._last_room_pf_mix: dict[str, tuple[float, float]] = {}
        self._observation_store: ObservationStore | None = None
        self._raw_observation_buffer: list[dict] = []
        self._raw_observation_prune_count: int = 0
        self._environmental_factors = EnvironmentalFactorManager(hass)
        self._airflow_control = AirflowControlManager(hass)
        self._hvac_output_observer = HVACOutputObserver(hass)
        self._night_mode_manager = NightModeManager(hass, actuation_ledger=self._actuation_ledger)
        self._room_coupling = RoomCouplingManager()
        self._room_coupling_last_temps: dict[str, tuple[float, float]] = {}
        # Cover/blind automatic control
        from .managers.cover_manager import CoverManager

        self._cover_manager = CoverManager()
        self._cover_orchestrator = CoverOrchestrator(hass, self._cover_manager, self._model_manager)
        # Compressor group management (min-run / min-off protection)
        self._compressor_manager = CompressorGroupManager()
        self._master_device_manager = MasterDeviceManager(hass, self._compressor_manager)
        # Heat source orchestration state (per room)
        self._heat_source_states: dict[str, str] = {}
        self._entity_platforms = {platform: _EntityPlatformRegistration() for platform in EntityPlatform}
        # Min-run enforcement: timestamp when current non-idle mode started
        self._mode_on_since: dict[str, float] = {}
        # Sensor dropout fallback: last valid temperature per room
        self._last_valid_temps: dict[str, tuple[float, float]] = {}  # {area_id: (celsius, monotonic_ts)}
        # Per-entity cache of schedule blocks; fallback when schedule.get_schedule fails (#308)
        self._schedule_blocks_cache: dict[str, dict] = {}
        # Tonight sleep phase overrides: {area_id: (action, expires_ts)}
        self._tonight_sleep_overrides: dict[str, tuple[str, float]] = {}

    def set_tonight_sleep_override(self, area_id: str, action: str, ttl_seconds: float = 12 * 3600) -> None:
        """Set a temporary sleep phase override for one room until wake/expiry."""
        self._tonight_sleep_overrides[area_id] = (action, time.time() + ttl_seconds)

    def get_tonight_sleep_override(self, area_id: str) -> str | None:
        """Return active tonight sleep override action if unexpired."""
        entry = self._tonight_sleep_overrides.get(area_id)
        if entry is None:
            return None
        action, expires_at = entry
        if time.time() >= expires_at:
            self._tonight_sleep_overrides.pop(area_id, None)
            return None
        return action

    def clear_tonight_sleep_override(self, area_id: str) -> None:
        """Clear any temporary sleep phase override for one room."""
        self._tonight_sleep_overrides.pop(area_id, None)

    @callback
    def _handle_tcl_command_result(self, event: Any) -> None:
        """Reconcile TCL device evidence without coupling to its implementation."""
        data = getattr(event, "data", None)
        if isinstance(data, dict):
            evidence = self._actuation_ledger.record_tcl_event(data)
            if evidence is None or not self.data:
                return
            entity_id = data.get("entity_id")
            if isinstance(entity_id, str) and entity_id in self._tracked_entity_areas:
                self._reconcile_observed_room_states(set(self._tracked_entity_areas[entity_id]))
            previous = self.data.get("rooms", {})
            rooms = {area_id: self._reconcile_room_evidence(room) for area_id, room in previous.items()}
            if any(rooms[area_id] is not room for area_id, room in previous.items()):
                self.rooms = rooms
                self.data = {**self.data, "rooms": rooms}
                # Publish evidence without restarting the scheduled Control Cycle.
                self.async_update_listeners()

    @staticmethod
    def _room_tracked_entities(room: dict[str, Any]) -> set[str]:
        """Collect all entity IDs whose state changes should sync room observations."""
        tracked: set[str] = set()
        for dev in room.get("devices", []) or []:
            if isinstance(dev, dict) and dev.get("entity_id"):
                tracked.add(str(dev["entity_id"]))
        for dev in room.get("airflow_devices", []) or []:
            if isinstance(dev, dict):
                if dev.get("entity_id"):
                    tracked.add(str(dev["entity_id"]))
                if dev.get("power_sensor_entity"):
                    tracked.add(str(dev["power_sensor_entity"]))
        for nc in room.get("night_controls", []) or []:
            if isinstance(nc, dict) and nc.get("entity_id"):
                tracked.add(str(nc["entity_id"]))
        for key in ("temperature_sensor", "humidity_sensor"):
            if room.get(key):
                tracked.add(str(room[key]))
        for key in ("temperature_sensors", "humidity_sensors", "window_sensors"):
            for eid in room.get(key, []) or []:
                if isinstance(eid, str) and eid:
                    tracked.add(eid)
        sleep_dev = room.get("sleep_device")
        if isinstance(sleep_dev, dict):
            for key, val in sleep_dev.items():
                if key.endswith("_entity") and isinstance(val, str) and val:
                    tracked.add(val)
        return tracked

    def _sync_entity_state_listeners(self, rooms: dict[str, dict[str, Any]]) -> None:
        """Keep HA state-change subscriptions aligned with configured room entities."""
        entity_map: dict[str, set[str]] = {}
        for area_id, room in rooms.items():
            for eid in self._room_tracked_entities(room):
                entity_map.setdefault(eid, set()).add(area_id)

        if set(entity_map) == set(self._tracked_entity_areas):
            self._tracked_entity_areas = entity_map
            return

        if self._remove_state_listeners is not None:
            with contextlib.suppress(Exception):
                self._remove_state_listeners()
            self._remove_state_listeners = None

        self._tracked_entity_areas = entity_map
        if not entity_map:
            return
        bus = getattr(self.hass, "bus", None)
        if bus is None or not callable(getattr(bus, "async_listen", None)):
            return
        try:
            self._remove_state_listeners = async_track_state_change_event(
                self.hass,
                sorted(entity_map),
                self._handle_tracked_entity_state_change,
            )
        except Exception:  # noqa: BLE001
            _LOGGER.debug("Failed to attach state-change listener for tracked entities", exc_info=True)

    @callback
    def _handle_tracked_entity_state_change(self, event: Any) -> None:
        """Schedule a debounced observation-only sync when a managed entity changes."""
        data = getattr(event, "data", None)
        if not isinstance(data, dict):
            return
        entity_id = data.get("entity_id")
        if not isinstance(entity_id, str) or entity_id not in self._tracked_entity_areas:
            return
        old_state = data.get("old_state")
        new_state = data.get("new_state")
        if old_state is not None and new_state is not None and old_state.state == new_state.state:
            old_attrs = getattr(old_state, "attributes", {}) or {}
            new_attrs = getattr(new_state, "attributes", {}) or {}
            if not any(old_attrs.get(k) != new_attrs.get(k) for k in _OBSERVED_STATE_ATTRS):
                return

        self._pending_obs_areas.update(self._tracked_entity_areas.get(entity_id, ()))
        if self._obs_sync_handle is not None:
            return
        loop = getattr(self.hass, "loop", None)
        call_later = getattr(loop, "call_later", None)
        if not callable(call_later):
            try:
                loop = asyncio.get_running_loop()
                call_later = loop.call_later
            except RuntimeError:
                self._flush_pending_observation_sync()
                return
        self._obs_sync_handle = call_later(_OBS_SYNC_DEBOUNCE_SECONDS, self._flush_pending_observation_sync)

    @callback
    def _flush_pending_observation_sync(self) -> None:
        self._obs_sync_handle = None
        areas = set(self._pending_obs_areas)
        self._pending_obs_areas.clear()
        if areas:
            self._reconcile_observed_room_states(areas)

    def _reconcile_observed_room_states(self, area_ids: set[str]) -> bool:
        """Update live observed room state without advancing EKF/MPC control cycles."""
        if not area_ids or not self.data:
            return False
        store = self.hass.data.get(DOMAIN, {}).get("store")
        if store is None:
            return False
        rooms_cfg = store.get_rooms()
        previous = self.data.get("rooms", {})
        if not previous:
            return False

        updated_rooms = dict(previous)
        changed = False
        for area_id in area_ids:
            prev_live = previous.get(area_id)
            room = rooms_cfg.get(area_id)
            if not isinstance(prev_live, dict) or not isinstance(room, dict):
                continue

            sensors = self._read_room_sensors(room, area_id, record_raw=False)
            climate_devices = self._read_climate_device_snapshot(room)
            actuator_states = capture_entity_snapshots(
                self.hass,
                (
                    *climate_devices.all_entity_ids,
                    *(config["entity_id"] for config in room.get("night_controls", []) or [] if config.get("entity_id")),
                ),
            )
            device_action = self._observe_device_action(room)
            airflow = self._environmental_factors.read_room_airflow(room)
            obs_stub = RoomControlObservation(
                sensors=sensors,
                climate_devices=climate_devices,
                actuator_states=actuator_states,
                device_action=device_action,
                airflow=airflow,
                hvac_output=self._observe_hvac_output(room, airflow),
                raw_window_open=self._is_window_open(room),
                q_occupancy=prev_live.get("q_occupancy", 0.0),
                shading_factor=prev_live.get("shading_factor", 1.0),
            )

            next_live = dict(prev_live)
            observed_mode = device_action[0]
            next_live["observed_mode"] = observed_mode
            next_live["observation_status"] = "observed" if observed_mode is not None else "unknown"
            next_live["mode"] = observed_mode or MODE_IDLE
            next_live["device_observations"] = self._device_observation_status(obs_stub)
            next_live["hvac_output_status"] = (
                obs_stub.hvac_output.as_status_dict() if obs_stub.hvac_output is not None else None
            )
            next_live["airflow_devices_status"] = airflow.as_status_dicts()
            next_live["sleep_device_status"] = inspect_sleep_device_state(self.hass, room.get("sleep_device"))

            if sensors.current_temp is not None:
                next_live["current_temp"] = sensors.current_temp
                next_live["current_temp_raw"] = sensors.current_temp_raw
            if sensors.humidity.value is not None or sensors.humidity.sources:
                next_live["current_humidity"] = sensors.humidity.value
                next_live.update(sensors.humidity.as_live_status())

            temp_obs = sensors.temperature_observations
            last_pf, last_mix = self._last_room_pf_mix.get(area_id, (device_action[1], airflow.q_fan_mix))
            next_live["sensor_conflict"] = airflow_sensor_conflict(temp_obs)
            next_live["sensor_fusion_status"] = self._sensor_fusion.diagnostics(
                temp_obs, power_fraction=last_pf, q_fan_mix=last_mix
            )
            if next_live.get("current_temp") is not None:
                next_live["perceived_temp"] = perceived_temperature(
                    air_temp_c=next_live["current_temp"],
                    humidity=next_live.get("current_humidity"),
                    q_mix=airflow.q_fan_mix,
                    mode=next_live.get("commanded_mode", MODE_IDLE),
                )
            next_live = self._reconcile_room_evidence(next_live)
            if next_live != prev_live:
                updated_rooms[area_id] = next_live
                changed = True

        if changed:
            self.rooms = updated_rooms
            self.data = {**self.data, "rooms": updated_rooms}
            self.async_update_listeners()
        return changed

    def _reconcile_room_evidence(self, room: dict[str, Any]) -> dict[str, Any]:
        """Replace evidence fields while retaining the cycle's physical observations."""
        return reconcile_room_evidence(room, self._actuation_ledger)

    async def async_shutdown(self) -> None:
        """Release event subscriptions owned by the coordinator."""
        if self._obs_sync_handle is not None:
            self._obs_sync_handle.cancel()
            self._obs_sync_handle = None
        if self._remove_state_listeners is not None:
            with contextlib.suppress(Exception):
                self._remove_state_listeners()
            self._remove_state_listeners = None
        self._remove_tcl_command_listener()
        await super().async_shutdown()
        if self._observation_store is not None:
            await self.hass.async_add_executor_job(self._observation_store.close)

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
        self._sync_entity_state_listeners(rooms)

        settings = store.get_settings()
        self._read_outdoor_environment(settings)
        self._compressor_manager.load_groups(settings.get("compressor_groups", []))
        self._ensure_runtime_state(store, settings)
        self._begin_observation_cycle(settings)

        outdoor_forecast = await self._async_update_weather_environment(settings)
        await self._price_manager.async_update(settings)
        observations: dict[str, RoomControlObservation] = {}
        for area_id, room in rooms.items():
            try:
                observations[area_id] = self._read_control_observation(room, area_id)
            except Exception:  # noqa: BLE001
                _LOGGER.exception("Room '%s': observation failed, skipping", area_id)

        room_states: dict[str, dict] = {}
        for area_id, room in rooms.items():
            observation = observations.get(area_id)
            if observation is None:
                continue
            try:
                room_state = await self._async_process_room(
                    room,
                    settings,
                    outdoor_forecast,
                    observation=observation,
                )
                room_states[area_id] = room_state
            except Exception:  # noqa: BLE001
                _LOGGER.exception("Room '%s': processing failed, skipping", area_id)

        self._update_room_couplings(rooms, room_states)
        await self._async_control_master_devices(room_states, rooms, settings)
        await self._async_reconcile_ventilation(rooms, room_states, settings, store)

        if self._observation_store and self._raw_observation_buffer:
            try:
                await self.hass.async_add_executor_job(
                    self._observation_store.record_many,
                    list(self._raw_observation_buffer),
                )
            except Exception:  # noqa: BLE001
                _LOGGER.warning("Raw observation record failed")

        await self._async_record_history(
            rooms,
            room_states,
            set(settings.get("learning_disabled_rooms", [])),
        )

        thermal_state_saved = await self._async_save_thermal_state(store)
        await self._async_rotate_and_prune_observations(rooms)
        await self._async_maintain_valves(
            store,
            rooms,
            settings,
            persist_actuation=thermal_state_saved,
        )

        stored_rooms = store.get_rooms()
        device_map = build_rooms_devices_map(stored_rooms)
        self.device_setpoints.prune(set(device_map))
        self._coil_dry_manager.prune(set(device_map))
        if self._coil_dry_manager.state_dirty:
            await store.async_save_settings({"coil_dry_state": self._coil_dry_manager.get_state()})
            self._coil_dry_manager.state_dirty = False

        room_states = {area_id: self._reconcile_room_evidence(room) for area_id, room in room_states.items()}
        self.rooms = room_states
        return {"rooms": room_states}

    def _read_outdoor_environment(self, settings: dict) -> None:
        """Read configured outdoor sensors and resolve the effective temperature."""
        outdoor_sensor_id = settings.get("outdoor_temp_sensor")
        raw_outdoor = read_sensor_value(self.hass, outdoor_sensor_id, "global", "outdoor temperature")
        self.outdoor_temp = (
            ha_temp_to_celsius(self.hass, raw_outdoor, entity_id=outdoor_sensor_id) if raw_outdoor is not None else None
        )
        self.outdoor_humidity = read_sensor_value(
            self.hass,
            settings.get("outdoor_humidity_sensor"),
            "global",
            "outdoor humidity",
        )
        # Do not train the EKF with a degenerate fallback such as room temperature.
        self.outdoor_temp_effective, self.outdoor_temp_source = self._resolve_outdoor_temp(settings)
        self._update_outdoor_unavailable_notification(settings)

    def _ensure_runtime_state(self, store: RoomMindStore, settings: dict) -> None:
        """Restore learned state and initialize local persistence once."""
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
                    self._ac_overdrive = ACOverdriveManager.from_dict(thermal_data.get("ac_overdrive", {}))
            self._valve_manager.load_actuation_data(settings.get("valve_last_actuation", {}))
            self._coil_dry_manager.load_state(settings.get("coil_dry_state", {}))
            self._ventilation.load_state(settings.get("ventilation_state", {}))
            self._model_loaded = True

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

    def _begin_observation_cycle(self, settings: dict) -> None:
        """Reset the raw buffer and capture global sensor observations."""
        self._raw_observation_buffer = []
        outdoor_sensor_id = settings.get("outdoor_temp_sensor")
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

    async def _async_update_weather_environment(self, settings: dict) -> list[dict]:
        """Refresh forecast, cover cloud inputs, and current solar irradiance."""
        outdoor_forecast = await self._weather_manager.async_read_forecast(settings)
        self._cover_orchestrator.set_cloud_series(WeatherManager.extract_cloud_series(outdoor_forecast))

        cloud_coverage = None
        weather_entity = resolve_weather_entity(self.hass, settings)
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
        return outdoor_forecast

    async def _async_record_history(
        self,
        rooms: dict[str, dict],
        room_states: dict[str, dict],
        learning_disabled: set[str],
    ) -> None:
        """Record throttled room snapshots and prepare the next predictions."""
        self._history_write_count += 1
        if self._history_write_count < HISTORY_WRITE_CYCLES or not self._history_store:
            return

        self._history_write_count = 0
        for area_id, room_state in room_states.items():
            if area_id in learning_disabled:
                continue
            current_temp = room_state.get("current_temp")
            mode = room_state.get("observed_mode", room_state.get("mode", MODE_IDLE))
            # A pending prediction describes this snapshot, not the next one.
            predicted = self._pending_predictions.pop(area_id, None)
            try:
                await self.hass.async_add_executor_job(
                    self._history_store.record,
                    area_id,
                    {
                        "room_temp": room_state.get("current_temp_raw", current_temp),
                        "outdoor_temp": self.outdoor_temp_effective,
                        "target_temp": room_state.get("target_temp"),
                        "mode": mode,
                        "predicted_temp": predicted,
                        "window_open": room_state.get("window_open", False),
                        "heating_power": room_state.get("heating_power", 0),
                        "solar_irradiance": round(self._current_q_solar, 3),
                        "blind_position": room_state.get("blind_position"),
                        "cover_reason": room_state.get("cover_reason", ""),
                        "device_setpoint": room_state.get("device_setpoint"),
                        "occupancy": room_state.get("q_occupancy", 0.0) > 0,
                        "room_humidity": room_state.get("current_humidity"),
                        "outdoor_humidity": self.outdoor_humidity,
                        "perceived_temp": room_state.get("perceived_temp"),
                        "q_fan_mix": room_state.get("q_fan_mix", 0.0),
                        "q_vent": room_state.get("q_vent", 0.0),
                        "airflow_ach": room_state.get("airflow_ach", 0.0),
                        "airflow_plan_level": room_state.get("airflow_plan_level", 0.0),
                        "airflow_mix_plan_level": room_state.get("airflow_mix_plan_level", 0.0),
                        "airflow_vent_plan_level": room_state.get("airflow_vent_plan_level", 0.0),
                        "night_mode_active": room_state.get("night_mode", {}).get("active", False),
                        "rapid_recovery_active": room_state.get("rapid_recovery_active", False),
                        "hvac_stage": (room_state.get("hvac_output_status") or {}).get("stage"),
                        "sensor_conflict": room_state.get("sensor_conflict", 0.0),
                        "mold_surface_rh": room_state.get("mold_surface_rh"),
                        "mold_risk_level": room_state.get("mold_risk_level", ""),
                        "effective_control_target": room_state.get("effective_control_target"),
                        "heat_target": room_state.get("heat_target"),
                        "cool_target": room_state.get("cool_target"),
                        "override_active": room_state.get("override_active", False),
                        "override_type": room_state.get("override_type", ""),
                        "active_heat_sources": room_state.get("active_heat_sources", ""),
                        "temperature_source": room_state.get("temperature_source", ""),
                        "temperature_source_count": room_state.get("temperature_source_count", 0),
                        "temperature_primary_available": room_state.get("temperature_primary_available", False),
                        "humidity_sources": room_state.get("humidity_sources", ""),
                        "humidity_source_count": room_state.get("humidity_source_count", 0),
                        "humidity_primary_available": room_state.get("humidity_primary_available", False),
                    },
                )
            except Exception:  # noqa: BLE001
                _LOGGER.warning("History record failed for '%s'", area_id)
            self._update_pending_prediction(area_id, rooms.get(area_id, {}), room_state)

    def _update_pending_prediction(
        self,
        area_id: str,
        room: dict,
        room_state: dict,
    ) -> None:
        """Prepare the prediction to evaluate at the next history write."""
        current_temp = room_state.get("current_temp")
        if (
            current_temp is None
            or self.outdoor_temp_effective is None
            or room.get("is_outdoor", False)
            or room_state.get("observation_status") == "unknown"
        ):
            return
        try:
            if room_state.get("window_open", False):
                raw_prediction = self._model_manager.predict_window_open(
                    area_id,
                    current_temp,
                    self.outdoor_temp_effective,
                    3.0,
                )
            else:
                model = self._model_manager.get_model(area_id)
                power_fraction = room_state.get("heating_power", 100) / 100.0
                mode = room_state.get("mode", MODE_IDLE)
                q_hvac = (
                    power_fraction * model.Q_heat
                    if mode == MODE_HEATING
                    else (-power_fraction * model.Q_cool if mode == MODE_COOLING else 0.0)
                )
                raw_prediction = model.predict(
                    current_temp,
                    self.outdoor_temp_effective,
                    q_hvac,
                    3.0,
                    q_solar=self._current_q_solar * room_state.get("shading_factor", 1.0),
                    q_vent=room_state.get("q_vent", 0.0),
                    q_occupancy=room_state.get("q_occupancy", 0.0),
                    coupling_terms=room_state.get("coupling_status", []),
                )
            clamped = max(
                current_temp - MAX_PREDICTION_DELTA,
                min(current_temp + MAX_PREDICTION_DELTA, raw_prediction),
            )
            self._pending_predictions[area_id] = round(clamped, 2)
        except Exception:  # noqa: BLE001
            pass

    async def _async_save_thermal_state(self, store: RoomMindStore) -> bool:
        """Save learned thermal state when its cycle is due."""
        self._thermal_save_count += 1
        if self._thermal_save_count < THERMAL_SAVE_CYCLES:
            return False

        self._thermal_save_count = 0
        await store.async_save_thermal_data(
            {
                "models": self._model_manager.to_dict(),
                "sensor_biases": self._sensor_fusion.to_dict(),
                "ac_overdrive": self._ac_overdrive.to_dict(),
            }
        )
        return True

    async def _async_rotate_and_prune_observations(self, rooms: dict[str, dict]) -> None:
        """Run throttled history rotation and observation retention."""
        self._history_rotate_count += 1
        if self._history_rotate_count >= HISTORY_ROTATE_CYCLES and self._history_store:
            self._history_rotate_count = 0
            now_ts = time.time()
            for area_id in rooms:
                try:
                    await self.hass.async_add_executor_job(self._history_store.rotate, area_id)
                except Exception:  # noqa: BLE001
                    _LOGGER.warning("History rotation failed for '%s'", area_id)
                await async_store_observed_derivatives(
                    self.hass,
                    self._observation_store,
                    self._history_store,
                    area_id,
                    now_ts=now_ts,
                )
            await async_store_observation_summaries(
                self.hass,
                self._observation_store,
                "global",
                ("outdoor_temperature", "outdoor_humidity"),
                now_ts=now_ts,
            )

        self._raw_observation_prune_count += 1
        if self._raw_observation_prune_count < RAW_OBSERVATION_PRUNE_CYCLES or not self._observation_store:
            return
        self._raw_observation_prune_count = 0
        try:
            await self.hass.async_add_executor_job(self._observation_store.prune_raw)
            await self.hass.async_add_executor_job(self._observation_store.prune_derived)
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Raw observation pruning failed")

    async def _async_maintain_valves(
        self,
        store: RoomMindStore,
        rooms: dict[str, dict],
        settings: dict,
        *,
        persist_actuation: bool,
    ) -> None:
        """Finish protection cycles and persist actuation state when due."""
        await self._valve_manager.async_finish_cycles(build_rooms_devices_map(rooms))
        if self._valve_manager.should_run_cycle_check():
            await self._valve_manager.async_check_and_cycle(rooms, settings)
        if persist_actuation and self._valve_manager.actuation_dirty:
            await store.async_save_settings({"valve_last_actuation": self._valve_manager.get_actuation_data()})
            self._valve_manager.actuation_dirty = False

    def _read_room_sensors(
        self,
        room: dict,
        area_id: str,
        *,
        record_raw: bool = True,
    ) -> RoomSensorSnapshot:
        """Read a complete sensor snapshot for one room control cycle."""
        primary_sensor_id = room.get("temperature_sensor")
        temp_sensor_ids = self._temperature_sensor_ids(room)
        has_external_sensor = bool(temp_sensor_ids)
        observations: list[TemperatureObservation] = []
        now = datetime.now(UTC)

        for temp_sensor_id in temp_sensor_ids:
            raw_temp = read_sensor_value(self.hass, temp_sensor_id, area_id, "temperature", now=now)
            temp_c = ha_temp_to_celsius(self.hass, raw_temp, entity_id=temp_sensor_id) if raw_temp is not None else None
            state = self.hass.states.get(temp_sensor_id) if temp_sensor_id else None
            if record_raw:
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

        last_pf, last_mix = self._last_room_pf_mix.get(area_id, (0.0, 0.0))
        ekf_pred_temp: float | None = None
        ekf_pred_var: float | None = None
        if observations and self.outdoor_temp_effective is not None and self._model_manager.get_confidence(area_id) >= 0.3:
            model = self._model_manager.get_model(area_id)
            prev_mode = self._previous_modes.get(area_id, MODE_IDLE)
            q_act = (
                last_pf * model.Q_heat
                if prev_mode == MODE_HEATING
                else (-last_pf * model.Q_cool if prev_mode == MODE_COOLING else 0.0)
            )
            anchor_temp = observations[0].value
            ekf_pred_temp = model.predict(anchor_temp, self.outdoor_temp_effective, q_act, UPDATE_INTERVAL / 60.0)
            ekf_pred_var = (
                self._model_manager.get_prediction_std(
                    area_id, q_act, anchor_temp, self.outdoor_temp_effective, UPDATE_INTERVAL / 60.0
                )
                ** 2
            )

        fused = self._sensor_fusion.fuse_temperature(
            observations,
            power_fraction=last_pf,
            q_fan_mix=last_mix,
            ekf_predicted_temp=ekf_pred_temp,
            ekf_prediction_var=ekf_pred_var,
        )
        current_temp: float | None = fused.value
        current_temp_age_s = min((obs.age_s for obs in observations), default=0.0)

        # Fallback: read current_temperature from first thermostat/AC if no external sensor
        if current_temp is None and not has_external_sensor:
            device_observation = self._read_device_temperature_observation(room, now=now)
            if device_observation is not None:
                current_temp = device_observation.value
                current_temp_age_s = device_observation.age_s

        # --- Sensor dropout fallback: use cached temp if fresh enough ---
        current_temp_raw = current_temp  # preserve original for EKF/history

        if current_temp is not None:
            self._last_valid_temps[area_id] = (current_temp, time.monotonic() - current_temp_age_s)
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

        humidity = self._read_room_humidity(room, area_id, now, record_raw=record_raw)

        return RoomSensorSnapshot(
            current_temp=current_temp,
            current_temp_raw=current_temp_raw,
            humidity=humidity,
            has_external_sensor=has_external_sensor,
            temperature_observations=tuple(observations),
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
        self._raw_observation_buffer.append(
            build_raw_state_observation(
                area_id,
                entity_id,
                kind,
                state,
                is_primary=is_primary,
                quality=quality,
            )
        )

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

    def _read_room_humidity(
        self, room: dict, area_id: str, now: datetime, *, record_raw: bool = True
    ) -> HumiditySensorSnapshot:
        """Read configured humidity sources into an explicit weighted snapshot."""
        sensor_ids = self._humidity_sensor_ids(room)
        channels: list[tuple[str, float, float, bool]] = []
        primary = room.get("humidity_sensor") or ""
        for sensor_id in sensor_ids:
            state = self.hass.states.get(sensor_id)
            if record_raw:
                self._record_raw_state_observation(
                    area_id,
                    sensor_id,
                    "humidity",
                    state,
                    is_primary=(sensor_id == primary),
                )
            value = read_sensor_value(self.hass, sensor_id, area_id, "humidity", now=now)
            if value is None:
                continue
            attribute = "current_humidity" if sensor_id.startswith("climate.") else None
            age_s = sensor_observation_age(state, now=now, attribute=attribute)
            if age_s is None:
                continue
            channels.append((sensor_id, value, age_s, sensor_id == primary))

        fused, sources, primary_available = self._sensor_fusion.fuse_humidity(channels, learn=record_raw)
        if fused is not None:
            return HumiditySensorSnapshot(
                value=fused,
                sources=tuple(sources),
                primary_available=primary_available,
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
          - "sensor": primary outdoor_temp_sensor delivers a value
          - "weather": weather_entity attribute "temperature" delivers a value
          - "none": neither source available

        ``self.outdoor_temp`` remains the raw sensor reading for diagnostics.
        The result of this method is stored in ``self.outdoor_temp_effective``.
        It is the canonical value all consumers (EKF, MPC, cover, heat-source,
        analytics, mold) use. EKF training is gated on a non-None effective
        temperature. The filter never trains with a degenerate fallback
        (e.g. room temp). Such a fallback causes the alpha state to drift to
        the upper bound — see #301.
        """
        if self.outdoor_temp is not None:
            return self.outdoor_temp, "sensor"

        weather_eid = resolve_weather_entity(self.hass, settings)
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
        single HA persistent notification. The notification informs the user
        that EKF training is paused. It clears as soon as a valid outdoor
        source returns. Do not raise the notification when the user disables
        it via the ``outdoor_unavailable_notify`` global setting.
        """
        if self.outdoor_temp_effective is not None:
            self._outdoor_unavailable_cycles = 0
            if self._outdoor_warning_sent:
                self._outdoor_warning_sent = False
                async_dismiss_notification(self.hass, OUTDOOR_UNAVAILABLE_NOTIFICATION_ID)
            self._delete_outdoor_repair_issue()
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
        self._create_outdoor_repair_issue(sensor_id, weather_eid)
        bus = getattr(self.hass, "bus", None)
        async_fire = getattr(bus, "async_fire", None) if bus is not None else None
        if callable(async_fire):
            async_fire(
                EVENT_ROOMMIND_ALERT,
                {
                    "alert_type": "outdoor_temp_unavailable",
                    "sensor": sensor_id,
                    "weather": weather_eid,
                },
            )
        self._outdoor_warning_sent = True

    def _create_outdoor_repair_issue(self, sensor_id: str, weather_eid: str) -> None:
        """Surface an outdoor temperature outage in HA Repairs safely."""
        try:
            ir.async_create_issue(
                self.hass,
                DOMAIN,
                "outdoor_temp_unavailable",
                is_fixable=False,
                is_persistent=False,
                severity=ir.IssueSeverity.WARNING,
                translation_key="outdoor_temp_unavailable",
                translation_placeholders={"sensor": sensor_id, "weather": weather_eid},
            )
        except Exception:  # noqa: BLE001
            pass

    def _delete_outdoor_repair_issue(self) -> None:
        """Clear any active outdoor temperature HA Repairs issue safely."""
        try:
            ir.async_delete_issue(self.hass, DOMAIN, "outdoor_temp_unavailable")
        except Exception:  # noqa: BLE001
            pass

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
            acs_can_heat=check_acs_can_heat(self.hass, room),
        )

    def _read_control_observation(self, room: dict[str, Any], area_id: str) -> RoomControlObservation:
        """Capture physical inputs together, before any room can dispatch work."""
        sensors = self._read_room_sensors(room, area_id)
        climate_devices = self._read_climate_device_snapshot(room)
        airflow = self._environmental_factors.read_room_airflow(room)
        occupied = any(
            state.state == "on"
            for entity_id in room.get("occupancy_sensors", [])
            if (state := self.hass.states.get(entity_id)) is not None
        )
        return RoomControlObservation(
            sensors=sensors,
            climate_devices=climate_devices,
            actuator_states=capture_entity_snapshots(
                self.hass,
                (
                    *climate_devices.all_entity_ids,
                    *(
                        config["entity_id"]
                        for config in room.get("night_controls", []) or []
                        if config.get("entity_id")
                    ),
                ),
            ),
            device_action=self._observe_device_action(room),
            airflow=airflow,
            hvac_output=self._observe_hvac_output(room, airflow),
            raw_window_open=self._is_window_open(room),
            q_occupancy=1.0 if occupied else 0.0,
            shading_factor=self._cover_orchestrator.read_positions(area_id, room).shading_factor,
        )

    def _setpoint_tolerances(self, state: Any) -> tuple[float, float]:
        """Return (min_change_tolerance, echo_rounding_tolerance) in the device unit."""
        step = state.attributes.get("target_temp_step")
        try:
            step = float(step) if step is not None else None
        except (TypeError, ValueError):
            step = None
        if step and step > 0:
            return step / 2, step / 2
        default = 1.0 if ha_temp_unit_str(self.hass) == "°F" else 0.5
        return default / 2, default

    @staticmethod
    def _setpoint_side(attr: str, state: Any, device_type: str, climate_mode: str) -> str | None:
        if attr == "target_temp_low":
            return "heat"
        if attr == "target_temp_high":
            return "cool"
        if device_type == "trv" or state.state == "heat":
            return "heat"
        if state.state in ("cool", "dry"):
            return "cool"
        action = state.attributes.get("hvac_action")
        if state.state in ("heat_cool", "auto") and action in ("heating", "preheating"):
            return "heat"
        if state.state in ("heat_cool", "auto") and action == "cooling":
            return "cool"
        if climate_mode == CLIMATE_MODE_HEAT_ONLY:
            return "heat"
        if climate_mode == CLIMATE_MODE_COOL_ONLY:
            return "cool"
        return None

    async def _async_adopt_device_setpoints(self, room: dict, settings: dict) -> dict:
        """Promote manual remote/dial setpoint changes into a temporary override when enabled."""
        area_id = room.get("area_id", "unknown")
        climate_mode = room.get("climate_mode", "auto")
        devices = room.get("devices", []) or []
        chosen: dict[str, tuple[float, float]] = {}
        changed_on: list[str] = []
        for device in devices:
            if not isinstance(device, dict):
                continue
            eid = device.get("entity_id", "")
            if not eid:
                continue
            state = self.hass.states.get(eid)
            if state is None or state.state in ("unavailable", "unknown"):
                self.device_setpoints.forget_readings(eid)
                continue
            changes = self.device_setpoints.observe(
                eid, state.state, state.attributes, *self._setpoint_tolerances(state)
            )
            for attr, (before, after) in changes.items():
                side = self._setpoint_side(attr, state, device.get("type", ""), climate_mode)
                if side is None:
                    continue
                size = abs(after - before)
                if size > chosen.get(side, (0.0, 0.0))[0]:
                    chosen[side] = (size, ha_temp_to_celsius(self.hass, after, entity_id=eid))
                changed_on.append(eid)
        if not chosen or not room.get("follow_thermostat_dial", False):
            return room
        if not (settings.get("climate_control_active", True) and room.get("climate_control_enabled", True)):
            return room
        preferred_side = (
            "cool"
            if climate_mode == CLIMATE_MODE_COOL_ONLY
            else "heat"
            if climate_mode == CLIMATE_MODE_HEAT_ONLY
            else max(chosen, key=lambda k: chosen[k][0])
        )
        new_temp = chosen.get(preferred_side, next(iter(chosen.values())))[1]
        override = {
            "override_temp": round(new_temp, 1),
            "override_until": override_hold_until(self.hass, room),
            "override_type": OVERRIDE_CUSTOM,
        }
        _LOGGER.info(
            "Room '%s': external setpoint change on %s, adopting override %.1f°C",
            area_id,
            ", ".join(sorted(set(changed_on))),
            override["override_temp"],
        )
        await self.hass.data[DOMAIN]["store"].async_update_room(area_id, override)
        return {**room, **override}

    async def _async_process_room(
        self,
        room: dict,
        settings: dict,
        outdoor_forecast: list[dict],
        *,
        observation: RoomControlObservation | None = None,
    ) -> dict:
        """Process a single room: read sensor, evaluate schedule, apply control."""
        area_id = room.get("area_id", "unknown")
        if not room.get("is_outdoor", False):
            room = await self._async_adopt_device_setpoints(room, settings)

        if observation is None:
            observation = self._read_control_observation(room, area_id)
        sensor_snapshot = observation.sensors
        sensor_conflict = airflow_sensor_conflict(sensor_snapshot.temperature_observations)

        if room.get("is_outdoor", False):
            return self._build_outdoor_room_state(area_id, room, sensor_snapshot, sensor_conflict)

        (
            mold_risk_level,
            mold_surface_rh,
            mold_prevention_active_room,
            mold_prevention_temp_delta,
        ) = await self._evaluate_mold_risk(area_id, sensor_snapshot.current_temp, sensor_snapshot.humidity.value, settings)

        sleep_device_status = inspect_sleep_device_state(self.hass, room.get("sleep_device"))
        sleep_device_heating = bool(sleep_device_status and sleep_device_status.get("heating_active"))
        target_plan = await self.async_prepare_control_target_plan(
            room,
            settings,
            mold_prevention_active=mold_prevention_active_room,
            mold_prevention_delta=mold_prevention_temp_delta,
            tonight_override=self.get_tonight_sleep_override(area_id),
            sleep_device_heating=sleep_device_heating,
        )
        self._schedule_expired_target_state_cleanup(area_id, target_plan)

        control_state = await self._evaluate_mpc_and_constraints(
            area_id=area_id,
            room=room,
            settings=settings,
            outdoor_forecast=outdoor_forecast,
            observation=observation,
            target_plan=target_plan,
            sensor_conflict=sensor_conflict,
        )
        actuation_state = await self._apply_room_actuation(
            area_id=area_id,
            room=room,
            settings=settings,
            observation=observation,
            target_plan=target_plan,
            control_state=control_state,
        )
        return await self._finalize_room_state(
            area_id=area_id,
            room=room,
            settings=settings,
            observation=observation,
            sensor_conflict=sensor_conflict,
            target_plan=target_plan,
            mold_risk_level=mold_risk_level,
            mold_surface_rh=mold_surface_rh,
            mold_prevention_active_room=mold_prevention_active_room,
            mold_prevention_temp_delta=mold_prevention_temp_delta,
            sleep_device_status=sleep_device_status,
            control_state=control_state,
            actuation_state=actuation_state,
        )

    def _build_outdoor_room_state(
        self,
        area_id: str,
        room: dict,
        sensor_snapshot: RoomSensorSnapshot,
        sensor_conflict: float,
    ) -> dict[str, Any]:
        """Build the passive monitoring payload for an outdoor room."""
        sensor_fusion_status = self._sensor_fusion.diagnostics(
            sensor_snapshot.temperature_observations,
            power_fraction=0.0,
            q_fan_mix=0.0,
        )
        temperature_sources = [
            status.get("entity_id", "") for status in sensor_fusion_status if status.get("entity_id")
        ]
        return {
            "area_id": area_id,
            "current_temp": sensor_snapshot.current_temp,
            "current_temp_raw": sensor_snapshot.current_temp_raw,
            "current_humidity": sensor_snapshot.humidity.value,
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

    @staticmethod
    def _resolve_display_target_temp(room: dict, mode: str, targets: TargetTemps) -> float | None:
        """Compute effective single target temperature for display and history."""
        climate_mode = room.get("climate_mode", "auto")
        if climate_mode == CLIMATE_MODE_COOL_ONLY:
            return targets.cool
        if climate_mode == CLIMATE_MODE_HEAT_ONLY:
            return targets.heat
        if climate_mode in (CLIMATE_MODE_DRY, CLIMATE_MODE_FAN_ONLY, CLIMATE_MODE_OFF):
            return None
        if mode == MODE_HEATING and targets.heat is not None:
            return targets.heat
        if mode == MODE_COOLING and targets.cool is not None:
            return targets.cool
        return targets.heat if targets.heat is not None else targets.cool

    async def _evaluate_mpc_and_constraints(
        self,
        *,
        area_id: str,
        room: dict,
        settings: dict,
        outdoor_forecast: list[dict],
        observation: RoomControlObservation,
        target_plan: ControlTargetPlan,
        sensor_conflict: float,
    ) -> dict[str, Any]:
        """Run MPC evaluation, safety/window constraints, inverter regime, and airflow plan."""
        sensor_snapshot = observation.sensors
        current_temp = sensor_snapshot.current_temp
        current_humidity = sensor_snapshot.humidity.value
        has_external_sensor = sensor_snapshot.has_external_sensor
        targets = target_plan.targets
        force_off = target_plan.force_off
        night_mode_active = target_plan.night_active
        system_type = room.get("heating_system_type", "")
        q_residual = self._residual_tracker.get_q_residual(
            area_id,
            system_type,
            self._previous_modes.get(area_id, MODE_IDLE),
        )
        shading_factor = observation.shading_factor
        solar_exposure = SolarExposure(raw_solar=self._current_q_solar, shading_factor=shading_factor)
        airflow = observation.airflow
        airflow_has_ventilation = any(
            status.available and status.role == AIRFLOW_ROLE_VENTILATION for status in airflow.statuses
        )
        coupling_terms = self._build_coupling_terms(area_id, room)

        controller = MPCController(
            self.hass,
            room,
            model_manager=self._model_manager,
            actuation_ledger=self._actuation_ledger,
            actuator_observations=observation.actuator_states,
            outdoor_temp=self.outdoor_temp_effective,
            outdoor_forecast=outdoor_forecast,
            settings=settings,
            setback_offset=resolve_setback_offset(room, settings),
            previous_mode=self._previous_modes.get(area_id, MODE_IDLE),
            mode_on_since=self._mode_on_since.get(area_id),
            has_external_sensor=has_external_sensor,
            acs_can_heat=observation.climate_devices.acs_can_heat,
            target_resolver=target_plan.resolver,
            q_solar=solar_exposure.raw_solar,
            latitude=self.hass.config.latitude,
            longitude=self.hass.config.longitude,
            cloud_series=WeatherManager.extract_cloud_series(outdoor_forecast),
            q_residual=q_residual,
            heating_system_type=system_type,
            shading_factor=shading_factor,
            q_occupancy=observation.q_occupancy,
            q_vent=airflow.q_vent,
            airflow_levels=list(airflow.levels),
            mix_levels=list(airflow.mix_levels),
            vent_levels=list(airflow.vent_levels),
            airflow_has_ventilation=airflow_has_ventilation,
            airflow_has_hvac_fan=airflow.has_hvac_fan_control,
            airflow_mix_score=max(airflow.q_fan_mix, sensor_conflict),
            airflow_capacity_curve=self._select_airflow_curve(room, "fan_capacity_curve"),
            airflow_power_curve=self._select_airflow_curve(room, "fan_power_curve"),
            control_target=room.get("control_target", "air_temperature"),
            current_humidity=current_humidity,
            night_active=night_mode_active,
            night_quiet_penalty=0.35,
            coupling_terms=coupling_terms,
            ac_overdrive=self._ac_overdrive,
            sensor_fusion=self._sensor_fusion,
        )
        mode, power_fraction = await controller.async_evaluate(current_temp, targets)
        target_temp = self._resolve_display_target_temp(room, mode, targets)

        rapid_recovery_mode = resolve_rapid_recovery_mode(
            room,
            settings,
            current_temp=current_temp,
            targets=targets,
            night_active=night_mode_active,
            outdoor_temp=self.outdoor_temp_effective,
        )
        if not has_external_sensor:
            rapid_recovery_mode = None
        window_open = self._window_manager.update(
            area_id,
            observation.raw_window_open,
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
        regime_decision = self._evaluate_inverter_regime(
            area_id=area_id,
            room=room,
            observation=observation,
            controller=controller,
            targets=targets,
            mode=mode,
            power_fraction=power_fraction,
            climate_active=climate_active,
            window_open=window_open,
            force_off=force_off,
            rapid_recovery_active=rapid_recovery_active,
        )
        if regime_decision is not None:
            mode, power_fraction, target_temp = self._apply_regime_override(
                room=room,
                observation=observation,
                targets=targets,
                regime_decision=regime_decision,
                mode=mode,
                power_fraction=power_fraction,
                target_temp=target_temp,
                window_open=window_open,
                force_off=force_off,
            )

        airflow_mix_plan_level, airflow_vent_plan_level, airflow_plan_level = self._compute_airflow_plan_levels(
            room=room,
            airflow=airflow,
            controller=controller,
            regime_decision=regime_decision,
            mode=mode,
            window_open=window_open,
            force_off=force_off,
            rapid_recovery_active=rapid_recovery_active,
            night_mode_active=night_mode_active,
        )
        return {
            "controller": controller,
            "mode": mode,
            "power_fraction": power_fraction,
            "target_temp": target_temp,
            "window_open": window_open,
            "rapid_recovery_active": rapid_recovery_active,
            "climate_active": climate_active,
            "system_type": system_type,
            "q_residual": q_residual,
            "solar_exposure": solar_exposure,
            "coupling_terms": coupling_terms,
            "regime_decision": regime_decision,
            "airflow_mix_plan_level": airflow_mix_plan_level,
            "airflow_vent_plan_level": airflow_vent_plan_level,
            "airflow_plan_level": airflow_plan_level,
        }

    def _evaluate_inverter_regime(
        self,
        *,
        area_id: str,
        room: dict,
        observation: RoomControlObservation,
        controller: MPCController,
        targets: Any,
        mode: str,
        power_fraction: float,
        climate_active: bool,
        window_open: bool,
        force_off: bool,
        rapid_recovery_active: bool,
    ) -> InverterRegimeDecision | None:
        """Evaluate near-setpoint inverter regime when AC and external sensor are available."""
        device_snapshot = observation.climate_devices
        has_external_sensor = observation.sensors.has_external_sensor
        climate_mode = room.get("climate_mode", "auto")
        if not (
            device_snapshot.ac_entity_ids
            and has_external_sensor
            and climate_active
            and climate_mode in ("auto", CLIMATE_MODE_HEAT_ONLY, CLIMATE_MODE_COOL_ONLY)
        ):
            return None
        can_heat_r, can_cool_r = controller._get_can_heat_cool()
        hold_cruise = bool(device_snapshot.ac_entity_ids and not device_snapshot.trv_entity_ids)
        decision = self._inverter_regime.evaluate(
            area_id,
            mode=mode,
            power_fraction=power_fraction,
            can_heat=can_heat_r,
            can_cool=can_cool_r,
            current_temp=observation.sensors.current_temp,
            targets=targets,
            previous_mode=self._previous_modes.get(area_id, MODE_IDLE),
            has_ac=True,
            has_external_sensor=has_external_sensor,
            window_open=window_open,
            force_off=force_off,
            rapid_recovery_active=rapid_recovery_active,
            hold_cruise=hold_cruise,
        )
        controller._inverter_regime = decision.regime
        return decision

    @staticmethod
    def _apply_regime_override(
        *,
        room: dict,
        observation: RoomControlObservation,
        targets: TargetTemps,
        regime_decision: InverterRegimeDecision,
        mode: str,
        power_fraction: float,
        target_temp: float | None,
        window_open: bool,
        force_off: bool,
    ) -> tuple[str, float, float | None]:
        """Apply AC-only inverter cruise/coast mode and target overrides."""
        device_snapshot = observation.climate_devices
        hold_cruise = bool(device_snapshot.ac_entity_ids and not device_snapshot.trv_entity_ids)
        has_adaptive_ac = any(
            isinstance(d, dict) and d.get("type") == "ac" and d.get("setpoint_mode") == "adaptive"
            for d in (room.get("devices") or [])
        )
        if hold_cruise and not window_open and not force_off and mode in (MODE_IDLE, MODE_HEATING, MODE_COOLING):
            if regime_decision.active and (has_adaptive_ac or mode != regime_decision.mode):
                mode = regime_decision.mode
                power_fraction = regime_decision.power_fraction
            elif regime_decision.regime == "coast" and regime_decision.in_min_hold:
                mode = MODE_IDLE
                power_fraction = 0.0
            if mode == MODE_HEATING and targets.heat is not None:
                target_temp = targets.heat
            elif mode == MODE_COOLING and targets.cool is not None:
                target_temp = targets.cool
        return mode, power_fraction, target_temp

    @staticmethod
    def _compute_airflow_plan_levels(
        *,
        room: dict,
        airflow: AirflowFactors,
        controller: MPCController,
        regime_decision: InverterRegimeDecision | None,
        mode: str,
        window_open: bool,
        force_off: bool,
        rapid_recovery_active: bool,
        night_mode_active: bool,
    ) -> tuple[float, float, float]:
        """Resolve mix, ventilation, and combined airflow plan levels for the cycle."""
        airflow_mix_plan_level = 0.0 if window_open or force_off else controller.last_airflow_mix_level
        airflow_vent_plan_level = 0.0 if window_open or force_off else controller.last_airflow_vent_level
        if (
            regime_decision is not None
            and room.get("fan_speed_mode", "auto") == "auto"
            and not window_open
            and not force_off
        ):
            if regime_decision.active:
                airflow_mix_plan_level = max(airflow_mix_plan_level, regime_decision.recommended_fan_level)
            elif regime_decision.regime in ("coast", "off") and mode == MODE_IDLE:
                airflow_mix_plan_level = 0.0
        if (
            rapid_recovery_active
            and controller.last_plan is None
            and not window_open
            and not force_off
            and mode in (MODE_HEATING, MODE_COOLING)
        ):
            airflow_mix_plan_level = max(airflow_mix_plan_level, *(airflow.mix_levels or [1.0]))
        night_fan_limit = room.get("max_fan_level_night")
        if night_mode_active and night_fan_limit is not None:
            airflow_mix_plan_level = min(airflow_mix_plan_level, max(0.0, min(1.0, float(night_fan_limit))))
        airflow_plan_level = max(airflow_mix_plan_level, airflow_vent_plan_level)
        return airflow_mix_plan_level, airflow_vent_plan_level, airflow_plan_level

    async def _apply_room_actuation(
        self,
        *,
        area_id: str,
        room: dict,
        settings: dict,
        observation: RoomControlObservation,
        target_plan: ControlTargetPlan,
        control_state: dict[str, Any],
    ) -> dict[str, Any]:
        """Apply heat-source routing, compressor constraints, coil-dry, night mode, and device commands."""
        controller: MPCController = control_state["controller"]
        mode: str = control_state["mode"]
        power_fraction: float = control_state["power_fraction"]
        window_open: bool = control_state["window_open"]
        rapid_recovery_active: bool = control_state["rapid_recovery_active"]
        climate_active: bool = control_state["climate_active"]
        airflow_mix_plan_level: float = control_state["airflow_mix_plan_level"]
        airflow_vent_plan_level: float = control_state["airflow_vent_plan_level"]
        airflow_plan_level: float = control_state["airflow_plan_level"]

        device_snapshot = observation.climate_devices
        sensor_snapshot = observation.sensors
        targets = target_plan.targets
        force_off = target_plan.force_off
        night_mode_active = target_plan.night_active
        cycling_eids = {eid for eid in device_snapshot.trv_entity_ids if self._valve_manager.is_entity_cycling(eid)}

        heat_source_plan = None
        if (
            room.get("heat_source_orchestration", False)
            and mode == MODE_HEATING
            and sensor_snapshot.has_external_sensor
            and device_snapshot.trv_entity_ids
            and device_snapshot.ac_entity_ids
        ):
            heat_source_plan = evaluate_heat_sources(
                room_config=room,
                mode=mode,
                power_fraction=power_fraction,
                current_temp=sensor_snapshot.current_temp,
                target_temp=targets.heat,
                outdoor_temp=self.outdoor_temp_effective,
                previous_active_sources=self._heat_source_states.get(area_id, "none"),
                hass=self.hass,
            )
            if heat_source_plan is not None:
                self._heat_source_states[area_id] = heat_source_plan.active_sources
            else:
                self._heat_source_states.pop(area_id, None)
        else:
            self._heat_source_states.pop(area_id, None)

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

        coil_dry = await self._coil_dry_manager.async_process_room(
            area_id=area_id,
            room=room,
            settings=settings,
            mode=mode,
            commandable=climate_active,
            compressor_forced_on=compressor_forced_on,
            compressor_forced_off=compressor_forced_off,
            exclude_eids=cycling_eids,
            force_off=force_off,
            can_activate=self._compressor_manager.check_can_activate,
        )
        if climate_active and control_state["system_type"]:
            self._residual_tracker.update(
                area_id,
                mode,
                power_fraction,
                self._previous_modes.get(area_id, MODE_IDLE),
                q_residual=control_state["q_residual"],
            )

        night_control_status: list[dict[str, Any]] = []
        try:
            night_control_status = await self._night_mode_manager.async_apply(
                area_id, room, active=night_mode_active, observations=observation.actuator_states
            )
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Room '%s': night-mode accessory control failed", area_id, exc_info=True)

        airflow_context = AirflowRuntimeContext(
            night_active=night_mode_active,
            presence_away=target_plan.presence_away,
            rapid_recovery_active=rapid_recovery_active,
        )
        airflow_command_status: list[dict[str, Any]] = []
        dispatch_status = "disabled"
        applied_report: AppliedCommandReport | None = None
        if climate_active:
            try:
                applied_report = await controller.async_apply(
                    mode,
                    targets,
                    power_fraction=power_fraction,
                    current_temp=sensor_snapshot.current_temp,
                    exclude_eids=cycling_eids | coil_dry.controlled_eids,
                    heating_boost_target=device_snapshot.heating_boost_target,
                    ac_heating_boost_target=device_snapshot.ac_heating_boost_target,
                    cooling_boost_target=device_snapshot.cooling_boost_target,
                    heat_source_plan=heat_source_plan,
                    compressor_forced_on=compressor_forced_on or None,
                    compressor_forced_off=compressor_forced_off or None,
                    urgent=rapid_recovery_active,
                )
                results = tuple(applied_report.results.values())
                dispatch_status = (
                    "failed"
                    if applied_report.failed_eids
                    else "deferred"
                    if applied_report.deferred_eids
                    else "sent"
                    if any(result.dispatch == "sent" for result in results)
                    else "skipped"
                    if results and all(result.dispatch == "skipped" for result in results)
                    else "unknown"
                )
            except Exception:  # noqa: BLE001
                dispatch_status = "failed"
                _LOGGER.warning("Room '%s': climate service call failed", area_id, exc_info=True)
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
                _LOGGER.warning("Room '%s': airflow service call failed", area_id, exc_info=True)
            routed_commands = heat_source_plan.commands if heat_source_plan is not None else ()
            self._compressor_manager.reconcile_command_outcome(
                CompressorCommandOutcome(
                    member_entity_ids=device_snapshot.all_entity_ids,
                    excluded=frozenset(cycling_eids),
                    forced_on=frozenset(compressor_forced_on),
                    forced_off=frozenset(compressor_forced_off),
                    applied_active=(
                        (frozenset(applied_report.active_eids) if applied_report is not None else frozenset())
                        | frozenset(coil_dry.compressor_active_eids)
                    ),
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
            mode = MODE_IDLE
            power_fraction = 0.0
            rapid_recovery_active = False
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

        return {
            "mode": mode,
            "power_fraction": power_fraction,
            "rapid_recovery_active": rapid_recovery_active,
            "airflow_mix_plan_level": airflow_mix_plan_level,
            "airflow_vent_plan_level": airflow_vent_plan_level,
            "airflow_plan_level": airflow_plan_level,
            "dispatch_status": dispatch_status,
            "applied_report": applied_report,
            "airflow_command_status": airflow_command_status,
            "night_control_status": night_control_status,
            "coil_dry": coil_dry,
        }

    async def _finalize_room_state(
        self,
        *,
        area_id: str,
        room: dict,
        settings: dict,
        observation: RoomControlObservation,
        sensor_conflict: float,
        target_plan: ControlTargetPlan,
        mold_risk_level: str,
        mold_surface_rh: float | None,
        mold_prevention_active_room: bool,
        mold_prevention_temp_delta: float,
        sleep_device_status: dict | None,
        control_state: dict[str, Any],
        actuation_state: dict[str, Any],
    ) -> dict[str, Any]:
        """Run covers, EKF/overdrive observation, air quality, and assemble room state."""
        controller: MPCController = control_state["controller"]
        solar_exposure: SolarExposure = control_state["solar_exposure"]
        regime_decision: InverterRegimeDecision | None = control_state["regime_decision"]
        mode: str = actuation_state["mode"]
        power_fraction: float = actuation_state["power_fraction"]
        coil_dry = actuation_state["coil_dry"]
        sensor_snapshot = observation.sensors
        device_snapshot = observation.climate_devices
        device_action = observation.device_action
        current_temp = sensor_snapshot.current_temp
        current_temp_raw = sensor_snapshot.current_temp_raw

        cover_result = await self._cover_orchestrator.async_process(
            area_id=area_id,
            room=room,
            targets=target_plan.targets,
            mode=mode,
            current_temp=current_temp,
            outdoor_temp=self.outdoor_temp_effective,
            q_solar=solar_exposure.raw_solar,
            predicted_peak_temp=controller.predicted_peak_temp,
            has_override=is_override_active(room),
            solar_exposure=solar_exposure,
        )
        if mode == MODE_HEATING:
            excluded = set(room.get("valve_protection_exclude", []))
            self._valve_manager.record_heating([eid for eid in device_snapshot.trv_entity_ids if eid not in excluded])

        mpc_active = self._is_room_mpc_active(
            area_id=area_id,
            room=room,
            settings=settings,
            has_external_sensor=sensor_snapshot.has_external_sensor,
            acs_can_heat=device_snapshot.acs_can_heat,
            current_temp=current_temp,
        )
        temp_slope = self._update_temp_slope(area_id, current_temp_raw)
        soft_load = self._compute_soft_thermal_load(
            room,
            area_id,
            expected_mode=mode if mode in (MODE_HEATING, MODE_COOLING) else device_action[0],
            room_temp_c=current_temp_raw,
            temp_slope_c_per_h=temp_slope,
        )
        display_mode, display_pf = await self._observe_and_train(
            area_id=area_id,
            room=room,
            settings=settings,
            observation=observation,
            solar_exposure=solar_exposure,
            mode=mode,
            window_open=control_state["window_open"],
            q_residual=control_state["q_residual"],
            pause_learning=(
                bool(sleep_device_status and sleep_device_status.get("mite_removal_active"))
                or coil_dry.skip_ekf_training
            ),
            soft_load=soft_load,
        )
        self._last_room_pf_mix[area_id] = (display_pf, observation.airflow.q_fan_mix)
        self._observe_adaptive_overdrive(
            area_id=area_id,
            room=room,
            observation=observation,
            current_temp_raw=current_temp_raw,
            target_temp=control_state["target_temp"],
            mode=mode,
            device_action=device_action,
        )

        room_state = self._build_room_state_dict(
            area_id=area_id,
            room=room,
            settings=settings,
            sensor_snapshot=sensor_snapshot,
            target_temp=control_state["target_temp"],
            target_plan=target_plan,
            display_mode=display_mode,
            display_pf=display_pf,
            applied_report=actuation_state["applied_report"],
            window_open=control_state["window_open"],
            mode=mode,
            mold_risk_level=mold_risk_level,
            mold_surface_rh=mold_surface_rh,
            mold_prevention_active_room=mold_prevention_active_room,
            mold_prevention_temp_delta=mold_prevention_temp_delta,
            solar_exposure=solar_exposure,
            q_occupancy=observation.q_occupancy,
            airflow=observation.airflow,
            airflow_mix_plan_level=actuation_state["airflow_mix_plan_level"],
            airflow_vent_plan_level=actuation_state["airflow_vent_plan_level"],
            airflow_plan_level=actuation_state["airflow_plan_level"],
            airflow_command_status=actuation_state["airflow_command_status"],
            sensor_conflict=sensor_conflict,
            sensor_fusion_status=self._sensor_fusion.diagnostics(
                sensor_snapshot.temperature_observations,
                power_fraction=device_action[1],
                q_fan_mix=observation.airflow.q_fan_mix,
            ),
            hvac_output_status=observation.hvac_output.as_status_dict()
            if observation.hvac_output is not None
            else None,
            night_control_status=actuation_state["night_control_status"],
            rapid_recovery_active=actuation_state["rapid_recovery_active"],
            coupling_status=control_state["coupling_terms"],
            cover_result=cover_result,
            mpc_active=mpc_active,
        )
        room_state["observed_mode"] = device_action[0]
        room_state["observation_status"] = "observed" if device_action[0] is not None else "unknown"
        room_state["requested_power"] = round(power_fraction * 100) if mode != MODE_IDLE else 0
        room_state["dispatch_status"] = actuation_state["dispatch_status"]
        room_state["device_observations"] = self._device_observation_status(observation)
        room_state["sleep_device_status"] = sleep_device_status
        room_state["ac_overdrive_status"] = controller.last_overdrive_status
        room_state["inverter_regime"] = regime_decision.as_dict() if regime_decision is not None else None
        room_state["thermal_load_status"] = soft_load.as_dict() if soft_load is not None else None
        room_state["coil_dry_active"] = bool(coil_dry.active)
        room_state["coil_dry_phase"] = coil_dry.phase
        room_state["coil_dry_until"] = coil_dry.until
        room_state["coil_dry_entities"] = sorted(coil_dry.controlled_eids)
        room_state["preheat"] = (
            controller.preheat if controller.preheat and controller.preheat.get("mode") == mode else None
        )
        room_state["occupancy_vacant"] = target_plan.occupancy_vacant
        room_state["price_level"] = target_plan.price_level
        room_state["price_shift_heat"] = target_plan.price_shift_heat
        room_state["price_shift_cool"] = target_plan.price_shift_cool
        room_state.update(self._evaluate_air_quality(area_id, room))
        return room_state

    def _is_room_mpc_active(
        self,
        *,
        area_id: str,
        room: dict,
        settings: dict,
        has_external_sensor: bool,
        acs_can_heat: bool,
        current_temp: float | None,
    ) -> bool:
        """Return whether MPC control is currently active for the room."""
        if not (has_external_sensor and mpc_control_enabled(settings)):
            return False
        try:
            can_heat, can_cool = get_can_heat_cool(
                room,
                self.outdoor_temp_effective,
                acs_can_heat=acs_can_heat,
                override_active=is_override_active(room),
            )
            outdoor_temp = (
                self.outdoor_temp_effective if self.outdoor_temp_effective is not None else DEFAULT_OUTDOOR_TEMP_FALLBACK
            )
            return is_mpc_active(
                self._model_manager,
                area_id,
                can_heat,
                can_cool,
                current_temp if current_temp is not None else 20.0,
                outdoor_temp,
            )
        except Exception:  # noqa: BLE001
            return False

    def _observe_adaptive_overdrive(
        self,
        *,
        area_id: str,
        room: dict,
        observation: RoomControlObservation,
        current_temp_raw: float | None,
        target_temp: float | None,
        mode: str,
        device_action: tuple[str | None, float],
    ) -> None:
        """Feed room thermal progress to adaptive-overdrive AC trackers."""
        if not (observation.sensors.has_external_sensor and current_temp_raw is not None):
            return
        model = self._model_manager.get_model(area_id)
        alpha = model.U / max(model.C, 0.001)
        is_heating = mode == MODE_HEATING or device_action[0] == MODE_HEATING
        is_active = device_action[0] in (MODE_HEATING, MODE_COOLING) or mode in (MODE_HEATING, MODE_COOLING)
        for dev in room.get("devices", []) or []:
            if not isinstance(dev, dict) or dev.get("setpoint_mode") != "adaptive":
                continue
            dev_eid = dev.get("entity_id", "")
            if not dev_eid:
                continue
            pre_dev_state = observation.actuator_states.get(dev_eid)
            raw_ac_temp = pre_dev_state.attributes.get("current_temperature") if pre_dev_state else None
            ac_internal_c = (
                ha_temp_to_celsius(self.hass, float(raw_ac_temp), entity_id=dev_eid)
                if isinstance(raw_ac_temp, int | float) and not isinstance(raw_ac_temp, bool)
                else None
            )
            self._ac_overdrive.observe_response(
                dev_eid,
                room_temp_c=current_temp_raw,
                target_c=target_temp,
                ac_internal_temp_c=ac_internal_c,
                heating=is_heating,
                active=bool(is_active),
                outdoor_temp_c=self.outdoor_temp_effective,
                alpha=alpha,
            )

    def price_status(self) -> dict | None:
        """Return current electricity price status for settings diagnostics."""
        return self._price_manager.status()

    def _evaluate_air_quality(self, area_id: str, room: dict) -> dict[str, Any]:
        """Evaluate CO2, VOC, and PM2.5 sensors with hysteresis."""
        now = time.time()
        result = dict(_NO_AIR_QUALITY)
        bad: list[str] = []
        venting = self._ventilation.is_running(room.get("ventilation_entity") or "")
        for kind, threshold, clear_below in (
            ("co2", room.get("co2_threshold") or DEFAULT_CO2_THRESHOLD, None),
            ("voc", room.get("voc_threshold"), None),
        ):
            sensor = room.get(f"{kind}_sensor")
            if not sensor:
                continue
            value = read_sensor_value(self.hass, sensor, area_id, kind.upper())
            result[kind] = value
            if self._air_quality.evaluate(
                area_id, kind, value, threshold, now, assume_bad=venting, clear_below=clear_below
            ):
                bad.append(kind)

        pm25_val = read_pm25_value(self.hass, room, area_id)
        if pm25_val is not None or room.get("pm25_sensors") or room.get("pm25_sensor"):
            result["pm25"] = pm25_val
            pm25_thresh = float(room.get("air_quality_pm25_threshold") or DEFAULT_PM25_THRESHOLD)
            pm25_clear = round(pm25_thresh * (DEFAULT_PM25_CLEAR_THRESHOLD / DEFAULT_PM25_THRESHOLD), 1)
            if self._air_quality.evaluate(
                area_id, "pm25", pm25_val, pm25_thresh, now, assume_bad=venting, clear_below=pm25_clear
            ):
                bad.append("pm25")

        result["air_quality_bad"] = bool(bad)
        result["air_quality_reason"] = bad[0] if bad else None
        return result

    async def _async_reconcile_ventilation(
        self,
        rooms: dict[str, dict],
        room_states: dict[str, dict],
        settings: dict,
        store: RoomMindStore,
    ) -> None:
        """Turn shared/room ventilation entities on for bad air and off when clear."""
        now = time.time()
        wanted: dict[str, bool] = {}
        blocked: set[str] = set()
        global_active = settings.get("climate_control_active", True)
        for area_id, room in rooms.items():
            eid = room.get("ventilation_entity") or ""
            if not eid or room.get("is_outdoor", False):
                continue
            if not (global_active and room.get("climate_control_enabled", True)):
                continue
            rs = room_states.get(area_id)
            if not rs:
                continue
            if rs.get("window_open"):
                blocked.add(eid)
                continue
            wanted[eid] = wanted.get(eid, False) or bool(rs.get("air_quality_bad", False))
        for eid in blocked:
            wanted.pop(eid, None)
        await self._ventilation.async_reconcile(wanted, now, blocked=blocked)
        if self._ventilation.dirty:
            await store.async_save_settings({"ventilation_state": self._ventilation.get_state()})
            self._ventilation.dirty = False
        for area_id, room in rooms.items():
            eid = room.get("ventilation_entity") or ""
            if area_id in room_states and eid:
                room_states[area_id]["ventilation_active"] = self._ventilation.is_running(eid)

    def _update_temp_slope(self, area_id: str, temp_c: float | None) -> float | None:
        """Track filtered room temperature slope in °C/h across cycles."""
        if temp_c is None:
            return None
        now = time.monotonic()
        prev = self._prev_slope_sample.get(area_id)
        self._prev_slope_sample[area_id] = (temp_c, now)
        if prev is None:
            return None
        dt_s = now - prev[1]
        if dt_s < 20.0 or dt_s > 3600.0:
            return None
        return max(-15.0, min(15.0, (temp_c - prev[0]) / (dt_s / 3600.0)))

    def _compute_soft_thermal_load(
        self,
        room: dict[str, Any],
        area_id: str,
        *,
        expected_mode: str | None,
        room_temp_c: float | None,
        temp_slope_c_per_h: float | None,
    ) -> SoftThermalLoadEstimate | None:
        """Estimate thermal load from wattage, HVAC feedback, or dual-sensor plume."""
        devices = [d for d in (room.get("devices") or []) if isinstance(d, dict) and d.get("entity_id")]
        if not devices:
            return None
        primary = next((d for d in devices if d.get("type") == "ac"), devices[0])
        target_dev = dict(primary)
        if not target_dev.get("power_sensor_entity"):
            for af in room.get("airflow_devices", []) or []:
                if (
                    isinstance(af, dict)
                    and af.get("entity_id") == target_dev.get("entity_id")
                    and af.get("power_sensor_entity")
                ):
                    target_dev["power_sensor_entity"] = af["power_sensor_entity"]
                    break
        model = self._model_manager.get_model(area_id)
        alpha = model.U / max(model.C, 0.001)
        return self._hvac_output_observer.estimate_soft_load(
            device=target_dev,
            expected_mode=expected_mode,
            room_temp_c=room_temp_c,
            outdoor_temp_c=self.outdoor_temp_effective,
            temp_slope_c_per_h=temp_slope_c_per_h,
            alpha=alpha,
        )

    def _supports_mode_aware_ekf_training(
        self,
        room: dict[str, Any],
        commanded_mode: str,
        soft_load: SoftThermalLoadEstimate | None,
    ) -> bool:
        """Allow safe EKF training when confirmed hvac_mode + plume/power confirm active delivery."""
        if commanded_mode not in (MODE_HEATING, MODE_COOLING):
            return False
        if soft_load is None or not soft_load.supports_training:
            return False
        eids = get_all_entity_ids(room.get("devices", []))
        if not eids:
            return False
        expected_hvac = ("heat", "heat_cool", "auto") if commanded_mode == MODE_HEATING else ("cool", "heat_cool", "auto")
        for eid in eids:
            obs = self._hvac_output_observer.read_climate(eid)
            if obs.assumed_state or obs.hvac_mode not in expected_hvac:
                return False
            if obs.thermal_mode == "idle":
                return False
        return True

    async def _observe_and_train(
        self,
        *,
        area_id: str,
        room: dict,
        settings: dict,
        observation: RoomControlObservation,
        solar_exposure: SolarExposure,
        mode: str,
        window_open: bool,
        q_residual: float,
        pause_learning: bool = False,
        soft_load: SoftThermalLoadEstimate | None = None,
    ) -> tuple[str, float]:
        """Observe device state, train EKF, compute display mode.

        Returns (display_mode, display_pf).
        """
        current_temp_raw = observation.sensors.current_temp_raw
        temperature_observations = observation.sensors.temperature_observations
        airflow = observation.airflow

        # Use the pre-dispatch observation for the interval ending now.
        # Missing feedback is unknown; neither a setpoint nor a completed
        # service call measures heat delivered to the room.
        raw_ekf_mode, raw_ekf_pf = observation.device_action
        ekf_mode, ekf_pf = raw_ekf_mode, raw_ekf_pf
        if ekf_mode is None and self._supports_mode_aware_ekf_training(room, mode, soft_load):
            ekf_mode = mode
            assert soft_load is not None
            ekf_pf = max(0.25, min(1.0, float(soft_load.load_fraction)))
        q_residual_training = q_residual

        # Update thermal model with observation (EKF online learning).
        # The filter must NOT train with a degenerate outdoor fallback (e.g.
        # using room temp when the sensor is unavailable). F[0][1] collapses
        # toward 0 and alpha drifts under process noise. Alpha eventually
        # pegs at the upper bound (see #301). Skip the update and flush any
        # accumulated batch when no real outdoor source is available.
        learning_disabled = settings.get("learning_disabled_rooms", [])
        learning_active = (area_id not in learning_disabled) and not pause_learning
        if learning_active and current_temp_raw is not None and self.outdoor_temp_effective is not None:
            can_heat, can_cool = get_can_heat_cool(room, acs_can_heat=observation.climate_devices.acs_can_heat)
            training_observations = (
                self._sensor_fusion.calibrate_observations(
                    temperature_observations,
                    mode=ekf_mode,
                    power_fraction=ekf_pf,
                    q_fan_mix=airflow.q_fan_mix,
                )
                if ekf_mode is not None
                else None
            )
            self._ekf_training.process(
                area_id=area_id,
                current_temp=current_temp_raw,
                current_observations=training_observations,
                T_outdoor=self.outdoor_temp_effective,
                ekf_mode=ekf_mode,
                ekf_pf=ekf_pf,
                window_open=window_open,
                raw_open=observation.raw_window_open,
                q_residual=q_residual_training,
                shading_factor=solar_exposure.shading_factor,
                q_solar=self._current_q_solar,
                can_heat=can_heat,
                can_cool=can_cool,
                dt_minutes=UPDATE_INTERVAL / 60.0,
                q_occupancy=observation.q_occupancy,
                q_vent=airflow.q_vent,
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

        # Unknown output is surfaced separately from the requested mode.
        return raw_ekf_mode or MODE_IDLE, raw_ekf_pf

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
        applied_report: AppliedCommandReport | None,
        window_open: bool,
        mode: str,
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
            "device_setpoint": self._planned_device_setpoint(applied_report, mode)
            if sensor_snapshot.has_external_sensor
            else None,
            "device_actuation_status": self._device_actuation_status(applied_report),
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
                "phase": target_plan.sleep_phase,
                "trigger_source": target_plan.sleep_trigger_source,
                "effective_ramp_c": target_plan.effective_sleep_ramp_c,
                "coupled_offset_active": target_plan.coupled_offset_active,
                "tonight_override": self.get_tonight_sleep_override(area_id),
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
        airflow: AirflowFactors,
    ) -> HVACOutputObservation | None:
        """Return a coarse HVAC output observation for the first configured climate airflow device."""
        fan_levels = {status.entity_id: status.q for status in airflow.statuses}
        for device in room.get("airflow_devices", []) or []:
            entity_id = device.get("entity_id", "")
            if not entity_id.startswith("climate."):
                continue
            climate = self._hvac_output_observer.read_climate(entity_id)
            return self._hvac_output_observer.observe(
                device,
                hvac_action=climate.output_action,
                fan_q=fan_levels.get(entity_id, 0.0),
            )
        return None

    def _planned_device_setpoint(self, report: AppliedCommandReport | None, mode: str) -> float | None:
        """Summarize an actual device plan after offsets, limits and step rounding."""
        if report is None or mode == MODE_IDLE:
            return None
        for entity_id, operations in report.operation_results.items():
            if entity_id in report.failed_eids or entity_id in report.inactive_eids:
                continue
            for result in reversed(operations):
                if result.service != "set_temperature":
                    continue
                temperature = result.desired.get("temperature")
                if temperature is None:
                    temperature = result.desired.get("target_temp_low" if mode == MODE_HEATING else "target_temp_high")
                if temperature is not None:
                    return round(ha_temp_to_celsius(self.hass, float(temperature)), 1)
        return None

    def _device_actuation_status(self, report: AppliedCommandReport | None) -> list[dict[str, Any]]:
        """Publish every operation's plan and evidence without reconstructing commands."""
        if report is None:
            return []
        statuses = []
        for operations in report.operation_results.values():
            for result in operations:
                evidence = self._actuation_ledger.get(result.context_id)
                statuses.append(
                    {
                        "entity_id": result.entity_id,
                        "service": result.service,
                        "desired": dict(result.desired),
                        "temperature_unit": str(self.hass.config.units.temperature_unit),
                        "dispatch": result.dispatch.value,
                        "acceptance": evidence.acceptance.value if evidence else "unknown",
                        "application": evidence.application.value if evidence else "unknown",
                        "context_id": result.context_id,
                        "diagnostic": result.diagnostic,
                    }
                )
        return statuses

    def _device_observation_status(self, observation: RoomControlObservation) -> list[dict[str, Any]]:
        """Publish detached pre-actuation device settings in canonical Celsius."""
        statuses = []
        for entity_id in observation.climate_devices.all_entity_ids:
            state = observation.actuator_states.get(entity_id)
            available = state is not None and state.state not in {"unknown", "unavailable"}
            attrs = state.attributes if state is not None else {}
            status: dict[str, Any] = {
                "entity_id": entity_id,
                "available": available,
                "assumed_state": bool(attrs.get("assumed_state", False)),
                "hvac_mode": state.state if state is not None and available else None,
            }
            for attribute in ("temperature", "target_temp_low", "target_temp_high"):
                value = attrs.get(attribute)
                status[attribute] = (
                    ha_temp_to_celsius(self.hass, float(value))
                    if available and isinstance(value, int | float)
                    else None
                )
            statuses.append(status)
        return statuses

    def _read_device_temperature_observation(
        self, room: dict, *, now: datetime | None = None
    ) -> TemperatureObservation | None:
        """Read the first usable thermostat or AC temperature with its original age."""
        now = now or datetime.now(UTC)
        for entity_id in get_all_entity_ids(room.get("devices", [])):
            state = self.hass.states.get(entity_id)
            raw = read_sensor_value(self.hass, entity_id, room.get("area_id", ""), "temperature", now=now)
            if raw is None:
                continue
            observation = self._sensor_fusion.observation_from_state(
                entity_id,
                state,
                now=now,
                value_c=ha_temp_to_celsius(self.hass, raw, entity_id=entity_id),
                is_primary=True,
            )
            if observation is not None:
                return observation
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
        """Read conclusive room activity without promoting assumed state to feedback."""
        return observed_room_activity(
            self._hvac_output_observer.read_climate(entity_id)
            for entity_id in get_all_entity_ids(room.get("devices", []))
        )

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
        self._add_entity_platform_room(EntityPlatform.CLIMATE_MODE_SELECT, area_id)
        self._add_entity_platform_room(EntityPlatform.CLIMATE_CONTROL_SWITCH, area_id)

        # Cover entities: only create when covers are configured.
        # Do not remove them on save. cleanup_orphaned_entities() handles that
        # at startup so brief config changes do not break user automations.
        if has_covers:
            self._add_entity_platform_room(EntityPlatform.COVER_SWITCH, area_id)
            self._add_entity_platform_room(EntityPlatform.COVER_BINARY_SENSOR, area_id)
        if has_air_quality_sensor(room):
            self._add_entity_platform_room(EntityPlatform.AIR_QUALITY_BINARY_SENSOR, area_id)

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

        try:
            device_reg = dr.async_get(self.hass)
            device = device_reg.async_get_device(identifiers={(DOMAIN, area_id)})
            if device is not None:
                device_reg.async_remove_device(device.id)
        except Exception:  # noqa: BLE001
            pass

        # Clean up in-memory state
        self._window_manager.remove_room(area_id)
        self._previous_modes.pop(area_id, None)
        self._last_valid_temps.pop(area_id, None)
        self._ekf_training.remove_room(area_id)
        self._inverter_regime.reset_room(area_id)
        self._coil_dry_manager.remove_room(area_id)
        self._air_quality.remove_room(area_id)
        self._prev_slope_sample.pop(area_id, None)
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

        The coordinator calls this at startup to clean up entities from
        removed features.
        """
        from homeassistant.helpers import entity_registry as er

        store = self.hass.data[DOMAIN]["store"]
        rooms = store.get_rooms()
        registry = er.async_get(self.hass)

        # Known valid suffixes for each condition
        always_valid = ("_target_temp", "_mode", "_override", "_comfort", "_climate_control", "_climate_mode")
        cover_only = ("_cover_auto", "_cover_paused")
        aq_only = ("_air_quality",)
        # Global entities (not per-room) that should never be cleaned up
        global_uids = {f"{DOMAIN}_vacation", f"{DOMAIN}_climate_control"}

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
            if suffix in aq_only and has_air_quality_sensor(room):
                continue

            # Entity does not match any valid type — orphaned
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
        tonight_override: str | None = None,
        sleep_device_heating: bool = False,
    ) -> ControlTargetPlan:
        """Prepare targets while keeping the schedule cache coordinator-owned."""
        return await prepare_control_target_plan(
            self.hass,
            room,
            settings,
            schedule_blocks_cache=self._schedule_blocks_cache,
            mold_prevention_active=mold_prevention_active,
            mold_prevention_delta=mold_prevention_delta,
            tonight_override=tonight_override,
            sleep_device_heating=sleep_device_heating,
            price_signal=self._price_manager.signal,
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

    async def _async_control_master_devices(
        self,
        room_states: dict[str, dict],
        rooms_config: dict[str, dict],
        settings: dict,
    ) -> None:
        """Control master devices based on aggregate demand from member rooms."""
        await self._master_device_manager.async_control_master_devices(
            room_states,
            rooms_config,
            settings,
            outdoor_temp_effective=self.outdoor_temp_effective,
        )
