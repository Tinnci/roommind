import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ClimateMode, HomeAssistant } from "../types";
import { localize } from "../utils/localize";
import { tempRange, tempStep, tempUnit, toCelsius, toDisplay } from "../utils/temperature";
import { inputStyles } from "../styles/input-styles";

@customElement("rs-targets-section")
export class RsTargetsSection extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ type: String }) public climateMode: ClimateMode = "auto";
  @property({ type: Number }) public comfortHeat = 21.0;
  @property({ type: Number }) public comfortCool = 24.0;
  @property({ type: Number }) public ecoHeat = 17.0;
  @property({ type: Number }) public ecoCool = 27.0;
  @property({ type: Boolean }) public preheatEnabled = true;

  static override styles = [
    inputStyles,
    css`
      :host {
        display: block;
      }

      .fallback-hint {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin-bottom: 12px;
        line-height: 1.45;
      }

      .temp-inputs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .preheat-row {
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
      }

      .preheat-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
      }

      .temp-grid-auto {
        display: grid;
        grid-template-columns: auto 1fr 1fr;
        gap: 8px 12px;
        align-items: center;
      }

      .temp-grid-header {
        font-size: 12px;
        font-weight: 600;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        text-align: center;
      }

      .temp-grid-row-label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        font-weight: 500;
        color: var(--secondary-text-color);
        white-space: nowrap;
      }

      @media (max-width: 600px) {
        .temp-grid-auto {
          grid-template-columns: 1fr 1fr;
        }
        .temp-grid-row-label {
          grid-column: 1 / -1;
          margin-top: 8px;
        }
        .temp-grid-header {
          display: none;
        }
      }
    `,
  ];

  override render() {
    const l = this.hass.language;
    const isNonTempMode =
      this.climateMode === "off" || this.climateMode === "dry" || this.climateMode === "fan_only";

    if (isNonTempMode) {
      return html`
        <div class="fallback-hint">
          ${localize(
            this.climateMode === "dry"
              ? "mode.dry_desc"
              : this.climateMode === "fan_only"
                ? "mode.fan_only_desc"
                : "mode.off_desc",
            l,
          )}
        </div>
        ${this._renderAutoGrid(l)}
      `;
    }

    if (this.climateMode === "auto") {
      return html`
        ${this._renderAutoGrid(l)}
        <div class="fallback-hint" style="margin-top: 12px; margin-bottom: 0">
          ${localize("schedule.comfort_hint", l)}
        </div>
      `;
    }

    const isCoolOnly = this.climateMode === "cool_only";
    return html`
      <div class="temp-inputs">
        <ha-textfield
          type="number"
          label=${localize("schedule.comfort_label", l)}
          suffix=${tempUnit(this.hass)}
          step=${tempStep(this.hass)}
          .value=${String(toDisplay(isCoolOnly ? this.comfortCool : this.comfortHeat, this.hass))}
          min=${tempRange(5, 35, this.hass).min}
          max=${tempRange(5, 35, this.hass).max}
          @change=${isCoolOnly ? this._onComfortCoolChange : this._onComfortHeatChange}
        ></ha-textfield>
        <ha-textfield
          type="number"
          label=${localize("schedule.eco_label", l)}
          suffix=${tempUnit(this.hass)}
          step=${tempStep(this.hass)}
          .value=${String(toDisplay(isCoolOnly ? this.ecoCool : this.ecoHeat, this.hass))}
          min=${tempRange(5, 35, this.hass).min}
          max=${tempRange(5, 35, this.hass).max}
          @change=${isCoolOnly ? this._onEcoCoolChange : this._onEcoHeatChange}
        ></ha-textfield>
      </div>
      <div class="fallback-hint" style="margin-top: 12px; margin-bottom: 0">
        ${localize("schedule.comfort_hint", l)}
      </div>
    `;
  }

  private _renderAutoGrid(l: string) {
    return html`
      <div class="temp-grid-auto">
        <div class="temp-grid-header"></div>
        <div class="temp-grid-header">${localize("schedule.column_comfort", l)}</div>
        <div class="temp-grid-header">${localize("schedule.column_eco", l)}</div>
        <div class="temp-grid-row-label">
          <ha-icon icon="mdi:fire" style="--mdc-icon-size:16px"></ha-icon>
          ${localize("schedule.row_heat", l)}
        </div>
        <ha-textfield
          type="number"
          .value=${String(toDisplay(this.comfortHeat, this.hass))}
          suffix=${tempUnit(this.hass)}
          step=${tempStep(this.hass)}
          min=${tempRange(5, 35, this.hass).min}
          max=${tempRange(5, 35, this.hass).max}
          @change=${this._onComfortHeatChange}
        ></ha-textfield>
        <ha-textfield
          type="number"
          .value=${String(toDisplay(this.ecoHeat, this.hass))}
          suffix=${tempUnit(this.hass)}
          step=${tempStep(this.hass)}
          min=${tempRange(5, 35, this.hass).min}
          max=${tempRange(5, 35, this.hass).max}
          @change=${this._onEcoHeatChange}
        ></ha-textfield>
        <div class="temp-grid-row-label">
          <ha-icon icon="mdi:snowflake" style="--mdc-icon-size:16px"></ha-icon>
          ${localize("schedule.row_cool", l)}
        </div>
        <ha-textfield
          type="number"
          .value=${String(toDisplay(this.comfortCool, this.hass))}
          suffix=${tempUnit(this.hass)}
          step=${tempStep(this.hass)}
          min=${tempRange(5, 35, this.hass).min}
          max=${tempRange(5, 35, this.hass).max}
          @change=${this._onComfortCoolChange}
        ></ha-textfield>
        <ha-textfield
          type="number"
          .value=${String(toDisplay(this.ecoCool, this.hass))}
          suffix=${tempUnit(this.hass)}
          step=${tempStep(this.hass)}
          min=${tempRange(5, 35, this.hass).min}
          max=${tempRange(5, 35, this.hass).max}
          @change=${this._onEcoCoolChange}
        ></ha-textfield>
      </div>
      <div class="preheat-row">
        <label class="preheat-toggle">
          <ha-checkbox
            .checked=${this.preheatEnabled}
            @change=${(e: Event) =>
              this.dispatchEvent(
                new CustomEvent("preheat-enabled-changed", {
                  detail: { value: (e.target as HTMLInputElement).checked },
                  bubbles: true,
                  composed: true,
                }),
              )}
          ></ha-checkbox>
          <span>${localize("targets.preheat_enabled", l)}</span>
        </label>
        <div class="fallback-hint" style="margin: 4px 0 0 36px">
          ${localize("targets.preheat_enabled_hint", l)}
        </div>
      </div>
    `;
  }

  private _emit(event: string, value: number) {
    this.dispatchEvent(
      new CustomEvent(event, {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onComfortHeatChange(e: Event) {
    const target = e.target as HTMLElement & { value: string };
    const val = toCelsius(parseFloat(target.value) || toDisplay(21.0, this.hass), this.hass);
    this._emit("comfort-heat-changed", val);
    if (this.comfortCool < val) this._emit("comfort-cool-changed", val);
  }

  private _onComfortCoolChange(e: Event) {
    const target = e.target as HTMLElement & { value: string };
    const val = toCelsius(parseFloat(target.value) || toDisplay(24.0, this.hass), this.hass);
    this._emit("comfort-cool-changed", val);
    if (this.comfortHeat > val) this._emit("comfort-heat-changed", val);
  }

  private _onEcoHeatChange(e: Event) {
    const target = e.target as HTMLElement & { value: string };
    const val = toCelsius(parseFloat(target.value) || toDisplay(17.0, this.hass), this.hass);
    this._emit("eco-heat-changed", val);
    if (this.ecoCool < val) this._emit("eco-cool-changed", val);
  }

  private _onEcoCoolChange(e: Event) {
    const target = e.target as HTMLElement & { value: string };
    const val = toCelsius(parseFloat(target.value) || toDisplay(27.0, this.hass), this.hass);
    this._emit("eco-cool-changed", val);
    if (this.ecoHeat > val) this._emit("eco-heat-changed", val);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-targets-section": RsTargetsSection;
  }
}
