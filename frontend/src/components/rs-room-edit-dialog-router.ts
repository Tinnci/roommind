import { LitElement, html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant, HassArea, RoomConfig } from "../types";
import type { RoomConfigDraft } from "../utils/room-config-draft";
import { roomEditDialogHasInfo, type RoomEditSection } from "../utils/room-edit-dialog";
import { localize } from "../utils/localize";
import { resolveHeatingSystemType } from "../utils/device-utils";
import "./rs-schedule-settings";
import "./rs-device-section";
import "./rs-sensor-section";
import "./rs-airflow-section";
import "./rs-comfort-section";
import "./rs-presence-section";
import "./rs-covers-section";
import "./rs-heat-source-section";
import "../components/shared/rs-edit-dialog";

const CONTROL_DOCS_URL =
  "https://github.com/snazzybean/roommind/blob/main/docs/control-and-devices.md";

@customElement("rs-room-edit-dialog-router")
export class RsRoomEditDialogRouter extends LitElement {
  @property({ type: String }) public editing: RoomEditSection | null = null;
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public area!: HassArea;
  @property({ attribute: false }) public config: RoomConfig | null = null;
  @property({ attribute: false }) public draft!: RoomConfigDraft;
  @property({ type: Boolean }) public presenceEnabled = false;
  @property({ attribute: false }) public presencePersons: string[] = [];
  @property({ type: Boolean }) public valveProtectionEnabled = false;

  protected override createRenderRoot() {
    return this;
  }

  override render() {
    if (this.editing === null || !this.draft) return nothing;
    const lang = this.hass.language;

    return html`
      <rs-edit-dialog
        open
        .icon=${this._icon(this.editing)}
        .heading=${this._heading(this.editing, lang)}
        ?hasInfo=${roomEditDialogHasInfo(this.editing)}
        @rs-dialog-closed=${this._closeEdit}
      >
        ${this._renderInfo(this.editing, lang)} ${this._renderEditor(this.editing)}
      </rs-edit-dialog>
    `;
  }

  private _renderInfo(section: RoomEditSection, lang: string) {
    switch (section) {
      case "schedule":
        return html`<div slot="info">
          <p><strong>${localize("schedule.help_temps_title", lang)}</strong></p>
          <p>${localize("schedule.help_temps", lang)}</p>
          <ol style="margin: 4px 0 0 0; padding-left: 20px; line-height: 1.8">
            <li>${unsafeHTML(localize("schedule.help_temps_1", lang))}</li>
            <li>${unsafeHTML(localize("schedule.help_temps_2", lang))}</li>
            <li>${unsafeHTML(localize("schedule.help_temps_3", lang))}</li>
            <li>${unsafeHTML(localize("schedule.help_temps_4", lang))}</li>
          </ol>
          <p style="margin-top: 12px">
            <strong>${localize("schedule.help_block_title", lang)}</strong>
          </p>
          <p>${unsafeHTML(localize("schedule.help_block", lang))}</p>
          <div class="yaml-block">
            ${unsafeHTML(
              '<span class="yaml-key">schedule</span>:\n' +
                '  <span class="yaml-key">living_room_heating</span>:\n' +
                `    <span class="yaml-key">name</span>: <span class="yaml-value">${localize("schedule.example_name", lang)}</span>\n` +
                '    <span class="yaml-key">monday</span>:\n' +
                '      - <span class="yaml-key">from</span>: <span class="yaml-value">"06:00:00"</span>\n' +
                '        <span class="yaml-key">to</span>: <span class="yaml-value">"08:00:00"</span>\n' +
                '        <span class="yaml-key">data</span>:\n' +
                '          <span class="yaml-key">temperature</span>: <span class="yaml-value">23</span>\n' +
                '      - <span class="yaml-key">from</span>: <span class="yaml-value">"17:00:00"</span>\n' +
                '        <span class="yaml-key">to</span>: <span class="yaml-value">"22:00:00"</span>\n' +
                '        <span class="yaml-key">data</span>:\n' +
                '          <span class="yaml-key">temperature</span>: <span class="yaml-value">21.5</span>',
            )}
          </div>
          <p style="margin-top: 8px">${unsafeHTML(localize("schedule.help_block_note", lang))}</p>
          <p style="margin-top: 12px">
            <strong>${localize("schedule.help_split_title", lang)}</strong>
          </p>
          <p>${unsafeHTML(localize("schedule.help_split", lang))}</p>
          <div class="yaml-block">
            ${unsafeHTML(
              '- <span class="yaml-key">from</span>: <span class="yaml-value">"06:00:00"</span>\n' +
                '  <span class="yaml-key">to</span>: <span class="yaml-value">"08:00:00"</span>\n' +
                '  <span class="yaml-key">data</span>:\n' +
                '    <span class="yaml-key">heat_temperature</span>: <span class="yaml-value">21</span>\n' +
                '    <span class="yaml-key">cool_temperature</span>: <span class="yaml-value">24</span>',
            )}
          </div>
          <p style="margin-top: 8px">${unsafeHTML(localize("schedule.help_split_note", lang))}</p>
          <p style="margin-top: 12px">
            <strong>${localize("schedule.help_multi_title", lang)}</strong>
          </p>
          <p>${unsafeHTML(localize("schedule.help_multi", lang))}</p>
        </div>`;
      case "devices":
        return html`<div slot="info">
          <b>${localize("devices.info.types_title", lang)}</b><br />
          ${localize("devices.info.types_body", lang)}
          <br /><br />
          <b>${localize("devices.info.control_title", lang)}</b><br />
          ${localize("devices.info.control_body", lang)}
          <br /><br />
          <b>${localize("devices.info.modes_title", lang)}</b><br />
          ${localize("devices.info.modes_body", lang)}
          <br /><br />
          <b>${localize("devices.info.heat_source_title", lang)}</b><br />
          ${localize("devices.info.heat_source_body", lang)}
          <br />
          <a class="helper-link" href=${CONTROL_DOCS_URL} target="_blank" rel="noreferrer">
            ${localize("common.learn_more", lang)}
          </a>
        </div>`;
      case "airflow":
        return html`<div slot="info">
          <b>${localize("airflow.info_title", lang)}</b><br />
          ${localize("airflow.info_body", lang)}
          <br /><br />
          <b>${localize("airflow.info_control_title", lang)}</b><br />
          ${localize("airflow.info_control_body", lang)}
        </div>`;
      case "comfort":
        return html`<div slot="info">
          <b>${localize("comfort.info_title", lang)}</b><br />
          ${localize("comfort.info_body", lang)}
          <br /><br />
          <b>${localize("comfort.info_night_title", lang)}</b><br />
          ${localize("comfort.info_night_body", lang)}
          <br /><br />
          <b>${localize("comfort.info_coupling_title", lang)}</b><br />
          ${localize("comfort.info_coupling_body", lang)}
        </div>`;
      case "presence":
        return html`<div slot="info">
          <b>${localize("presence.room_help_header", lang)}</b><br />
          ${localize("presence.room_help_body", lang)}
          <br /><br />
          <b>${localize("presence.help_ignore_title", lang)}</b><br />
          ${localize("presence.help_ignore_body", lang)}
        </div>`;
      case "covers":
        return html`<div slot="info">
          <b>${localize("covers.info.selection_title", lang)}</b><br />
          ${localize("covers.info.selection_body", lang)}
          <br /><br />
          <b>${localize("covers.info.schedule_title", lang)}</b><br />
          ${localize("covers.info.schedule_body", lang)}
          <div class="yaml-block">
            ${unsafeHTML(
              '<span class="yaml-key">schedule</span>:\n' +
                '  <span class="yaml-key">cover_evening</span>:\n' +
                `    <span class="yaml-key">name</span>: <span class="yaml-value">${localize("covers.example_name", lang)}</span>\n` +
                '    <span class="yaml-key">monday</span>:\n' +
                '      - <span class="yaml-key">from</span>: <span class="yaml-value">"20:00:00"</span>\n' +
                '        <span class="yaml-key">to</span>: <span class="yaml-value">"06:00:00"</span>\n' +
                '        <span class="yaml-key">data</span>:\n' +
                '          <span class="yaml-key">position</span>: <span class="yaml-value">10</span>',
            )}
          </div>
          <b>${localize("covers.info.solar_title", lang)}</b><br />
          ${localize("covers.info.solar_body", lang)}
          <br /><br />
          <b>${localize("covers.info.night_title", lang)}</b><br />
          ${localize("covers.info.night_body", lang)}
          <br /><br />
          <b>${localize("covers.info.override_title", lang)}</b><br />
          ${localize("covers.info.override_body", lang)}
          <br /><br />
          <b>${localize("covers.info.priority_title", lang)}</b><br />
          ${localize("covers.info.priority_body", lang)}
          <br /><br />
          <b>${localize("covers.info.entities_title", lang)}</b><br />
          ${localize("covers.info.entities_body", lang)}
        </div>`;
      default:
        return nothing;
    }
  }

  private _renderEditor(section: RoomEditSection) {
    const draft = this.draft;
    const live = this.config?.live;
    switch (section) {
      case "schedule":
        return html`<rs-schedule-settings
          .hass=${this.hass}
          .schedules=${draft.schedules}
          .scheduleSelectorEntity=${draft.scheduleSelectorEntity}
          .activeScheduleIndex=${live?.active_schedule_index ?? -1}
          .comfortHeat=${draft.comfortHeat}
          .comfortCool=${draft.comfortCool}
          .ecoHeat=${draft.ecoHeat}
          .ecoCool=${draft.ecoCool}
          .climateMode=${draft.climateMode}
          .editing=${true}
          @schedules-changed=${this._forward("schedules-changed")}
          @schedule-selector-changed=${this._forward("schedule-selector-changed")}
          @comfort-heat-changed=${this._forward("comfort-heat-changed")}
          @comfort-cool-changed=${this._forward("comfort-cool-changed")}
          @eco-heat-changed=${this._forward("eco-heat-changed")}
          @eco-cool-changed=${this._forward("eco-cool-changed")}
        ></rs-schedule-settings>`;
      case "devices":
        return html`<rs-device-section
          .hass=${this.hass}
          .area=${this.area}
          .editing=${true}
          .devices=${draft.devices}
          .selectedTempSensor=${draft.selectedTempSensor}
          .valveProtectionExclude=${draft.valveProtectionExclude}
          .valveProtectionEnabled=${this.valveProtectionEnabled}
          @device-changed=${this._forward("device-changed")}
          @valve-protection-exclude-toggle=${this._forward("valve-protection-exclude-toggle")}
        ></rs-device-section>`;
      case "sensors":
        return html`<rs-sensor-section
          .hass=${this.hass}
          .area=${this.area}
          .editing=${true}
          .temperatureSensor=${draft.selectedTempSensor}
          .temperatureSensors=${draft.selectedTempSensors}
          .humiditySensor=${draft.selectedHumiditySensor}
          .occupancySensors=${draft.selectedOccupancySensors}
          .windowSensors=${draft.selectedWindowSensors}
          .windowOpenDelay=${draft.windowOpenDelay}
          .windowCloseDelay=${draft.windowCloseDelay}
          .heatingSystemType=${resolveHeatingSystemType(draft.devices)}
          .sensorConflict=${live?.sensor_conflict ?? 0}
          .sensorFusionStatus=${live?.sensor_fusion_status ?? []}
          .language=${this.hass.language}
          @sensor-changed=${this._forward("sensor-changed")}
        ></rs-sensor-section>`;
      case "airflow":
        return html`<rs-airflow-section
          .hass=${this.hass}
          .area=${this.area}
          .editing=${true}
          .airflowDevices=${draft.airflowDevices}
          .statuses=${live?.airflow_devices_status ?? []}
          .commandStatuses=${live?.airflow_command_status ?? []}
          .hvacOutputStatus=${live?.hvac_output_status ?? null}
          .qFanMix=${live?.q_fan_mix ?? 0}
          .qVent=${live?.q_vent ?? 0}
          .airflowAch=${live?.airflow_ach ?? 0}
          .planLevel=${live?.airflow_plan_level ?? 0}
          .mixPlanLevel=${live?.airflow_mix_plan_level ?? 0}
          .ventPlanLevel=${live?.airflow_vent_plan_level ?? 0}
          .active=${live?.airflow_active ?? false}
          .language=${this.hass.language}
          @airflow-devices-changed=${this._forward("airflow-devices-changed")}
        ></rs-airflow-section>`;
      case "comfort":
        return html`<rs-comfort-section
          .hass=${this.hass}
          .area=${this.area}
          .editing=${true}
          .currentTemp=${live?.current_temp ?? null}
          .perceivedTemp=${live?.perceived_temp ?? null}
          .currentHumidity=${live?.current_humidity ?? null}
          .controlTarget=${draft.controlTarget}
          .roomVolumeM3=${draft.roomVolumeM3}
          .quietHours=${draft.quietHours}
          .nightModeEnabled=${draft.nightModeEnabled}
          .maxFanLevelNight=${draft.maxFanLevelNight}
          .sleepTempRampC=${draft.sleepTempRampC}
          .nightAllowRapidRecovery=${draft.nightAllowRapidRecovery}
          .rapidRecoveryDeltaC=${draft.rapidRecoveryDeltaC}
          .nightMode=${live?.night_mode ?? null}
          .nightControls=${draft.nightControls ?? []}
          .nightControlStatus=${live?.night_control_status ?? []}
          .adjacentRooms=${draft.adjacentRooms ?? []}
          .couplingStatus=${live?.coupling_status ?? []}
          .rapidRecoveryActive=${live?.rapid_recovery_active ?? false}
          .language=${this.hass.language}
          @setting-changed=${this._forward("comfort-setting-changed")}
        ></rs-comfort-section>`;
      case "presence":
        return html`<rs-presence-section
          .hass=${this.hass}
          .presenceEnabled=${this.presenceEnabled}
          .presencePersons=${this.presencePersons}
          .selectedPresencePersons=${draft.selectedPresencePersons}
          .ignorePresence=${draft.ignorePresence}
          .editing=${true}
          .language=${this.hass.language}
          @presence-persons-changed=${this._forward("presence-persons-changed")}
          @ignore-presence-changed=${this._forward("ignore-presence-changed")}
        ></rs-presence-section>`;
      case "covers":
        return html`<rs-covers-section
          .hass=${this.hass}
          .area=${this.area}
          .editing=${true}
          .selectedCovers=${draft.selectedCovers}
          .autoEnabled=${draft.coversAutoEnabled}
          .deployThreshold=${draft.coversDeployThreshold}
          .minPosition=${draft.coversMinPosition}
          .overrideMinutes=${draft.coversOverrideMinutes}
          .coverSchedules=${draft.coverSchedules}
          .coverScheduleSelectorEntity=${draft.coverScheduleSelectorEntity}
          .activeCoverScheduleIndex=${live?.active_cover_schedule_index ?? -1}
          .nightClose=${draft.coversNightClose}
          .nightPosition=${draft.coversNightPosition}
          .snapDeploy=${draft.coversSnapDeploy}
          .forcedReason=${live?.cover_forced_reason ?? ""}
          .autoPaused=${live?.cover_auto_paused ?? false}
          .coverOrientations=${draft.coverOrientations}
          .nightCloseElevation=${draft.coversNightCloseElevation}
          .nightCloseOffsetMinutes=${draft.coversNightCloseOffsetMinutes}
          .outdoorMinTemp=${draft.coversOutdoorMinTemp}
          .coverMinPositions=${draft.coverMinPositions}
          @covers-toggle=${this._forward("covers-toggle")}
          @setting-changed=${this._forward("cover-setting-changed")}
        ></rs-covers-section>`;
      case "heatSource":
        return html`<rs-heat-source-section
          .hass=${this.hass}
          .editing=${true}
          .enabled=${draft.heatSourceOrchestration}
          .primaryDelta=${draft.heatSourcePrimaryDelta}
          .outdoorThreshold=${draft.heatSourceOutdoorThreshold}
          .acMinOutdoor=${draft.heatSourceAcMinOutdoor}
          @setting-changed=${this._forward("heat-source-setting-changed")}
        ></rs-heat-source-section>`;
    }
  }

  private _icon(section: RoomEditSection): string {
    switch (section) {
      case "schedule":
        return "mdi:calendar";
      case "devices":
        return "mdi:power-plug";
      case "sensors":
        return "mdi:thermometer";
      case "airflow":
        return "mdi:fan";
      case "comfort":
        return "mdi:weather-night";
      case "presence":
        return "mdi:home-account";
      case "covers":
        return "mdi:blinds-horizontal";
      case "heatSource":
        return "mdi:swap-horizontal";
    }
  }

  private _heading(section: RoomEditSection, lang: string): string {
    switch (section) {
      case "schedule":
        return localize("room.section.schedule", lang);
      case "devices":
        return localize("room.section.devices", lang);
      case "sensors":
        return localize("room.section.sensors", lang);
      case "airflow":
        return localize("room.section.airflow", lang);
      case "comfort":
        return localize("room.section.comfort", lang);
      case "presence":
        return localize("room.section.presence", lang);
      case "covers":
        return localize("room.section.covers", lang);
      case "heatSource":
        return localize("room.section.heat_source", lang);
    }
  }

  private _closeEdit = () => {
    this.dispatchEvent(new CustomEvent("edit-closed", { bubbles: true, composed: true }));
  };

  private _forward(name: string) {
    return (e: CustomEvent) => {
      e.stopPropagation();
      this.dispatchEvent(
        new CustomEvent(name, {
          detail: e.detail,
          bubbles: true,
          composed: true,
        }),
      );
    };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-room-edit-dialog-router": RsRoomEditDialogRouter;
  }
}
