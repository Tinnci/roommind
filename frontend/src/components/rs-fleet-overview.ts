import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { FleetFilter, FleetOverviewStats } from "../utils/fleet-overview";
import { localize } from "../utils/localize";

@customElement("rs-fleet-overview")
export class RsFleetOverview extends LitElement {
  @property({ type: String }) public language = "en";
  @property({ attribute: false }) public stats!: FleetOverviewStats;
  @property({ type: String }) public filter: FleetFilter = "all";

  static override styles = css`
    :host {
      display: block;
    }

    .overview-bar {
      background: var(--roommind-surface, var(--card-background-color));
      border: var(--roommind-border-subtle, 1px solid var(--divider-color));
      border-radius: var(--roommind-radius-card, 16px);
      padding: 14px 18px;
      margin-bottom: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .stats-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .title-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      color: var(--primary-text-color);
    }

    .title-wrap ha-icon {
      --mdc-icon-size: 18px;
      color: var(--primary-color);
    }

    .kpi-strip {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .kpi {
      display: inline-flex;
      align-items: baseline;
      gap: 5px;
      font-size: 12px;
      color: var(--secondary-text-color);
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--roommind-surface-subtle, rgba(0, 0, 0, 0.03));
      border: var(--roommind-border-faint, 1px solid rgba(0, 0, 0, 0.08));
      font-variant-numeric: tabular-nums;
    }

    .kpi strong {
      font-size: 13px;
      color: var(--primary-text-color);
    }

    .kpi.attention strong,
    .kpi.attention {
      color: var(--roommind-error-color, #d32f2f);
      border-color: var(--roommind-error-border, rgba(244, 67, 54, 0.28));
      background: var(--roommind-error-tint, rgba(244, 67, 54, 0.08));
    }

    .filter-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .filter-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.14));
      background: transparent;
      color: var(--secondary-text-color);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      font-family: inherit;
    }

    .filter-chip:hover {
      border-color: var(--primary-color);
      color: var(--primary-text-color);
    }

    .filter-chip.active {
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.14);
      border-color: var(--primary-color);
      color: var(--primary-color);
      font-weight: 600;
    }

    .chip-count {
      font-size: 11px;
      opacity: 0.8;
      font-variant-numeric: tabular-nums;
    }

    @media (max-width: 600px) {
      .overview-bar {
        padding: 12px 14px;
      }
    }
  `;

  private _selectFilter(next: FleetFilter) {
    const target: FleetFilter = this.filter === next && next !== "all" ? "all" : next;
    this.dispatchEvent(
      new CustomEvent("fleet-filter-changed", {
        detail: { filter: target },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    if (!this.stats || this.stats.configuredRooms === 0) return nothing;
    const l = this.language;
    const s = this.stats;

    const chips: {
      id: FleetFilter;
      label: string;
      count: number;
      show: boolean;
    }[] = [
      {
        id: "all",
        label: localize("overview.filter.all", l),
        count: s.configuredRooms,
        show: true,
      },
      {
        id: "active",
        label: localize("overview.filter.active", l),
        count: s.activeRooms,
        show: true,
      },
      {
        id: "multi_unit",
        label: localize("overview.filter.multi_unit", l),
        count: s.multiUnitRooms,
        show: s.multiUnitRooms > 0,
      },
      {
        id: "cooling",
        label: localize("overview.filter.cooling", l),
        count: s.coolingDryingRooms,
        show: true,
      },
      {
        id: "heating",
        label: localize("overview.filter.heating", l),
        count: s.heatingRooms,
        show: true,
      },
      {
        id: "off",
        label: localize("overview.filter.off", l),
        count: s.offIdleRooms,
        show: true,
      },
      {
        id: "attention",
        label: localize("overview.filter.attention", l),
        count: s.attentionRooms,
        show: s.attentionRooms > 0,
      },
    ];

    return html`
      <section class="overview-bar">
        <div class="stats-row">
          <div class="title-wrap">
            <ha-icon icon="mdi:home-thermometer-outline"></ha-icon>
            <span>${localize("overview.stats.title", l)}</span>
          </div>
          <div class="kpi-strip">
            <span class="kpi">
              ${localize("overview.stats.active_units", l)}
              <strong>${s.activeUnits}/${s.totalUnits}</strong>
            </span>
            <span class="kpi">
              ${localize("overview.stats.active_rooms", l)}
              <strong>${s.activeRooms}/${s.configuredRooms}</strong>
            </span>
            <span class="kpi">
              ${localize("overview.stats.cooling_drying", l)}
              <strong>${s.coolingDryingRooms}</strong>
            </span>
            <span class="kpi">
              ${localize("overview.stats.heating", l)}
              <strong>${s.heatingRooms}</strong>
            </span>
            ${
              s.attentionRooms > 0
                ? html`<span class="kpi attention">
                    ${localize("overview.stats.attention", l)}
                    <strong>${s.attentionRooms}</strong>
                  </span>`
                : nothing
            }
          </div>
        </div>

        <div class="filter-row">
          ${chips
            .filter((chip) => chip.show)
            .map(
              (chip) => html`
                <button
                  type="button"
                  class="filter-chip ${this.filter === chip.id ? "active" : ""}"
                  aria-pressed=${this.filter === chip.id}
                  @click=${() => this._selectFilter(chip.id)}
                >
                  <span>${chip.label}</span>
                  <span class="chip-count">${chip.count}</span>
                </button>
              `,
            )}
        </div>
      </section>
    `;
  }
}
