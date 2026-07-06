/**
 * rs-analytics-summary – Compact metric strip above the analytics chart.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant, AnalyticsData } from "../../types";
import {
  buildAnalyticsSummary,
  type AnalyticsSummaryMetric,
  type AnalyticsSummaryMetricId,
} from "../../utils/analytics-summary";
import { localize, type TranslationKey } from "../../utils/localize";
import { formatTemp, tempUnit, toDisplayDelta } from "../../utils/temperature";

@customElement("rs-analytics-summary")
export class RsAnalyticsSummary extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public data: AnalyticsData | null = null;
  @property({ type: String }) public language = "en";
  @property({ type: Boolean }) public isOutdoor = false;

  override render() {
    const metrics = buildAnalyticsSummary(this.data, { isOutdoor: this.isOutdoor });
    if (metrics.length === 0) return nothing;

    return html`
      <div class="summary-grid">
        ${metrics.map(
          (metric) => html`
            <div class="summary-item ${metric.tone ?? "neutral"}">
              <div class="summary-label">${this._label(metric.id)}</div>
              <div class="summary-value">${this._value(metric)}</div>
            </div>
          `,
        )}
      </div>
    `;
  }

  private _label(id: AnalyticsSummaryMetricId) {
    const keys: Record<AnalyticsSummaryMetricId, TranslationKey> = {
      latest_temp: "analytics.summary.latest_temp",
      avg_temp: "analytics.summary.avg_temp",
      avg_target: "analytics.summary.avg_target",
      avg_deviation: "analytics.summary.avg_deviation",
      heating_share: "analytics.summary.heating_share",
      cooling_share: "analytics.summary.cooling_share",
      window_open_share: "analytics.summary.window_open_share",
      forecast_horizon: "analytics.summary.forecast_horizon",
      data_points: "analytics.summary.data_points",
    };
    return localize(keys[id], this.language);
  }

  private _value(metric: AnalyticsSummaryMetric) {
    switch (metric.kind) {
      case "temperature":
        return `${formatTemp(metric.value, this.hass)}${tempUnit(this.hass)}`;
      case "delta":
        return `${toDisplayDelta(metric.value, this.hass).toFixed(1)}${tempUnit(this.hass)}`;
      case "percent":
        return `${Math.round(metric.value)}%`;
      case "hours":
        return `${metric.value.toFixed(metric.value < 10 ? 1 : 0)}h`;
      case "count":
        return String(Math.round(metric.value));
    }
  }

  static override styles = css`
    :host {
      display: block;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
      gap: 8px;
      padding: 12px 16px 4px;
    }

    .summary-item {
      min-width: 0;
      border: var(--roommind-border-faint, 1px solid var(--divider-color, rgba(0, 0, 0, 0.06)));
      border-radius: var(--roommind-radius-control, 8px);
      padding: 9px 10px;
      background: var(--roommind-surface-subtle);
    }

    .summary-item.heating {
      border-color: var(--roommind-warning-border);
      background: var(--roommind-warning-tint);
    }

    .summary-item.cooling {
      border-color: var(--roommind-info-border);
      background: var(--roommind-info-tint);
    }

    .summary-item.warning {
      border-color: var(--roommind-error-border);
      background: var(--roommind-error-tint);
    }

    .summary-label {
      color: var(--secondary-text-color);
      font-size: 11px;
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .summary-value {
      color: var(--primary-text-color);
      font-size: 18px;
      font-weight: 650;
      line-height: 1.2;
      margin-top: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    @media (max-width: 520px) {
      .summary-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        padding: 10px 12px 2px;
      }

      .summary-value {
        font-size: 16px;
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-analytics-summary": RsAnalyticsSummary;
  }
}
