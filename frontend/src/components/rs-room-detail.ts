import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  HassArea,
  RoomConfig,
  ClimateMode,
  ScheduleEntry,
  CoverScheduleEntry,
  DeviceConfig,
  AirflowDeviceConfig,
} from "../types";
import "./rs-hero-status";
import "./rs-climate-mode-selector";
import "./rs-schedule-settings";
import "./rs-section-card";
import "./rs-room-configuration-hub";
import "./rs-room-edit-dialog-router";
import "./rs-override-section";
import "../components/shared/rs-toggle-row";
import "../components/shared/rs-toggle-card";
import "../components/shared/rs-info-icon";
import { localize } from "../utils/localize";
import { fireSaveStatus } from "../utils/events";
import { formatMode } from "../utils/room-state";
import { formatTemp, tempUnit } from "../utils/temperature";
import {
  getRoomDetailLayout,
  type ConfigurationRoomSection,
  type PrimaryRoomSection,
} from "../utils/room-detail-layout";
import {
  applyCoverSelectionChange,
  applyDeviceConfigChange,
  applySensorConfigChange,
  buildRoomSavePayload,
  createEmptyRoomConfigDraft,
  createRoomConfigDraft,
  patchRoomConfigDraft,
  temperatureSensorIdsForSave,
  type RoomConfigDraft,
  type SensorConfigChangeKey,
} from "../utils/room-config-draft";
import type { RoomEditSection } from "../utils/room-edit-dialog";
import type { RsOverrideSection } from "./rs-override-section";

@customElement("rs-room-detail")
export class RsRoomDetail extends LitElement {
  @property({ attribute: false }) public area!: HassArea;
  @property({ attribute: false }) public config: RoomConfig | null = null;
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ type: Boolean }) public presenceEnabled = false;
  @property({ attribute: false }) public presencePersons: string[] = [];
  @property({ type: Boolean }) public climateControlActive = true;

  @property({ type: Boolean }) public valveProtectionEnabled = false;

  @state() private _draft: RoomConfigDraft = createEmptyRoomConfigDraft();
  @state() private _error = "";
  @state() private _dirty = false;
  @state() private _editing: RoomEditSection | null = null;

  private _prevAreaId: string | null = null;
  private _saveDebounce?: ReturnType<typeof setTimeout>;

  static override styles = css`
    :host {
      display: block;
      max-width: 2400px;
      margin: 0 auto;
    }

    .detail-layout {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr));
      gap: 14px;
      align-items: start;
    }

    .detail-grid > * {
      display: block;
      width: 100%;
    }

    rs-room-edit-dialog-router {
      position: fixed;
      inset: 0;
      z-index: 10000;
      pointer-events: none;
    }

    rs-room-edit-dialog-router rs-edit-dialog {
      pointer-events: auto;
    }

    .status-summary {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
      padding: 10px;
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.08));
      border-radius: var(--roommind-radius-card, 8px);
      background: rgba(255, 255, 255, 0.025);
    }

    .status-item {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      gap: 8px;
      align-items: center;
      min-width: 0;
      min-height: 48px;
      padding: 8px;
      border-radius: var(--roommind-radius-control, 8px);
      background: rgba(255, 255, 255, 0.025);
    }

    .status-item ha-icon {
      --mdc-icon-size: 20px;
      color: var(--secondary-text-color);
    }

    .status-copy {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .status-label {
      color: var(--secondary-text-color);
      font-size: 11px;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .status-value {
      color: var(--primary-text-color);
      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    @media (min-width: 1900px) {
      .detail-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .status-summary {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .detail-grid {
        grid-template-columns: 1fr;
        gap: 12px;
      }
    }

    @media (max-width: 420px) {
      .status-summary {
        grid-template-columns: 1fr;
      }
    }

    /* Section cards handled by rs-section-card */

    /* YAML code block for info panels (slotted into edit dialogs) */
    .yaml-block {
      background: var(--code-editor-background-color, rgba(0, 0, 0, 0.35));
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.12));
      border-radius: 6px;
      padding: 10px 14px;
      margin: 8px 0;
      font-family: var(--code-font-family, monospace);
      font-size: 12px;
      line-height: 1.6;
      white-space: pre;
      overflow-x: auto;
      color: var(--primary-text-color);
    }
    .yaml-key {
      color: #82aaff;
    }
    .yaml-value {
      color: #e2a76a;
    }

    /* Actions */
    .actions {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 8px;
      margin-bottom: 24px;
    }

    .error {
      color: var(--error-color, #d32f2f);
      font-size: 13px;
      margin-top: 8px;
    }

    .field-hint {
      color: var(--secondary-text-color);
      font-size: 12px;
    }

    .exceptions-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: none;
      border: none;
      padding: 8px 0 0;
      margin: 0;
      cursor: pointer;
      font-size: 13px;
      color: var(--primary-color);
      font-family: inherit;
    }

    .exceptions-link:hover {
      text-decoration: underline;
    }

    .helper-link {
      display: inline-block;
      margin-top: 12px;
      color: var(--primary-color);
      font-size: 12px;
      text-decoration: none;
    }

    .helper-link:hover {
      text-decoration: underline;
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
    this._initFromConfig();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this._saveDebounce) clearTimeout(this._saveDebounce);
  }

  override updated(changedProps: Map<string, unknown>) {
    const currentAreaId = this.config?.area_id ?? this.area?.area_id ?? null;
    const areaChanged = currentAreaId !== this._prevAreaId;

    if (areaChanged) {
      this._initFromConfig();
      this._prevAreaId = currentAreaId;
    } else if (changedProps.has("config") && !this._dirty) {
      const prevConfig = changedProps.get("config") as RoomConfig | null | undefined;
      if (prevConfig === null || prevConfig === undefined) {
        this._initFromConfig();
      }
    }
  }

  private _initFromConfig() {
    this._applyDraft(createRoomConfigDraft(this.config));
    this._dirty = false;

    // Unconfigured rooms open the device-edit dialog automatically.
    if (this._devices.length === 0 && this._editing === null) {
      this._editing = "devices";
    }
  }

  private _applyDraft(draft: RoomConfigDraft) {
    this._draft = draft;
  }

  private _currentDraft(): RoomConfigDraft {
    return this._draft;
  }

  private _patchDraft(patch: Partial<RoomConfigDraft>) {
    this._draft = patchRoomConfigDraft(this._draft, patch);
  }

  private get _devices() {
    return this._draft.devices;
  }
  private set _devices(devices: DeviceConfig[]) {
    this._patchDraft({ devices });
  }
  private get _airflowDevices() {
    return this._draft.airflowDevices;
  }
  private set _airflowDevices(airflowDevices: AirflowDeviceConfig[]) {
    this._patchDraft({ airflowDevices });
  }
  private get _roomVolumeM3() {
    return this._draft.roomVolumeM3;
  }
  private set _roomVolumeM3(roomVolumeM3: number | null) {
    this._patchDraft({ roomVolumeM3 });
  }
  private get _controlTarget() {
    return this._draft.controlTarget;
  }
  private set _controlTarget(controlTarget: RoomConfigDraft["controlTarget"]) {
    this._patchDraft({ controlTarget });
  }
  private get _quietHours() {
    return this._draft.quietHours;
  }
  private set _quietHours(quietHours: RoomConfigDraft["quietHours"]) {
    this._patchDraft({ quietHours });
  }
  private get _nightModeEnabled() {
    return this._draft.nightModeEnabled;
  }
  private set _nightModeEnabled(nightModeEnabled: boolean) {
    this._patchDraft({ nightModeEnabled });
  }
  private get _nightControls() {
    return this._draft.nightControls;
  }
  private set _nightControls(nightControls: RoomConfig["night_controls"]) {
    this._patchDraft({ nightControls });
  }
  private get _nightAllowRapidRecovery() {
    return this._draft.nightAllowRapidRecovery;
  }
  private set _nightAllowRapidRecovery(nightAllowRapidRecovery: boolean) {
    this._patchDraft({ nightAllowRapidRecovery });
  }
  private get _rapidRecoveryDeltaC() {
    return this._draft.rapidRecoveryDeltaC;
  }
  private set _rapidRecoveryDeltaC(rapidRecoveryDeltaC: number) {
    this._patchDraft({ rapidRecoveryDeltaC });
  }
  private get _maxFanLevelNight() {
    return this._draft.maxFanLevelNight;
  }
  private set _maxFanLevelNight(maxFanLevelNight: number) {
    this._patchDraft({ maxFanLevelNight });
  }
  private get _sleepTempRampC() {
    return this._draft.sleepTempRampC;
  }
  private set _sleepTempRampC(sleepTempRampC: number) {
    this._patchDraft({ sleepTempRampC });
  }
  private get _adjacentRooms() {
    return this._draft.adjacentRooms;
  }
  private set _adjacentRooms(adjacentRooms: RoomConfig["adjacent_rooms"]) {
    this._patchDraft({ adjacentRooms });
  }
  private get _selectedTempSensor() {
    return this._draft.selectedTempSensor;
  }
  private set _selectedTempSensor(selectedTempSensor: string) {
    this._patchDraft({ selectedTempSensor });
  }
  private get _selectedTempSensors() {
    return this._draft.selectedTempSensors;
  }
  private set _selectedTempSensors(selectedTempSensors: Set<string>) {
    this._patchDraft({ selectedTempSensors });
  }
  private get _selectedHumiditySensor() {
    return this._draft.selectedHumiditySensor;
  }
  private set _selectedHumiditySensor(selectedHumiditySensor: string) {
    this._patchDraft({ selectedHumiditySensor });
  }
  private get _selectedOccupancySensors() {
    return this._draft.selectedOccupancySensors;
  }
  private set _selectedOccupancySensors(selectedOccupancySensors: Set<string>) {
    this._patchDraft({ selectedOccupancySensors });
  }
  private get _selectedWindowSensors() {
    return this._draft.selectedWindowSensors;
  }
  private set _selectedWindowSensors(selectedWindowSensors: Set<string>) {
    this._patchDraft({ selectedWindowSensors });
  }
  private get _windowOpenDelay() {
    return this._draft.windowOpenDelay;
  }
  private set _windowOpenDelay(windowOpenDelay: number) {
    this._patchDraft({ windowOpenDelay });
  }
  private get _windowCloseDelay() {
    return this._draft.windowCloseDelay;
  }
  private set _windowCloseDelay(windowCloseDelay: number) {
    this._patchDraft({ windowCloseDelay });
  }
  private get _climateMode() {
    return this._draft.climateMode;
  }
  private set _climateMode(climateMode: ClimateMode) {
    this._patchDraft({ climateMode });
  }
  private get _schedules() {
    return this._draft.schedules;
  }
  private set _schedules(schedules: ScheduleEntry[]) {
    this._patchDraft({ schedules });
  }
  private get _scheduleSelectorEntity() {
    return this._draft.scheduleSelectorEntity;
  }
  private set _scheduleSelectorEntity(scheduleSelectorEntity: string) {
    this._patchDraft({ scheduleSelectorEntity });
  }
  private get _comfortHeat() {
    return this._draft.comfortHeat;
  }
  private set _comfortHeat(comfortHeat: number) {
    this._patchDraft({ comfortHeat });
  }
  private get _comfortCool() {
    return this._draft.comfortCool;
  }
  private set _comfortCool(comfortCool: number) {
    this._patchDraft({ comfortCool });
  }
  private get _ecoHeat() {
    return this._draft.ecoHeat;
  }
  private set _ecoHeat(ecoHeat: number) {
    this._patchDraft({ ecoHeat });
  }
  private get _ecoCool() {
    return this._draft.ecoCool;
  }
  private set _ecoCool(ecoCool: number) {
    this._patchDraft({ ecoCool });
  }
  private get _selectedPresencePersons() {
    return this._draft.selectedPresencePersons;
  }
  private set _selectedPresencePersons(selectedPresencePersons: string[]) {
    this._patchDraft({ selectedPresencePersons });
  }
  private get _displayName() {
    return this._draft.displayName;
  }
  private set _displayName(displayName: string) {
    this._patchDraft({ displayName });
  }
  private get _selectedCovers() {
    return this._draft.selectedCovers;
  }
  private set _selectedCovers(selectedCovers: Set<string>) {
    this._patchDraft({ selectedCovers });
  }
  private get _coversAutoEnabled() {
    return this._draft.coversAutoEnabled;
  }
  private set _coversAutoEnabled(coversAutoEnabled: boolean) {
    this._patchDraft({ coversAutoEnabled });
  }
  private get _coversDeployThreshold() {
    return this._draft.coversDeployThreshold;
  }
  private set _coversDeployThreshold(coversDeployThreshold: number) {
    this._patchDraft({ coversDeployThreshold });
  }
  private get _coversMinPosition() {
    return this._draft.coversMinPosition;
  }
  private set _coversMinPosition(coversMinPosition: number) {
    this._patchDraft({ coversMinPosition });
  }
  private get _coversOverrideMinutes() {
    return this._draft.coversOverrideMinutes;
  }
  private set _coversOverrideMinutes(coversOverrideMinutes: number) {
    this._patchDraft({ coversOverrideMinutes });
  }
  private get _coverSchedules() {
    return this._draft.coverSchedules;
  }
  private set _coverSchedules(coverSchedules: CoverScheduleEntry[]) {
    this._patchDraft({ coverSchedules });
  }
  private get _coverScheduleSelectorEntity() {
    return this._draft.coverScheduleSelectorEntity;
  }
  private set _coverScheduleSelectorEntity(coverScheduleSelectorEntity: string) {
    this._patchDraft({ coverScheduleSelectorEntity });
  }
  private get _coversNightClose() {
    return this._draft.coversNightClose;
  }
  private set _coversNightClose(coversNightClose: boolean) {
    this._patchDraft({ coversNightClose });
  }
  private get _coversNightPosition() {
    return this._draft.coversNightPosition;
  }
  private set _coversNightPosition(coversNightPosition: number) {
    this._patchDraft({ coversNightPosition });
  }
  private get _coversSnapDeploy() {
    return this._draft.coversSnapDeploy;
  }
  private set _coversSnapDeploy(coversSnapDeploy: boolean) {
    this._patchDraft({ coversSnapDeploy });
  }
  private get _coverOrientations() {
    return this._draft.coverOrientations;
  }
  private set _coverOrientations(coverOrientations: Record<string, number>) {
    this._patchDraft({ coverOrientations });
  }
  private get _coversNightCloseElevation() {
    return this._draft.coversNightCloseElevation;
  }
  private set _coversNightCloseElevation(coversNightCloseElevation: number) {
    this._patchDraft({ coversNightCloseElevation });
  }
  private get _coversNightCloseOffsetMinutes() {
    return this._draft.coversNightCloseOffsetMinutes;
  }
  private set _coversNightCloseOffsetMinutes(coversNightCloseOffsetMinutes: number) {
    this._patchDraft({ coversNightCloseOffsetMinutes });
  }
  private get _coversOutdoorMinTemp() {
    return this._draft.coversOutdoorMinTemp;
  }
  private set _coversOutdoorMinTemp(coversOutdoorMinTemp: number | null) {
    this._patchDraft({ coversOutdoorMinTemp });
  }
  private get _coverMinPositions() {
    return this._draft.coverMinPositions;
  }
  private set _coverMinPositions(coverMinPositions: Record<string, number>) {
    this._patchDraft({ coverMinPositions });
  }
  private get _ignorePresence() {
    return this._draft.ignorePresence;
  }
  private set _ignorePresence(ignorePresence: boolean) {
    this._patchDraft({ ignorePresence });
  }
  private get _isOutdoor() {
    return this._draft.isOutdoor;
  }
  private set _isOutdoor(isOutdoor: boolean) {
    this._patchDraft({ isOutdoor });
  }
  private get _valveProtectionExclude() {
    return this._draft.valveProtectionExclude;
  }
  private set _valveProtectionExclude(valveProtectionExclude: Set<string>) {
    this._patchDraft({ valveProtectionExclude });
  }
  private get _climateControlEnabled() {
    return this._draft.climateControlEnabled;
  }
  private set _climateControlEnabled(climateControlEnabled: boolean) {
    this._patchDraft({ climateControlEnabled });
  }
  private get _heatSourceOrchestration() {
    return this._draft.heatSourceOrchestration;
  }
  private set _heatSourceOrchestration(heatSourceOrchestration: boolean) {
    this._patchDraft({ heatSourceOrchestration });
  }
  private get _heatSourcePrimaryDelta() {
    return this._draft.heatSourcePrimaryDelta;
  }
  private set _heatSourcePrimaryDelta(heatSourcePrimaryDelta: number) {
    this._patchDraft({ heatSourcePrimaryDelta });
  }
  private get _heatSourceOutdoorThreshold() {
    return this._draft.heatSourceOutdoorThreshold;
  }
  private set _heatSourceOutdoorThreshold(heatSourceOutdoorThreshold: number) {
    this._patchDraft({ heatSourceOutdoorThreshold });
  }
  private get _heatSourceAcMinOutdoor() {
    return this._draft.heatSourceAcMinOutdoor;
  }
  private set _heatSourceAcMinOutdoor(heatSourceAcMinOutdoor: number) {
    this._patchDraft({ heatSourceAcMinOutdoor });
  }

  private _openEdit = (section: RoomEditSection) => () => {
    this._editing = section;
  };

  private _closeEdit = () => {
    this._editing = null;
  };

  /** Expose effective override for hero-status via the override sub-component. */
  private _getEffectiveOverride(): {
    active: boolean;
    type: import("../types").OverrideType | null;
    temp: number | null;
    until: number | null;
  } {
    const overrideEl = this.shadowRoot?.querySelector(
      "rs-override-section",
    ) as RsOverrideSection | null;
    if (overrideEl) {
      return overrideEl.getEffectiveOverride();
    }
    // Fallback before sub-component mounts
    const live = this.config?.live;
    if (live?.override_active && live.override_type) {
      return {
        active: true,
        type: live.override_type,
        temp: live.override_temp,
        until: live.override_until,
      };
    }
    return { active: false, type: null, temp: null, until: null };
  }

  private _configurationMetrics() {
    return {
      deviceCount: this._devices.length,
      temperatureSensorCount: this._temperatureSensorIdsForSave().length,
      humiditySensorConfigured: !!this._selectedHumiditySensor,
      occupancySensorCount: this._selectedOccupancySensors.size,
      windowSensorCount: this._selectedWindowSensors.size,
      primaryTemperatureSensorName: this._entityName(this._selectedTempSensor),
      quietHours: this._quietHours,
      nightModeEnabled: this._nightModeEnabled,
      airflowDeviceCount: this._airflowDevices.length,
      presencePersonCount: this._selectedPresencePersons.length,
      coverCount: this._selectedCovers.size,
      heatSourceOrchestration: this._heatSourceOrchestration,
    };
  }

  private _onConfigurationEdit(
    e: CustomEvent<{ section: Exclude<ConfigurationRoomSection, "outdoor"> }>,
  ) {
    this._editing = e.detail.section;
  }

  override render() {
    if (!this.area) return nothing;
    const layout = getRoomDetailLayout({
      isOutdoor: this._isOutdoor,
      presenceAvailable: this.presenceEnabled && this.presencePersons.length > 0,
      hasTemperatureSensor: !!this._selectedTempSensor,
      devices: this._devices,
    });

    return html`
      <div class="detail-layout">
        <rs-hero-status
          .hass=${this.hass}
          .area=${this.area}
          .config=${this.config}
          .isOutdoor=${this._isOutdoor}
          .overrideInfo=${this._getEffectiveOverride()}
          .climateControlActive=${this.climateControlActive && this._climateControlEnabled}
          @display-name-changed=${this._onDisplayNameChanged}
        ></rs-hero-status>
        ${!this._isOutdoor ? this._renderStatusSummary() : nothing}

        <div class="detail-grid">
          ${layout.primarySections.map((section) => this._renderPrimarySection(section))}
          <rs-room-configuration-hub
            .sections=${layout.configurationSections}
            .metrics=${this._configurationMetrics()}
            .isOutdoor=${this._isOutdoor}
            .language=${this.hass.language}
            @configuration-edit=${this._onConfigurationEdit}
            @outdoor-changed=${this._onOutdoorToggle}
          ></rs-room-configuration-hub>
        </div>
        ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
        <rs-room-edit-dialog-router
          .editing=${this._editing}
          .hass=${this.hass}
          .area=${this.area}
          .config=${this.config}
          .draft=${this._draft}
          .presenceEnabled=${this.presenceEnabled}
          .presencePersons=${this.presencePersons}
          .valveProtectionEnabled=${this.valveProtectionEnabled}
          @edit-closed=${this._closeEdit}
          @schedules-changed=${this._onSchedulesChanged}
          @schedule-selector-changed=${this._onScheduleSelectorChanged}
          @comfort-heat-changed=${this._onComfortHeatChanged}
          @comfort-cool-changed=${this._onComfortCoolChanged}
          @eco-heat-changed=${this._onEcoHeatChanged}
          @eco-cool-changed=${this._onEcoCoolChanged}
          @device-changed=${this._onDeviceChanged}
          @valve-protection-exclude-toggle=${this._onValveProtectionExcludeToggle}
          @sensor-changed=${this._onSensorChanged}
          @airflow-devices-changed=${this._onAirflowDevicesChanged}
          @comfort-setting-changed=${this._onComfortSettingChanged}
          @presence-persons-changed=${this._onPresencePersonsChanged}
          @ignore-presence-changed=${this._onIgnorePresenceChanged}
          @covers-toggle=${this._onCoversToggle}
          @cover-setting-changed=${this._onCoverSettingChanged}
          @heat-source-setting-changed=${this._onHeatSourceSettingChanged}
        ></rs-room-edit-dialog-router>
      </div>
    `;
  }

  private _renderStatusSummary() {
    const live = this.config?.live;
    const unit = tempUnit(this.hass);
    const mode = live?.mode ?? "idle";
    const targetValue = this._formatTarget(live);
    const nightValue = live?.night_mode?.active
      ? localize("room.status.night_active", this.hass.language)
      : this._quietHours
        ? localize("room.status.night_scheduled", this.hass.language, {
            hours: `${this._quietHours.start}-${this._quietHours.end}`,
          })
        : localize("room.status.not_set", this.hass.language);
    const sensorValue =
      this._entityName(this._selectedTempSensor) ||
      localize("room.status.not_set", this.hass.language);
    const setpointValue =
      live?.device_setpoint != null
        ? `${formatTemp(live.device_setpoint, this.hass)}${unit}`
        : localize("room.status.not_set", this.hass.language);

    return html`
      <div class="status-summary">
        ${this._renderStatusItem(
          "mdi:state-machine",
          localize("room.status.action", this.hass.language),
          formatMode(mode, this.hass.language),
        )}
        ${this._renderStatusItem(
          "mdi:target",
          localize("room.status.target", this.hass.language),
          targetValue,
        )}
        ${this._renderStatusItem(
          "mdi:weather-night",
          localize("room.status.night", this.hass.language),
          nightValue,
        )}
        ${this._renderStatusItem(
          "mdi:thermometer",
          localize("room.status.primary_sensor", this.hass.language),
          sensorValue,
        )}
        ${this._renderStatusItem(
          "mdi:tune-vertical",
          localize("room.status.device_setpoint", this.hass.language),
          setpointValue,
        )}
      </div>
    `;
  }

  private _renderStatusItem(icon: string, label: string, value: string) {
    return html`
      <div class="status-item">
        <ha-icon icon=${icon}></ha-icon>
        <span class="status-copy">
          <span class="status-label">${label}</span>
          <span class="status-value" title=${value}>${value}</span>
        </span>
      </div>
    `;
  }

  private _formatTarget(live: RoomConfig["live"] | undefined): string {
    const unit = tempUnit(this.hass);
    if (!live) return localize("room.status.not_set", this.hass.language);
    if (
      live.heat_target != null &&
      live.cool_target != null &&
      live.heat_target !== live.cool_target
    ) {
      return `${formatTemp(live.heat_target, this.hass)}-${formatTemp(live.cool_target, this.hass)}${unit}`;
    }
    const target = live.target_temp ?? live.heat_target ?? live.cool_target;
    return target != null
      ? `${formatTemp(target, this.hass)}${unit}`
      : localize("room.status.not_set", this.hass.language);
  }

  private _entityName(entityId: string): string {
    if (!entityId) return "";
    return (this.hass.states[entityId]?.attributes?.friendly_name as string) || entityId;
  }

  private _renderPrimarySection(section: PrimaryRoomSection) {
    switch (section) {
      case "climateControl":
        return html`
          <rs-toggle-card
            icon="mdi:power"
            .label=${localize("room.climate_control_toggle", this.hass.language)}
            .hint=${localize("room.climate_control_hint", this.hass.language)}
            .checked=${this._climateControlEnabled}
            @toggle-changed=${this._onClimateControlToggle}
          ></rs-toggle-card>
        `;
      case "climateMode":
        return html`
          <rs-section-card
            icon="mdi:cog"
            .heading=${localize("room.section.climate_mode", this.hass.language)}
          >
            <rs-info-icon
              slot="header-extras"
              .label=${localize("common.info", this.hass.language)}
            >
              <b>${localize("mode.auto", this.hass.language)}</b> —
              ${localize("mode.auto_desc", this.hass.language)}<br />
              <b>${localize("mode.heat_only", this.hass.language)}</b> —
              ${localize("mode.heat_only_desc", this.hass.language)}<br />
              <b>${localize("mode.cool_only", this.hass.language)}</b> —
              ${localize("mode.cool_only_desc", this.hass.language)}
            </rs-info-icon>
            <rs-climate-mode-selector
              .climateMode=${this._climateMode}
              .language=${this.hass.language}
              @mode-changed=${this._onModeChanged}
            ></rs-climate-mode-selector>
          </rs-section-card>
        `;
      case "schedule":
        return html`
          <rs-section-card
            icon="mdi:calendar"
            .heading=${localize("room.section.schedule", this.hass.language)}
            editable
            @edit-click=${this._openEdit("schedule")}
          >
            <rs-schedule-settings
              .hass=${this.hass}
              .schedules=${this._schedules}
              .scheduleSelectorEntity=${this._scheduleSelectorEntity}
              .activeScheduleIndex=${this.config?.live?.active_schedule_index ?? -1}
              .comfortHeat=${this._comfortHeat}
              .comfortCool=${this._comfortCool}
              .ecoHeat=${this._ecoHeat}
              .ecoCool=${this._ecoCool}
              .climateMode=${this._climateMode}
              .editing=${false}
              @schedules-changed=${this._onSchedulesChanged}
              @schedule-selector-changed=${this._onScheduleSelectorChanged}
              @comfort-heat-changed=${this._onComfortHeatChanged}
              @comfort-cool-changed=${this._onComfortCoolChanged}
              @eco-heat-changed=${this._onEcoHeatChanged}
              @eco-cool-changed=${this._onEcoCoolChanged}
            ></rs-schedule-settings>
            ${this.config
              ? html`
                  <rs-override-section
                    .hass=${this.hass}
                    .config=${this.config}
                    .climateMode=${this._climateMode}
                    .comfortHeat=${this._comfortHeat}
                    .comfortCool=${this._comfortCool}
                    .ecoHeat=${this._ecoHeat}
                    .ecoCool=${this._ecoCool}
                    .language=${this.hass.language}
                  ></rs-override-section>
                `
              : nothing}
          </rs-section-card>
        `;
    }
  }

  // ---- Child event handlers ----

  private _onModeChanged(e: CustomEvent<{ mode: ClimateMode }>) {
    this._climateMode = e.detail.mode;
    this._autoSave();
  }

  private _onSchedulesChanged(e: CustomEvent<{ value: ScheduleEntry[] }>) {
    this._schedules = e.detail.value;
    this._autoSave();
  }

  private _onScheduleSelectorChanged(e: CustomEvent<{ value: string }>) {
    this._scheduleSelectorEntity = e.detail.value;
    this._autoSave();
  }

  private _onComfortHeatChanged(e: CustomEvent<{ value: number }>) {
    this._comfortHeat = e.detail.value;
    if (this._comfortCool < this._comfortHeat) this._comfortCool = this._comfortHeat;
    this._autoSave();
  }

  private _onComfortCoolChanged(e: CustomEvent<{ value: number }>) {
    this._comfortCool = e.detail.value;
    if (this._comfortHeat > this._comfortCool) this._comfortHeat = this._comfortCool;
    this._autoSave();
  }

  private _onEcoHeatChanged(e: CustomEvent<{ value: number }>) {
    this._ecoHeat = e.detail.value;
    if (this._ecoCool < this._ecoHeat) this._ecoCool = this._ecoHeat;
    this._autoSave();
  }

  private _onEcoCoolChanged(e: CustomEvent<{ value: number }>) {
    this._ecoCool = e.detail.value;
    if (this._ecoHeat > this._ecoCool) this._ecoHeat = this._ecoCool;
    this._autoSave();
  }

  private _onDeviceChanged(e: CustomEvent<{ devices: DeviceConfig[] }>) {
    const next = applyDeviceConfigChange(
      {
        devices: this._devices,
        valveProtectionExclude: this._valveProtectionExclude,
      },
      e.detail.devices,
    );
    this._devices = next.devices;
    this._valveProtectionExclude = next.valveProtectionExclude;
    this._autoSave();
  }

  private _onAirflowDevicesChanged(e: CustomEvent<{ devices: AirflowDeviceConfig[] }>) {
    this._airflowDevices = e.detail.devices;
    this._autoSave();
  }

  private _onComfortSettingChanged(e: CustomEvent<{ key: string; value: unknown }>) {
    const { key, value } = e.detail;
    e.stopPropagation();
    if (key === "room_volume_m3") this._roomVolumeM3 = value as number | null;
    else if (key === "control_target")
      this._controlTarget = value as "air_temperature" | "perceived_temperature";
    else if (key === "quiet_hours") this._quietHours = value as { start: string; end: string };
    else if (key === "night_mode_enabled") this._nightModeEnabled = value as boolean;
    else if (key === "night_controls") this._nightControls = value as RoomConfig["night_controls"];
    else if (key === "night_allow_rapid_recovery") this._nightAllowRapidRecovery = value as boolean;
    else if (key === "rapid_recovery_delta_c") this._rapidRecoveryDeltaC = value as number;
    else if (key === "max_fan_level_night") this._maxFanLevelNight = value as number;
    else if (key === "sleep_temp_ramp_c") this._sleepTempRampC = value as number;
    else if (key === "adjacent_rooms") this._adjacentRooms = value as RoomConfig["adjacent_rooms"];
    this._autoSave();
  }

  private _onSensorChanged(e: CustomEvent<{ key: string; value: string | string[] | number }>) {
    const { key, value } = e.detail;
    const next = applySensorConfigChange(
      {
        selectedTempSensor: this._selectedTempSensor,
        selectedTempSensors: this._selectedTempSensors,
        selectedHumiditySensor: this._selectedHumiditySensor,
        selectedOccupancySensors: this._selectedOccupancySensors,
        selectedWindowSensors: this._selectedWindowSensors,
        windowOpenDelay: this._windowOpenDelay,
        windowCloseDelay: this._windowCloseDelay,
      },
      key as SensorConfigChangeKey,
      value,
    );
    this._selectedTempSensor = next.selectedTempSensor;
    this._selectedTempSensors = next.selectedTempSensors;
    this._selectedHumiditySensor = next.selectedHumiditySensor;
    this._selectedOccupancySensors = next.selectedOccupancySensors;
    this._selectedWindowSensors = next.selectedWindowSensors;
    this._windowOpenDelay = next.windowOpenDelay;
    this._windowCloseDelay = next.windowCloseDelay;
    this._autoSave();
  }

  private _onValveProtectionExcludeToggle(e: CustomEvent<{ entityId: string; excluded: boolean }>) {
    const { entityId, excluded } = e.detail;
    const next = new Set(this._valveProtectionExclude);
    if (excluded) {
      next.add(entityId);
    } else {
      next.delete(entityId);
    }
    this._valveProtectionExclude = next;
    this._autoSave();
  }

  private _onPresencePersonsChanged(e: CustomEvent<string[]>) {
    this._selectedPresencePersons = e.detail;
    this._autoSave();
  }

  private _onIgnorePresenceChanged(e: CustomEvent<boolean>) {
    this._ignorePresence = e.detail;
    this._autoSave();
  }

  // ---- Cover event handlers ----

  private _onCoversToggle(e: CustomEvent<{ entityId: string; checked: boolean }>) {
    const { entityId, checked } = e.detail;
    const next = applyCoverSelectionChange(
      {
        selectedCovers: this._selectedCovers,
        coverOrientations: this._coverOrientations,
        coverMinPositions: this._coverMinPositions,
      },
      entityId,
      checked,
    );
    this._selectedCovers = next.selectedCovers;
    this._coverOrientations = next.coverOrientations;
    this._coverMinPositions = next.coverMinPositions;
    this._autoSave();
  }

  private _onCoverSettingChanged(e: CustomEvent<{ key: string; value: unknown }>) {
    const { key, value } = e.detail;
    e.stopPropagation();
    if (key === "covers_auto_enabled") this._coversAutoEnabled = value as boolean;
    else if (key === "covers_deploy_threshold") this._coversDeployThreshold = value as number;
    else if (key === "covers_min_position") this._coversMinPosition = value as number;
    else if (key === "covers_override_minutes") this._coversOverrideMinutes = value as number;
    else if (key === "cover_schedules") this._coverSchedules = value as CoverScheduleEntry[];
    else if (key === "cover_schedule_selector_entity")
      this._coverScheduleSelectorEntity = value as string;
    else if (key === "covers_night_close") this._coversNightClose = value as boolean;
    else if (key === "covers_night_position") this._coversNightPosition = value as number;
    else if (key === "covers_snap_deploy") this._coversSnapDeploy = value as boolean;
    else if (key === "cover_orientations")
      this._coverOrientations = value as Record<string, number>;
    else if (key === "covers_night_close_elevation")
      this._coversNightCloseElevation = value as number;
    else if (key === "covers_night_close_offset_minutes")
      this._coversNightCloseOffsetMinutes = value as number;
    else if (key === "covers_outdoor_min_temp") this._coversOutdoorMinTemp = value as number | null;
    else if (key === "cover_min_positions")
      this._coverMinPositions = value as Record<string, number>;
    this._autoSave();
  }

  // ---- Heat source orchestration ----

  private _onHeatSourceSettingChanged(e: CustomEvent<{ key: string; value: unknown }>) {
    const { key, value } = e.detail;
    e.stopPropagation();
    if (key === "heat_source_orchestration") this._heatSourceOrchestration = value as boolean;
    else if (key === "heat_source_primary_delta") this._heatSourcePrimaryDelta = value as number;
    else if (key === "heat_source_outdoor_threshold")
      this._heatSourceOutdoorThreshold = value as number;
    else if (key === "heat_source_ac_min_outdoor") this._heatSourceAcMinOutdoor = value as number;
    this._autoSave();
  }

  // ---- Outdoor toggle ----

  private _onClimateControlToggle(e: CustomEvent) {
    this._climateControlEnabled = e.detail;
    this._autoSave();
  }

  private _onOutdoorToggle(e: CustomEvent<boolean>) {
    this._isOutdoor = e.detail;
    this._autoSave();
  }

  // ---- Auto-save ----

  private _onDisplayNameChanged(e: CustomEvent<{ value: string }>) {
    this._displayName = e.detail.value;
    this._autoSave();
  }

  private _autoSave() {
    this._dirty = true;
    if (this._saveDebounce) clearTimeout(this._saveDebounce);
    this._saveDebounce = setTimeout(() => this._doSave(), 500);
  }

  private async _doSave() {
    fireSaveStatus(this, "saving");
    this._error = "";

    try {
      await this.hass.callWS(buildRoomSavePayload(this.area.area_id, this._currentDraft()));

      this._dirty = false;
      fireSaveStatus(this, "saved");

      this.dispatchEvent(
        new CustomEvent("room-updated", {
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : localize("room.error_save_fallback", this.hass.language);
      this._error = message;
      fireSaveStatus(this, "error");
    }
  }

  private _temperatureSensorIdsForSave(): string[] {
    return temperatureSensorIdsForSave(this._currentDraft());
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-room-detail": RsRoomDetail;
  }
}
