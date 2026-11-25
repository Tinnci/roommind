/**
 * rs-analytics-model – Thermal model confidence hero (with 80% MPC milestone) and parameter grid.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, AnalyticsData } from "../../types";
import { localize, type TranslationKey } from "../../utils/localize";
import { infoIconStyles } from "../../styles/info-icon-styles";
import { tempUnit, toDisplayDelta } from "../../utils/temperature";

@customElement("rs-analytics-model")
export class RsAnalyticsModel extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public data: AnalyticsData | null = null;
  @property({ type: String }) public language = "en";

  @state() private _expandedStat: string | null = null;

  override render() {
    const l = this.language;
    const hasModel = !!this.data?.model?.model;
    const m = this.data?.model;
    const model = m?.model;
    const confidence = m?.confidence ?? 0;
    const n_samples = m?.n_samples ?? 0;
    const n_heating = m?.n_heating ?? 0;
    const n_cooling = m?.n_cooling ?? 0;
    const n_idle = Math.max(0, n_samples - n_heating - n_cooling);
    const applicable_modes = m?.applicable_modes ?? [];
    const predStdIdle = m?.prediction_std_idle;
    const predStdHeat = m?.prediction_std_heating;

    const mpcActive = m?.mpc_active ?? false;
    const confidencePct = Math.round(confidence * 100);
    const modes = new Set(applicable_modes);
    const canHeat = modes.has("heating");
    const canCool = modes.has("cooling");
    const hasHeated = n_heating >= 10;
    const hasCooled = n_cooling >= 10;
    const hasIdleData = n_idle >= 10;
    const n_observations = m?.n_observations ?? n_samples;
    const ph = "\u2014";

    const statItems: Array<{ id: string; labelKey: TranslationKey; infoKey: TranslationKey }> = [];
    const stat = (
      id: string,
      icon: string,
      value: string | number,
      labelKey: TranslationKey,
      unit: string,
      infoKey: TranslationKey,
    ) => {
      statItems.push({ id, labelKey, infoKey });
      const active = this._expandedStat === id;
      return html`
        <button
          type="button"
          class="model-stat ${active ? "active" : ""}"
          aria-expanded=${active}
          @click=${() => this._toggleStat(id)}
        >
          <div class="stat-top">
            <span class="stat-label-wrap">
              <ha-icon class="stat-icon" icon=${icon}></ha-icon>
              <span class="model-label">${localize(labelKey, l)}${unit ? ` (${unit})` : ""}</span>
            </span>
            <ha-icon
              class="info-icon ${active ? "info-active" : ""}"
              icon="mdi:information-outline"
            ></ha-icon>
          </div>
          <span class="model-value ${value === ph ? "pending" : ""}">${value}</span>
        </button>
      `;
    };

    return html`
      <ha-card>
        <div class="card-header">
          <div class="title-wrap">
            <ha-icon icon="mdi:brain"></ha-icon>
            <span>${localize("analytics.model_status", l)}</span>
          </div>
          <div class="control-mode-badge ${mpcActive ? "mpc" : "bangbang"}">
            <ha-icon icon=${mpcActive ? "mdi:check-decagram" : "mdi:school-outline"}></ha-icon>
            <span>
              ${
                mpcActive
                  ? localize("analytics.control_mode_mpc", l)
                  : localize("analytics.control_mode_bangbang", l)
              }
            </span>
          </div>
        </div>
        <div class="card-content">
          <div class="confidence-hero">
            <div class="confidence-top">
              <div class="confidence-main">
                <span class="confidence-value">${hasModel ? confidencePct + "%" : "0%"}</span>
                <button
                  type="button"
                  class="confidence-label-btn"
                  @click=${() => this._toggleStat("confidence")}
                >
                  <span>${localize("analytics.confidence", l)}</span>
                  <ha-icon
                    class="info-icon ${this._expandedStat === "confidence" ? "info-active" : ""}"
                    icon="mdi:information-outline"
                  ></ha-icon>
                </button>
              </div>
              <div class="sample-pills">
                <button
                  type="button"
                  class="sample-pill"
                  @click=${() => this._toggleStat("data_points")}
                >
                  <span
                    >${localize("analytics.data_points", l)}: ${hasModel ? n_observations : 0}</span
                  >
                  <ha-icon
                    class="info-icon ${this._expandedStat === "data_points" ? "info-active" : ""}"
                    icon="mdi:information-outline"
                  ></ha-icon>
                </button>
                ${
                  canHeat
                    ? html`<span class="sample-pill muted"
                        >${localize("analytics.model_samples_heat", l, { count: n_heating })}</span
                      >`
                    : nothing
                }
                ${
                  canCool
                    ? html`<span class="sample-pill muted"
                        >${localize("analytics.model_samples_cool", l, { count: n_cooling })}</span
                      >`
                    : nothing
                }
                <span class="sample-pill muted"
                  >${localize("analytics.model_samples_idle", l, { count: n_idle })}</span
                >
              </div>
            </div>

            <div class="confidence-bar-wrap">
              <div class="confidence-bar">
                <div
                  class="confidence-fill ${mpcActive ? "mpc" : ""}"
                  style="width: ${hasModel ? confidencePct : 0}%"
                ></div>
                <span
                  class="confidence-threshold"
                  title=${localize("analytics.model_ready_threshold", l)}
                ></span>
              </div>
              <div class="threshold-caption">${localize("analytics.model_ready_threshold", l)}</div>
            </div>

            ${
              this._expandedStat === "confidence"
                ? html`<div class="info-panel stat-info-panel">
                    <strong>${localize("analytics.confidence", l)}</strong>
                    ${localize("analytics.info.confidence", l)}
                  </div>`
                : nothing
            }
            ${
              this._expandedStat === "data_points"
                ? html`<div class="info-panel stat-info-panel">
                    <strong>${localize("analytics.data_points", l)}</strong>
                    ${localize("analytics.info.data_points", l)}
                  </div>`
                : nothing
            }
          </div>

          <div class="model-grid">
            ${stat(
              "time_constant",
              "mdi:timer-sand",
              hasIdleData && model && model.U > 0 ? (1 / model.U).toFixed(1) + "h" : ph,
              "analytics.time_constant",
              "",
              "analytics.info.time_constant",
            )}
            ${
              canHeat
                ? stat(
                    "heating_rate",
                    "mdi:fire",
                    hasHeated && model
                      ? toDisplayDelta(model.Q_heat, this.hass).toFixed(1) +
                          tempUnit(this.hass) +
                          "/h"
                      : ph,
                    "analytics.heating_rate",
                    "",
                    "analytics.info.heating_rate",
                  )
                : nothing
            }
            ${
              canCool
                ? stat(
                    "cooling_rate",
                    "mdi:snowflake",
                    hasCooled && model
                      ? toDisplayDelta(model.Q_cool, this.hass).toFixed(1) +
                          tempUnit(this.hass) +
                          "/h"
                      : ph,
                    "analytics.cooling_rate",
                    "",
                    "analytics.info.cooling_rate",
                  )
                : nothing
            }
            ${
              model && model.Q_solar > 0.1
                ? stat(
                    "solar_gain",
                    "mdi:white-balance-sunny",
                    toDisplayDelta(model.Q_solar, this.hass).toFixed(1) +
                      tempUnit(this.hass) +
                      "/h",
                    "analytics.solar_gain",
                    "",
                    "analytics.info.solar_gain",
                  )
                : nothing
            }
            ${
              model && m?.has_occupancy_sensors
                ? stat(
                    "occupancy_gain",
                    "mdi:account-multiple",
                    toDisplayDelta(model.Q_occupancy, this.hass).toFixed(1) +
                      tempUnit(this.hass) +
                      "/h",
                    "analytics.occupancy_gain",
                    "",
                    "analytics.info.occupancy_gain",
                  )
                : nothing
            }
            ${stat(
              "accuracy_idle",
              "mdi:target",
              hasIdleData && predStdIdle != null
                ? "\u00B1" + toDisplayDelta(predStdIdle, this.hass).toFixed(2) + tempUnit(this.hass)
                : ph,
              "analytics.accuracy_idle",
              "",
              "analytics.info.accuracy_idle",
            )}
            ${
              canHeat
                ? stat(
                    "accuracy_heating",
                    "mdi:bullseye-arrow",
                    hasHeated && predStdHeat != null
                      ? "\u00B1" +
                          toDisplayDelta(predStdHeat, this.hass).toFixed(2) +
                          tempUnit(this.hass)
                      : ph,
                    "analytics.accuracy_heating",
                    "",
                    "analytics.info.accuracy_heating",
                  )
                : nothing
            }
          </div>
          ${
            this._expandedStat && statItems.find((s) => s.id === this._expandedStat)
              ? html`<div class="info-panel stat-info-panel">
                  <strong
                    >${localize(
                      statItems.find((s) => s.id === this._expandedStat)!.labelKey,
                      l,
                    )}</strong
                  >
                  ${localize(statItems.find((s) => s.id === this._expandedStat)!.infoKey, l)}
                </div>`
              : nothing
          }
        </div>
      </ha-card>
    `;
  }

  private _toggleStat(id: string) {
    this._expandedStat = this._expandedStat === id ? null : id;
  }

  static override styles = [
    infoIconStyles,
    css`
      :host {
        display: block;
      }

      ha-card {
        border-radius: var(--roommind-radius-card, 14px);
        border: var(--roommind-border-subtle, 1px solid var(--divider-color));
        background: var(--roommind-surface, var(--card-background-color));
        box-shadow: var(--roommind-shadow-card, none);
      }

      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        padding: 12px 16px 0;
      }

      .title-wrap {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 15px;
        font-weight: 600;
        color: var(--primary-text-color);
        --mdc-icon-size: 18px;
      }

      .title-wrap ha-icon {
        color: var(--primary-color);
      }

      .card-content {
        padding: 12px 16px 16px;
        display: grid;
        gap: 12px;
      }

      .confidence-hero {
        display: grid;
        gap: 8px;
        padding: 12px 14px;
        border-radius: var(--roommind-radius-control, 8px);
        border: var(--roommind-border-faint, 1px solid var(--divider-color));
        background: var(--roommind-surface-subtle);
      }

      .confidence-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }

      .confidence-main {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }

      .confidence-value {
        font-size: 26px;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        color: var(--primary-text-color);
        line-height: 1;
      }

      .confidence-label-btn,
      .sample-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        font-size: 12px;
        color: var(--secondary-text-color);
        cursor: pointer;
      }

      .sample-pills {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      .sample-pill {
        padding: 3px 8px;
        border-radius: 999px;
        border: var(--roommind-border-faint, 1px solid var(--divider-color));
        background: var(--roommind-surface);
        font-variant-numeric: tabular-nums;
      }

      .sample-pill.muted {
        cursor: default;
      }

      .control-mode-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        --mdc-icon-size: 14px;
      }

      .control-mode-badge.mpc {
        background: var(--roommind-success-tint);
        color: var(--success-color, #4caf50);
      }

      .control-mode-badge.bangbang {
        background: var(--roommind-surface-muted);
        color: var(--secondary-text-color);
      }

      .confidence-bar-wrap {
        display: grid;
        gap: 4px;
      }

      .confidence-bar {
        position: relative;
        height: 8px;
        border-radius: 999px;
        background: var(--roommind-surface-muted);
        overflow: visible;
      }

      .confidence-fill {
        height: 100%;
        border-radius: 999px;
        background: var(--primary-color);
        transition: width 0.6s ease;
      }

      .confidence-fill.mpc {
        background: var(--success-color, #4caf50);
      }

      .confidence-threshold {
        position: absolute;
        left: 80%;
        top: -2px;
        bottom: -2px;
        width: 2px;
        border-radius: 1px;
        background: var(--primary-text-color);
        opacity: 0.45;
      }

      .threshold-caption {
        font-size: 11px;
        color: var(--secondary-text-color);
        text-align: right;
      }

      .model-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
        gap: 8px;
      }

      .model-stat {
        display: grid;
        gap: 6px;
        padding: 11px 13px;
        border-radius: 10px;
        border: var(--roommind-border-faint, 1px solid var(--divider-color));
        background: var(--roommind-surface-subtle);
        text-align: left;
        font: inherit;
        cursor: pointer;
        transition:
          border-color 0.2s,
          background 0.2s;
      }

      .model-stat:hover {
        background: var(--roommind-surface-hover);
      }

      .model-stat.active {
        border-color: var(--primary-color);
        background: var(--roommind-primary-subtle);
      }

      .stat-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }

      .stat-label-wrap {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
      }

      .stat-icon {
        --mdc-icon-size: 15px;
        color: var(--primary-color);
        flex-shrink: 0;
      }

      .model-value {
        font-size: 18px;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        color: var(--primary-text-color);
      }

      .model-value.pending {
        opacity: 0.25;
      }

      .model-label {
        font-size: 12px;
        color: var(--secondary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .info-panel.stat-info-panel {
        margin-top: 2px;
      }

      @media (max-width: 600px) {
        .card-content {
          padding: 10px 12px 12px;
        }

        .model-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-analytics-model": RsAnalyticsModel;
  }
}
