/**
 * rs-settings – Global RoomMind settings hub & focused editors.
 * Owns all global settings state, surfaces whole-home quick toggles at a glance,
 * filters settings into clear category cards, and renders focused sub-editors.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  HomeAssistant,
  GlobalSettings,
  RoomConfig,
  NotificationTarget,
  CompressorGroup,
} from "../types";
import { localize } from "../utils/localize";
import { fireSaveStatus } from "../utils/events";
import {
  DEFAULT_CONTROL_MODE,
  DEFAULT_SETBACK_OFFSET,
  VACATION_SENTINEL,
} from "../utils/constants";
import { roommindThemeStyles } from "../styles/theme-styles";
import { tempUnit, toDisplay } from "../utils/temperature";
import {
  SETTINGS_CATEGORIES,
  filterSettingsSections,
  findSettingsSection,
  getSettingsSectionTone,
  type SettingsCategoryId,
  type SettingsSectionId,
  type SettingsSectionMeta,
} from "../utils/settings-hub";
import "./settings/rs-settings-general";
import "./settings/rs-settings-sensors";
import "./settings/rs-settings-control";
import "./settings/rs-settings-presence";
import "./settings/rs-settings-vacation";
import "./settings/rs-settings-valve";
import "./settings/rs-settings-coil-dry";
import "./settings/rs-settings-compressor";
import "./settings/rs-settings-mold";
import "./settings/rs-settings-notifications";
import "./settings/rs-settings-learning";
import "./settings/rs-settings-reset";

@customElement("rs-settings")
export class RsSettings extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public rooms: Record<string, RoomConfig> = {};

  @state() private _groupByFloor = false;
  @state() private _climateControlActive = true;
  @state() private _learningDisabledRooms: string[] = [];
  @state() private _outdoorTempSensor = "";
  @state() private _outdoorHumiditySensor = "";
  @state() private _outdoorCoolingMin = 16;
  @state() private _outdoorHeatingMax = 22;
  @state() private _controlMode: "mpc" | "bangbang" = DEFAULT_CONTROL_MODE;
  @state() private _optimizerStrategy: "greedy" | "horizon_search" = "greedy";
  @state() private _comfortWeight = 70;
  @state() private _setbackOffset = DEFAULT_SETBACK_OFFSET;
  @state() private _weatherEntity = "";
  @state() private _outdoorUnavailableNotify = true;
  @state() private _predictionEnabled = true;
  @state() private _vacationActive = false;
  @state() private _vacationTemp = 15;
  @state() private _vacationUntil = "";
  @state() private _presenceEnabled = false;
  @state() private _presencePersons: string[] = [];
  @state() private _presenceAwayAction: "eco" | "off" = "eco";
  @state() private _presenceClearsOverride = false;
  @state() private _scheduleOffAction: "eco" | "off" = "eco";
  @state() private _valveProtectionEnabled = false;
  @state() private _valveProtectionInterval = 7;
  @state() private _coilDryEnabled = false;
  @state() private _coilDryMinutes = 20;
  @state() private _coilDryMode: "fan_only" | "dry" = "fan_only";
  @state() private _coilDryFanMode = "low";
  @state() private _coilDryMinCoolingMinutes = 10;
  @state() private _coilDryDrainMinutes = 0;
  @state() private _moldDetectionEnabled = false;
  @state() private _moldHumidityThreshold = 70;
  @state() private _moldSustainedMinutes = 30;
  @state() private _moldNotificationCooldown = 60;
  @state() private _moldNotificationsEnabled = true;
  @state() private _moldNotificationTargets: NotificationTarget[] = [];
  @state() private _moldPreventionEnabled = false;
  @state() private _moldPreventionIntensity: "light" | "medium" | "strong" = "medium";
  @state() private _moldPreventionNotify = false;
  @state() private _compressorGroups: CompressorGroup[] = [];
  @state() private _boostAppliedAt: Record<string, number> = {};
  @state() private _loaded = false;
  @state() private _selectedCategory: SettingsCategoryId = "all";
  @state() private _activeSection: SettingsSectionId | null = null;

  private _saveDebounce?: ReturnType<typeof setTimeout>;

  override connectedCallback() {
    super.connectedCallback();
    this._loadSettings();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this._saveDebounce) clearTimeout(this._saveDebounce);
  }

  private async _loadSettings() {
    try {
      const result = await this.hass.callWS<{ settings: GlobalSettings }>({
        type: "roommind/settings/get",
      });
      const s = result.settings;
      this._groupByFloor = s.group_by_floor ?? false;
      this._climateControlActive = s.climate_control_active ?? true;
      this._learningDisabledRooms = s.learning_disabled_rooms ?? [];
      this._outdoorTempSensor = s.outdoor_temp_sensor ?? "";
      this._outdoorHumiditySensor = s.outdoor_humidity_sensor ?? "";
      this._outdoorCoolingMin = s.outdoor_cooling_min ?? 16;
      this._outdoorHeatingMax = s.outdoor_heating_max ?? 22;
      this._controlMode = s.control_mode ?? DEFAULT_CONTROL_MODE;
      this._optimizerStrategy = s.optimizer_strategy ?? "greedy";
      this._comfortWeight = s.comfort_weight ?? 70;
      this._setbackOffset = s.setback_offset ?? DEFAULT_SETBACK_OFFSET;
      this._weatherEntity = s.weather_entity ?? "";
      this._outdoorUnavailableNotify = s.outdoor_unavailable_notify ?? true;
      this._predictionEnabled = s.prediction_enabled ?? true;
      const vUntil = s.vacation_until;
      this._vacationActive = !!(vUntil && vUntil > Date.now() / 1000);
      this._vacationTemp = s.vacation_temp ?? 15;
      if (vUntil && vUntil > Date.now() / 1000 && vUntil < VACATION_SENTINEL) {
        this._vacationUntil = this._tsToDatetimeLocal(vUntil);
      } else {
        this._vacationUntil = "";
      }
      this._presenceEnabled = s.presence_enabled ?? false;
      this._presencePersons = s.presence_persons ?? [];
      this._presenceAwayAction = s.presence_away_action ?? "eco";
      this._presenceClearsOverride = s.presence_clears_override ?? false;
      this._scheduleOffAction = s.schedule_off_action ?? "eco";
      this._valveProtectionEnabled = s.valve_protection_enabled ?? false;
      this._valveProtectionInterval = s.valve_protection_interval_days ?? 7;
      this._coilDryEnabled = s.coil_dry_enabled ?? false;
      this._coilDryMinutes = s.coil_dry_minutes ?? 20;
      this._coilDryMode = s.coil_dry_mode ?? "fan_only";
      this._coilDryFanMode = s.coil_dry_fan_mode ?? "low";
      this._coilDryMinCoolingMinutes = s.coil_dry_min_cooling_minutes ?? 10;
      this._coilDryDrainMinutes = s.coil_dry_drain_minutes ?? 0;
      this._moldDetectionEnabled = s.mold_detection_enabled ?? false;
      this._moldHumidityThreshold = s.mold_humidity_threshold ?? 70;
      this._moldSustainedMinutes = s.mold_sustained_minutes ?? 30;
      this._moldNotificationCooldown = s.mold_notification_cooldown ?? 60;
      this._moldNotificationsEnabled = s.mold_notifications_enabled ?? true;
      this._moldNotificationTargets = s.mold_notification_targets ?? [];
      this._moldPreventionEnabled = s.mold_prevention_enabled ?? false;
      this._moldPreventionIntensity = s.mold_prevention_intensity ?? "medium";
      this._moldPreventionNotify = s.mold_prevention_notify_enabled ?? false;
      this._compressorGroups = s.compressor_groups ?? [];
      this._boostAppliedAt = s.boost_applied_at ?? {};
    } catch (err) {
      // eslint-disable-next-line no-console
      console.debug("[RoomMind] loadSettings:", err);
    } finally {
      this._loaded = true;
    }
  }

  protected override render() {
    if (!this._loaded) {
      return html`<div class="loading">${localize("panel.loading", this.hass.language)}</div>`;
    }

    const l = this.hass.language;
    const activeMeta = this._activeSection ? findSettingsSection(this._activeSection) : undefined;

    if (activeMeta) {
      return this._renderFocusedEditor(activeMeta, l);
    }

    const sections = filterSettingsSections(this._selectedCategory);

    return html`
      ${this._renderQuickControlsStrip(l)}

      <div class="hub-header">
        <div>
          <h2 class="hub-title">${localize("settings_hub.title", l)}</h2>
          <p class="hub-subtitle">${localize("settings_hub.subtitle", l)}</p>
        </div>
        <div class="category-pills" role="tablist">
          ${SETTINGS_CATEGORIES.map(
            (cat) => html`
              <button
                type="button"
                role="tab"
                aria-selected=${this._selectedCategory === cat.id}
                class="category-pill ${this._selectedCategory === cat.id ? "active" : ""}"
                @click=${() => {
                  this._selectedCategory = cat.id;
                }}
              >
                ${localize(cat.labelKey, l)}
              </button>
            `,
          )}
        </div>
      </div>

      <div class="hub-grid">${sections.map((section) => this._renderHubCard(section, l))}</div>
    `;
  }

  private _renderQuickControlsStrip(lang: string) {
    const vacationLabel = this._vacationActive
      ? `${toDisplay(this._vacationTemp, this.hass)}${tempUnit(this.hass)}`
      : localize("settings_hub.quick.vacation_hint", lang);

    const presenceLabel = this._presenceEnabled
      ? localize("settings.summary.people", lang, { count: this._presencePersons.length })
      : localize("settings.summary.off", lang);

    return html`
      <div class="quick-strip">
        <button
          type="button"
          class="quick-tile ${this._climateControlActive ? "is-on" : "is-warn"}"
          @click=${this._toggleClimateControl}
        >
          <span class="quick-tile-icon">
            <ha-icon icon="mdi:power"></ha-icon>
          </span>
          <span class="quick-tile-body">
            <span class="quick-tile-label">${localize("settings_hub.quick.climate", lang)}</span>
            <span class="quick-tile-value">
              ${
                this._climateControlActive
                  ? localize("settings.summary.control_on", lang)
                  : localize("settings.summary.control_off", lang)
              }
            </span>
          </span>
        </button>

        <button
          type="button"
          class="quick-tile ${this._vacationActive ? "is-accent" : ""}"
          @click=${this._toggleVacation}
        >
          <span class="quick-tile-icon">
            <ha-icon icon="mdi:airplane"></ha-icon>
          </span>
          <span class="quick-tile-body">
            <span class="quick-tile-label">${localize("settings_hub.quick.vacation", lang)}</span>
            <span class="quick-tile-value">${vacationLabel}</span>
          </span>
        </button>

        <button
          type="button"
          class="quick-tile ${this._groupByFloor ? "is-accent" : ""}"
          @click=${this._toggleGroupByFloor}
        >
          <span class="quick-tile-icon">
            <ha-icon icon="mdi:layers-outline"></ha-icon>
          </span>
          <span class="quick-tile-body">
            <span class="quick-tile-label">${localize("settings_hub.quick.floors", lang)}</span>
            <span class="quick-tile-value">
              ${
                this._groupByFloor
                  ? localize("settings.summary.grouped", lang)
                  : localize("settings.summary.custom_order", lang)
              }
            </span>
          </span>
        </button>

        <button
          type="button"
          class="quick-tile ${this._presenceEnabled ? "is-on" : ""}"
          @click=${() => {
            this._activeSection = "presence";
          }}
        >
          <span class="quick-tile-icon">
            <ha-icon icon="mdi:home-account"></ha-icon>
          </span>
          <span class="quick-tile-body">
            <span class="quick-tile-label">${localize("settings_hub.quick.presence", lang)}</span>
            <span class="quick-tile-value">${presenceLabel}</span>
          </span>
        </button>
      </div>
    `;
  }

  private _renderHubCard(section: SettingsSectionMeta, lang: string) {
    const tone = getSettingsSectionTone(section.id, this._statusInput());
    const summary = this._sectionSummary(section.id, lang);

    return html`
      <button
        type="button"
        class="hub-card"
        @click=${() => {
          this._activeSection = section.id;
        }}
      >
        <div class="hub-card-top">
          <span class="hub-card-icon" data-tone=${tone}>
            <ha-icon .icon=${section.icon}></ha-icon>
          </span>
          <span class="hub-card-badges">
            ${
              section.isBeta
                ? html`<span class="beta-pill" title=${localize("badge.beta_hint", lang)}>
                    ${localize("badge.beta", lang)}
                  </span>`
                : nothing
            }
            <span class="status-pill" data-tone=${tone}>${summary}</span>
          </span>
        </div>
        <h3 class="hub-card-title">${localize(section.titleKey, lang)}</h3>
        <p class="hub-card-desc">${localize(section.descKey, lang)}</p>
        <span class="hub-card-action">
          <span>${localize("settings_hub.configure", lang)}</span>
          <ha-icon icon="mdi:chevron-right"></ha-icon>
        </span>
      </button>
    `;
  }

  private _renderFocusedEditor(section: SettingsSectionMeta, lang: string) {
    const tone = getSettingsSectionTone(section.id, this._statusInput());
    const summary = this._sectionSummary(section.id, lang);

    return html`
      <div class="editor-header">
        <button
          type="button"
          class="back-btn"
          @click=${() => {
            this._activeSection = null;
          }}
        >
          <ha-icon icon="mdi:arrow-left"></ha-icon>
          <span>${localize("settings_hub.back", lang)}</span>
        </button>
        <span class="status-pill" data-tone=${tone}>${summary}</span>
      </div>

      <ha-card class="editor-card">
        <div class="editor-card-head">
          <span class="hub-card-icon" data-tone=${tone}>
            <ha-icon .icon=${section.icon}></ha-icon>
          </span>
          <div class="editor-card-titles">
            <h2 class="editor-card-title">${localize(section.titleKey, lang)}</h2>
            <p class="editor-card-desc">${localize(section.descKey, lang)}</p>
          </div>
        </div>
        <div class="editor-card-body">${this._renderSectionBody(section.id)}</div>
      </ha-card>
    `;
  }

  private _renderSectionBody(sectionId: SettingsSectionId) {
    switch (sectionId) {
      case "general":
        return html`<rs-settings-general
          .hass=${this.hass}
          .groupByFloor=${this._groupByFloor}
          .climateControlActive=${this._climateControlActive}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-general>`;
      case "sensors":
        return html`<rs-settings-sensors
          .hass=${this.hass}
          .outdoorTempSensor=${this._outdoorTempSensor}
          .outdoorHumiditySensor=${this._outdoorHumiditySensor}
          .weatherEntity=${this._weatherEntity}
          .outdoorUnavailableNotify=${this._outdoorUnavailableNotify}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-sensors>`;
      case "control":
        return html`<rs-settings-control
          .hass=${this.hass}
          .controlMode=${this._controlMode}
          .optimizerStrategy=${this._optimizerStrategy}
          .comfortWeight=${this._comfortWeight}
          .setbackOffset=${this._setbackOffset}
          .outdoorCoolingMin=${this._outdoorCoolingMin}
          .outdoorHeatingMax=${this._outdoorHeatingMax}
          .predictionEnabled=${this._predictionEnabled}
          .scheduleOffAction=${this._scheduleOffAction}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-control>`;
      case "presence":
        return html`<rs-settings-presence
          .hass=${this.hass}
          .presenceEnabled=${this._presenceEnabled}
          .presencePersons=${this._presencePersons}
          .presenceAwayAction=${this._presenceAwayAction}
          .presenceClearsOverride=${this._presenceClearsOverride}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-presence>`;
      case "vacation":
        return html`<rs-settings-vacation
          .hass=${this.hass}
          .vacationActive=${this._vacationActive}
          .vacationTemp=${this._vacationTemp}
          .vacationUntil=${this._vacationUntil}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-vacation>`;
      case "valve":
        return html`<rs-settings-valve
          .hass=${this.hass}
          .valveProtectionEnabled=${this._valveProtectionEnabled}
          .valveProtectionInterval=${this._valveProtectionInterval}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-valve>`;
      case "coil_dry":
        return html`<rs-settings-coil-dry
          .hass=${this.hass}
          .rooms=${this.rooms}
          .coilDryEnabled=${this._coilDryEnabled}
          .coilDryMinutes=${this._coilDryMinutes}
          .coilDryMode=${this._coilDryMode}
          .coilDryFanMode=${this._coilDryFanMode}
          .coilDryMinCoolingMinutes=${this._coilDryMinCoolingMinutes}
          .coilDryDrainMinutes=${this._coilDryDrainMinutes}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-coil-dry>`;
      case "compressor":
        return html`<rs-settings-compressor
          .hass=${this.hass}
          .compressorGroups=${this._compressorGroups}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-compressor>`;
      case "mold":
        return html`<rs-settings-mold
          .hass=${this.hass}
          .moldDetectionEnabled=${this._moldDetectionEnabled}
          .moldHumidityThreshold=${this._moldHumidityThreshold}
          .moldSustainedMinutes=${this._moldSustainedMinutes}
          .moldPreventionEnabled=${this._moldPreventionEnabled}
          .moldPreventionIntensity=${this._moldPreventionIntensity}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-mold>`;
      case "notifications":
        return html`<rs-settings-notifications
          .hass=${this.hass}
          .notificationsEnabled=${this._moldNotificationsEnabled}
          .notificationTargets=${this._moldNotificationTargets}
          .notificationCooldown=${this._moldNotificationCooldown}
          .moldPreventionEnabled=${this._moldPreventionEnabled}
          .moldPreventionNotify=${this._moldPreventionNotify}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-notifications>`;
      case "learning":
        return html`<rs-settings-learning
          .hass=${this.hass}
          .rooms=${this.rooms}
          .learningDisabledRooms=${this._learningDisabledRooms}
          .boostAppliedAt=${this._boostAppliedAt}
          .roomsLive=${Object.fromEntries(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- HA room data includes untyped live state
            Object.entries(this.rooms).map(([id, r]) => [id, (r as any).live ?? {}]),
          )}
          @setting-changed=${this._onSettingChanged}
          @boost-applied=${this._onBoostApplied}
        ></rs-settings-learning>`;
      case "reset":
        return html`<rs-settings-reset
          .hass=${this.hass}
          .rooms=${this.rooms}
        ></rs-settings-reset>`;
    }
  }

  private _statusInput() {
    return {
      climateControlActive: this._climateControlActive,
      controlMode: this._controlMode,
      presenceEnabled: this._presenceEnabled,
      presencePersonsCount: this._presencePersons.filter(Boolean).length,
      vacationActive: this._vacationActive,
      valveProtectionEnabled: this._valveProtectionEnabled,
      coilDryEnabled: this._coilDryEnabled,
      outdoorSensorConfigured: Boolean(this._outdoorTempSensor),
      weatherEntityConfigured: Boolean(this._weatherEntity),
      compressorGroupsCount: this._compressorGroups.filter((g) => g.members.length > 0).length,
      moldDetectionEnabled: this._moldDetectionEnabled,
      moldPreventionEnabled: this._moldPreventionEnabled,
      notificationsEnabled: this._moldNotificationsEnabled,
      learningDisabledCount: this._learningDisabledRooms.length,
    };
  }

  private _sectionSummary(sectionId: SettingsSectionId, lang: string): string {
    switch (sectionId) {
      case "general":
        return this._generalSummary(lang);
      case "sensors":
        return this._sensorsSummary(lang);
      case "control":
        return this._controlSummary(lang);
      case "presence":
        return this._presenceSummary(lang);
      case "vacation":
        return this._vacationSummary(lang);
      case "valve":
        return this._valveSummary(lang);
      case "coil_dry":
        return this._coilDrySummary(lang);
      case "compressor":
        return this._compressorSummary(lang);
      case "mold":
        return this._moldSummary(lang);
      case "notifications":
        return this._notificationsSummary(lang);
      case "learning":
        return this._learningSummary(lang);
      case "reset":
        return localize("settings.summary.data_tools", lang);
    }
  }

  private _toggleClimateControl() {
    this._climateControlActive = !this._climateControlActive;
    this._autoSave();
  }

  private _toggleVacation() {
    this._vacationActive = !this._vacationActive;
    this._autoSave();
  }

  private _toggleGroupByFloor() {
    this._groupByFloor = !this._groupByFloor;
    this._autoSave();
  }

  private _onBoostApplied(e: CustomEvent<{ area_id: string; n_observations: number }>) {
    const { area_id, n_observations } = e.detail;
    this._boostAppliedAt = { ...this._boostAppliedAt, [area_id]: n_observations };
  }

  private _onSettingChanged(e: CustomEvent<{ key: string; value: unknown }>) {
    const { key, value } = e.detail;
    (this as Record<string, unknown>)[`_${key}`] = value;
    this._autoSave();
  }

  private _generalSummary(lang: string): string {
    return this._summaryParts(
      this._climateControlActive
        ? localize("settings.summary.control_on", lang)
        : localize("settings.summary.control_off", lang),
      this._groupByFloor
        ? localize("settings.summary.grouped", lang)
        : localize("settings.summary.custom_order", lang),
    );
  }

  private _sensorsSummary(lang: string): string {
    const sourceCount = [
      this._outdoorTempSensor,
      this._outdoorHumiditySensor,
      this._weatherEntity,
    ].filter(Boolean).length;
    return this._summaryParts(
      localize("settings.summary.sources", lang, { count: sourceCount }),
      this._weatherEntity
        ? localize("settings.summary.forecast_on", lang)
        : localize("settings.summary.forecast_off", lang),
    );
  }

  private _controlSummary(lang: string): string {
    return this._summaryParts(
      this._controlMode === "mpc"
        ? localize("settings.summary.mode_mpc", lang)
        : localize("settings.summary.mode_simple", lang),
      localize("settings.summary.comfort", lang, { value: this._comfortWeight }),
      this._predictionEnabled
        ? localize("settings.summary.prediction_on", lang)
        : localize("settings.summary.prediction_off", lang),
    );
  }

  private _presenceSummary(lang: string): string {
    if (!this._presenceEnabled) return localize("settings.summary.off", lang);
    return this._summaryParts(
      localize("settings.summary.on", lang),
      localize("settings.summary.people", lang, { count: this._presencePersons.length }),
      this._presenceAwayAction === "eco"
        ? localize("presence.away_action_eco", lang)
        : localize("presence.away_action_off", lang),
    );
  }

  private _vacationSummary(lang: string): string {
    if (!this._vacationActive) return localize("settings.summary.off", lang);
    return this._summaryParts(
      localize("settings.summary.on", lang),
      localize("settings.summary.temp", lang, {
        temp: toDisplay(this._vacationTemp, this.hass),
        unit: tempUnit(this.hass),
      }),
      this._vacationUntil
        ? localize("settings.summary.until", lang, {
            date: this._shortDate(this._vacationUntil, lang),
          })
        : localize("settings.summary.no_end", lang),
    );
  }

  private _valveSummary(lang: string): string {
    if (!this._valveProtectionEnabled) return localize("settings.summary.off", lang);
    return this._summaryParts(
      localize("settings.summary.on", lang),
      localize("settings.summary.every_days", lang, { days: this._valveProtectionInterval }),
    );
  }

  private _coilDrySummary(lang: string): string {
    if (!this._coilDryEnabled) return localize("settings.summary.off", lang);
    return localize("settings.summary.coil_dry_on", lang, {
      time: `${this._coilDryMinutes} min`,
    });
  }

  private _compressorSummary(lang: string): string {
    const groups = this._compressorGroups.filter((group) => group.members.length > 0).length;
    return groups > 0
      ? localize("settings.summary.groups", lang, { count: groups })
      : localize("settings.summary.no_groups", lang);
  }

  private _moldSummary(lang: string): string {
    if (!this._moldDetectionEnabled && !this._moldPreventionEnabled) {
      return localize("settings.summary.off", lang);
    }
    return this._summaryParts(
      this._moldDetectionEnabled
        ? localize("mold.detection", lang)
        : localize("settings.summary.detection_off", lang),
      this._moldPreventionEnabled
        ? this._moldPreventionSummary(lang)
        : localize("settings.summary.prevention_off", lang),
    );
  }

  private _notificationsSummary(lang: string): string {
    if (!this._moldNotificationsEnabled) return localize("settings.summary.off", lang);
    const targets = this._moldNotificationTargets.filter((target) => target.entity_id).length;
    return this._summaryParts(
      localize("settings.summary.on", lang),
      targets > 0
        ? localize("settings.summary.targets", lang, { count: targets })
        : localize("settings.summary.no_targets", lang),
      localize("settings.summary.cooldown", lang, { minutes: this._moldNotificationCooldown }),
    );
  }

  private _learningSummary(lang: string): string {
    const paused = this._learningDisabledRooms.length;
    return paused > 0
      ? this._summaryParts(
          localize("settings.summary.rooms_paused", lang, { count: paused }),
          localize("settings.summary.rooms_total", lang, { count: Object.keys(this.rooms).length }),
        )
      : localize("settings.summary.all_learning", lang);
  }

  private _moldPreventionSummary(lang: string): string {
    switch (this._moldPreventionIntensity) {
      case "light":
        return localize("settings.summary.prevention_light", lang);
      case "strong":
        return localize("settings.summary.prevention_strong", lang);
      default:
        return localize("settings.summary.prevention_medium", lang);
    }
  }

  private _summaryParts(...parts: string[]): string {
    return parts.filter(Boolean).join(" · ");
  }

  private _shortDate(value: string, lang: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(lang, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  private _tsToDatetimeLocal(ts: number): string {
    const d = new Date(ts * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private _autoSave() {
    if (this._saveDebounce) clearTimeout(this._saveDebounce);
    this._saveDebounce = setTimeout(() => this._doSave(), 500);
  }

  private async _doSave() {
    fireSaveStatus(this, "saving");

    try {
      await this.hass.callWS({
        type: "roommind/settings/save",
        group_by_floor: this._groupByFloor,
        climate_control_active: this._climateControlActive,
        learning_disabled_rooms: this._learningDisabledRooms,
        outdoor_temp_sensor: this._outdoorTempSensor,
        outdoor_humidity_sensor: this._outdoorHumiditySensor,
        outdoor_cooling_min: this._outdoorCoolingMin,
        outdoor_heating_max: this._outdoorHeatingMax,
        control_mode: this._controlMode,
        optimizer_strategy: this._optimizerStrategy,
        comfort_weight: this._comfortWeight,
        setback_offset: this._setbackOffset,
        weather_entity: this._weatherEntity,
        outdoor_unavailable_notify: this._outdoorUnavailableNotify,
        prediction_enabled: this._predictionEnabled,
        vacation_temp: this._vacationTemp,
        vacation_until: this._vacationActive
          ? this._vacationUntil
            ? new Date(this._vacationUntil).getTime() / 1000
            : VACATION_SENTINEL
          : null,
        presence_enabled: this._presenceEnabled,
        presence_persons: this._presencePersons.filter((p) => p),
        presence_away_action: this._presenceAwayAction,
        presence_clears_override: this._presenceClearsOverride,
        schedule_off_action: this._scheduleOffAction,
        valve_protection_enabled: this._valveProtectionEnabled,
        valve_protection_interval_days: this._valveProtectionInterval,
        coil_dry_enabled: this._coilDryEnabled,
        coil_dry_minutes: this._coilDryMinutes,
        coil_dry_mode: this._coilDryMode,
        coil_dry_fan_mode: this._coilDryFanMode,
        coil_dry_min_cooling_minutes: this._coilDryMinCoolingMinutes,
        coil_dry_drain_minutes: this._coilDryDrainMinutes,
        compressor_groups: this._compressorGroups.filter((g) => g.members.length > 0),
        mold_detection_enabled: this._moldDetectionEnabled,
        mold_humidity_threshold: this._moldHumidityThreshold,
        mold_sustained_minutes: this._moldSustainedMinutes,
        mold_notification_cooldown: this._moldNotificationCooldown,
        mold_notifications_enabled: this._moldNotificationsEnabled,
        mold_notification_targets: this._moldNotificationTargets.filter((t) => t.entity_id),
        mold_prevention_enabled: this._moldPreventionEnabled,
        mold_prevention_intensity: this._moldPreventionIntensity,
        mold_prevention_notify_enabled: this._moldPreventionNotify,
        mold_prevention_notify_targets: this._moldPreventionNotify
          ? this._moldNotificationTargets.filter((t) => t.entity_id)
          : [],
      });
      fireSaveStatus(this, "saved");
      this.dispatchEvent(new CustomEvent("settings-updated", { bubbles: true, composed: true }));
    } catch {
      fireSaveStatus(this, "error");
    }
  }

  static override styles = [
    roommindThemeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 0 16px 24px;
      }

      .loading {
        padding: 80px 16px;
        text-align: center;
        color: var(--secondary-text-color);
      }

      .quick-strip {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }

      .quick-tile {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        border-radius: var(--roommind-radius-card, 14px);
        border: var(--roommind-border-subtle);
        box-shadow: var(--roommind-shadow-card, none);
        background: var(--roommind-surface);
        color: var(--primary-text-color);
        font-family: inherit;
        text-align: left;
        cursor: pointer;
        transition:
          border-color var(--roommind-motion-duration) ease,
          box-shadow var(--roommind-motion-duration) ease,
          transform var(--roommind-motion-duration) var(--roommind-motion-easing),
          background var(--roommind-motion-duration) ease;
      }

      .quick-tile:hover {
        border-color: var(--roommind-card-border-hover);
        box-shadow: var(--roommind-shadow-card-hover, none);
        transform: translateY(-1px);
      }

      .quick-tile.is-on {
        border-color: color-mix(in srgb, var(--roommind-success-color) 42%, transparent);
        background: color-mix(in srgb, var(--roommind-success-tint) 60%, var(--roommind-surface));
      }

      .quick-tile.is-warn {
        border-color: color-mix(in srgb, var(--roommind-warning-color) 45%, transparent);
        background: color-mix(in srgb, var(--roommind-warning-tint) 65%, var(--roommind-surface));
      }

      .quick-tile.is-accent {
        border-color: rgba(var(--rgb-primary-color, 3, 169, 244), 0.45);
        background: color-mix(
          in srgb,
          var(--roommind-primary-muted, rgba(3, 169, 244, 0.1)) 65%,
          var(--roommind-surface)
        );
      }

      .quick-tile-icon {
        width: 34px;
        height: 34px;
        border-radius: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        background: var(--roommind-tile-surface, rgba(0, 0, 0, 0.05));
        color: var(--secondary-text-color);
        --mdc-icon-size: 18px;
      }

      .quick-tile.is-on .quick-tile-icon {
        color: var(--roommind-success-color);
        background: var(--roommind-success-tint);
      }

      .quick-tile.is-warn .quick-tile-icon {
        color: var(--roommind-warning-color);
        background: var(--roommind-warning-tint);
      }

      .quick-tile.is-accent .quick-tile-icon {
        color: var(--primary-color);
        background: var(--roommind-primary-muted, rgba(3, 169, 244, 0.14));
      }

      .quick-tile-body {
        display: flex;
        flex-direction: column;
        min-width: 0;
        gap: 2px;
      }

      .quick-tile-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--secondary-text-color);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .quick-tile-value {
        font-size: 13px;
        font-weight: 700;
        color: var(--primary-text-color);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .hub-header {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 2px;
      }

      .hub-title {
        margin: 0;
        font-size: 16px;
        font-weight: 700;
        color: var(--primary-text-color);
      }

      .hub-subtitle {
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--secondary-text-color);
      }

      .category-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .category-pill {
        appearance: none;
        border: var(--roommind-border-subtle);
        background: var(--roommind-surface);
        color: var(--secondary-text-color);
        border-radius: 999px;
        padding: 5px 12px;
        font-size: 12px;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .category-pill.active {
        background: var(--primary-color);
        color: var(--text-primary-color, #fff);
        border-color: var(--primary-color);
      }

      .hub-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 12px;
      }

      .hub-card {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        text-align: left;
        padding: 15px 16px;
        border-radius: var(--roommind-radius-card, 14px);
        border: var(--roommind-border-subtle);
        box-shadow: var(--roommind-shadow-card, none);
        background: var(--roommind-surface);
        color: var(--primary-text-color);
        font-family: inherit;
        cursor: pointer;
        transition:
          border-color var(--roommind-motion-duration) ease,
          box-shadow var(--roommind-motion-duration) ease,
          transform var(--roommind-motion-duration) var(--roommind-motion-easing);
      }

      .hub-card:hover {
        border-color: var(--roommind-card-border-hover);
        box-shadow: var(--roommind-shadow-card-hover, none);
        transform: translateY(-1px);
      }

      @media (prefers-reduced-motion: reduce) {
        .quick-tile:hover,
        .hub-card:hover {
          transform: none;
        }
      }

      .hub-card-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 10px;
      }

      .hub-card-icon {
        width: 34px;
        height: 34px;
        border-radius: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--roommind-tile-surface, rgba(0, 0, 0, 0.05));
        color: var(--secondary-text-color);
        --mdc-icon-size: 19px;
        flex: 0 0 auto;
      }

      .hub-card-icon[data-tone="ok"] {
        background: var(--roommind-success-tint);
        color: var(--roommind-success-color);
      }

      .hub-card-icon[data-tone="accent"] {
        background: var(--roommind-primary-muted, rgba(3, 169, 244, 0.14));
        color: var(--primary-color);
      }

      .hub-card-icon[data-tone="warning"] {
        background: var(--roommind-warning-tint);
        color: var(--roommind-warning-color);
      }

      .hub-card-badges {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .beta-pill {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 6px;
        background: var(--roommind-info-tint);
        color: var(--roommind-info-color);
        text-transform: uppercase;
      }

      .status-pill {
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 8px;
        background: var(--roommind-tile-surface, rgba(0, 0, 0, 0.05));
        color: var(--secondary-text-color);
        max-width: 170px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .status-pill[data-tone="ok"] {
        background: var(--roommind-success-tint);
        color: var(--roommind-success-color);
      }

      .status-pill[data-tone="accent"] {
        background: var(--roommind-primary-muted, rgba(3, 169, 244, 0.14));
        color: var(--primary-color);
      }

      .status-pill[data-tone="warning"] {
        background: var(--roommind-warning-tint);
        color: var(--roommind-warning-color);
      }

      .hub-card-title {
        margin: 0 0 4px;
        font-size: 15px;
        font-weight: 700;
        color: var(--primary-text-color);
      }

      .hub-card-desc {
        margin: 0 0 12px;
        font-size: 12px;
        line-height: 1.4;
        color: var(--secondary-text-color);
        flex: 1;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .hub-card-action {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 650;
        color: var(--primary-color);
        --mdc-icon-size: 16px;
      }

      .editor-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .back-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 9px;
        border: var(--roommind-border-subtle);
        background: var(--roommind-surface);
        color: var(--primary-text-color);
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        --mdc-icon-size: 17px;
      }

      .back-btn:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }

      .editor-card {
        padding: 18px 20px;
        border-radius: var(--roommind-radius-card, 14px);
        border: var(--roommind-border-subtle);
        box-shadow: var(--roommind-shadow-card, none);
        background: var(--roommind-surface);
      }

      .editor-card-head {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding-bottom: 14px;
        margin-bottom: 16px;
        border-bottom: var(--roommind-border-faint, 1px solid var(--divider-color));
      }

      .editor-card-titles {
        min-width: 0;
      }

      .editor-card-title {
        margin: 0;
        font-size: 17px;
        font-weight: 700;
        color: var(--primary-text-color);
      }

      .editor-card-desc {
        margin: 3px 0 0;
        font-size: 12.5px;
        line-height: 1.4;
        color: var(--secondary-text-color);
      }

      @media (max-width: 820px) {
        .quick-strip {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 480px) {
        .quick-strip {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-settings": RsSettings;
  }
}
