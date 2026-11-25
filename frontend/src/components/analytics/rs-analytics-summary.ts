/**
 * rs-analytics-summary – KPI insight cards + HVAC runtime activity breakdown.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant, AnalyticsData } from "../../types";
import { buildAnalyticsInsights } from "../../utils/analytics-insights";
import { localize } from "../../utils/localize";
import { formatTemp, tempUnit, toDisplayDelta } from "../../utils/temperature";

@customElement("rs-analytics-summary")
export class RsAnalyticsSummary extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public data: AnalyticsData | null = null;
  @property({ type: String }) public language = "en";
  @property({ type: Boolean }) public isOutdoor = false;

  override render() {
    const l = this.language;
    const insights = buildAnalyticsInsights(this.data, { isOutdoor: this.isOutdoor });
    if (!insights) return nothing;

    const unit = tempUnit(this.hass);
    const fmtTemp = (v: number) => `${formatTemp(v, this.hass)}${unit}`;
    const fmtDelta = (v: number) => `${toDisplayDelta(v, this.hass).toFixed(1)}${unit}`;

    const adherence = insights.comfortAdherencePct;
    const adherenceTone =
      adherence == null ? "neutral" : adherence >= 80 ? "good" : adherence >= 50 ? "warn" : "low";

    const rt = insights.runtime;
    const runtimeSegments = [
      { id: "heating", pct: rt.heatingPct, label: localize("analytics.heating_period", l) },
      { id: "cooling", pct: rt.coolingPct, label: localize("analytics.cooling_period", l) },
      { id: "dry", pct: rt.dryPct, label: localize("analytics.dry_period", l) },
      { id: "fan_only", pct: rt.fanOnlyPct, label: localize("analytics.fan_period", l) },
      { id: "idle", pct: rt.idlePct, label: localize("analytics.idle_period", l) },
    ].filter((seg) => seg.pct >= 0.5);

    return html`
      <div class="insights-wrap">
        <div class="kpi-grid">
          ${
            insights.temp
              ? html`
                  <div class="kpi-card">
                    <div class="kpi-head">
                      <ha-icon icon="mdi:thermometer"></ha-icon>
                      <span>${localize("analytics.temperature", l)}</span>
                    </div>
                    <div class="kpi-value">${fmtTemp(insights.temp.latest)}</div>
                    <div class="kpi-sub">
                      ${localize("analytics.summary.temp_range", l, {
                        avg: fmtTemp(insights.temp.avg),
                        min: fmtTemp(insights.temp.min),
                        max: fmtTemp(insights.temp.max),
                      })}
                    </div>
                  </div>
                `
              : nothing
          }
          ${
            !this.isOutdoor && (adherence != null || insights.avgTarget != null)
              ? html`
                  <div class="kpi-card ${adherenceTone}">
                    <div class="kpi-head">
                      <ha-icon icon="mdi:check-circle-outline"></ha-icon>
                      <span>${localize("analytics.summary.comfort_adherence", l)}</span>
                    </div>
                    <div class="kpi-value">
                      ${adherence != null ? `${Math.round(adherence)}%` : "--"}
                    </div>
                    <div class="kpi-sub">
                      ${
                        insights.avgTarget != null
                          ? localize("analytics.summary.target_drift", l, {
                              target: fmtTemp(insights.avgTarget),
                              drift:
                                insights.avgDeviation != null
                                  ? fmtDelta(insights.avgDeviation)
                                  : "--",
                            })
                          : nothing
                      }
                    </div>
                  </div>
                `
              : nothing
          }
          ${
            insights.humidity
              ? html`
                  <div class="kpi-card">
                    <div class="kpi-head">
                      <ha-icon icon="mdi:water-percent"></ha-icon>
                      <span>${localize("analytics.summary.humidity_label", l)}</span>
                    </div>
                    <div class="kpi-value">${Math.round(insights.humidity.latest)}%</div>
                    <div class="kpi-sub">
                      ${localize("analytics.summary.temp_range", l, {
                        avg: `${Math.round(insights.humidity.avg)}%`,
                        min: `${Math.round(insights.humidity.min)}%`,
                        max: `${Math.round(insights.humidity.max)}%`,
                      })}
                    </div>
                  </div>
                `
              : nothing
          }
          <div class="kpi-card">
            <div class="kpi-head">
              <ha-icon icon="mdi:timeline-clock-outline"></ha-icon>
              <span>
                ${
                  insights.forecastHorizonHours != null && insights.forecastHorizonHours > 0
                    ? localize("analytics.summary.forecast_horizon", l)
                    : localize("analytics.summary.data_points", l)
                }
              </span>
            </div>
            <div class="kpi-value">
              ${
                insights.forecastHorizonHours != null && insights.forecastHorizonHours > 0
                  ? `${insights.forecastHorizonHours.toFixed(
                      insights.forecastHorizonHours < 10 ? 1 : 0,
                    )}h`
                  : String(insights.dataPoints)
              }
            </div>
            <div class="kpi-sub">
              ${insights.dataPoints} ${localize("analytics.summary.data_points", l)}
            </div>
          </div>
        </div>

        ${
          !this.isOutdoor && runtimeSegments.length > 0
            ? html`
                <div class="runtime-card">
                  <div class="runtime-head">
                    <span class="runtime-title"
                      >${localize("analytics.summary.runtime_title", l)}</span
                    >
                    <div class="runtime-legend">
                      ${runtimeSegments.map(
                        (seg) => html`
                          <span class="runtime-item">
                            <span class="runtime-dot ${seg.id}"></span>
                            <span>${seg.label} ${Math.round(seg.pct)}%</span>
                          </span>
                        `,
                      )}
                      ${
                        rt.windowOpenPct >= 0.5
                          ? html`
                              <span class="runtime-window">
                                <ha-icon icon="mdi:window-open-variant"></ha-icon>
                                ${localize("analytics.summary.window_open_share", l)}
                                ${Math.round(rt.windowOpenPct)}%
                              </span>
                            `
                          : nothing
                      }
                    </div>
                  </div>
                  <div
                    class="runtime-track"
                    aria-label=${localize("analytics.summary.runtime_title", l)}
                  >
                    ${runtimeSegments.map(
                      (seg) =>
                        html`<span
                          class="runtime-seg ${seg.id}"
                          style="width: ${seg.pct.toFixed(1)}%"
                          title="${seg.label}: ${Math.round(seg.pct)}%"
                        ></span>`,
                    )}
                  </div>
                </div>
              `
            : nothing
        }
      </div>
    `;
  }

  static override styles = css`
    :host {
      display: block;
    }

    .insights-wrap {
      display: grid;
      gap: 10px;
      padding: 12px 16px 6px;
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 8px;
    }

    .kpi-card {
      min-width: 0;
      padding: 10px 12px;
      border-radius: var(--roommind-radius-control, 8px);
      border: var(--roommind-border-faint, 1px solid var(--divider-color));
      background: var(--roommind-surface-subtle);
      display: grid;
      gap: 3px;
    }

    .kpi-card.good {
      border-color: var(--roommind-success-border);
      background: var(--roommind-success-tint);
    }

    .kpi-card.warn {
      border-color: var(--roommind-warning-border);
      background: var(--roommind-warning-tint);
    }

    .kpi-card.low {
      border-color: var(--roommind-error-border);
      background: var(--roommind-error-tint);
    }

    .kpi-head {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--secondary-text-color);
      --mdc-icon-size: 15px;
    }

    .kpi-head ha-icon {
      color: var(--primary-color);
      flex-shrink: 0;
    }

    .kpi-card.good .kpi-head ha-icon {
      color: var(--success-color, #4caf50);
    }

    .kpi-card.warn .kpi-head ha-icon {
      color: var(--warning-color, #ff9800);
    }

    .kpi-card.low .kpi-head ha-icon {
      color: var(--error-color, #f44336);
    }

    .kpi-value {
      font-size: 20px;
      font-weight: 650;
      font-variant-numeric: tabular-nums;
      color: var(--primary-text-color);
      line-height: 1.15;
    }

    .kpi-sub {
      font-size: 11.5px;
      color: var(--secondary-text-color);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .runtime-card {
      display: grid;
      gap: 6px;
      padding: 8px 12px;
      border-radius: var(--roommind-radius-control, 8px);
      border: var(--roommind-border-faint, 1px solid var(--divider-color));
      background: var(--roommind-surface-subtle);
    }

    .runtime-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }

    .runtime-title {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--secondary-text-color);
    }

    .runtime-legend {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      font-size: 11.5px;
      color: var(--primary-text-color);
      font-variant-numeric: tabular-nums;
    }

    .runtime-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .runtime-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .runtime-window {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 7px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: var(--roommind-warning-tint);
      color: var(--warning-color, #ef6c00);
      --mdc-icon-size: 13px;
    }

    .runtime-track {
      display: flex;
      width: 100%;
      height: 8px;
      border-radius: 999px;
      overflow: hidden;
      background: var(--roommind-surface-muted);
    }

    .runtime-seg {
      display: block;
      height: 100%;
    }

    .runtime-dot.heating,
    .runtime-seg.heating {
      background: rgb(244, 67, 54);
    }

    .runtime-dot.cooling,
    .runtime-seg.cooling {
      background: rgb(33, 150, 243);
    }

    .runtime-dot.dry,
    .runtime-seg.dry {
      background: rgb(0, 172, 193);
    }

    .runtime-dot.fan_only,
    .runtime-seg.fan_only {
      background: rgb(38, 166, 154);
    }

    .runtime-dot.idle,
    .runtime-seg.idle {
      background: var(--divider-color, rgba(128, 128, 128, 0.35));
    }

    @media (max-width: 560px) {
      .insights-wrap {
        padding: 10px 12px 4px;
      }

      .kpi-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-analytics-summary": RsAnalyticsSummary;
  }
}
