import type {
  AirflowDeviceConfig,
  ClimateMode,
  CoverScheduleEntry,
  DeviceConfig,
  DeviceRole,
  DeviceType,
  RoomConfig,
  ScheduleEntry,
} from "../types";

export interface RoomConfigDraft {
  devices: DeviceConfig[];
  airflowDevices: AirflowDeviceConfig[];
  roomVolumeM3: number | null;
  controlTarget: "air_temperature" | "perceived_temperature";
  quietHours: { start: string; end: string } | null;
  nightModeEnabled: boolean;
  nightControls: RoomConfig["night_controls"];
  nightAllowRapidRecovery: boolean;
  rapidRecoveryDeltaC: number;
  maxFanLevelNight: number;
  sleepTempRampC: number;
  adjacentRooms: RoomConfig["adjacent_rooms"];
  selectedTempSensor: string;
  selectedTempSensors: Set<string>;
  selectedHumiditySensor: string;
  selectedHumiditySensors: Set<string>;
  selectedOccupancySensors: Set<string>;
  selectedWindowSensors: Set<string>;
  windowOpenDelay: number;
  windowCloseDelay: number;
  climateMode: ClimateMode;
  schedules: ScheduleEntry[];
  scheduleSelectorEntity: string;
  comfortHeat: number;
  comfortCool: number;
  ecoHeat: number;
  ecoCool: number;
  selectedPresencePersons: string[];
  displayName: string;
  selectedCovers: Set<string>;
  coversAutoEnabled: boolean;
  coversDeployThreshold: number;
  coversMinPosition: number;
  coversOverrideMinutes: number;
  coverSchedules: CoverScheduleEntry[];
  coverScheduleSelectorEntity: string;
  coversNightClose: boolean;
  coversNightPosition: number;
  coversSnapDeploy: boolean;
  coverOrientations: Record<string, number>;
  coversNightCloseElevation: number;
  coversNightCloseOffsetMinutes: number;
  coversOutdoorMinTemp: number | null;
  coverMinPositions: Record<string, number>;
  ignorePresence: boolean;
  isOutdoor: boolean;
  valveProtectionExclude: Set<string>;
  climateControlEnabled: boolean;
  heatSourceOrchestration: boolean;
  heatSourcePrimaryDelta: number;
  heatSourceOutdoorThreshold: number;
  heatSourceAcMinOutdoor: number;
}

export function createEmptyRoomConfigDraft(): RoomConfigDraft {
  return {
    devices: [],
    airflowDevices: [],
    roomVolumeM3: null,
    controlTarget: "air_temperature",
    quietHours: null,
    nightModeEnabled: true,
    nightControls: [],
    nightAllowRapidRecovery: true,
    rapidRecoveryDeltaC: 2.0,
    maxFanLevelNight: 0.5,
    sleepTempRampC: 0.0,
    adjacentRooms: [],
    selectedTempSensor: "",
    selectedTempSensors: new Set(),
    selectedHumiditySensor: "",
    selectedHumiditySensors: new Set(),
    selectedOccupancySensors: new Set(),
    selectedWindowSensors: new Set(),
    windowOpenDelay: 0,
    windowCloseDelay: 0,
    climateMode: "auto",
    schedules: [],
    scheduleSelectorEntity: "",
    comfortHeat: 21.0,
    comfortCool: 24.0,
    ecoHeat: 17.0,
    ecoCool: 27.0,
    selectedPresencePersons: [],
    displayName: "",
    selectedCovers: new Set(),
    coversAutoEnabled: false,
    coversDeployThreshold: 1.5,
    coversMinPosition: 0,
    coversOverrideMinutes: 60,
    coverSchedules: [],
    coverScheduleSelectorEntity: "",
    coversNightClose: false,
    coversNightPosition: 0,
    coversSnapDeploy: false,
    coverOrientations: {},
    coversNightCloseElevation: 0,
    coversNightCloseOffsetMinutes: 0,
    coversOutdoorMinTemp: 10,
    coverMinPositions: {},
    ignorePresence: false,
    isOutdoor: false,
    valveProtectionExclude: new Set(),
    climateControlEnabled: true,
    heatSourceOrchestration: false,
    heatSourcePrimaryDelta: 1.5,
    heatSourceOutdoorThreshold: 5.0,
    heatSourceAcMinOutdoor: -15.0,
  };
}

export function createRoomConfigDraft(config: RoomConfig | null): RoomConfigDraft {
  const draft = createEmptyRoomConfigDraft();
  if (!config) return draft;

  draft.devices = config.devices?.length
    ? [...config.devices]
    : [
        ...(config.thermostats ?? []).map((eid) => ({
          entity_id: eid,
          type: "trv" as DeviceType,
          role: "auto" as DeviceRole,
          heating_system_type: config.heating_system_type ?? "",
        })),
        ...(config.acs ?? []).map((eid) => ({
          entity_id: eid,
          type: "ac" as DeviceType,
          role: "auto" as DeviceRole,
        })),
      ];
  draft.airflowDevices = [...(config.airflow_devices ?? [])];
  draft.roomVolumeM3 = config.room_volume_m3 ?? null;
  draft.controlTarget = config.control_target ?? "air_temperature";
  draft.quietHours = config.quiet_hours ?? null;
  draft.nightModeEnabled = config.night_mode_enabled ?? true;
  draft.nightControls = [...(config.night_controls ?? [])];
  draft.nightAllowRapidRecovery = config.night_allow_rapid_recovery ?? true;
  draft.rapidRecoveryDeltaC = config.rapid_recovery_delta_c ?? 2.0;
  draft.maxFanLevelNight = config.max_fan_level_night ?? 0.5;
  draft.sleepTempRampC = config.sleep_temp_ramp_c ?? 0.0;
  draft.adjacentRooms = [...(config.adjacent_rooms ?? [])];
  draft.selectedTempSensor = config.temperature_sensor;
  draft.selectedTempSensors = new Set(
    config.temperature_sensors?.length
      ? config.temperature_sensors
      : config.temperature_sensor
        ? [config.temperature_sensor]
        : [],
  );
  if (draft.selectedTempSensor) {
    draft.selectedTempSensors.delete(draft.selectedTempSensor);
    draft.selectedTempSensors = new Set([draft.selectedTempSensor, ...draft.selectedTempSensors]);
  }
  draft.selectedHumiditySensor = config.humidity_sensor ?? "";
  draft.selectedHumiditySensors = new Set(
    config.humidity_sensors?.length
      ? config.humidity_sensors
      : config.humidity_sensor
        ? [config.humidity_sensor]
        : [],
  );
  if (draft.selectedHumiditySensor) {
    draft.selectedHumiditySensors.delete(draft.selectedHumiditySensor);
    draft.selectedHumiditySensors = new Set([
      draft.selectedHumiditySensor,
      ...draft.selectedHumiditySensors,
    ]);
  }
  draft.selectedOccupancySensors = new Set(config.occupancy_sensors ?? []);
  draft.selectedWindowSensors = new Set(config.window_sensors ?? []);
  draft.windowOpenDelay = config.window_open_delay ?? 0;
  draft.windowCloseDelay = config.window_close_delay ?? 0;
  draft.climateMode = config.climate_mode;
  draft.schedules = config.schedules ?? [];
  draft.scheduleSelectorEntity = config.schedule_selector_entity ?? "";
  draft.comfortHeat = config.comfort_heat ?? config.comfort_temp ?? 21.0;
  draft.comfortCool = config.comfort_cool ?? 24.0;
  draft.ecoHeat = config.eco_heat ?? config.eco_temp ?? 17.0;
  draft.ecoCool = config.eco_cool ?? 27.0;
  draft.selectedPresencePersons = config.presence_persons ?? [];
  draft.displayName = config.display_name ?? "";
  draft.selectedCovers = new Set(config.covers ?? []);
  draft.coversAutoEnabled = config.covers_auto_enabled ?? false;
  draft.coversDeployThreshold = config.covers_deploy_threshold ?? 1.5;
  draft.coversMinPosition = config.covers_min_position ?? 0;
  draft.coversOverrideMinutes = config.covers_override_minutes ?? 60;
  draft.coverSchedules = config.cover_schedules ?? [];
  draft.coverScheduleSelectorEntity = config.cover_schedule_selector_entity ?? "";
  draft.coversNightClose = config.covers_night_close ?? false;
  draft.coversNightPosition = config.covers_night_position ?? 0;
  draft.coversSnapDeploy = config.covers_snap_deploy ?? false;
  draft.coverOrientations = config.cover_orientations ?? {};
  draft.coversNightCloseElevation = config.covers_night_close_elevation ?? 0;
  draft.coversNightCloseOffsetMinutes = config.covers_night_close_offset_minutes ?? 0;
  draft.coversOutdoorMinTemp =
    config.covers_outdoor_min_temp === undefined ? 10 : config.covers_outdoor_min_temp;
  draft.coverMinPositions = config.cover_min_positions ?? {};
  draft.ignorePresence = config.ignore_presence ?? false;
  draft.isOutdoor = config.is_outdoor ?? false;
  draft.valveProtectionExclude = new Set(config.valve_protection_exclude ?? []);
  draft.climateControlEnabled = config.climate_control_enabled ?? true;
  draft.heatSourceOrchestration = config.heat_source_orchestration ?? false;
  draft.heatSourcePrimaryDelta = config.heat_source_primary_delta ?? 1.5;
  draft.heatSourceOutdoorThreshold = config.heat_source_outdoor_threshold ?? 5.0;
  draft.heatSourceAcMinOutdoor = config.heat_source_ac_min_outdoor ?? -15.0;
  return draft;
}

export function patchRoomConfigDraft(
  draft: RoomConfigDraft,
  patch: Partial<RoomConfigDraft>,
): RoomConfigDraft {
  return { ...draft, ...patch };
}

export interface DeviceConfigDraftState {
  devices: DeviceConfig[];
  valveProtectionExclude: Set<string>;
}

export function applyDeviceConfigChange(
  state: DeviceConfigDraftState,
  devices: DeviceConfig[],
): DeviceConfigDraftState {
  const oldDeviceIds = new Set(state.devices.map((device) => device.entity_id));
  const newDeviceIds = new Set(devices.map((device) => device.entity_id));
  const valveProtectionExclude = new Set(state.valveProtectionExclude);

  for (const entityId of oldDeviceIds) {
    if (!newDeviceIds.has(entityId)) {
      valveProtectionExclude.delete(entityId);
    }
  }

  for (const device of devices) {
    if (device.type !== "trv") {
      valveProtectionExclude.delete(device.entity_id);
    }
  }

  return { devices, valveProtectionExclude };
}

export interface SensorConfigDraftState {
  selectedTempSensor: string;
  selectedTempSensors: Set<string>;
  selectedHumiditySensor: string;
  selectedHumiditySensors: Set<string>;
  selectedOccupancySensors: Set<string>;
  selectedWindowSensors: Set<string>;
  windowOpenDelay: number;
  windowCloseDelay: number;
}

export type SensorConfigChangeKey =
  | "temperature_sensor"
  | "temperature_sensors"
  | "humidity_sensor"
  | "humidity_sensors"
  | "occupancy_sensors"
  | "window_sensors"
  | "window_open_delay"
  | "window_close_delay";

export function applySensorConfigChange(
  state: SensorConfigDraftState,
  key: SensorConfigChangeKey,
  value: string | string[] | number,
): SensorConfigDraftState {
  const next: SensorConfigDraftState = {
    selectedTempSensor: state.selectedTempSensor,
    selectedTempSensors: new Set(state.selectedTempSensors),
    selectedHumiditySensor: state.selectedHumiditySensor,
    selectedHumiditySensors: new Set(state.selectedHumiditySensors),
    selectedOccupancySensors: new Set(state.selectedOccupancySensors),
    selectedWindowSensors: new Set(state.selectedWindowSensors),
    windowOpenDelay: state.windowOpenDelay,
    windowCloseDelay: state.windowCloseDelay,
  };

  if (key === "temperature_sensor") {
    next.selectedTempSensor = value as string;
    next.selectedTempSensors = next.selectedTempSensor
      ? new Set([next.selectedTempSensor, ...next.selectedTempSensors])
      : new Set();
  } else if (key === "temperature_sensors") {
    const selectedTempSensors = new Set(value as string[]);
    if (next.selectedTempSensor && !selectedTempSensors.has(next.selectedTempSensor)) {
      next.selectedTempSensor = [...selectedTempSensors][0] ?? "";
    }
    if (next.selectedTempSensor) selectedTempSensors.add(next.selectedTempSensor);
    next.selectedTempSensors = selectedTempSensors;
  } else if (key === "humidity_sensor") {
    next.selectedHumiditySensor = value as string;
    next.selectedHumiditySensors = next.selectedHumiditySensor
      ? new Set([next.selectedHumiditySensor, ...next.selectedHumiditySensors])
      : new Set();
  } else if (key === "humidity_sensors") {
    const selectedHumiditySensors = new Set(value as string[]);
    if (next.selectedHumiditySensor && !selectedHumiditySensors.has(next.selectedHumiditySensor)) {
      next.selectedHumiditySensor = [...selectedHumiditySensors][0] ?? "";
    }
    if (next.selectedHumiditySensor) selectedHumiditySensors.add(next.selectedHumiditySensor);
    next.selectedHumiditySensors = selectedHumiditySensors;
  } else if (key === "occupancy_sensors") {
    next.selectedOccupancySensors = new Set(value as string[]);
  } else if (key === "window_sensors") {
    next.selectedWindowSensors = new Set(value as string[]);
  } else if (key === "window_open_delay") {
    next.windowOpenDelay = value as number;
  } else if (key === "window_close_delay") {
    next.windowCloseDelay = value as number;
  }

  return next;
}

export interface CoverSelectionDraftState {
  selectedCovers: Set<string>;
  coverOrientations: Record<string, number>;
  coverMinPositions: Record<string, number>;
}

export function applyCoverSelectionChange(
  state: CoverSelectionDraftState,
  entityId: string,
  checked: boolean,
): CoverSelectionDraftState {
  const selectedCovers = new Set(state.selectedCovers);
  const coverOrientations = { ...state.coverOrientations };
  const coverMinPositions = { ...state.coverMinPositions };

  if (checked) {
    selectedCovers.add(entityId);
  } else {
    selectedCovers.delete(entityId);
    delete coverOrientations[entityId];
    delete coverMinPositions[entityId];
  }

  return { selectedCovers, coverOrientations, coverMinPositions };
}

export function temperatureSensorIdsForSave(
  draft: Pick<RoomConfigDraft, "selectedTempSensor" | "selectedTempSensors">,
): string[] {
  const ids: string[] = [];
  if (draft.selectedTempSensor) ids.push(draft.selectedTempSensor);
  for (const id of draft.selectedTempSensors) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function humiditySensorIdsForSave(
  draft: Pick<RoomConfigDraft, "selectedHumiditySensor" | "selectedHumiditySensors">,
): string[] {
  const ids: string[] = [];
  if (draft.selectedHumiditySensor) ids.push(draft.selectedHumiditySensor);
  for (const id of draft.selectedHumiditySensors) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function buildRoomSavePayload(
  areaId: string,
  draft: RoomConfigDraft,
): Record<string, unknown> {
  return {
    type: "roommind/rooms/save",
    area_id: areaId,
    devices: draft.devices,
    airflow_devices: draft.airflowDevices,
    room_volume_m3: draft.roomVolumeM3,
    control_target: draft.controlTarget,
    quiet_hours: draft.quietHours,
    night_mode_enabled: draft.nightModeEnabled,
    night_controls: draft.nightControls ?? [],
    night_allow_rapid_recovery: draft.nightAllowRapidRecovery,
    rapid_recovery_delta_c: draft.rapidRecoveryDeltaC,
    max_fan_level_night: draft.maxFanLevelNight,
    sleep_temp_ramp_c: draft.sleepTempRampC,
    adjacent_rooms: draft.adjacentRooms ?? [],
    temperature_sensor: draft.selectedTempSensor,
    temperature_sensors: temperatureSensorIdsForSave(draft),
    humidity_sensor: draft.selectedHumiditySensor,
    humidity_sensors: humiditySensorIdsForSave(draft),
    occupancy_sensors: [...draft.selectedOccupancySensors],
    window_sensors: [...draft.selectedWindowSensors],
    window_open_delay: draft.windowOpenDelay,
    window_close_delay: draft.windowCloseDelay,
    climate_mode: draft.climateMode,
    schedules: draft.schedules,
    schedule_selector_entity: draft.scheduleSelectorEntity,
    comfort_heat: draft.comfortHeat,
    comfort_cool: draft.comfortCool,
    eco_heat: draft.ecoHeat,
    eco_cool: draft.ecoCool,
    presence_persons: draft.selectedPresencePersons.filter((person) => person),
    display_name: draft.displayName,
    covers: [...draft.selectedCovers],
    climate_control_enabled: draft.climateControlEnabled,
    covers_auto_enabled: draft.coversAutoEnabled,
    covers_deploy_threshold: draft.coversDeployThreshold,
    covers_min_position: draft.coversMinPosition,
    covers_override_minutes: draft.coversOverrideMinutes,
    cover_schedules: draft.coverSchedules,
    cover_schedule_selector_entity: draft.coverScheduleSelectorEntity,
    covers_night_close: draft.coversNightClose,
    covers_night_position: draft.coversNightPosition,
    covers_snap_deploy: draft.coversSnapDeploy,
    cover_orientations: draft.coverOrientations,
    covers_night_close_elevation: draft.coversNightCloseElevation,
    covers_night_close_offset_minutes: draft.coversNightCloseOffsetMinutes,
    covers_outdoor_min_temp: draft.coversOutdoorMinTemp,
    cover_min_positions: draft.coverMinPositions,
    ignore_presence: draft.ignorePresence,
    is_outdoor: draft.isOutdoor,
    valve_protection_exclude: [...draft.valveProtectionExclude],
    heat_source_orchestration: draft.heatSourceOrchestration,
    heat_source_primary_delta: draft.heatSourcePrimaryDelta,
    heat_source_outdoor_threshold: draft.heatSourceOutdoorThreshold,
    heat_source_ac_min_outdoor: draft.heatSourceAcMinOutdoor,
  };
}
