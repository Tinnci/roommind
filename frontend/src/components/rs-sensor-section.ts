import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, HassArea, SensorFusionStatus } from "../types";
import { getEntitiesForArea, isRoomMindEntity } from "../utils/room-state";
import { localize } from "../utils/localize";
import { openEntityInfo } from "../utils/events";
import {
  classifyNonAmbientTempSensor,
  type NonAmbientReason,
} from "../utils/ambient-sensor-filter";
import {
  formatSensorAge,
  formatSensorValue,
  freshnessLabel,
  freshnessSourceLabel,
  isGlobalSensorCandidate,
  resolveSensorHealth,
} from "../utils/sensor-display";
import { tempUnit } from "../utils/temperature";
import { inputStyles } from "../styles/input-styles";
import { sensorSectionStyles } from "../styles/sensor-section-styles";
import "./shared/rs-entity-picker-field";

type SensorKind = "temp" | "humidity" | "occupancy" | "window";

@customElement("rs-sensor-section")
export class RsSensorSection extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public area!: HassArea;
  @property({ type: String }) public temperatureSensor = "";
  @property({ attribute: false }) public temperatureSensors: Set<string> = new Set();
  @property({ type: String }) public humiditySensor = "";
  @property({ attribute: false }) public humiditySensors: Set<string> = new Set();
  @property({ attribute: false }) public occupancySensors: Set<string> = new Set();
  @property({ type: Boolean }) public occupancyEcoEnabled = false;
  @property({ type: Number }) public occupancyEcoDelayMinutes = 15;
  @property({ type: String }) public co2Sensor = "";
  @property({ type: Number }) public co2Threshold = 1000;
  @property({ type: String }) public vocSensor = "";
  @property({ attribute: false }) public vocThreshold: number | null = 250;
  @property({ attribute: false }) public pm25Sensors: Set<string> = new Set();
  @property({ type: Number }) public pm25Threshold = 35;
  @property({ type: String }) public ventilationEntity = "";
  @property({ attribute: false }) public windowSensors: Set<string> = new Set();
  @property({ type: Number }) public windowOpenDelay = 0;
  @property({ type: Number }) public windowCloseDelay = 0;
  @property({ type: String }) public heatingSystemType = "";
  @property({ type: Number }) public sensorConflict = 0;
  @property({ attribute: false }) public sensorFusionStatus: SensorFusionStatus[] = [];
  @property({ type: Boolean, reflect: true }) public editing = false;
  @property() public language = "en";

  @state() private _pickerOpen = false;
  @state() private _collapsed: Partial<Record<SensorKind, boolean>> = {};
  @state() private _showFilteredTempSensors = false;

  static override styles = [inputStyles, sensorSectionStyles];

  override render() {
    if (!this.editing) {
      return this._renderViewMode();
    }
    return this._renderEditMode();
  }

  // ─── View mode ───

  private _renderViewMode() {
    const tempSensorIds = this._temperatureSensorIds();
    const humiditySensorIds = this._humiditySensorIds();
    const hasTempSensors = tempSensorIds.length > 0;
    const hasHumiditySensor = humiditySensorIds.length > 0;
    const hasOccupancySensors = this.occupancySensors.size > 0;
    const hasWindowSensors = this.windowSensors.size > 0;

    if (!hasTempSensors && !hasHumiditySensor && !hasOccupancySensors && !hasWindowSensors) {
      return nothing;
    }

    const lang = this.hass.language;
    return html`
      ${
        hasTempSensors
          ? html`
              <div class="section-subtitle">${localize("devices.temp_sensors", lang)}</div>
              ${tempSensorIds.map((id) => this._renderSensorViewRow(id, "temp"))}
            `
          : nothing
      }
      ${
        hasHumiditySensor
          ? html`
              <div class="section-subtitle">${localize("devices.humidity_sensors", lang)}</div>
              ${humiditySensorIds.map((id) => this._renderSensorViewRow(id, "humidity"))}
            `
          : nothing
      }
      ${
        hasOccupancySensors
          ? html`
              <div class="section-subtitle">${localize("devices.occupancy_sensors", lang)}</div>
              ${[...this.occupancySensors].map((id) => this._renderOccupancyViewRow(id))}
            `
          : nothing
      }
      ${
        hasWindowSensors
          ? html`
              <div class="section-subtitle">${localize("devices.window_sensors", lang)}</div>
              ${[...this.windowSensors].map((id) => this._renderWindowViewRow(id))}
              ${
                this.windowOpenDelay || this.windowCloseDelay
                  ? html`<div class="delay-view">
                      ${
                        this.windowOpenDelay
                          ? html`${localize("devices.window_open_delay", lang)}:
                            ${this.windowOpenDelay}s`
                          : nothing
                      }
                      ${this.windowOpenDelay && this.windowCloseDelay ? " · " : nothing}
                      ${
                        this.windowCloseDelay
                          ? html`${localize("devices.window_close_delay", lang)}:
                            ${this.windowCloseDelay}s`
                          : nothing
                      }
                    </div>`
                  : nothing
              }
            `
          : nothing
      }
    `;
  }

  private _renderWindowViewRow(entityId: string) {
    const entityState = this.hass.states[entityId];
    const friendlyName = (entityState?.attributes?.friendly_name as string) || entityId;
    const isOpen = entityState?.state === "on";

    return html`
      <div class="view-row">
        <span class="view-name entity-link" @click=${() => openEntityInfo(this, entityId)}
          >${friendlyName}</span
        >
        <span class="occupancy-dot window-dot ${isOpen ? "on" : "off"}"></span>
      </div>
    `;
  }

  private _renderSensorViewRow(entityId: string, type: "temp" | "humidity") {
    const entityState = this.hass.states[entityId];
    const friendlyName = (entityState?.attributes?.friendly_name as string) || entityId;
    const state = entityState?.state;
    const attrs = entityState?.attributes ?? {};

    let displayValue = "";
    if (type === "temp") {
      const tempVal = entityId.startsWith("climate.") ? attrs.current_temperature : state;
      if (tempVal != null && tempVal !== "" && tempVal !== "unknown" && tempVal !== "unavailable")
        displayValue = `${Number(tempVal).toFixed(1)}${tempUnit(this.hass)}`;
    } else {
      if (state && state !== "unknown" && state !== "unavailable")
        displayValue = `${Math.round(Number(state))}%`;
    }

    return html`
      <div class="view-row">
        <span class="view-name entity-link" @click=${() => openEntityInfo(this, entityId)}
          >${friendlyName}</span
        >
        ${displayValue ? html`<span class="view-value">${displayValue}</span>` : nothing}
      </div>
    `;
  }

  private _renderOccupancyViewRow(entityId: string) {
    const entityState = this.hass.states[entityId];
    const friendlyName = (entityState?.attributes?.friendly_name as string) || entityId;
    const isOn = entityState?.state === "on";

    return html`
      <div class="view-row">
        <span class="view-name entity-link" @click=${() => openEntityInfo(this, entityId)}
          >${friendlyName}</span
        >
        <span class="occupancy-dot ${isOn ? "on" : "off"}"></span>
      </div>
    `;
  }

  // ─── Edit mode ───

  private _renderEditMode() {
    const allAreaEntities = getEntitiesForArea(
      this.area.area_id,
      this.hass?.entities,
      this.hass?.devices,
    ).filter((entity) => !isRoomMindEntity(entity.entity_id, this.hass.entities));

    const areaTempSensors = this.hass?.states
      ? allAreaEntities.filter(
          (e) =>
            (e.entity_id.startsWith("sensor.") &&
              this.hass.states[e.entity_id]?.attributes?.device_class === "temperature") ||
            (e.entity_id.startsWith("climate.") &&
              this.hass.states[e.entity_id]?.attributes?.current_temperature != null),
        )
      : [];

    const areaHumiditySensors = this.hass?.states
      ? allAreaEntities.filter(
          (e) =>
            e.entity_id.startsWith("sensor.") &&
            this.hass.states[e.entity_id]?.attributes?.device_class === "humidity",
        )
      : [];

    const areaOccupancySensors = this.hass?.states
      ? allAreaEntities.filter(
          (e) =>
            (e.entity_id.startsWith("binary_sensor.") &&
              ["occupancy", "motion", "presence"].includes(
                this.hass.states[e.entity_id]?.attributes?.device_class as string,
              )) ||
            e.entity_id.startsWith("input_boolean."),
        )
      : [];

    const areaTempIds = new Set(areaTempSensors.map((e) => e.entity_id));
    const externalTempSensors = this._temperatureSensorIds().filter((id) => !areaTempIds.has(id));

    const areaHumidityIds = new Set(areaHumiditySensors.map((e) => e.entity_id));
    const externalHumiditySensors = this._humiditySensorIds().filter(
      (id) => !areaHumidityIds.has(id),
    );

    const areaOccupancyIds = new Set(areaOccupancySensors.map((e) => e.entity_id));
    const externalOccupancySensors = [...this.occupancySensors].filter(
      (id) => !areaOccupancyIds.has(id),
    );

    const areaWindowSensors = this.hass?.states
      ? allAreaEntities.filter(
          (e) =>
            e.entity_id.startsWith("binary_sensor.") &&
            ["window", "door", "opening"].includes(
              this.hass.states[e.entity_id]?.attributes?.device_class as string,
            ),
        )
      : [];
    const areaWindowIds = new Set(areaWindowSensors.map((e) => e.entity_id));
    const externalWindowSensors = [...this.windowSensors].filter((id) => !areaWindowIds.has(id));

    const lang = this.hass.language;

    return html`
      ${this._renderTemperatureBlock(areaTempSensors, externalTempSensors, lang)}
      ${this._renderFusionDiagnostics(lang)}
      ${this._renderHumidityBlock(areaHumiditySensors, externalHumiditySensors, lang)}
      ${this._renderBlock({
        kind: "occupancy",
        icon: "mdi:account-eye",
        title: localize("devices.occupancy_sensors", lang),
        emptyText: localize("devices.no_occupancy_sensors", lang),
        areaSensors: areaOccupancySensors,
        externalSensors: externalOccupancySensors,
        selectedCount: this.occupancySensors.size,
        extras: this._renderOccupancyExtras(lang),
      })}
      ${this._renderBlock({
        kind: "window",
        icon: "mdi:window-open-variant",
        title: localize("devices.window_sensors", lang),
        emptyText: localize("devices.no_window_sensors", lang),
        areaSensors: areaWindowSensors,
        externalSensors: externalWindowSensors,
        selectedCount: this.windowSensors.size,
        extras: this._renderWindowExtras(lang),
      })}
      ${this._renderAirQualityBlock(lang)} ${this._renderGlobalAdd(lang)}
    `;
  }

  private _renderTemperatureBlock(
    areaSensors: { entity_id: string }[],
    externalSensors: string[],
    lang: string,
  ) {
    const selectedIds = this._temperatureSensorIds();
    const selectedSet = new Set(selectedIds);
    const ambientAreaSensors: { entity_id: string }[] = [];
    const filteredAreaSensors: { entity_id: string; reason: NonAmbientReason }[] = [];

    for (const entry of areaSensors) {
      const reason = classifyNonAmbientTempSensor(entry.entity_id, this.hass);
      if (reason === null || selectedSet.has(entry.entity_id)) {
        ambientAreaSensors.push(entry);
      } else {
        filteredAreaSensors.push({ entity_id: entry.entity_id, reason });
      }
    }

    const total = ambientAreaSensors.length + externalSensors.length;
    const isCollapsed = this._collapsed.temp ?? false;
    const ids = [
      ...ambientAreaSensors.map((e) => ({ entityId: e.entity_id, external: false })),
      ...externalSensors.map((entityId) => ({ entityId, external: true })),
    ];

    return html`
      <div class="sensor-block ${isCollapsed ? "collapsed" : ""}">
        <div class="block-header" @click=${() => this._toggleBlock("temp")}>
          <ha-icon icon="mdi:thermometer"></ha-icon>
          <div class="block-title">${localize("devices.temp_sensors", lang)}</div>
          ${
            selectedIds.length > 0
              ? html`<span class="count-chip has-selection">${selectedIds.length}</span>`
              : total > 0
                ? html`<span class="count-chip">${total}</span>`
                : nothing
          }
          <ha-icon
            class="chevron ${isCollapsed ? "collapsed" : ""}"
            icon="mdi:chevron-down"
          ></ha-icon>
        </div>
        ${
          isCollapsed
            ? nothing
            : html`
                <div class="block-body temperature-stack">
                  ${
                    ids.length > 0
                      ? html`
                          <div class="sensor-table">
                            <div class="sensor-table-title">
                              <ha-icon icon="mdi:sort-ascending"></ha-icon>
                              ${localize("devices.temperature_priority_sources", lang)}
                            </div>
                            <div class="sensor-table-hint">
                              ${localize("devices.temperature_priority_hint", lang)}
                            </div>
                            ${ids.map(({ entityId, external }) =>
                              this._renderPrioritySensorRow(
                                entityId,
                                external,
                                "temp",
                                selectedIds.indexOf(entityId),
                              ),
                            )}
                          </div>
                        `
                      : html`<div class="empty-row">
                          ${localize("devices.no_temp_sensors", lang)}
                        </div>`
                  }
                  ${
                    filteredAreaSensors.length > 0
                      ? html`
                          <div class="filtered-sensors-wrap">
                            <button
                              type="button"
                              class="filtered-sensors-toggle"
                              @click=${() => {
                                this._showFilteredTempSensors = !this._showFilteredTempSensors;
                              }}
                            >
                              <ha-icon
                                icon=${
                                  this._showFilteredTempSensors
                                    ? "mdi:chevron-up"
                                    : "mdi:filter-off-outline"
                                }
                              ></ha-icon>
                              <span>
                                ${localize(
                                  this._showFilteredTempSensors
                                    ? "devices.filtered_temp_toggle_hide"
                                    : "devices.filtered_temp_toggle_show",
                                  lang,
                                  { count: String(filteredAreaSensors.length) },
                                )}
                              </span>
                            </button>
                            ${
                              this._showFilteredTempSensors
                                ? html`
                                    <div class="sensor-table">
                                      ${filteredAreaSensors.map(({ entity_id, reason }) =>
                                        this._renderPrioritySensorRow(
                                          entity_id,
                                          false,
                                          "temp",
                                          selectedIds.indexOf(entity_id),
                                          reason,
                                        ),
                                      )}
                                    </div>
                                  `
                                : nothing
                            }
                          </div>
                        `
                      : nothing
                  }
                </div>
              `
        }
      </div>
    `;
  }

  private _renderHumidityBlock(
    areaSensors: { entity_id: string }[],
    externalSensors: string[],
    lang: string,
  ) {
    const total = areaSensors.length + externalSensors.length;
    const isCollapsed = this._collapsed.humidity ?? true;
    const ids = [
      ...areaSensors.map((e) => ({ entityId: e.entity_id, external: false })),
      ...externalSensors.map((entityId) => ({ entityId, external: true })),
    ];
    const selectedIds = this._humiditySensorIds();

    return html`
      <div class="sensor-block ${isCollapsed ? "collapsed" : ""}">
        <div class="block-header" @click=${() => this._toggleBlock("humidity")}>
          <ha-icon icon="mdi:water-percent"></ha-icon>
          <div class="block-title">${localize("devices.humidity_sensors", lang)}</div>
          ${
            selectedIds.length > 0
              ? html`<span class="count-chip has-selection">${selectedIds.length}</span>`
              : total > 0
                ? html`<span class="count-chip">${total}</span>`
                : nothing
          }
          <ha-icon
            class="chevron ${isCollapsed ? "collapsed" : ""}"
            icon="mdi:chevron-down"
          ></ha-icon>
        </div>
        ${
          isCollapsed
            ? nothing
            : html`
                <div class="block-body temperature-stack">
                  ${
                    ids.length > 0
                      ? html`
                          <div class="sensor-table">
                            <div class="sensor-table-title">
                              <ha-icon icon="mdi:sort-ascending"></ha-icon>
                              ${localize("devices.humidity_priority_sources", lang)}
                            </div>
                            <div class="sensor-table-hint">
                              ${localize("devices.humidity_priority_hint", lang)}
                            </div>
                            ${ids.map(({ entityId, external }) =>
                              this._renderPrioritySensorRow(
                                entityId,
                                external,
                                "humidity",
                                selectedIds.indexOf(entityId),
                              ),
                            )}
                          </div>
                        `
                      : html`<div class="empty-row">
                          ${localize("devices.no_humidity_sensors", lang)}
                        </div>`
                  }
                </div>
              `
        }
      </div>
    `;
  }

  private _renderPrioritySensorRow(
    entityId: string,
    external: boolean,
    kind: "temp" | "humidity",
    priorityIndex: number,
    filteredReason: NonAmbientReason | null = null,
  ) {
    const state = this.hass.states[entityId];
    const friendlyName = (state?.attributes?.friendly_name as string) || entityId;
    const lang = this.hass.language;
    const selected = priorityIndex >= 0;
    const formatted = this._formatSensorValue(entityId, kind);
    const health = this._sensorHealth(entityId);
    const selectedIds = kind === "temp" ? this._temperatureSensorIds() : this._humiditySensorIds();
    const roleLabel =
      priorityIndex === 0
        ? localize("devices.priority_primary", lang)
        : selected
          ? localize("devices.priority_backup", lang, { index: String(priorityIndex + 1) })
          : localize("devices.priority_disabled", lang);
    const filteredReasonLabel =
      filteredReason === "appliance"
        ? localize("devices.filtered_reason_appliance", lang)
        : filteredReason === "diagnostic"
          ? localize("devices.filtered_reason_diagnostic", lang)
          : filteredReason === "outdoor"
            ? localize("devices.filtered_reason_outdoor", lang)
            : "";
    return html`
      <div
        class="sensor-table-row ${selected ? "selected" : ""}"
        @click=${(e: Event) => {
          const tag = (e.target as HTMLElement).tagName;
          if (tag === "HA-CHECKBOX" || tag === "BUTTON" || tag === "HA-ICON") return;
          this._onPrioritySensorToggle(entityId, kind, !selected);
        }}
      >
        <ha-checkbox
          .checked=${selected}
          @change=${(e: Event) => {
            const target = e.target as HTMLElement & { checked: boolean };
            this._onPrioritySensorToggle(entityId, kind, target.checked);
          }}
        ></ha-checkbox>
        <div class="row-info">
          <div class="row-name-line">
            <span class="row-name">${friendlyName}</span>
            ${
              external
                ? html`<span class="external-badge">${localize("devices.other_area", lang)}</span>`
                : nothing
            }
            ${
              filteredReasonLabel
                ? html`<span class="filtered-reason-badge">${filteredReasonLabel}</span>`
                : nothing
            }
          </div>
          <div class="row-eid">${entityId}</div>
        </div>
        <span class="value-chip">${formatted || localize("room.status.not_set", lang)}</span>
        <span class="health-chip ${health.className}">${health.label}</span>
        <span class="role-chip ${priorityIndex > 0 ? "aux" : selected ? "" : "disabled"}">
          ${roleLabel}
        </span>
        <span class="priority-actions">
          <button
            class="priority-button"
            type="button"
            title=${localize("devices.priority_move_up", lang)}
            ?disabled=${!selected || priorityIndex <= 0}
            @click=${(e: Event) => {
              e.stopPropagation();
              this._movePrioritySensor(entityId, kind, -1);
            }}
          >
            <ha-icon icon="mdi:chevron-up"></ha-icon>
          </button>
          <button
            class="priority-button"
            type="button"
            title=${localize("devices.priority_move_down", lang)}
            ?disabled=${!selected || priorityIndex < 0 || priorityIndex >= selectedIds.length - 1}
            @click=${(e: Event) => {
              e.stopPropagation();
              this._movePrioritySensor(entityId, kind, 1);
            }}
          >
            <ha-icon icon="mdi:chevron-down"></ha-icon>
          </button>
        </span>
      </div>
    `;
  }

  private _renderFusionDiagnostics(lang: string) {
    if (!this.sensorFusionStatus?.length) return nothing;
    const conflictPercent = Math.round(Math.max(0, Math.min(1, this.sensorConflict || 0)) * 100);
    const ordered = [...this.sensorFusionStatus].sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary),
    );
    return html`
      <div class="fusion-panel">
        <div class="fusion-header">
          <ha-icon icon="mdi:chart-timeline-variant"></ha-icon>
          <div class="fusion-title">${localize("devices.sensor_fusion", lang)}</div>
          <div class="fusion-conflict">
            ${localize("devices.sensor_conflict", lang)} ${conflictPercent}%
          </div>
        </div>
        <div class="fusion-list">
          ${ordered.map((status) => this._renderFusionRow(status, lang))}
        </div>
      </div>
    `;
  }

  private _renderFusionRow(status: SensorFusionStatus, lang: string) {
    const state = this.hass.states[status.entity_id];
    const friendlyName = (state?.attributes?.friendly_name as string) || status.entity_id;
    const unit = tempUnit(this.hass);
    const bias = status.static_bias + status.active_bias;
    return html`
      <div class="fusion-row">
        <div>
          <div
            class="fusion-name entity-link"
            @click=${() => openEntityInfo(this, status.entity_id)}
          >
            ${friendlyName}
          </div>
          <div class="fusion-meta">
            <span class="fusion-chip ${status.is_primary ? "primary" : ""}">
              ${
                status.is_primary
                  ? localize("devices.primary_sensor", lang)
                  : status.sensor_class === "hvac_internal"
                    ? localize("devices.sensor_hvac_internal", lang)
                    : localize("devices.sensor_auxiliary", lang)
              }
            </span>
            <span class="fusion-chip ${status.freshness_status}">
              ${this._freshnessLabel(status.freshness_status, lang)}
            </span>
            <span class="fusion-chip"
              >${this._freshnessSourceLabel(status.freshness_source, lang)}</span
            >
            <span class="fusion-chip">${this._formatAge(status.age_s)}</span>
            ${
              typeof status.cadence_s === "number"
                ? html`<span class="fusion-chip">~${Math.round(status.cadence_s)}s</span>`
                : nothing
            }
          </div>
        </div>
        <div class="fusion-values">
          ${
            typeof status.weight === "number"
              ? html`<span class="fusion-chip"
                  >${localize("devices.sensor_weight", lang)}
                  ${Math.round(status.weight * 100)}%</span
                >`
              : nothing
          }
          <span class="fusion-chip">
            ${localize("devices.sensor_corrected", lang)}
            ${Number(status.corrected_value).toFixed(1)}${unit}
          </span>
          <span class="fusion-chip">
            ${localize("devices.sensor_bias", lang)}
            ${bias >= 0 ? "+" : ""}${bias.toFixed(2)}${unit}
          </span>
          <span class="fusion-chip">Var ${Number(status.variance).toFixed(3)}</span>
        </div>
      </div>
    `;
  }

  private _freshnessLabel(status: string, lang: string): string {
    return freshnessLabel(status, lang);
  }

  private _freshnessSourceLabel(source: string, lang: string): string {
    return freshnessSourceLabel(source, lang);
  }

  private _formatAge(ageSeconds: number): string {
    return formatSensorAge(ageSeconds);
  }

  private _emitSensor(key: string, value: unknown) {
    this.dispatchEvent(
      new CustomEvent("sensor-changed", {
        detail: { key, value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _renderAirQualityBlock(lang: string) {
    const pm25List = [...this.pm25Sensors];
    return html`
      <div class="sensor-block">
        <div class="block-header">
          <ha-icon icon="mdi:air-filter"></ha-icon>
          <div class="block-title">${localize("sensors.air_quality_title", lang)}</div>
        </div>
        <div class="block-body" style="gap: 10px">
          <div class="delay-fields" style="align-items: flex-end">
            <rs-entity-picker-field
              .hass=${this.hass}
              .label=${localize("sensors.co2_sensor", lang)}
              .value=${this.co2Sensor}
              .includeDomains=${["sensor"]}
              @value-changed=${(e: CustomEvent<{ value: string }>) =>
                this._emitSensor("co2_sensor", e.detail.value ?? "")}
            ></rs-entity-picker-field>
            ${
              this.co2Sensor
                ? html`<ha-textfield
                    type="number"
                    min="800"
                    max="5000"
                    suffix="ppm"
                    .label=${localize("sensors.co2_threshold", lang)}
                    .value=${String(this.co2Threshold)}
                    @change=${(e: Event) => {
                      const v = parseInt((e.target as HTMLInputElement).value, 10);
                      if (!isNaN(v) && v >= 800 && v <= 5000) this._emitSensor("co2_threshold", v);
                    }}
                  ></ha-textfield>`
                : nothing
            }
          </div>

          <div class="delay-fields" style="align-items: flex-end">
            <rs-entity-picker-field
              .hass=${this.hass}
              .label=${localize("sensors.voc_sensor", lang)}
              .value=${this.vocSensor}
              .includeDomains=${["sensor"]}
              @value-changed=${(e: CustomEvent<{ value: string }>) =>
                this._emitSensor("voc_sensor", e.detail.value ?? "")}
            ></rs-entity-picker-field>
            ${
              this.vocSensor
                ? html`<ha-textfield
                    type="number"
                    min="1"
                    max="10000"
                    .label=${localize("sensors.voc_threshold", lang)}
                    .value=${this.vocThreshold === null ? "" : String(this.vocThreshold)}
                    @change=${(e: Event) => {
                      const raw = (e.target as HTMLInputElement).value.trim();
                      if (!raw) {
                        this._emitSensor("voc_threshold", null);
                      } else {
                        const v = parseFloat(raw);
                        if (Number.isFinite(v) && v > 0) this._emitSensor("voc_threshold", v);
                      }
                    }}
                  ></ha-textfield>`
                : nothing
            }
          </div>

          <div class="delay-fields" style="align-items: flex-end">
            <rs-entity-picker-field
              .hass=${this.hass}
              .label=${localize("sensors.pm25_sensor", lang)}
              .value=${pm25List[0] ?? ""}
              .includeDomains=${["sensor"]}
              @value-changed=${(e: CustomEvent<{ value: string }>) => {
                const v = e.detail.value ?? "";
                this._emitSensor("pm25_sensors", v ? [v] : []);
              }}
            ></rs-entity-picker-field>
            ${
              pm25List.length > 0
                ? html`<ha-textfield
                    type="number"
                    min="5"
                    max="500"
                    suffix="µg/m³"
                    .label=${localize("sensors.pm25_threshold", lang)}
                    .value=${String(this.pm25Threshold)}
                    @change=${(e: Event) => {
                      const v = parseFloat((e.target as HTMLInputElement).value);
                      if (Number.isFinite(v) && v >= 5 && v <= 500) {
                        this._emitSensor("air_quality_pm25_threshold", v);
                      }
                    }}
                  ></ha-textfield>`
                : nothing
            }
          </div>

          <rs-entity-picker-field
            .hass=${this.hass}
            .label=${localize("sensors.ventilation_entity", lang)}
            .value=${this.ventilationEntity}
            .includeDomains=${["fan", "switch", "input_boolean"]}
            @value-changed=${(e: CustomEvent<{ value: string }>) =>
              this._emitSensor("ventilation_entity", e.detail.value ?? "")}
          ></rs-entity-picker-field>
        </div>
      </div>
    `;
  }

  private _renderOccupancyExtras(lang: string) {
    if (this.occupancySensors.size === 0) return nothing;
    return html`
      <div class="delay-fields" style="align-items: center; margin-top: 8px">
        <label
          style="display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer"
        >
          <ha-checkbox
            .checked=${this.occupancyEcoEnabled}
            @change=${(e: Event) =>
              this.dispatchEvent(
                new CustomEvent("sensor-changed", {
                  detail: {
                    key: "occupancy_eco_enabled",
                    value: (e.target as HTMLInputElement).checked,
                  },
                  bubbles: true,
                  composed: true,
                }),
              )}
          ></ha-checkbox>
          <span>${localize("devices.occupancy_eco", lang)}</span>
        </label>
        ${
          this.occupancyEcoEnabled
            ? html`
                <ha-textfield
                  type="number"
                  min="5"
                  max="240"
                  suffix="min"
                  .label=${localize("devices.occupancy_eco_delay", lang)}
                  .value=${String(this.occupancyEcoDelayMinutes)}
                  @change=${(e: Event) => {
                    const v = parseInt((e.target as HTMLInputElement).value, 10);
                    if (!isNaN(v) && v >= 5 && v <= 240) {
                      this.dispatchEvent(
                        new CustomEvent("sensor-changed", {
                          detail: { key: "occupancy_eco_delay_minutes", value: v },
                          bubbles: true,
                          composed: true,
                        }),
                      );
                    }
                  }}
                ></ha-textfield>
              `
            : nothing
        }
      </div>
      <div class="delay-hint" style="margin-top: 4px">
        <ha-icon icon="mdi:information-outline"></ha-icon>
        ${localize("sensors.occupancy_eco_info", lang)}
      </div>
    `;
  }

  private _renderWindowExtras(lang: string) {
    if (this.windowSensors.size === 0) return nothing;
    return html`
      <div class="delay-fields">
        <ha-textfield
          type="number"
          min="0"
          suffix="s"
          .label=${localize("devices.window_open_delay", lang)}
          .value=${String(this.windowOpenDelay)}
          @change=${this._onWindowOpenDelayChange}
        ></ha-textfield>
        <ha-textfield
          type="number"
          min="0"
          suffix="s"
          .label=${localize("devices.window_close_delay", lang)}
          .value=${String(this.windowCloseDelay)}
          @change=${this._onWindowCloseDelayChange}
        ></ha-textfield>
      </div>
      ${
        this.heatingSystemType === "underfloor" && this.windowOpenDelay < 300
          ? html`
              <div class="delay-hint">
                <ha-icon icon="mdi:information-outline"></ha-icon>
                ${localize("devices.underfloor_delay_hint", lang)}
              </div>
            `
          : nothing
      }
    `;
  }

  private _renderGlobalAdd(lang: string) {
    if (this._pickerOpen) {
      return html`
        <div class="global-add">
          <ha-entity-picker
            .hass=${this.hass}
            .includeDomains=${[
              "sensor",
              "binary_sensor",
              "climate",
              "input_number",
              "input_boolean",
            ]}
            .entityFilter=${this._globalEntityFilter}
            .value=${""}
            .autofocus=${true}
            label=${localize("devices.add_entity", lang)}
            @value-changed=${this._onGlobalPickerValueChanged}
          ></ha-entity-picker>
          <ha-icon-button
            class="picker-close"
            .path=${"M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"}
            @click=${() => (this._pickerOpen = false)}
          ></ha-icon-button>
        </div>
      `;
    }
    return html`
      <button type="button" class="add-button global" @click=${() => (this._pickerOpen = true)}>
        <ha-icon icon="mdi:plus"></ha-icon>
        ${localize("devices.add_entity", lang)}
      </button>
    `;
  }

  private _renderBlock(opts: {
    kind: SensorKind;
    icon: string;
    title: string;
    emptyText: string;
    areaSensors: { entity_id: string }[];
    externalSensors: string[];
    selectedCount: number;
    extras?: unknown;
  }) {
    const total = opts.areaSensors.length + opts.externalSensors.length;
    const isCollapsed = this._collapsed[opts.kind] ?? true;
    return html`
      <div class="sensor-block ${isCollapsed ? "collapsed" : ""}">
        <div class="block-header" @click=${() => this._toggleBlock(opts.kind)}>
          <ha-icon icon=${opts.icon}></ha-icon>
          <div class="block-title">${opts.title}</div>
          ${
            opts.selectedCount > 0
              ? html`<span class="count-chip has-selection">${opts.selectedCount}</span>`
              : total > 0
                ? html`<span class="count-chip">${total}</span>`
                : nothing
          }
          <ha-icon
            class="chevron ${isCollapsed ? "collapsed" : ""}"
            icon="mdi:chevron-down"
          ></ha-icon>
        </div>
        ${
          isCollapsed
            ? nothing
            : html`
                <div class="block-body">
                  <div class="row-list">
                    ${
                      opts.areaSensors.length > 0 || opts.externalSensors.length > 0
                        ? html`
                            ${opts.areaSensors.map((e) =>
                              this._renderEditRow(e.entity_id, opts.kind, false),
                            )}
                            ${opts.externalSensors.map((id) =>
                              this._renderEditRow(id, opts.kind, true),
                            )}
                          `
                        : html`<div class="empty-row">${opts.emptyText}</div>`
                    }
                  </div>
                  ${opts.extras ?? nothing}
                </div>
              `
        }
      </div>
    `;
  }

  private _toggleBlock(kind: SensorKind) {
    const currentlyCollapsed = this._collapsed[kind] ?? true;
    this._collapsed = { ...this._collapsed, [kind]: !currentlyCollapsed };
  }

  private _renderEditRow(entityId: string, kind: SensorKind, external: boolean) {
    const state = this.hass.states[entityId];
    const friendlyName = (state?.attributes?.friendly_name as string) || entityId;
    const lang = this.hass.language;

    if (kind === "occupancy" || kind === "window") {
      const set = kind === "occupancy" ? this.occupancySensors : this.windowSensors;
      const isSelected = set.has(entityId);
      const isOn = state?.state === "on";
      const dotClass = kind === "window" ? "occupancy-dot window-dot" : "occupancy-dot";
      const onChange = (checked: boolean) =>
        kind === "occupancy"
          ? this._onOccupancyToggle(entityId, checked)
          : this._onWindowToggle(entityId, checked);
      return html`
        <div
          class="row ${isSelected ? "selected" : ""}"
          @click=${(e: Event) => {
            if ((e.target as HTMLElement).tagName === "HA-CHECKBOX") return;
            onChange(!isSelected);
          }}
        >
          <ha-checkbox
            .checked=${isSelected}
            @change=${(e: Event) => {
              const t = e.target as HTMLElement & { checked: boolean };
              onChange(t.checked);
            }}
          ></ha-checkbox>
          <div class="row-info">
            <div class="row-name-line">
              <span class="row-name">${friendlyName}</span>
              ${
                external
                  ? html`<span class="external-badge"
                      >${localize("devices.other_area", lang)}</span
                    >`
                  : nothing
              }
            </div>
            <div class="row-eid">${entityId}</div>
          </div>
          <span class="${dotClass} ${isOn ? "on" : "off"}"></span>
        </div>
      `;
    }

    const selected = kind === "temp" ? this.temperatureSensor : this.humiditySensor;
    const isSelected = selected === entityId;
    const isIncludedTemp = this.temperatureSensors.has(entityId) || isSelected;
    const unit = kind === "temp" ? tempUnit(this.hass) : "%";
    const currentValue = entityId.startsWith("climate.")
      ? state?.attributes?.current_temperature
      : state?.state;
    const hasValue = currentValue && currentValue !== "unknown" && currentValue !== "unavailable";
    const formatted = hasValue
      ? `${kind === "humidity" ? Math.round(Number(currentValue)) : Number(currentValue).toFixed(1)}${unit}`
      : "";

    return html`
      <div
        class="row ${isSelected || (kind === "temp" && isIncludedTemp) ? "selected" : ""}"
        @click=${(e: Event) => {
          if ((e.target as HTMLElement).tagName === "HA-CHECKBOX") return;
          this._onSensorSelected(isSelected ? "" : entityId, kind);
        }}
      >
        ${
          kind === "temp"
            ? html`
                <div class="temp-controls">
                  <ha-radio .checked=${isSelected} name="temp-sensor"></ha-radio>
                  <span class="temp-role">${localize("devices.primary_sensor", lang)}</span>
                  <ha-checkbox
                    .checked=${isIncludedTemp}
                    @change=${(e: Event) => {
                      const t = e.target as HTMLElement & { checked: boolean };
                      this._onTemperatureSensorToggle(entityId, t.checked);
                    }}
                  ></ha-checkbox>
                </div>
              `
            : html`<ha-radio .checked=${isSelected} name="${kind}-sensor"></ha-radio>`
        }
        <div class="row-info">
          <div class="row-name-line">
            <span class="row-name">${friendlyName}</span>
            ${
              external
                ? html`<span class="external-badge">${localize("devices.other_area", lang)}</span>`
                : nothing
            }
          </div>
          <div class="row-eid">${entityId}</div>
        </div>
        ${formatted ? html`<span class="value-chip">${formatted}</span>` : nothing}
      </div>
    `;
  }

  private _formatSensorValue(entityId: string, kind: "temp" | "humidity"): string {
    return formatSensorValue(this.hass, entityId, kind);
  }

  private _sensorHealth(entityId: string): { label: string; className: string } {
    return resolveSensorHealth(this.hass, this.sensorFusionStatus, entityId);
  }

  private _globalEntityFilter = (entity: { entity_id: string }): boolean =>
    isGlobalSensorCandidate(this.hass, entity.entity_id, {
      temperatureSensor: this.temperatureSensor,
      temperatureSensors: this.temperatureSensors,
      humiditySensor: this.humiditySensor,
      humiditySensors: this.humiditySensors,
      occupancySensors: this.occupancySensors,
      windowSensors: this.windowSensors,
    });

  private _onGlobalPickerValueChanged = (e: CustomEvent) => {
    const entityId = e.detail?.value as string;
    const picker = e.target as HTMLElement & { value: string };
    picker.value = "";
    if (!entityId) {
      return;
    }

    if (entityId.startsWith("binary_sensor.")) {
      const dc = this.hass.states[entityId]?.attributes?.device_class;
      if (dc === "window" || dc === "door" || dc === "opening") {
        if (!this.windowSensors.has(entityId)) this._onWindowToggle(entityId, true);
      } else if (!this.occupancySensors.has(entityId)) {
        this._onOccupancyToggle(entityId, true);
      }
    } else if (entityId.startsWith("input_boolean.")) {
      if (!this.occupancySensors.has(entityId)) this._onOccupancyToggle(entityId, true);
    } else if (entityId.startsWith("input_number.")) {
      const uom = this.hass.states[entityId]?.attributes?.unit_of_measurement;
      if (uom === "%") this._onPrioritySensorToggle(entityId, "humidity", true);
      else this._onPrioritySensorToggle(entityId, "temp", true);
    } else if (entityId.startsWith("climate.")) {
      this._onPrioritySensorToggle(entityId, "temp", true);
    } else {
      const dc = this.hass.states[entityId]?.attributes?.device_class;
      this._onPrioritySensorToggle(entityId, dc === "humidity" ? "humidity" : "temp", true);
    }
    this._pickerOpen = false;
  };

  private _onSensorSelected(entityId: string, kind: "temp" | "humidity") {
    const key = kind === "temp" ? "temperature_sensor" : "humidity_sensor";
    this.dispatchEvent(
      new CustomEvent("sensor-changed", {
        detail: { key, value: entityId },
        bubbles: true,
        composed: true,
      }),
    );
    if (kind === "temp") {
      if (entityId) {
        this._onTemperatureSensorToggle(entityId, true);
      } else {
        this.dispatchEvent(
          new CustomEvent("sensor-changed", {
            detail: { key: "temperature_sensors", value: [] },
            bubbles: true,
            composed: true,
          }),
        );
      }
    }
  }

  private _onPrioritySensorToggle(entityId: string, kind: "temp" | "humidity", checked: boolean) {
    const selectedIds = kind === "temp" ? this._temperatureSensorIds() : this._humiditySensorIds();
    const next = checked
      ? selectedIds.includes(entityId)
        ? selectedIds
        : [...selectedIds, entityId]
      : selectedIds.filter((id) => id !== entityId);
    this._emitPrioritySensors(kind, next);
  }

  private _movePrioritySensor(entityId: string, kind: "temp" | "humidity", direction: -1 | 1) {
    const selectedIds = kind === "temp" ? this._temperatureSensorIds() : this._humiditySensorIds();
    const index = selectedIds.indexOf(entityId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= selectedIds.length) return;
    const next = [...selectedIds];
    const current = next[index];
    const target = next[nextIndex];
    if (!current || !target) return;
    next[index] = target;
    next[nextIndex] = current;
    this._emitPrioritySensors(kind, next);
  }

  private _emitPrioritySensors(kind: "temp" | "humidity", ids: string[]) {
    const primaryKey = kind === "temp" ? "temperature_sensor" : "humidity_sensor";
    const listKey = kind === "temp" ? "temperature_sensors" : "humidity_sensors";
    const primary = ids[0] ?? "";
    this.dispatchEvent(
      new CustomEvent("sensor-changed", {
        detail: { key: primaryKey, value: primary },
        bubbles: true,
        composed: true,
      }),
    );
    this.dispatchEvent(
      new CustomEvent("sensor-changed", {
        detail: { key: listKey, value: ids },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onTemperatureSensorToggle(entityId: string, checked: boolean) {
    const next = new Set(this.temperatureSensors);
    if (checked) next.add(entityId);
    else next.delete(entityId);
    this.dispatchEvent(
      new CustomEvent("sensor-changed", {
        detail: { key: "temperature_sensors", value: [...next] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _temperatureSensorIds(): string[] {
    const ids: string[] = [];
    if (this.temperatureSensor) ids.push(this.temperatureSensor);
    for (const id of this.temperatureSensors) {
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  private _humiditySensorIds(): string[] {
    const ids: string[] = [];
    if (this.humiditySensor) ids.push(this.humiditySensor);
    for (const id of this.humiditySensors) {
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  private _onOccupancyToggle(entityId: string, checked: boolean) {
    const next = new Set(this.occupancySensors);
    if (checked) next.add(entityId);
    else next.delete(entityId);
    this.dispatchEvent(
      new CustomEvent("sensor-changed", {
        detail: { key: "occupancy_sensors", value: [...next] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onWindowToggle(entityId: string, checked: boolean) {
    const next = new Set(this.windowSensors);
    if (checked) next.add(entityId);
    else next.delete(entityId);
    this.dispatchEvent(
      new CustomEvent("sensor-changed", {
        detail: { key: "window_sensors", value: [...next] },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onWindowOpenDelayChange = (e: Event) => {
    const value = Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0);
    this.dispatchEvent(
      new CustomEvent("sensor-changed", {
        detail: { key: "window_open_delay", value },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onWindowCloseDelayChange = (e: Event) => {
    const value = Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0);
    this.dispatchEvent(
      new CustomEvent("sensor-changed", {
        detail: { key: "window_close_delay", value },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-sensor-section": RsSensorSection;
  }
}
