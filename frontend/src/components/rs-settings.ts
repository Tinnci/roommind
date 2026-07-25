/**
 * rs-settings – Global RoomMind settings page (orchestrator).
 * Owns all state, loads/saves settings, delegates rendering to sub-components
 * wrapped in ha-expansion-panel accordion sections.
 */
import { LitElement, html, css } from "lit";
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
import { DEFAULT_CONTROL_MODE, VACATION_SENTINEL } from "../utils/constants";
import { roommindThemeStyles } from "../styles/theme-styles";
import { tempUnit, toDisplay } from "../utils/temperature";
import "./settings/rs-settings-panel";
import "./settings/rs-settings-general";
import "./settings/rs-settings-sensors";
import "./settings/rs-settings-control";
import "./settings/rs-settings-presence";
import "./settings/rs-settings-vacation";
import "./settings/rs-settings-valve";
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

    return html`
      <h2 class="settings-group-heading">${localize("settings.group.basics", l)}</h2>
      <rs-settings-panel
        icon="mdi:power"
        .heading=${localize("settings.general_title", l)}
        .summary=${this._generalSummary(l)}
        .intro=${localize("settings.intro.general", l)}
      >
        <rs-settings-general
          .hass=${this.hass}
          .groupByFloor=${this._groupByFloor}
          .climateControlActive=${this._climateControlActive}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-general>
      </rs-settings-panel>

      <rs-settings-panel
        icon="mdi:thermometer"
        .heading=${localize("settings.sensors_title", l)}
        .summary=${this._sensorsSummary(l)}
        .intro=${localize("settings.intro.sensors", l)}
      >
        <rs-settings-sensors
          .hass=${this.hass}
          .outdoorTempSensor=${this._outdoorTempSensor}
          .outdoorHumiditySensor=${this._outdoorHumiditySensor}
          .weatherEntity=${this._weatherEntity}
          .outdoorUnavailableNotify=${this._outdoorUnavailableNotify}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-sensors>
      </rs-settings-panel>

      <h2 class="settings-group-heading">${localize("settings.group.automation", l)}</h2>
      <rs-settings-panel
        icon="mdi:tune-variant"
        .heading=${localize("settings.control_title", l)}
        .summary=${this._controlSummary(l)}
        .intro=${localize("settings.intro.control", l)}
      >
        <rs-settings-control
          .hass=${this.hass}
          .controlMode=${this._controlMode}
          .optimizerStrategy=${this._optimizerStrategy}
          .comfortWeight=${this._comfortWeight}
          .outdoorCoolingMin=${this._outdoorCoolingMin}
          .outdoorHeatingMax=${this._outdoorHeatingMax}
          .predictionEnabled=${this._predictionEnabled}
          .scheduleOffAction=${this._scheduleOffAction}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-control>
      </rs-settings-panel>

      <rs-settings-panel
        icon="mdi:home-account"
        .heading=${localize("presence.title", l)}
        .summary=${this._presenceSummary(l)}
        .intro=${localize("settings.intro.presence", l)}
      >
        <rs-settings-presence
          .hass=${this.hass}
          .presenceEnabled=${this._presenceEnabled}
          .presencePersons=${this._presencePersons}
          .presenceAwayAction=${this._presenceAwayAction}
          .presenceClearsOverride=${this._presenceClearsOverride}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-presence>
      </rs-settings-panel>

      <rs-settings-panel
        icon="mdi:airplane"
        .heading=${localize("vacation.title", l)}
        .summary=${this._vacationSummary(l)}
        .intro=${localize("settings.intro.vacation", l)}
      >
        <rs-settings-vacation
          .hass=${this.hass}
          .vacationActive=${this._vacationActive}
          .vacationTemp=${this._vacationTemp}
          .vacationUntil=${this._vacationUntil}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-vacation>
      </rs-settings-panel>

      <rs-settings-panel
        icon="mdi:shield-refresh"
        .heading=${localize("valve_protection.title", l)}
        .summary=${this._valveSummary(l)}
        .intro=${localize("settings.intro.valve", l)}
      >
        <rs-settings-valve
          .hass=${this.hass}
          .valveProtectionEnabled=${this._valveProtectionEnabled}
          .valveProtectionInterval=${this._valveProtectionInterval}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-valve>
      </rs-settings-panel>

      <rs-settings-panel
        icon="mdi:heat-pump-outline"
        .heading=${localize("compressor.title", l)}
        .summary=${this._compressorSummary(l)}
        .intro=${localize("settings.intro.compressor", l)}
      >
        <rs-settings-compressor
          .hass=${this.hass}
          .compressorGroups=${this._compressorGroups}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-compressor>
      </rs-settings-panel>

      <rs-settings-panel
        icon="mdi:water-alert"
        .heading=${localize("mold.title", l)}
        .summary=${this._moldSummary(l)}
        .intro=${localize("settings.intro.mold", l)}
      >
        <rs-settings-mold
          .hass=${this.hass}
          .moldDetectionEnabled=${this._moldDetectionEnabled}
          .moldHumidityThreshold=${this._moldHumidityThreshold}
          .moldSustainedMinutes=${this._moldSustainedMinutes}
          .moldPreventionEnabled=${this._moldPreventionEnabled}
          .moldPreventionIntensity=${this._moldPreventionIntensity}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-mold>
      </rs-settings-panel>

      <h2 class="settings-group-heading">${localize("settings.group.maintenance", l)}</h2>
      <rs-settings-panel
        icon="mdi:bell-outline"
        .heading=${localize("notifications.title", l)}
        .summary=${this._notificationsSummary(l)}
        .intro=${localize("settings.intro.notifications", l)}
        .badge=${localize("badge.beta", l)}
        .badgeHint=${localize("badge.beta_hint", l)}
      >
        <rs-settings-notifications
          .hass=${this.hass}
          .notificationsEnabled=${this._moldNotificationsEnabled}
          .notificationTargets=${this._moldNotificationTargets}
          .notificationCooldown=${this._moldNotificationCooldown}
          .moldPreventionEnabled=${this._moldPreventionEnabled}
          .moldPreventionNotify=${this._moldPreventionNotify}
          @setting-changed=${this._onSettingChanged}
        ></rs-settings-notifications>
      </rs-settings-panel>

      <rs-settings-panel
        icon="mdi:brain"
        .heading=${localize("settings.learning_title", l)}
        .summary=${this._learningSummary(l)}
        .intro=${localize("settings.intro.learning", l)}
      >
        <rs-settings-learning
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
        ></rs-settings-learning>
      </rs-settings-panel>

      <rs-settings-panel
        icon="mdi:restart"
        .heading=${localize("settings.reset_title", l)}
        .summary=${localize("settings.summary.data_tools", l)}
        .intro=${localize("settings.intro.reset", l)}
      >
        <rs-settings-reset .hass=${this.hass} .rooms=${this.rooms}></rs-settings-reset>
      </rs-settings-panel>
    `;
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
        gap: 12px;
        padding: 0 16px;
      }

      .loading {
        padding: 80px 16px;
        text-align: center;
        color: var(--secondary-text-color);
      }

      .settings-group-heading {
        margin: 14px 4px -2px;
        color: var(--secondary-text-color);
        font-size: 12px;
        font-weight: 650;
        letter-spacing: 0.04em;
        line-height: 1.3;
        text-transform: uppercase;
      }

      .settings-group-heading:first-child {
        margin-top: 2px;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-settings": RsSettings;
  }
}
