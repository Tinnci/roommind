import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant, RoomConfig } from "../types";
import { localize } from "../utils/localize";
import { formatTemp, tempUnit } from "../utils/temperature";
import { computeThermalBand } from "../utils/thermal-band";

@customElement("rs-thermal-band")
export class RsThermalBand extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config: RoomConfig | null = null;
  @property({ type: Boolean, reflect: true }) public compact = false;

  static override styles = css`
    :host {
      display: block;
    }

    .band-card {
      margin-top: 14px;
      padding: 12px 14px;
      border-radius: var(--roommind-radius-control, 12px);
      background: var(
        --roommind-surface-subtle,
        rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.03)
      );
      border: var(--roommind-border-faint, 1px solid rgba(0, 0, 0, 0.08));
    }

    :host([compact]) .band-card {
      margin-top: 10px;
      padding: 8px 10px;
    }

    .band-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
      font-size: 11px;
      font-weight: 600;
      color: var(--secondary-text-color);
    }

    .scale-labels {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      font-weight: 500;
      color: var(--secondary-text-color);
      margin-top: 5px;
      font-variant-numeric: tabular-nums;
    }

    :host([compact]) .scale-labels {
      margin-top: 4px;
    }

    .track-wrap {
      position: relative;
      height: 16px;
      display: flex;
      align-items: center;
    }

    :host([compact]) .track-wrap {
      height: 12px;
    }

    .track {
      position: relative;
      width: 100%;
      height: 8px;
      border-radius: 999px;
      background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--roommind-info-color, #2196f3) 20%, transparent) 0%,
        rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08) 50%,
        color-mix(in srgb, var(--roommind-warning-color, #ff9800) 20%, transparent) 100%
      );
      overflow: hidden;
    }

    :host([compact]) .track {
      height: 6px;
    }

    .comfort-zone {
      position: absolute;
      top: 0;
      bottom: 0;
      background: color-mix(in srgb, var(--roommind-success-color, #4caf50) 34%, transparent);
      border-left: 1.5px solid var(--roommind-success-color, #4caf50);
      border-right: 1.5px solid var(--roommind-success-color, #4caf50);
    }

    .pin-current {
      position: absolute;
      top: 50%;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: var(--primary-text-color);
      border: 2px solid var(--card-background-color, #fff);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.28);
      z-index: 3;
    }

    :host([compact]) .pin-current {
      width: 10px;
      height: 10px;
    }

    .pin-perceived {
      position: absolute;
      top: 50%;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      background: var(--card-background-color, #fff);
      border: 2px dashed var(--roommind-warning-color, #ff9800);
      z-index: 2;
    }

    .pin-device {
      position: absolute;
      top: 50%;
      width: 8px;
      height: 8px;
      border-radius: 2px;
      transform: translate(-50%, -50%) rotate(45deg);
      border: 1.5px solid var(--card-background-color, #fff);
      background: var(--primary-color, #03a9f4);
      z-index: 4;
    }

    .pin-device[data-mode="heat"] {
      background: var(--roommind-warning-color, #ff9800);
    }

    .pin-device[data-mode="cool"],
    .pin-device[data-mode="dry"] {
      background: var(--roommind-info-color, #2196f3);
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 12px;
      margin-top: 8px;
      font-size: 11px;
      color: var(--secondary-text-color);
    }

    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-variant-numeric: tabular-nums;
    }

    .swatch {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .swatch-current {
      background: var(--primary-text-color);
    }

    .swatch-perceived {
      border: 1.5px dashed var(--roommind-warning-color, #ff9800);
    }

    .swatch-band {
      border-radius: 2px;
      background: color-mix(in srgb, var(--roommind-success-color, #4caf50) 55%, transparent);
    }

    .swatch-device {
      border-radius: 1px;
      transform: rotate(45deg);
      background: var(--roommind-info-color, #2196f3);
    }
  `;

  override render() {
    if (!this.config || this.config.is_outdoor || !this.hass) return nothing;
    const model = computeThermalBand(this.config, this.hass);
    if (!model) return nothing;

    const l = this.hass.language;
    const unit = tempUnit(this.hass);

    const renderTrack = html`
      <div class="track-wrap">
        <div class="track">
          ${
            model.bandStartPct != null && model.bandWidthPct != null
              ? html`<div
                  class="comfort-zone"
                  style="left:${model.bandStartPct.toFixed(1)}%;width:${model.bandWidthPct.toFixed(
                    1,
                  )}%;"
                ></div>`
              : nothing
          }
        </div>
        ${
          model.perceivedPct != null && model.perceivedTempC != null
            ? html`<div
                class="pin-perceived"
                style="left:${model.perceivedPct.toFixed(1)}%;"
                title="${localize("thermal_band.perceived", l)}: ${formatTemp(
                  model.perceivedTempC,
                  this.hass,
                )}${unit}"
              ></div>`
            : nothing
        }
        ${
          model.currentPct != null && model.currentTempC != null
            ? html`<div
                class="pin-current"
                style="left:${model.currentPct.toFixed(1)}%;"
                title="${localize("thermal_band.current", l)}: ${formatTemp(
                  model.currentTempC,
                  this.hass,
                )}${unit}"
              ></div>`
            : nothing
        }
        ${model.devicePins.map(
          (pin) => html`
            <div
              class="pin-device"
              data-mode=${pin.hvacMode ?? "auto"}
              style="left:${pin.percent.toFixed(1)}%;"
              title="${localize("thermal_band.unit_setpoint", l, {
                name: pin.name,
                temp: `${formatTemp(pin.tempC, this.hass)}${unit}`,
              })}"
            ></div>
          `,
        )}
      </div>
    `;

    if (this.compact) {
      return html`
        <div class="band-card">
          ${renderTrack}
          <div class="scale-labels">
            <span>${formatTemp(model.minC, this.hass, 0)}${unit}</span>
            ${
              model.bandLowC != null && model.bandHighC != null
                ? html`<span
                    >${formatTemp(model.bandLowC, this.hass)}–${formatTemp(
                      model.bandHighC,
                      this.hass,
                    )}${unit}</span
                  >`
                : nothing
            }
            <span>${formatTemp(model.maxC, this.hass, 0)}${unit}</span>
          </div>
        </div>
      `;
    }

    return html`
      <div class="band-card">
        <div class="band-header">
          <span>${localize("thermal_band.title", l)}</span>
          ${
            model.bandLowC != null && model.bandHighC != null
              ? html`<span
                  >${localize("thermal_band.comfort_band", l)}:
                  ${formatTemp(model.bandLowC, this.hass)}–${formatTemp(
                    model.bandHighC,
                    this.hass,
                  )}${unit}</span
                >`
              : nothing
          }
        </div>
        ${renderTrack}
        <div class="scale-labels">
          <span>${formatTemp(model.minC, this.hass, 0)}${unit}</span>
          <span>${formatTemp(model.midC, this.hass, 0)}${unit}</span>
          <span>${formatTemp(model.maxC, this.hass, 0)}${unit}</span>
        </div>
        <div class="legend">
          ${
            model.currentTempC != null
              ? html`<span class="legend-item">
                  <span class="swatch swatch-current"></span>
                  ${localize("thermal_band.current", l)}:
                  ${formatTemp(model.currentTempC, this.hass)}${unit}
                </span>`
              : nothing
          }
          ${
            model.perceivedTempC != null
              ? html`<span class="legend-item">
                  <span class="swatch swatch-perceived"></span>
                  ${localize("thermal_band.perceived", l)}:
                  ${formatTemp(model.perceivedTempC, this.hass)}${unit}
                </span>`
              : nothing
          }
          ${
            model.bandLowC != null && model.bandHighC != null
              ? html`<span class="legend-item">
                  <span class="swatch swatch-band"></span>
                  ${localize("thermal_band.comfort_band", l)}
                </span>`
              : nothing
          }
          ${model.devicePins.map(
            (pin) => html`
              <span class="legend-item">
                <span class="swatch swatch-device"></span>
                ${localize("thermal_band.unit_setpoint", l, {
                  name: pin.name,
                  temp: `${formatTemp(pin.tempC, this.hass)}${unit}`,
                })}
              </span>
            `,
          )}
        </div>
      </div>
    `;
  }
}
