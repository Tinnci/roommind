import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ClimateMode } from "../types";
import { localize, type TranslationKey } from "../utils/localize";

@customElement("rs-climate-mode-selector")
export class RsClimateModeSelector extends LitElement {
  @property({ type: String }) public climateMode: ClimateMode = "auto";
  @property({ type: String }) public language = "en";

  static override styles = css`
    :host {
      display: block;
    }

    .mode-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
      gap: 8px;
    }

    .mode-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 14px 8px;
      border: 2px solid var(--divider-color, #e0e0e0);
      border-radius: 8px;
      cursor: pointer;
      transition:
        border-color 0.2s,
        background 0.2s,
        box-shadow 0.2s;
      background: transparent;
      font-family: inherit;
      color: var(--primary-text-color);
      text-align: center;
    }

    .mode-card:hover {
      border-color: var(--primary-color, #03a9f4);
      background: var(--roommind-surface-hover);
      box-shadow: 0 2px 8px rgba(var(--rgb-primary-color, 3, 169, 244), 0.1);
    }

    .mode-card[active] {
      border-color: var(--primary-color, #03a9f4);
      background: var(--roommind-primary-muted);
      box-shadow: 0 2px 8px rgba(var(--rgb-primary-color, 3, 169, 244), 0.12);
    }

    .mode-card[active][data-mode="cool_only"],
    .mode-card[active][data-mode="dry"] {
      border-color: var(--roommind-info-color, #2196f3);
      background: var(--roommind-info-tint, rgba(33, 150, 243, 0.12));
    }

    .mode-card[active][data-mode="cool_only"] .mode-card-icon,
    .mode-card[active][data-mode="cool_only"] .mode-card-label,
    .mode-card[active][data-mode="dry"] .mode-card-icon,
    .mode-card[active][data-mode="dry"] .mode-card-label {
      color: var(--roommind-info-color, #1976d2);
    }

    .mode-card[active][data-mode="heat_only"] {
      border-color: var(--roommind-warning-color, #ff9800);
      background: var(--roommind-warning-tint, rgba(255, 152, 0, 0.12));
    }

    .mode-card[active][data-mode="heat_only"] .mode-card-icon,
    .mode-card[active][data-mode="heat_only"] .mode-card-label {
      color: var(--roommind-warning-color, #ef6c00);
    }

    .mode-card[active][data-mode="fan_only"] {
      border-color: var(--roommind-success-color, #26a69a);
      background: var(--roommind-success-tint, rgba(38, 166, 154, 0.12));
    }

    .mode-card[active][data-mode="fan_only"] .mode-card-icon,
    .mode-card[active][data-mode="fan_only"] .mode-card-label {
      color: var(--roommind-success-color, #00796b);
    }

    .mode-card[active][data-mode="off"] {
      border-color: var(--secondary-text-color);
      background: var(--roommind-surface-muted, rgba(0, 0, 0, 0.06));
    }

    .mode-card[active][data-mode="off"] .mode-card-icon,
    .mode-card[active][data-mode="off"] .mode-card-label {
      color: var(--secondary-text-color);
    }

    .mode-card-icon {
      --mdc-icon-size: 24px;
    }

    .mode-card[active] .mode-card-icon {
      color: var(--primary-color, #03a9f4);
    }

    .mode-card-label {
      font-weight: 500;
      font-size: 13px;
    }

    .mode-card[active] .mode-card-label {
      color: var(--primary-color, #03a9f4);
    }
  `;

  override render() {
    const l = this.language;
    const modes: {
      value: ClimateMode;
      labelKey: TranslationKey;
      icon: string;
    }[] = [
      { value: "off", labelKey: "mode.off", icon: "mdi:power" },
      { value: "cool_only", labelKey: "mode.cool_only", icon: "mdi:snowflake" },
      { value: "heat_only", labelKey: "mode.heat_only", icon: "mdi:fire" },
      { value: "dry", labelKey: "mode.dry", icon: "mdi:water-percent" },
      { value: "fan_only", labelKey: "mode.fan_only", icon: "mdi:fan" },
      { value: "auto", labelKey: "mode.auto", icon: "mdi:autorenew" },
    ];

    return html`
      <div class="mode-grid">
        ${modes.map(
          (m) => html`
            <button
              class="mode-card"
              type="button"
              data-mode=${m.value}
              ?active=${this.climateMode === m.value}
              aria-pressed=${this.climateMode === m.value}
              @click=${() => this._onModeClick(m.value)}
            >
              <ha-icon class="mode-card-icon" icon=${m.icon}></ha-icon>
              <div class="mode-card-label">${localize(m.labelKey, l)}</div>
            </button>
          `,
        )}
      </div>
    `;
  }

  private _onModeClick(mode: ClimateMode) {
    this.dispatchEvent(
      new CustomEvent("mode-changed", {
        detail: { mode },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-climate-mode-selector": RsClimateModeSelector;
  }
}
