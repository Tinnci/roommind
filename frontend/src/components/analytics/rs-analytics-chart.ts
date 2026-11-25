/**
 * rs-analytics-chart – Multi-lens Chart card with ha-chart-base, lens tabs & structured legend.
 */
import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, AnalyticsData } from "../../types";
import { localize, type TranslationKey } from "../../utils/localize";
import { infoIconStyles } from "../../styles/info-icon-styles";
import { buildAnalyticsInsights } from "../../utils/analytics-insights";
import {
  buildChartSeries,
  buildChartOptions,
  type AnalyticsChartLens,
  type ChartBuildContext,
} from "../../utils/chart-builder";
import "./rs-analytics-summary";

const DEFAULT_HIDDEN_SERIES = [
  "outdoor_temp",
  "device_setpoint",
  "perceived_temp",
  "outdoor_humidity",
];

@customElement("rs-analytics-chart")
export class RsAnalyticsChart extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public data: AnalyticsData | null = null;
  @property({ type: Number }) public rangeStart = 0;
  @property({ type: Number }) public rangeEnd = 0;
  @property({ type: Number }) public chartAnchor = 0;
  @property({ type: String }) public language = "en";
  @property({ type: Boolean }) public isOutdoor = false;

  @state() private _lens: AnalyticsChartLens = "temperature";
  @state() private _hiddenSeries = new Set(DEFAULT_HIDDEN_SERIES);
  @state() private _chartInfoExpanded = false;

  protected override willUpdate(changedProps: PropertyValues): void {
    if (changedProps.has("data") || changedProps.has("isOutdoor")) {
      const insights = buildAnalyticsInsights(this.data, { isOutdoor: this.isOutdoor });
      if (
        (this._lens === "activity" && !insights?.hasActivityLens) ||
        (this._lens === "humidity" && !insights?.hasHumidity)
      ) {
        this._lens = "temperature";
      }
    }
  }

  override render() {
    const l = this.language;
    const points = this.data ? [...this.data.history, ...this.data.detail] : [];
    const allPoints = [...points, ...(this.data?.forecast ?? [])];
    const insights = buildAnalyticsInsights(this.data, { isOutdoor: this.isOutdoor });

    const availableLenses: Array<{
      id: AnalyticsChartLens;
      labelKey: TranslationKey;
      icon: string;
    }> = [{ id: "temperature", labelKey: "analytics.lens_temperature", icon: "mdi:thermometer" }];
    if (insights?.hasActivityLens) {
      availableLenses.push({
        id: "activity",
        labelKey: "analytics.lens_activity",
        icon: "mdi:hvac",
      });
    }
    if (insights?.hasHumidity) {
      availableLenses.push({
        id: "humidity",
        labelKey: "analytics.lens_humidity",
        icon: "mdi:water-percent",
      });
    }

    const chartCtx: ChartBuildContext = {
      hass: this.hass,
      language: l,
      chartAnchor: this.chartAnchor,
      rangeStart: this.rangeStart,
      rangeEnd: this.rangeEnd,
      isOutdoor: this.isOutdoor,
      lens: this._lens,
      ...(this.data?.forecast ? { forecast: this.data.forecast } : {}),
    };
    const allSeries = points.length > 0 ? buildChartSeries(points, chartCtx) : [];

    const visibleY: number[] = [];
    const displaySeries = allSeries.map((s) => {
      const id = s.id as string;
      const ls = (s.lineStyle as Record<string, unknown>) || {};
      const isEvent = id.endsWith("_events");
      if (this._hiddenSeries.has(id)) {
        const hidden: Record<string, unknown> = {
          ...s,
          lineStyle: { ...ls, width: 0, opacity: 0 },
        };
        if (s.areaStyle) {
          hidden.areaStyle = { ...(s.areaStyle as Record<string, unknown>), opacity: 0 };
        }
        return hidden;
      }
      if (!isEvent && id !== "now_marker") {
        for (const point of s.data as Array<[number, number]>) {
          if (point && point[1] != null) {
            visibleY.push(point[1]);
          }
        }
      }
      const visible: Record<string, unknown> = { ...s, lineStyle: { ...ls, opacity: 1 } };
      if (s.areaStyle) {
        visible.areaStyle = { ...(s.areaStyle as Record<string, unknown>), opacity: 1 };
      }
      return visible;
    });

    const options = buildChartOptions(visibleY, allPoints, chartCtx);

    return html`
      <ha-card>
        <div class="card-header">
          <div class="header-left">
            <span class="title-wrap">
              <ha-icon icon="mdi:chart-areaspline"></ha-icon>
              <span>${localize("analytics.temperature", l)}</span>
            </span>
            ${
              availableLenses.length > 1
                ? html`
                    <div class="lens-tabs" role="tablist">
                      ${availableLenses.map(
                        (lens) => html`
                          <button
                            type="button"
                            class="lens-tab"
                            role="tab"
                            aria-selected=${this._lens === lens.id}
                            ?active=${this._lens === lens.id}
                            @click=${() => {
                              this._lens = lens.id;
                            }}
                          >
                            <ha-icon icon=${lens.icon}></ha-icon>
                            <span>${localize(lens.labelKey, l)}</span>
                          </button>
                        `,
                      )}
                    </div>
                  `
                : nothing
            }
          </div>
          <div class="header-right">
            ${
              points.length > 0
                ? html`<span class="zoom-hint">${localize("analytics.zoom_hint", l)}</span>`
                : nothing
            }
            <ha-icon
              class="info-icon chart-info-toggle ${this._chartInfoExpanded ? "info-active" : ""}"
              icon="mdi:information-outline"
              @click=${() => {
                this._chartInfoExpanded = !this._chartInfoExpanded;
              }}
            ></ha-icon>
          </div>
        </div>
        ${
          this._chartInfoExpanded
            ? html`<div class="chart-info-panel">
                ${this._renderMarkdown(localize("analytics.chart_info_body", l))}
              </div>`
            : nothing
        }
        ${
          points.length > 0
            ? html`
                <rs-analytics-summary
                  .hass=${this.hass}
                  .data=${this.data}
                  .language=${l}
                  .isOutdoor=${this.isOutdoor}
                ></rs-analytics-summary>
                <div class="chart-frame">
                  <ha-chart-base
                    .hass=${this.hass}
                    .data=${displaySeries}
                    .options=${options}
                    .height=${"360px"}
                  ></ha-chart-base>
                </div>
                ${this._renderSeriesLegend(allSeries, l)}
              `
            : html`<div class="chart-empty">
                <ha-icon icon="mdi:chart-line"></ha-icon>
                <span>${localize("analytics.no_data", l)}</span>
              </div>`
        }
      </ha-card>
    `;
  }

  private _hasCustomVisibility(): boolean {
    if (this._hiddenSeries.size !== DEFAULT_HIDDEN_SERIES.length) return true;
    return DEFAULT_HIDDEN_SERIES.some((id) => !this._hiddenSeries.has(id));
  }

  private _resetVisibility() {
    this._hiddenSeries = new Set(DEFAULT_HIDDEN_SERIES);
  }

  private _renderSeriesLegend(series: Array<Record<string, unknown>>, l: string) {
    const legendSeries = series.filter((s) => (s.id as string) !== "now_marker");
    return html`
      <div class="series-legend">
        ${legendSeries.map((s) => {
          const id = s.id as string;
          const hidden = this._hiddenSeries.has(id);
          const isEvent = id.endsWith("_events");
          const lineStyle = (s.lineStyle as Record<string, unknown> | undefined) ?? {};
          const lineType = lineStyle.type as string | undefined;
          return html`
            <button
              type="button"
              class="legend-item ${hidden ? "legend-hidden" : ""}"
              aria-pressed=${!hidden}
              @click=${() => this._toggleSeries(id)}
            >
              ${
                isEvent
                  ? html`<span class="legend-band" style="background:${s.color}"></span>`
                  : html`<span
                      class="legend-stroke ${lineType ?? "solid"}"
                      style="border-color:${s.color}"
                    ></span>`
              }
              <span>${s.name}</span>
            </button>
          `;
        })}
        ${
          this._hasCustomVisibility()
            ? html`
                <button type="button" class="legend-reset" @click=${this._resetVisibility}>
                  ${localize("analytics.legend_reset", l)}
                </button>
              `
            : nothing
        }
      </div>
    `;
  }

  private _renderMarkdown(text: string) {
    const paragraphs = text.split("\n\n");
    return paragraphs.map(
      (p) =>
        html`<p>
          ${p
            .split(/(\*\*.*?\*\*)/)
            .map((part) =>
              part.startsWith("**") && part.endsWith("**")
                ? html`<strong>${part.slice(2, -2)}</strong>`
                : part,
            )}
        </p>`,
    );
  }

  private _toggleSeries(id: string) {
    const next = new Set(this._hiddenSeries);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this._hiddenSeries = next;
  }

  static override styles = [
    infoIconStyles,
    css`
      :host {
        display: block;
      }

      ha-card {
        border-radius: var(--roommind-radius-card, 12px);
        border: var(--roommind-border-subtle, 1px solid var(--divider-color));
        background: var(--roommind-surface, var(--card-background-color));
        box-shadow: none;
        overflow: hidden;
      }

      .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        padding: 12px 16px 0;
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        min-width: 0;
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

      .lens-tabs {
        display: inline-flex;
        flex-wrap: wrap;
        border-radius: var(--roommind-radius-control, 8px);
        border: var(--roommind-border-subtle, 1px solid var(--divider-color));
        background: var(--roommind-surface-subtle);
        overflow: hidden;
      }

      .lens-tab {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border: none;
        border-right: var(--roommind-border-faint, 1px solid var(--divider-color));
        background: transparent;
        color: var(--secondary-text-color);
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        --mdc-icon-size: 14px;
      }

      .lens-tab:last-child {
        border-right: none;
      }

      .lens-tab:hover:not([active]) {
        background: var(--roommind-surface-hover);
        color: var(--primary-text-color);
      }

      .lens-tab[active] {
        background: var(--roommind-primary-strong);
        color: var(--primary-color);
      }

      .header-right {
        display: inline-flex;
        align-items: center;
        gap: 10px;
      }

      .zoom-hint {
        font-size: 11.5px;
        color: var(--secondary-text-color);
        opacity: 0.8;
      }

      .chart-info-toggle {
        --mdc-icon-size: 20px;
      }

      .chart-info-panel {
        margin: 10px 16px 4px;
        padding: 12px 14px;
        border-radius: var(--roommind-radius-control, 8px);
        background: var(--roommind-surface-muted);
        font-size: 13px;
        line-height: 1.55;
        color: var(--secondary-text-color);
      }

      .chart-info-panel p {
        margin: 0 0 8px;
      }

      .chart-info-panel p:last-child {
        margin-bottom: 0;
      }

      .chart-info-panel strong {
        color: var(--primary-text-color);
      }

      .chart-frame {
        padding: 4px 8px 0;
      }

      .chart-frame ha-chart-base {
        display: block;
        height: 360px;
      }

      .series-legend {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 6px;
        padding: 8px 16px 14px;
        flex-wrap: wrap;
      }

      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 4px 10px;
        border: var(--roommind-border-faint, 1px solid var(--divider-color));
        border-radius: 999px;
        background: var(--roommind-surface-subtle);
        color: var(--primary-text-color);
        font-size: 12px;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        transition:
          opacity 0.2s,
          border-color 0.2s;
      }

      .legend-item:hover {
        border-color: var(--roommind-primary-border);
        background: var(--roommind-surface-hover);
      }

      .legend-item.legend-hidden {
        opacity: 0.42;
      }

      .legend-stroke {
        width: 14px;
        height: 0;
        border-top-width: 2.5px;
        border-top-style: solid;
        flex-shrink: 0;
      }

      .legend-stroke.dashed {
        border-top-style: dashed;
      }

      .legend-stroke.dotted {
        border-top-style: dotted;
      }

      .legend-band {
        width: 10px;
        height: 10px;
        border-radius: 3px;
        opacity: 0.45;
        flex-shrink: 0;
      }

      .legend-reset {
        padding: 4px 10px;
        border: var(--roommind-border-faint, 1px solid var(--divider-color));
        border-radius: 999px;
        background: transparent;
        color: var(--primary-color);
        font: inherit;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
      }

      .legend-reset:hover {
        background: var(--roommind-primary-muted);
      }

      .chart-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 220px;
        gap: 8px;
        color: var(--secondary-text-color);
        opacity: 0.55;
        --mdc-icon-size: 40px;
        font-size: 13px;
      }

      @media (max-width: 600px) {
        .card-header {
          padding: 10px 12px 0;
        }

        .zoom-hint {
          display: none;
        }

        .chart-frame ha-chart-base {
          height: 280px;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-analytics-chart": RsAnalyticsChart;
  }
}
