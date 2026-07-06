import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, HassArea, SensorFusionStatus } from "../types";
import { getEntitiesForArea } from "../utils/room-state";
import { localize } from "../utils/localize";
import { openEntityInfo } from "../utils/events";
import { tempUnit } from "../utils/temperature";
import { inputStyles } from "../styles/input-styles";

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

  static override styles = [
    inputStyles,
    css`
      :host {
        display: block;
      }

      :host([editing]) {
        background: transparent;
      }

      .sensor-block {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 12px 14px;
        background: var(--roommind-surface-subtle);
        border: var(--roommind-border-subtle);
        border-radius: 8px;
      }

      .sensor-block + .sensor-block {
        margin-top: 12px;
      }

      .block-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-bottom: 6px;
        cursor: pointer;
        user-select: none;
      }

      .block-header:hover .block-title {
        color: var(--primary-color);
      }

      .block-header ha-icon {
        --mdc-icon-size: 18px;
        color: var(--secondary-text-color);
      }

      .chevron {
        --mdc-icon-size: 18px;
        color: var(--secondary-text-color);
        transition: transform 0.2s ease;
      }

      .chevron.collapsed {
        transform: rotate(-90deg);
      }

      .block-body {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .sensor-block.collapsed .block-header {
        padding-bottom: 0;
      }

      .block-title {
        font-size: 13px;
        font-weight: 500;
        color: var(--primary-text-color);
        letter-spacing: 0;
        flex: 1;
      }

      .count-chip {
        font-size: 11px;
        font-weight: 500;
        padding: 1px 7px;
        border-radius: 8px;
        background: var(--roommind-surface-muted);
        color: var(--secondary-text-color);
      }

      .count-chip.has-selection {
        background: var(--roommind-primary-strong);
        color: var(--primary-color);
      }

      .row-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 168px;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
      }

      .temperature-stack {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .sensor-table {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .sensor-table-title {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--primary-text-color);
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      .sensor-table-hint {
        color: var(--secondary-text-color);
        font-size: 11.5px;
        line-height: 1.45;
        margin: -2px 0 4px 25px;
      }

      .sensor-table-title ha-icon {
        --mdc-icon-size: 17px;
        color: var(--secondary-text-color);
      }

      .sensor-table-row {
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr) auto auto auto;
        align-items: center;
        gap: 10px;
        min-width: 0;
        min-height: 44px;
        padding: 7px 8px;
        border: 1px solid transparent;
        border-radius: 8px;
        background: var(--roommind-surface-subtle);
        cursor: pointer;
      }

      .sensor-table-row:hover {
        background: var(--roommind-surface-hover);
      }

      .sensor-table-row.selected {
        border-color: var(--roommind-primary-border);
        background: var(--roommind-primary-muted);
      }

      .sensor-table-row ha-checkbox,
      .sensor-table-row ha-radio {
        margin: -4px 0;
      }

      .role-chip,
      .health-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 20px;
        padding: 2px 7px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.35;
        white-space: nowrap;
      }

      .role-chip {
        color: var(--primary-color);
        background: var(--roommind-primary-strong);
      }

      .role-chip.aux {
        color: var(--secondary-text-color);
        background: var(--roommind-surface-muted);
      }

      .role-chip.disabled {
        color: var(--secondary-text-color);
        background: var(--roommind-surface-subtle);
      }

      .priority-actions {
        display: inline-flex;
        align-items: center;
        gap: 2px;
      }

      .priority-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: var(--roommind-border-faint);
        border-radius: 6px;
        background: var(--roommind-surface-subtle);
        color: var(--secondary-text-color);
        cursor: pointer;
      }

      .priority-button:hover:not(:disabled),
      .priority-button:focus-visible:not(:disabled) {
        color: var(--primary-color);
        border-color: var(--roommind-primary-border);
        outline: none;
      }

      .priority-button:disabled {
        opacity: 0.35;
        cursor: default;
      }

      .priority-button ha-icon {
        --mdc-icon-size: 17px;
      }

      .health-chip {
        color: var(--secondary-text-color);
        background: var(--roommind-surface-muted);
      }

      .health-chip.fresh {
        color: var(--success-color, #4caf50);
        background: var(--roommind-success-tint);
      }

      .health-chip.aging {
        color: var(--warning-color, #ff9800);
        background: var(--roommind-warning-tint);
      }

      .health-chip.stale,
      .health-chip.unavailable {
        color: var(--error-color, #f44336);
        background: var(--roommind-error-tint);
      }

      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
        border-radius: 8px;
        cursor: pointer;
        border-left: 2px solid transparent;
        transition:
          background 0.15s,
          border-color 0.15s;
        min-width: 0;
      }

      .row:hover {
        background: var(--roommind-surface-hover);
      }

      .row.selected {
        background: var(--roommind-primary-muted);
        border-left-color: var(--primary-color);
      }

      .row ha-checkbox,
      .row ha-radio {
        flex-shrink: 0;
        margin: -4px 0;
      }

      .temp-controls {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }

      .temp-role {
        font-size: 10px;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        letter-spacing: 0;
        min-width: 28px;
      }

      .row-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
      }

      .row-name-line {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }

      .row-name {
        font-size: 13px;
        font-weight: 450;
        color: var(--primary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .row-eid {
        font-family: var(--code-font-family, monospace);
        font-size: 10.5px;
        color: var(--secondary-text-color);
        opacity: 0.65;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .external-badge {
        display: inline-flex;
        align-items: center;
        font-size: 9.5px;
        font-weight: 500;
        color: var(--warning-color, #ff9800);
        background: rgba(255, 152, 0, 0.1);
        padding: 1px 6px;
        border-radius: 8px;
        letter-spacing: 0;
        text-transform: uppercase;
        flex-shrink: 0;
      }

      .value-chip {
        flex-shrink: 0;
        font-size: 12px;
        font-weight: 500;
        padding: 3px 9px;
        border-radius: 8px;
        background: var(--roommind-surface-muted);
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
      }

      .row.selected .value-chip {
        background: var(--roommind-primary-strong);
        color: var(--primary-color);
      }

      .occupancy-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
        transition: background 0.2s;
      }

      .occupancy-dot.on {
        background: var(--success-color, #4caf50);
        box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.18);
      }

      .occupancy-dot.off {
        background: var(--roommind-surface-strong);
      }

      .window-dot.on {
        background: var(--warning-color, #ff9800);
        box-shadow: 0 0 0 3px rgba(255, 152, 0, 0.18);
      }

      .window-dot.off {
        background: var(--roommind-surface-strong);
      }

      .delay-fields {
        display: flex;
        gap: 8px;
        margin-top: 8px;
      }

      .delay-fields ha-textfield {
        flex: 1;
      }

      .delay-hint {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        font-size: 11.5px;
        line-height: 1.5;
        color: var(--warning-color, #ff9800);
        margin-top: 6px;
      }

      .delay-hint ha-icon {
        --mdc-icon-size: 16px;
        flex-shrink: 0;
        margin-top: 1px;
      }

      .delay-view {
        font-size: 12px;
        color: var(--secondary-text-color);
        padding-top: 4px;
      }

      .empty-row {
        color: var(--secondary-text-color);
        font-size: 12.5px;
        font-style: italic;
        padding: 6px 4px;
        opacity: 0.7;
      }

      .add-row,
      .global-add {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .global-add {
        margin-top: 12px;
      }

      .add-row ha-entity-picker,
      .global-add ha-entity-picker {
        flex: 1;
      }

      .add-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        margin: 12px 0 0 0;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--secondary-text-color);
        font-size: 12px;
        font-weight: 500;
        border-radius: 6px;
        transition:
          color 0.15s,
          background 0.15s;
      }

      .add-button:hover,
      .add-button:focus-visible {
        color: var(--primary-color);
        background: var(--roommind-primary-muted);
        outline: none;
      }

      .add-button ha-icon {
        --mdc-icon-size: 16px;
      }

      .picker-close {
        --mdc-icon-button-size: 32px;
        --mdc-icon-size: 18px;
        color: var(--secondary-text-color);
        flex-shrink: 0;
      }

      /* View mode rows */
      .view-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 0;
        font-size: 14px;
        color: var(--primary-text-color);
      }

      .view-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .entity-link {
        cursor: pointer;
      }

      .entity-link:hover {
        text-decoration: underline;
      }

      .view-value {
        font-weight: 500;
        flex-shrink: 0;
      }

      .section-subtitle {
        font-size: 12px;
        font-weight: 500;
        color: var(--secondary-text-color);
        margin: 12px 0 4px 0;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      .section-subtitle:first-child {
        margin-top: 0;
      }

      .fusion-panel {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 12px;
        margin: 0 0 12px 0;
        border: var(--roommind-border-subtle);
        border-radius: 8px;
        background: var(--roommind-surface-subtle);
      }

      .fusion-header {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .fusion-title {
        flex: 1;
        min-width: 0;
        font-size: 12px;
        font-weight: 600;
        color: var(--primary-text-color);
        text-transform: uppercase;
        letter-spacing: 0;
      }

      .fusion-conflict {
        font-size: 11px;
        font-weight: 600;
        color: var(--primary-color);
        font-variant-numeric: tabular-nums;
      }

      .fusion-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .fusion-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
      }

      .fusion-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        font-weight: 500;
        color: var(--primary-text-color);
      }

      .fusion-meta,
      .fusion-values {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        min-width: 0;
      }

      .fusion-meta {
        margin-top: 3px;
      }

      .fusion-chip {
        display: inline-flex;
        align-items: center;
        min-height: 18px;
        padding: 1px 6px;
        border-radius: 6px;
        font-size: 10.5px;
        line-height: 1.4;
        color: var(--secondary-text-color);
        background: var(--roommind-surface-muted);
        font-variant-numeric: tabular-nums;
      }

      .fusion-chip.primary {
        color: var(--primary-color);
        background: var(--roommind-primary-strong);
      }

      .fusion-chip.aging {
        color: var(--warning-color, #ff9800);
        background: var(--roommind-warning-tint);
      }

      .fusion-chip.stale {
        color: var(--error-color, #f44336);
        background: var(--roommind-error-tint);
      }

      @media (max-width: 520px) {
        .sensor-table-row {
          grid-template-columns: 32px minmax(0, 1fr);
          align-items: start;
        }

        .sensor-table-row .value-chip,
        .sensor-table-row .health-chip,
        .sensor-table-row .role-chip,
        .sensor-table-row .priority-actions {
          grid-column: 2 / -1;
          justify-self: start;
        }

        .fusion-row {
          grid-template-columns: minmax(0, 1fr);
        }

        .fusion-values {
          justify-content: flex-start;
        }
      }
    `,
  ];

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
      ${hasTempSensors
        ? html`
            <div class="section-subtitle">${localize("devices.temp_sensors", lang)}</div>
            ${tempSensorIds.map((id) => this._renderSensorViewRow(id, "temp"))}
          `
        : nothing}
      ${hasHumiditySensor
        ? html`
            <div class="section-subtitle">${localize("devices.humidity_sensors", lang)}</div>
            ${humiditySensorIds.map((id) => this._renderSensorViewRow(id, "humidity"))}
          `
        : nothing}
      ${hasOccupancySensors
        ? html`
            <div class="section-subtitle">${localize("devices.occupancy_sensors", lang)}</div>
            ${[...this.occupancySensors].map((id) => this._renderOccupancyViewRow(id))}
          `
        : nothing}
      ${hasWindowSensors
        ? html`
            <div class="section-subtitle">${localize("devices.window_sensors", lang)}</div>
            ${[...this.windowSensors].map((id) => this._renderWindowViewRow(id))}
            ${this.windowOpenDelay || this.windowCloseDelay
              ? html`<div class="delay-view">
                  ${this.windowOpenDelay
                    ? html`${localize("devices.window_open_delay", lang)}: ${this.windowOpenDelay}s`
                    : nothing}
                  ${this.windowOpenDelay && this.windowCloseDelay ? " · " : nothing}
                  ${this.windowCloseDelay
                    ? html`${localize("devices.window_close_delay", lang)}:
                      ${this.windowCloseDelay}s`
                    : nothing}
                </div>`
              : nothing}
          `
        : nothing}
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
    ).filter((e) => {
      const idAfterDot = e.entity_id.substring(e.entity_id.indexOf(".") + 1);
      return !idAfterDot.startsWith("roommind_");
    });

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
      ${this._renderGlobalAdd(lang)}
    `;
  }

  private _renderTemperatureBlock(
    areaSensors: { entity_id: string }[],
    externalSensors: string[],
    lang: string,
  ) {
    const total = areaSensors.length + externalSensors.length;
    const isCollapsed = this._collapsed.temp ?? false;
    const ids = [
      ...areaSensors.map((e) => ({ entityId: e.entity_id, external: false })),
      ...externalSensors.map((entityId) => ({ entityId, external: true })),
    ];
    const selectedIds = this._temperatureSensorIds();

    return html`
      <div class="sensor-block ${isCollapsed ? "collapsed" : ""}">
        <div class="block-header" @click=${() => this._toggleBlock("temp")}>
          <ha-icon icon="mdi:thermometer"></ha-icon>
          <div class="block-title">${localize("devices.temp_sensors", lang)}</div>
          ${this._temperatureSensorIds().length > 0
            ? html`<span class="count-chip has-selection"
                >${this._temperatureSensorIds().length}</span
              >`
            : total > 0
              ? html`<span class="count-chip">${total}</span>`
              : nothing}
          <ha-icon
            class="chevron ${isCollapsed ? "collapsed" : ""}"
            icon="mdi:chevron-down"
          ></ha-icon>
        </div>
        ${isCollapsed
          ? nothing
          : html`
              <div class="block-body temperature-stack">
                ${ids.length > 0
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
                  : html`<div class="empty-row">${localize("devices.no_temp_sensors", lang)}</div>`}
              </div>
            `}
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
          ${selectedIds.length > 0
            ? html`<span class="count-chip has-selection">${selectedIds.length}</span>`
            : total > 0
              ? html`<span class="count-chip">${total}</span>`
              : nothing}
          <ha-icon
            class="chevron ${isCollapsed ? "collapsed" : ""}"
            icon="mdi:chevron-down"
          ></ha-icon>
        </div>
        ${isCollapsed
          ? nothing
          : html`
              <div class="block-body temperature-stack">
                ${ids.length > 0
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
                    </div>`}
              </div>
            `}
      </div>
    `;
  }

  private _renderPrioritySensorRow(
    entityId: string,
    external: boolean,
    kind: "temp" | "humidity",
    priorityIndex: number,
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
            ${external
              ? html`<span class="external-badge">${localize("devices.other_area", lang)}</span>`
              : nothing}
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
              ${status.is_primary
                ? localize("devices.primary_sensor", lang)
                : localize("devices.sensor_auxiliary", lang)}
            </span>
            <span class="fusion-chip ${status.freshness_status}">
              ${this._freshnessLabel(status.freshness_status, lang)}
            </span>
            <span class="fusion-chip"
              >${this._freshnessSourceLabel(status.freshness_source, lang)}</span
            >
            <span class="fusion-chip">${this._formatAge(status.age_s)}</span>
          </div>
        </div>
        <div class="fusion-values">
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
    switch (status) {
      case "aging":
        return localize("devices.sensor_freshness_aging", lang);
      case "stale":
        return localize("devices.sensor_freshness_stale", lang);
      default:
        return localize("devices.sensor_freshness_fresh", lang);
    }
  }

  private _freshnessSourceLabel(source: string, lang: string): string {
    switch (source) {
      case "last_reported":
        return localize("devices.sensor_source_reported", lang);
      case "last_updated":
        return localize("devices.sensor_source_updated", lang);
      case "last_changed":
        return localize("devices.sensor_source_changed", lang);
      default:
        return localize("devices.sensor_source_none", lang);
    }
  }

  private _formatAge(ageSeconds: number): string {
    const age = Math.max(0, Number(ageSeconds) || 0);
    if (age < 60) return `${Math.round(age)}s`;
    if (age < 3600) return `${Math.round(age / 60)}m`;
    return `${Math.round(age / 3600)}h`;
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
      ${this.heatingSystemType === "underfloor" && this.windowOpenDelay < 300
        ? html`
            <div class="delay-hint">
              <ha-icon icon="mdi:information-outline"></ha-icon>
              ${localize("devices.underfloor_delay_hint", lang)}
            </div>
          `
        : nothing}
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
          ${opts.selectedCount > 0
            ? html`<span class="count-chip has-selection">${opts.selectedCount}</span>`
            : total > 0
              ? html`<span class="count-chip">${total}</span>`
              : nothing}
          <ha-icon
            class="chevron ${isCollapsed ? "collapsed" : ""}"
            icon="mdi:chevron-down"
          ></ha-icon>
        </div>
        ${isCollapsed
          ? nothing
          : html`
              <div class="block-body">
                <div class="row-list">
                  ${opts.areaSensors.length > 0 || opts.externalSensors.length > 0
                    ? html`
                        ${opts.areaSensors.map((e) =>
                          this._renderEditRow(e.entity_id, opts.kind, false),
                        )}
                        ${opts.externalSensors.map((id) =>
                          this._renderEditRow(id, opts.kind, true),
                        )}
                      `
                    : html`<div class="empty-row">${opts.emptyText}</div>`}
                </div>
                ${opts.extras ?? nothing}
              </div>
            `}
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
              ${external
                ? html`<span class="external-badge">${localize("devices.other_area", lang)}</span>`
                : nothing}
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
        ${kind === "temp"
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
          : html`<ha-radio .checked=${isSelected} name="${kind}-sensor"></ha-radio>`}
        <div class="row-info">
          <div class="row-name-line">
            <span class="row-name">${friendlyName}</span>
            ${external
              ? html`<span class="external-badge">${localize("devices.other_area", lang)}</span>`
              : nothing}
          </div>
          <div class="row-eid">${entityId}</div>
        </div>
        ${formatted ? html`<span class="value-chip">${formatted}</span>` : nothing}
      </div>
    `;
  }

  private _formatSensorValue(entityId: string, kind: "temp" | "humidity"): string {
    const state = this.hass.states[entityId];
    const unit = kind === "temp" ? tempUnit(this.hass) : "%";
    const currentValue = entityId.startsWith("climate.")
      ? state?.attributes?.current_temperature
      : state?.state;
    if (currentValue == null || currentValue === "unknown" || currentValue === "unavailable") {
      return "";
    }
    const value = Number(currentValue);
    if (!Number.isFinite(value)) return "";
    return `${kind === "humidity" ? Math.round(value) : value.toFixed(1)}${unit}`;
  }

  private _sensorHealth(entityId: string): { label: string; className: string } {
    const lang = this.hass.language;
    const fusion = this.sensorFusionStatus.find((status) => status.entity_id === entityId);
    if (fusion) {
      return {
        label: this._freshnessLabel(fusion.freshness_status, lang),
        className: fusion.freshness_status,
      };
    }
    const state = this.hass.states[entityId];
    if (!state || state.state === "unknown" || state.state === "unavailable") {
      return {
        label: localize("devices.sensor_freshness_stale", lang),
        className: "unavailable",
      };
    }
    return {
      label: localize("devices.sensor_freshness_fresh", lang),
      className: "fresh",
    };
  }

  private _globalEntityFilter = (entity: { entity_id: string }): boolean => {
    const id = entity.entity_id;
    const idAfterDot = id.substring(id.indexOf(".") + 1);
    if (idAfterDot.startsWith("roommind_")) return false;
    if (this.temperatureSensor === id) return false;
    if (this.temperatureSensors.has(id)) return false;
    if (this.humiditySensor === id) return false;
    if (this.humiditySensors.has(id)) return false;
    if (this.occupancySensors.has(id)) return false;
    if (this.windowSensors.has(id)) return false;
    if (id.startsWith("sensor.")) {
      const dc = this.hass.states[id]?.attributes?.device_class;
      return dc === "temperature" || dc === "humidity";
    }
    if (id.startsWith("binary_sensor.")) {
      const dc = this.hass.states[id]?.attributes?.device_class;
      return (
        dc === "occupancy" ||
        dc === "motion" ||
        dc === "presence" ||
        dc === "window" ||
        dc === "door" ||
        dc === "opening"
      );
    }
    if (id.startsWith("climate.")) {
      return this.hass.states[id]?.attributes?.current_temperature != null;
    }
    return id.startsWith("input_number.") || id.startsWith("input_boolean.");
  };

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
