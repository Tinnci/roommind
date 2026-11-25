import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  AnalyticsData,
  AnalyticsDataPoint,
  HassArea,
  HomeAssistant,
  RoomConfig,
} from "../types";
import { roommindThemeStyles } from "../styles/theme-styles";
import { openEntityInfo } from "../utils/events";
import {
  assessRoomComfort,
  buildTrendSummary,
  calculateDewPointC,
  findThermalNeighbors,
  inspectAreaSensors,
  type TrendSummary,
} from "../utils/environment-monitor";
import { localize } from "../utils/localize";
import { formatTemp, tempUnit, toDisplayDelta } from "../utils/temperature";
import "./rs-section-card";

@customElement("rs-environment-monitor")
export class RsEnvironmentMonitor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public area!: HassArea;
  @property({ attribute: false }) public config: RoomConfig | null = null;
  @property({ attribute: false }) public rooms: Record<string, RoomConfig> = {};
  @property({ type: String }) public language = "en";

  @state() private _trendPoints: AnalyticsDataPoint[] = [];
  @state() private _trendLoading = false;
  @state() private _trendAreaId = "";

  static override styles = [
    roommindThemeStyles,
    css`
      :host {
        display: block;
      }

      .monitor-stack {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .quickstart-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid rgba(var(--rgb-primary-color, 3, 169, 244), 0.28);
        background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.08);
        margin-bottom: 12px;
      }

      .quickstart-copy {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        flex: 1 1 240px;
      }

      .quickstart-title {
        font-size: 13.5px;
        font-weight: 650;
        color: var(--primary-text-color);
      }

      .quickstart-desc {
        font-size: 12px;
        line-height: 1.45;
        color: var(--secondary-text-color);
      }

      .primary-action-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        border: none;
        border-radius: 999px;
        background: var(--primary-color, #03a9f4);
        color: var(--text-primary-color, #ffffff);
        font: inherit;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
        --mdc-icon-size: 16px;
      }

      .primary-action-btn:hover {
        filter: brightness(1.06);
      }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(155px, 100%), 1fr));
        gap: 8px;
      }

      .summary-tile {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px 12px;
        border-radius: 10px;
        border: var(--roommind-border-faint, 1px solid rgba(0, 0, 0, 0.08));
        background: var(--roommind-surface-subtle, rgba(0, 0, 0, 0.025));
        min-width: 0;
      }

      .summary-label {
        font-size: 11px;
        font-weight: 500;
        color: var(--secondary-text-color);
      }

      .summary-value {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 15px;
        font-weight: 650;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
        --mdc-icon-size: 16px;
      }

      .summary-value[data-tone="success"] {
        color: var(--roommind-success-color, #4caf50);
      }
      .summary-value[data-tone="info"] {
        color: var(--roommind-info-color, #0288d1);
      }
      .summary-value[data-tone="warning"] {
        color: var(--roommind-warning-color, #ff9800);
      }
      .summary-value[data-tone="critical"] {
        color: var(--roommind-error-color, #d32f2f);
      }

      .summary-sub {
        font-size: 11px;
        color: var(--secondary-text-color);
      }

      .trends-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
        gap: 10px;
      }

      .trend-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 11px 13px;
        border-radius: 10px;
        border: var(--roommind-border-faint, 1px solid rgba(0, 0, 0, 0.08));
        background: var(--roommind-surface-subtle, rgba(0, 0, 0, 0.025));
      }

      .trend-header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }

      .trend-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--secondary-text-color);
      }

      .trend-delta {
        font-size: 11.5px;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        color: var(--secondary-text-color);
      }

      .trend-delta.up {
        color: var(--roommind-warning-color, #ff9800);
      }

      .trend-delta.down {
        color: var(--roommind-info-color, #0288d1);
      }

      .trend-sparkline {
        width: 100%;
        height: 44px;
        display: block;
      }

      .trend-footer {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        font-size: 11.5px;
        color: var(--secondary-text-color);
        font-variant-numeric: tabular-nums;
      }

      .trend-current {
        font-weight: 650;
        color: var(--primary-text-color);
      }

      .trend-empty {
        font-size: 12.5px;
        color: var(--secondary-text-color);
        padding: 8px 0;
        font-style: italic;
      }

      .header-actions {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      .header-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border-radius: 999px;
        border: var(--roommind-border-subtle, 1px solid var(--divider-color));
        background: var(--roommind-surface-subtle);
        color: var(--primary-text-color);
        font: inherit;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        --mdc-icon-size: 14px;
      }

      .header-btn:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }

      .header-btn.accent {
        border-color: rgba(var(--rgb-primary-color, 3, 169, 244), 0.35);
        background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.08);
        color: var(--primary-color);
      }

      .sensor-group-label {
        font-size: 11px;
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--secondary-text-color);
        margin: 12px 0 6px;
      }

      .sensor-group-label:first-child {
        margin-top: 0;
      }

      .sensor-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr));
        gap: 7px;
      }

      .sensor-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 11px;
        border-radius: 9px;
        border: var(--roommind-border-faint, 1px solid rgba(0, 0, 0, 0.08));
        background: var(--roommind-surface-subtle, rgba(0, 0, 0, 0.025));
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
        min-width: 0;
        transition: border-color 0.14s ease;
      }

      .sensor-row:hover {
        border-color: var(--primary-color);
      }

      .sensor-row-left {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        flex: 1 1 auto;
      }

      .sensor-row-left ha-icon {
        --mdc-icon-size: 17px;
        color: var(--secondary-text-color);
        flex: 0 0 auto;
      }

      .sensor-row-meta {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .sensor-name {
        font-size: 12.5px;
        font-weight: 600;
        color: var(--primary-text-color);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .sensor-tags {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-wrap: wrap;
        font-size: 10.5px;
        color: var(--secondary-text-color);
      }

      .sensor-tag {
        padding: 1px 6px;
        border-radius: 5px;
        background: var(--roommind-surface-muted);
        font-weight: 600;
      }

      .sensor-tag.primary {
        background: var(--roommind-primary-muted, rgba(3, 169, 244, 0.14));
        color: var(--primary-color);
      }

      .sensor-tag.fused {
        background: var(--roommind-success-tint, rgba(76, 175, 80, 0.12));
        color: var(--roommind-success-color, #4caf50);
      }

      .sensor-value {
        font-size: 14px;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        color: var(--primary-text-color);
        flex: 0 0 auto;
      }

      .empty-sensors {
        font-size: 12.5px;
        color: var(--secondary-text-color);
        font-style: italic;
        padding: 4px 0;
      }
    `,
  ];

  protected override updated(changedProps: Map<string, unknown>) {
    if (
      this.config &&
      this.hass &&
      this.area?.area_id &&
      (changedProps.has("area") ||
        (changedProps.has("config") && this._trendAreaId !== this.area.area_id))
    ) {
      this._fetchTrends(this.area.area_id);
    } else if (!this.config && this._trendAreaId) {
      this._trendAreaId = "";
      this._trendPoints = [];
    }
  }

  private async _fetchTrends(areaId: string) {
    if (!this.hass?.callWS) return;
    this._trendAreaId = areaId;
    this._trendLoading = true;
    const endTs = Date.now() / 1000;
    const startTs = endTs - 24 * 3600;
    try {
      const data = await this.hass.callWS<AnalyticsData>({
        type: "roommind/analytics/get",
        area_id: areaId,
        start_ts: startTs,
        end_ts: endTs,
      });
      if (this._trendAreaId === areaId) {
        const detail = data?.detail ?? [];
        const history = data?.history ?? [];
        this._trendPoints = detail.length >= 2 ? detail : history;
      }
    } catch {
      if (this._trendAreaId === areaId) {
        this._trendPoints = [];
      }
    } finally {
      if (this._trendAreaId === areaId) {
        this._trendLoading = false;
      }
    }
  }

  private _renderSparkline(
    summary: TrendSummary,
    stroke: string,
    formatValue: (v: number) => string,
    formatDelta: (d: number) => string,
    title: string,
  ) {
    const l = this.language;
    const deltaSign = summary.delta > 0 ? "+" : "";
    const deltaClass = summary.delta > 0.05 ? "up" : summary.delta < -0.05 ? "down" : "";
    return html`
      <div class="trend-card">
        <div class="trend-header">
          <span class="trend-title">${title}</span>
          <span class="trend-delta ${deltaClass}">${deltaSign}${formatDelta(summary.delta)}</span>
        </div>
        <svg
          class="trend-sparkline"
          viewBox="0 0 180 44"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d=${summary.areaPath} fill=${stroke} fill-opacity="0.14"></path>
          <path
            d=${summary.path}
            fill="none"
            stroke=${stroke}
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          ></path>
        </svg>
        <div class="trend-footer">
          <span>
            ${localize("monitor.min_max", l, {
              min: formatValue(summary.min),
              max: formatValue(summary.max),
            })}
          </span>
          <span class="trend-current">${formatValue(summary.current)}</span>
        </div>
      </div>
    `;
  }

  override render() {
    if (!this.hass || !this.area) return nothing;
    const l = this.language;
    const live = this.config?.live;
    const inv = inspectAreaSensors(this.area.area_id, this.hass, this.config);

    const effectiveTemp = live?.current_temp ?? inv.previewTempC;
    const effectiveHumidity = live?.current_humidity ?? inv.previewHumidity;
    const comfort = assessRoomComfort(effectiveTemp, effectiveHumidity, live?.mold_risk_level);
    const dewPoint = calculateDewPointC(effectiveTemp, effectiveHumidity);
    const feelsLike = live?.perceived_temp ?? null;
    const windowOpen =
      live?.window_open ??
      inv.binarySensors.some(
        (s) =>
          s.isOn === true &&
          (s.deviceClass === "window" || s.deviceClass === "door" || s.deviceClass === "opening"),
      );
    const occupied = inv.binarySensors.some(
      (s) =>
        s.isOn === true &&
        (s.deviceClass === "occupancy" ||
          s.deviceClass === "motion" ||
          s.deviceClass === "presence"),
    );
    const fusionEntries = live?.sensor_fusion_status ?? [];
    const fusionByEntity = new Map(fusionEntries.map((f) => [f.entity_id, f]));

    const tempTrend = this.config ? buildTrendSummary(this._trendPoints, "temp") : null;
    const humTrend = this.config ? buildTrendSummary(this._trendPoints, "humidity") : null;
    const detectedCount =
      inv.temperatureSensors.length + inv.humiditySensors.length + inv.binarySensors.length;
    const neighbors = findThermalNeighbors(
      this.area.area_id,
      this.config,
      this.rooms,
      this.hass,
      effectiveTemp,
    );

    return html`
      <div class="monitor-stack">
        <rs-section-card
          icon="mdi:thermometer-check"
          .heading=${localize("monitor.sensors_heading", l)}
        >
          <div slot="header-extras" class="header-actions">
            ${
              this.config && inv.unlinkedSensorCount > 0
                ? html`<button
                    type="button"
                    class="header-btn accent"
                    @click=${this._emitAutoDetect}
                  >
                    <ha-icon icon="mdi:link-plus"></ha-icon>
                    <span
                      >${localize("monitor.link_sensors", l, { count: inv.unlinkedSensorCount })}</span
                    >
                  </button>`
                : nothing
            }
            <button type="button" class="header-btn" @click=${this._emitEditSensors}>
              <ha-icon icon="mdi:tune"></ha-icon>
              <span>${localize("monitor.edit_sensors", l)}</span>
            </button>
          </div>

          ${
            !this.config && detectedCount > 0
              ? html`
                  <div class="quickstart-banner">
                    <div class="quickstart-copy">
                      <span class="quickstart-title"
                        >${localize("monitor.unconfigured_title", l)}</span
                      >
                      <span class="quickstart-desc">
                        ${localize("monitor.unconfigured_desc", l, { count: detectedCount })}
                      </span>
                    </div>
                    <button type="button" class="primary-action-btn" @click=${this._emitAutoDetect}>
                      <ha-icon icon="mdi:eye-plus-outline"></ha-icon>
                      <span>${localize("monitor.start_monitoring", l)}</span>
                    </button>
                  </div>
                `
              : !this.config
                ? html`
                    <div class="quickstart-banner">
                      <div class="quickstart-copy">
                        <span class="quickstart-title"
                          >${localize("monitor.empty_unconfigured_title", l)}</span
                        >
                        <span class="quickstart-desc">
                          ${localize("monitor.empty_unconfigured_desc", l)}
                        </span>
                      </div>
                      <button
                        type="button"
                        class="primary-action-btn"
                        @click=${this._emitEditSensors}
                      >
                        <ha-icon icon="mdi:thermometer-plus"></ha-icon>
                        <span>${localize("monitor.select_sensors_cta", l)}</span>
                      </button>
                    </div>
                  `
                : nothing
          }

          <div class="summary-grid">
            <div class="summary-tile">
              <span class="summary-label">${localize("monitor.comfort.title", l)}</span>
              ${
                comfort
                  ? html`<span class="summary-value" data-tone=${comfort.tone}>
                      <ha-icon .icon=${comfort.icon}></ha-icon>
                      <span>${localize(comfort.labelKey, l)}</span>
                    </span>`
                  : html`<span class="summary-value">--</span>`
              }
              <span class="summary-sub">
                ${
                  live?.mold_surface_rh != null
                    ? localize("monitor.surface_rh", l, { value: live.mold_surface_rh.toFixed(0) })
                    : `${inv.temperatureSensors.length + inv.humiditySensors.length}`
                }
              </span>
            </div>

            <div class="summary-tile">
              <span class="summary-label">${localize("monitor.feels_like", l)}</span>
              <span class="summary-value">
                <ha-icon icon="mdi:human-handsup"></ha-icon>
                <span>
                  ${
                    feelsLike != null
                      ? `${formatTemp(feelsLike, this.hass)}${tempUnit(this.hass)}`
                      : effectiveTemp != null
                        ? `${formatTemp(effectiveTemp, this.hass)}${tempUnit(this.hass)}`
                        : "--"
                  }
                </span>
              </span>
              <span class="summary-sub">${localize("room.temperature_panel.current", l)}</span>
            </div>

            <div class="summary-tile">
              <span class="summary-label">${localize("monitor.dew_point", l)}</span>
              <span class="summary-value">
                <ha-icon icon="mdi:water-thermometer"></ha-icon>
                <span>
                  ${dewPoint != null ? `${formatTemp(dewPoint, this.hass)}${tempUnit(this.hass)}` : "--"}
                </span>
              </span>
              <span class="summary-sub">
                ${
                  effectiveHumidity != null
                    ? localize("card.humidity", l, { value: effectiveHumidity.toFixed(0) })
                    : "--"
                }
              </span>
            </div>

            <div class="summary-tile">
              <span class="summary-label">${localize("monitor.status_label", l)}</span>
              <span class="summary-value" data-tone=${windowOpen ? "warning" : "info"}>
                <ha-icon
                  .icon=${
                    windowOpen
                      ? "mdi:window-open-variant"
                      : occupied
                        ? "mdi:account-check-outline"
                        : "mdi:eye-outline"
                  }
                ></ha-icon>
                <span>
                  ${
                    windowOpen
                      ? localize("monitor.window_open", l)
                      : occupied
                        ? localize("monitor.occupied", l)
                        : localize("monitor.clear", l)
                  }
                </span>
              </span>
              <span class="summary-sub">
                ${
                  fusionEntries.length > 1
                    ? localize("card.sensors_fused", l, { count: fusionEntries.length })
                    : localize("card.monitor_only", l)
                }
              </span>
            </div>

            ${
              live?.co2 != null || live?.voc != null || live?.pm25 != null
                ? html`
                    <div class="summary-tile">
                      <span class="summary-label">${localize("sensors.air_quality_title", l)}</span>
                      <span
                        class="summary-value"
                        data-tone=${live?.air_quality_bad ? "warning" : "info"}
                      >
                        <ha-icon icon="mdi:air-filter"></ha-icon>
                        <span>
                          ${
                            live?.pm25 != null
                              ? `${live.pm25.toFixed(1)} µg/m³`
                              : live?.co2 != null
                                ? `${Math.round(live.co2)} ppm`
                                : `${Math.round(live!.voc!)}`
                          }
                        </span>
                      </span>
                      <span class="summary-sub">
                        ${[
                          live?.co2 != null ? `CO₂ ${Math.round(live.co2)}` : "",
                          live?.voc != null ? `VOC ${Math.round(live.voc)}` : "",
                          live?.pm25 != null ? `PM2.5 ${live.pm25.toFixed(1)}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  `
                : nothing
            }
          </div>

          ${
            inv.temperatureSensors.length > 0 || inv.humiditySensors.length > 0
              ? html`
                  <div class="sensor-group-label">${localize("monitor.sensors_heading", l)}</div>
                  <div class="sensor-list">
                    ${inv.temperatureSensors.map((s) => {
                      const fusion = fusionByEntity.get(s.entityId);
                      return html`
                        <button
                          type="button"
                          class="sensor-row"
                          @click=${() => openEntityInfo(this, s.entityId)}
                        >
                          <span class="sensor-row-left">
                            <ha-icon icon="mdi:thermometer"></ha-icon>
                            <span class="sensor-row-meta">
                              <span class="sensor-name">${s.name}</span>
                              <span class="sensor-tags">
                                ${
                                  s.isPrimary
                                    ? html`<span class="sensor-tag primary"
                                        >${localize("monitor.primary_sensor", l)}</span
                                      >`
                                    : s.configured
                                      ? html`<span class="sensor-tag fused"
                                          >${localize("monitor.fused_sensor", l)}</span
                                        >`
                                      : html`<span class="sensor-tag"
                                          >${localize("monitor.unlinked_sensor", l)}</span
                                        >`
                                }
                                ${
                                  fusion && fusion.weight != null
                                    ? html`<span>${Math.round(fusion.weight * 100)}%</span>`
                                    : nothing
                                }
                              </span>
                            </span>
                          </span>
                          <span class="sensor-value">
                            ${
                              s.valueC !== null
                                ? `${formatTemp(s.valueC, this.hass)}${tempUnit(this.hass)}`
                                : "--"
                            }
                          </span>
                        </button>
                      `;
                    })}
                    ${inv.humiditySensors.map(
                      (s) => html`
                        <button
                          type="button"
                          class="sensor-row"
                          @click=${() => openEntityInfo(this, s.entityId)}
                        >
                          <span class="sensor-row-left">
                            <ha-icon icon="mdi:water-percent"></ha-icon>
                            <span class="sensor-row-meta">
                              <span class="sensor-name">${s.name}</span>
                              <span class="sensor-tags">
                                ${
                                  s.isPrimary
                                    ? html`<span class="sensor-tag primary"
                                        >${localize("monitor.primary_sensor", l)}</span
                                      >`
                                    : s.configured
                                      ? html`<span class="sensor-tag fused"
                                          >${localize("monitor.fused_sensor", l)}</span
                                        >`
                                      : html`<span class="sensor-tag"
                                          >${localize("monitor.unlinked_sensor", l)}</span
                                        >`
                                }
                              </span>
                            </span>
                          </span>
                          <span class="sensor-value">
                            ${s.value !== null ? `${s.value.toFixed(0)}%` : "--"}
                          </span>
                        </button>
                      `,
                    )}
                  </div>
                `
              : html`<div class="empty-sensors">${localize("monitor.no_sensors_yet", l)}</div>`
          }
          ${
            inv.airQualitySensors.length > 0 || inv.binarySensors.length > 0
              ? html`
                  <div class="sensor-group-label">
                    ${localize("monitor.air_quality_heading", l)}
                  </div>
                  <div class="sensor-list">
                    ${inv.airQualitySensors.map(
                      (s) => html`
                        <button
                          type="button"
                          class="sensor-row"
                          @click=${() => openEntityInfo(this, s.entityId)}
                        >
                          <span class="sensor-row-left">
                            <ha-icon .icon=${s.icon}></ha-icon>
                            <span class="sensor-row-meta">
                              <span class="sensor-name">${s.name}</span>
                            </span>
                          </span>
                          <span class="sensor-value"
                            >${s.displayValue}${s.unit ? ` ${s.unit}` : ""}</span
                          >
                        </button>
                      `,
                    )}
                    ${inv.binarySensors.map(
                      (s) => html`
                        <button
                          type="button"
                          class="sensor-row"
                          @click=${() => openEntityInfo(this, s.entityId)}
                        >
                          <span class="sensor-row-left">
                            <ha-icon
                              .icon=${
                                s.deviceClass === "window" ||
                                s.deviceClass === "door" ||
                                s.deviceClass === "opening"
                                  ? s.isOn
                                    ? "mdi:window-open-variant"
                                    : "mdi:window-closed-variant"
                                  : "mdi:motion-sensor"
                              }
                            ></ha-icon>
                            <span class="sensor-row-meta">
                              <span class="sensor-name">${s.name}</span>
                            </span>
                          </span>
                          <span class="sensor-value">
                            ${
                              s.isOn === null
                                ? "--"
                                : s.deviceClass === "window" ||
                                    s.deviceClass === "door" ||
                                    s.deviceClass === "opening"
                                  ? localize(
                                      s.isOn ? "monitor.window_open" : "monitor.window_closed",
                                      l,
                                    )
                                  : localize(s.isOn ? "monitor.occupied" : "monitor.clear", l)
                            }
                          </span>
                        </button>
                      `,
                    )}
                  </div>
                `
              : nothing
          }
        </rs-section-card>

        ${
          this.config
            ? html`
                <rs-section-card
                  icon="mdi:chart-areaspline"
                  .heading=${localize("monitor.trends_heading", l)}
                >
                  <button
                    slot="header-extras"
                    type="button"
                    class="header-btn"
                    @click=${this._emitOpenAnalytics}
                  >
                    <ha-icon icon="mdi:chart-line"></ha-icon>
                    <span>${localize("monitor.full_analytics", l)}</span>
                  </button>
                  ${
                    tempTrend || humTrend
                      ? html`
                          <div class="trends-grid">
                            ${
                              tempTrend
                                ? this._renderSparkline(
                                    tempTrend,
                                    "var(--roommind-warning-color, #ff9800)",
                                    (v) => `${formatTemp(v, this.hass)}${tempUnit(this.hass)}`,
                                    (d) =>
                                      `${toDisplayDelta(d, this.hass).toFixed(1)}${tempUnit(this.hass)}`,
                                    localize("monitor.temp_24h", l),
                                  )
                                : nothing
                            }
                            ${
                              humTrend
                                ? this._renderSparkline(
                                    humTrend,
                                    "var(--roommind-info-color, #03a9f4)",
                                    (v) => `${v.toFixed(0)}%`,
                                    (d) => `${d.toFixed(0)}%`,
                                    localize("monitor.humidity_24h", l),
                                  )
                                : nothing
                            }
                          </div>
                        `
                      : html`<div class="trend-empty">
                          ${
                            this._trendLoading
                              ? localize("analytics.loading", l)
                              : localize("monitor.collecting_history", l)
                          }
                        </div>`
                  }
                </rs-section-card>
              `
            : nothing
        }
        ${
          neighbors.length > 0
            ? html`
                <rs-section-card
                  icon="mdi:door-open"
                  .heading=${localize("monitor.neighbors_heading", l)}
                >
                  <button
                    slot="header-extras"
                    type="button"
                    class="header-btn"
                    @click=${this._emitEditCoupling}
                  >
                    <ha-icon icon="mdi:tune"></ha-icon>
                    <span>${localize("monitor.edit_coupling", l)}</span>
                  </button>
                  <div class="sensor-list">
                    ${neighbors.map(
                      (n) => html`
                        <div class="sensor-row" style="cursor: default;">
                          <span class="sensor-row-left">
                            <ha-icon icon="mdi:home-thermometer-outline"></ha-icon>
                            <span class="sensor-row-meta">
                              <span class="sensor-name">${n.name}</span>
                              <span class="sensor-tags">
                                ${
                                  n.borrowedConditioning
                                    ? html`<span class="sensor-tag primary">
                                        ${localize("monitor.borrowed_conditioning", l)}
                                      </span>`
                                    : nothing
                                }
                                ${
                                  n.deltaC !== null
                                    ? html`<span class="sensor-tag">
                                        ${n.deltaC >= 0 ? "+" : ""}${toDisplayDelta(
                                          n.deltaC,
                                          this.hass,
                                        ).toFixed(1)}${tempUnit(this.hass)}
                                      </span>`
                                    : nothing
                                }
                              </span>
                            </span>
                          </span>
                          <span class="sensor-value">
                            ${
                              n.currentTemp !== null
                                ? `${formatTemp(n.currentTemp, this.hass)}${tempUnit(this.hass)}`
                                : "--"
                            }
                          </span>
                        </div>
                      `,
                    )}
                  </div>
                </rs-section-card>
              `
            : nothing
        }
      </div>
    `;
  }

  private _emitEditSensors() {
    this.dispatchEvent(
      new CustomEvent("configuration-edit", {
        detail: { section: "sensors" },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _emitEditCoupling() {
    this.dispatchEvent(
      new CustomEvent("configuration-edit", {
        detail: { section: "comfort" },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _emitAutoDetect() {
    this.dispatchEvent(
      new CustomEvent("auto-detect-area", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _emitOpenAnalytics() {
    this.dispatchEvent(
      new CustomEvent("room-open-analytics", {
        detail: { areaId: this.area.area_id },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-environment-monitor": RsEnvironmentMonitor;
  }
}
