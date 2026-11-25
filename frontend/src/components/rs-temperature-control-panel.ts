import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ClimateMode, HomeAssistant, OverrideType, RoomConfig } from "../types";
import { localize, type TranslationKey } from "../utils/localize";
import {
  formatTemp,
  tempRange,
  tempStep,
  tempUnit,
  toCelsius,
  toDisplay,
} from "../utils/temperature";
import { buildRoomFanCapabilities, type FanSpeedOption } from "../utils/fan-control";
import { roommindThemeStyles } from "../styles/theme-styles";

@customElement("rs-temperature-control-panel")
export class RsTemperatureControlPanel extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config!: RoomConfig | null;
  @property() public climateMode: ClimateMode = "auto";
  @property({ type: Boolean }) public climateControlEnabled = true;
  @property({ type: Boolean }) public climateControlActive = true;
  @property({ type: Number }) public comfortHeat = 21.0;
  @property({ type: Number }) public comfortCool = 24.0;
  @property({ type: Number }) public ecoHeat = 17.0;
  @property({ type: Number }) public ecoCool = 27.0;
  @property({ type: Boolean }) public hasSchedule = false;
  @property() public fanSpeedMode = "auto";
  @property({ type: Boolean }) public nightCapActive = false;
  @property() public language = "en";

  @state() private _targetTempC = 21;
  @state() private _targetDirty = false;
  @state() private _durationHours = 2;
  @state() private _durationTouched = false;
  @state() private _overrideError = "";
  @state() private _optimisticOverride: {
    type: OverrideType;
    temp: number;
    until: number | null;
  } | null = null;
  @state() private _optimisticClear = false;
  @state() private _busy = false;

  static override styles = [
    roommindThemeStyles,
    css`
      :host {
        display: block;
      }

      ha-card {
        overflow: hidden;
        border-radius: var(--roommind-radius-card, 8px);
        border: var(--roommind-border-subtle);
        background: var(--roommind-surface);
        color: var(--primary-text-color);
        box-shadow: var(--roommind-shadow-soft);
      }

      .control-card {
        display: grid;
        gap: 10px;
        padding: 12px 16px;
      }

      .control-card.paused {
        box-shadow: none;
      }

      .control-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-width: 0;
      }

      .title-block {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr);
        gap: 10px;
        align-items: center;
        min-width: 0;
      }

      .title-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border-radius: var(--roommind-radius-control, 8px);
        background: var(--roommind-primary-muted);
        color: var(--primary-color);
      }

      .title-icon ha-icon {
        --mdc-icon-size: 18px;
      }

      .title-copy {
        min-width: 0;
      }

      .panel-title {
        margin: 0;
        color: var(--primary-text-color);
        font-size: 14px;
        font-weight: 650;
        line-height: 1.25;
      }

      .panel-status {
        display: block;
        margin-top: 1px;
        color: var(--secondary-text-color);
        font-size: 12px;
        line-height: 1.35;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      ha-switch {
        flex: 0 0 auto;
      }

      .control-primary-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-width: 0;
      }

      .target-cluster {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .duration-cluster {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        min-width: 0;
      }

      .control-secondary-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-top: 10px;
        border-top: var(--roommind-border-faint);
        min-width: 0;
      }

      .section-label {
        color: var(--secondary-text-color);
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 0.02em;
        line-height: 1.2;
      }

      .target-editor {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .step-button,
      .mode-button,
      .duration-button,
      .preset-button,
      .action-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        min-width: 0;
        border-radius: var(--roommind-radius-control, 8px);
        border: var(--roommind-border-subtle);
        background: var(--roommind-panel-surface);
        color: var(--primary-text-color);
        font: inherit;
        cursor: pointer;
        touch-action: manipulation;
        transition:
          background var(--roommind-motion-duration) ease,
          border-color var(--roommind-motion-duration) ease,
          transform var(--roommind-motion-duration) var(--roommind-motion-easing);
      }

      button:focus-visible,
      .target-input:focus-within {
        outline: 2px solid var(--primary-color);
        outline-offset: 3px;
      }

      button:not(:disabled):active {
        transform: scale(0.97);
      }

      .step-button {
        width: 34px;
        height: 34px;
        padding: 0;
        border-radius: var(--roommind-radius-control, 8px);
        font-size: 18px;
      }

      .step-button ha-icon,
      .action-button ha-icon {
        --mdc-icon-size: 16px;
        flex: 0 0 auto;
      }

      .mode-button ha-icon,
      .preset-button ha-icon {
        --mdc-icon-size: 15px;
        flex: 0 0 auto;
      }

      .target-input {
        display: inline-grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: baseline;
        min-height: 36px;
        box-sizing: border-box;
        border: var(--roommind-border-subtle);
        border-radius: var(--roommind-radius-control, 8px);
        background: var(--roommind-surface);
        padding: 0 8px;
      }

      .target-native {
        width: 58px;
        min-width: 0;
        height: 34px;
        box-sizing: border-box;
        border: none;
        outline: none;
        background: transparent;
        color: var(--primary-text-color);
        font: inherit;
        font-size: 18px;
        font-weight: 600;
        letter-spacing: -0.02em;
        line-height: 1;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }

      .target-native::-webkit-outer-spin-button,
      .target-native::-webkit-inner-spin-button {
        margin: 0;
        appearance: none;
      }

      .target-native:disabled {
        opacity: 0.6;
      }

      .target-unit {
        color: var(--secondary-text-color);
        font-size: 12px;
        font-weight: 650;
      }

      .step-button:hover,
      .mode-button:hover,
      .preset-button:hover,
      .action-button:hover {
        background: var(--roommind-surface-hover);
        border-color: var(--roommind-primary-border);
      }

      button:disabled {
        cursor: default;
        opacity: 0.45;
      }

      button:disabled:hover {
        background: var(--roommind-panel-surface);
        border-color: var(--divider-color);
      }

      .target-actions {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .pending-note {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 18px;
        color: var(--primary-color);
        font-size: 12px;
        font-weight: 650;
        line-height: 1.35;
      }

      .pending-note ha-icon {
        --mdc-icon-size: 15px;
        flex: 0 0 auto;
      }

      .duration-buttons {
        display: inline-flex;
        gap: 4px;
      }

      .action-button {
        min-height: 36px;
        padding: 0 12px;
        font-size: 12.5px;
        font-weight: 650;
      }

      .action-button.primary {
        border-color: var(--roommind-primary-border);
        background: var(--roommind-primary-strong);
        color: var(--primary-color);
      }

      .mode-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      .mode-button,
      .duration-button,
      .preset-button {
        min-height: 34px;
        padding: 0 10px;
        font-size: 12px;
        font-weight: 650;
        white-space: nowrap;
        overflow: hidden;
      }

      .preset-button {
        padding: 0 11px;
      }

      .mode-button[active],
      .duration-button[active],
      .preset-button[active] {
        border-color: var(--roommind-primary-border);
        background: var(--roommind-primary-strong);
        color: var(--primary-color);
      }

      .mode-button[active][data-mode="cool_only"],
      .mode-button[active][data-mode="dry"] {
        border-color: var(--roommind-info-color, #2196f3);
        background: var(--roommind-info-tint, rgba(33, 150, 243, 0.14));
        color: var(--roommind-info-color, #1976d2);
      }

      .mode-button[active][data-mode="heat_only"] {
        border-color: var(--roommind-warning-color, #ff9800);
        background: var(--roommind-warning-tint, rgba(255, 152, 0, 0.14));
        color: var(--roommind-warning-color, #ef6c00);
      }

      .mode-button[active][data-mode="fan_only"] {
        border-color: var(--roommind-success-color, #26a69a);
        background: var(--roommind-success-tint, rgba(38, 166, 154, 0.14));
        color: var(--roommind-success-color, #00796b);
      }

      .mode-button[active][data-mode="off"] {
        border-color: var(--secondary-text-color);
        background: var(--roommind-surface-muted, rgba(0, 0, 0, 0.06));
        color: var(--secondary-text-color);
      }

      .preset-buttons {
        display: inline-flex;
        gap: 6px;
      }

      .preset-button.boost[active] {
        border-color: var(--roommind-warning-border);
        background: var(--roommind-warning-tint);
        color: var(--warning-color, #ff9800);
      }

      .preset-button.eco[active] {
        border-color: var(--roommind-success-border);
        background: var(--roommind-success-tint);
        color: var(--success-color, #4caf50);
      }

      .control-fan-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-top: 10px;
        border-top: var(--roommind-border-faint);
        min-width: 0;
      }

      .fan-row-meta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        min-width: 0;
      }

      .fan-row-meta ha-icon {
        --mdc-icon-size: 16px;
        color: var(--primary-color);
      }

      .fan-meta-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 999px;
      }

      .fan-meta-badge.night {
        background: var(--roommind-warning-tint, rgba(255, 152, 0, 0.14));
        color: var(--warning-color, #ef6c00);
      }

      .fan-meta-badge.dry {
        background: var(--roommind-info-tint, rgba(33, 150, 243, 0.12));
        color: var(--roommind-info-color, #1976d2);
      }

      .fan-speed-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
      }

      .fan-speed-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 32px;
        padding: 0 10px;
        border-radius: var(--roommind-radius-control, 8px);
        border: var(--roommind-border-subtle);
        background: var(--roommind-panel-surface);
        color: var(--primary-text-color);
        font: inherit;
        font-size: 12px;
        font-weight: 650;
        cursor: pointer;
        touch-action: manipulation;
        white-space: nowrap;
        transition:
          background var(--roommind-motion-duration) ease,
          border-color var(--roommind-motion-duration) ease;
      }

      .fan-speed-button:hover {
        background: var(--roommind-surface-hover);
        border-color: var(--roommind-primary-border);
      }

      .fan-speed-button ha-icon {
        --mdc-icon-size: 15px;
      }

      .speed-bars {
        display: inline-flex;
        align-items: flex-end;
        gap: 1.5px;
        height: 12px;
      }

      .speed-bar {
        width: 2.5px;
        border-radius: 1px;
        background: currentColor;
        opacity: 0.22;
      }

      .speed-bar.on {
        opacity: 0.95;
      }

      .fan-speed-button[active][data-tone="auto"] {
        border-color: var(--roommind-primary-border);
        background: var(--roommind-primary-strong);
        color: var(--primary-color);
      }

      .fan-speed-button[active][data-tone="calm"] {
        border-color: var(--roommind-success-color, #26a69a);
        background: var(--roommind-success-tint, rgba(38, 166, 154, 0.14));
        color: var(--roommind-success-color, #00796b);
      }

      .fan-speed-button[active][data-tone="medium"] {
        border-color: var(--roommind-info-color, #2196f3);
        background: var(--roommind-info-tint, rgba(33, 150, 243, 0.14));
        color: var(--roommind-info-color, #1976d2);
      }

      .fan-speed-button[active][data-tone="strong"] {
        border-color: var(--roommind-warning-color, #ff9800);
        background: var(--roommind-warning-tint, rgba(255, 152, 0, 0.14));
        color: var(--roommind-warning-color, #ef6c00);
      }

      .error {
        color: var(--error-color, #d32f2f);
        font-size: 12px;
        line-height: 1.4;
      }

      @media (max-width: 560px) {
        .control-card {
          padding: 12px 14px;
          gap: 10px;
        }

        .control-header {
          align-items: flex-start;
        }

        .panel-status {
          white-space: normal;
        }

        .target-cluster,
        .duration-cluster {
          width: 100%;
          justify-content: space-between;
        }

        .duration-buttons {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .mode-buttons {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .mode-button {
          white-space: normal;
          padding: 0 6px;
        }

        .mode-button ha-icon {
          display: none;
        }

        .preset-buttons {
          width: 100%;
          display: grid;
          grid-template-columns: 1fr 1fr;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        button:not(:disabled):active {
          transform: none;
        }
      }
    `,
  ];

  override updated(changedProps: Map<string, unknown>): void {
    if (changedProps.has("config") && this.config?.live) {
      const live = this.config.live;
      if (this._optimisticOverride && live.override_active) {
        this._optimisticOverride = null;
        this._targetDirty = false;
      }
      if (this._optimisticClear && !live.override_active) {
        this._optimisticClear = false;
        this._targetDirty = false;
      }
    }
  }

  public getEffectiveOverride(): {
    active: boolean;
    type: OverrideType | null;
    temp: number | null;
    until: number | null;
  } {
    if (this._optimisticClear) {
      return { active: false, type: null, temp: null, until: null };
    }
    if (this._optimisticOverride) {
      return {
        active: true,
        type: this._optimisticOverride.type,
        temp: this._optimisticOverride.temp,
        until: this._optimisticOverride.until,
      };
    }
    const live = this.config?.live;
    if (live?.override_active && live.override_type) {
      return {
        active: true,
        type: live.override_type,
        temp: live.override_temp,
        until: live.override_until,
      };
    }
    return { active: false, type: null, temp: null, until: null };
  }

  override render() {
    const ov = this.getEffectiveOverride();
    const targetC = this._targetC(ov);
    const disabled = !this.config || !this.climateControlEnabled || this._busy;
    const isNonTempMode = ["off", "fan_only", "dry"].includes(this.climateMode);
    const tempDisabled = disabled || isNonTempMode;
    const fanCaps = buildRoomFanCapabilities(this.config, this.hass);
    const fanDisabled =
      !this.config || !this.climateControlEnabled || this.climateMode === "off" || this._busy;
    const comfortIcon =
      this.climateMode === "cool_only"
        ? "mdi:snowflake"
        : this.climateMode === "heat_only"
          ? "mdi:fire"
          : "mdi:thermometer";

    return html`
      <ha-card>
        <div class="control-card ${this.climateControlEnabled ? "" : "paused"}">
          <div class="control-header">
            <div class="title-block">
              <span class="title-icon"><ha-icon icon="mdi:thermostat"></ha-icon></span>
              <span class="title-copy">
                <h3 class="panel-title">
                  ${localize("room.climate_control_toggle", this.language)}
                </h3>
                <span class="panel-status">${this._statusText(ov)}</span>
              </span>
            </div>
            <ha-switch
              .checked=${this.climateControlEnabled}
              ?disabled=${!this.config || this._busy}
              @change=${this._onControlToggle}
            ></ha-switch>
          </div>

          <div class="control-primary-row">
            <div class="target-cluster">
              <div class="target-editor">
                <button
                  class="step-button"
                  type="button"
                  title=${localize("common.decrease", this.language)}
                  aria-label=${localize("common.decrease", this.language)}
                  ?disabled=${tempDisabled}
                  @click=${() => this._nudgeTarget(-1)}
                >
                  <span aria-hidden="true">−</span>
                </button>
                <label class="target-input">
                  <input
                    class="target-native"
                    type="number"
                    aria-label=${localize("room.temperature_panel.target", this.language)}
                    min=${tempRange(5, 35, this.hass).min}
                    max=${tempRange(5, 35, this.hass).max}
                    step=${tempStep(this.hass)}
                    .value=${this._targetDisplayValue(targetC)}
                    ?disabled=${tempDisabled}
                    @input=${this._onTargetInput}
                    @keydown=${this._onTargetKeyDown}
                  />
                  <span class="target-unit">${tempUnit(this.hass)}</span>
                </label>
                <button
                  class="step-button"
                  type="button"
                  title=${localize("common.increase", this.language)}
                  aria-label=${localize("common.increase", this.language)}
                  ?disabled=${tempDisabled}
                  @click=${() => this._nudgeTarget(1)}
                >
                  <span aria-hidden="true">+</span>
                </button>
              </div>
              <div class="target-actions">
                <button
                  class="action-button primary"
                  type="button"
                  ?disabled=${tempDisabled}
                  @click=${this._onApplyTarget}
                >
                  <ha-icon icon="mdi:check"></ha-icon>
                  ${this._applyLabel(targetC)}
                </button>
                ${
                  ov.active
                    ? html`
                        <button
                          class="action-button"
                          type="button"
                          ?disabled=${!this.config || this._busy}
                          @click=${this._onClearOverride}
                        >
                          <ha-icon icon="mdi:autorenew"></ha-icon>
                          ${localize(
                            this.hasSchedule
                              ? "room.temperature_panel.restore"
                              : "room.temperature_panel.revert_target",
                            this.language,
                          )}
                        </button>
                      `
                    : nothing
                }
              </div>
            </div>

            <div class="duration-cluster">
              <span class="section-label"
                >${localize("room.temperature_panel.hold", this.language)}</span
              >
              <div class="duration-buttons">
                ${this._renderDurationButton(1, "room.temperature_panel.hold_1h", tempDisabled)}
                ${this._renderDurationButton(2, "room.temperature_panel.hold_2h", tempDisabled)}
                ${this._renderDurationButton(4, "room.temperature_panel.hold_4h", tempDisabled)}
                ${this._renderDurationButton(
                  0,
                  this.hasSchedule
                    ? "room.temperature_panel.hold_permanent"
                    : "room.temperature_panel.direct_label",
                  tempDisabled,
                )}
              </div>
            </div>
          </div>

          ${
            this._targetDirty
              ? html`
                  <div class="pending-note">
                    <ha-icon icon="mdi:alert-circle-outline"></ha-icon>
                    ${localize("room.temperature_panel.pending_hint", this.language)}
                  </div>
                `
              : nothing
          }
          ${this._overrideError ? html`<div class="error">${this._overrideError}</div>` : nothing}

          <div class="control-secondary-row">
            <div class="mode-buttons">
              ${this._renderModeButton("off", "mode.off", "mdi:power")}
              ${this._renderModeButton("cool_only", "mode.cool_only", "mdi:snowflake")}
              ${this._renderModeButton("heat_only", "mode.heat_only", "mdi:fire")}
              ${this._renderModeButton("dry", "mode.dry", "mdi:water-percent")}
              ${this._renderModeButton("fan_only", "mode.fan_only", "mdi:fan")}
              ${this._renderModeButton("auto", "mode.auto", "mdi:autorenew")}
            </div>
            <div class="preset-buttons">
              ${this._renderPresetButton("boost", "override.comfort", comfortIcon, tempDisabled)}
              ${this._renderPresetButton("eco", "override.eco", "mdi:leaf", tempDisabled)}
            </div>
          </div>

          ${
            fanCaps.hasFanControl
              ? html`
                  <div class="control-fan-row">
                    <div class="fan-row-meta">
                      <ha-icon icon="mdi:fan"></ha-icon>
                      <span class="section-label">${localize("fan.label", this.language)}</span>
                      ${
                        this.nightCapActive
                          ? html`<span class="fan-meta-badge night"
                              >${localize("fan.night_capped", this.language)}</span
                            >`
                          : nothing
                      }
                      ${
                        this.climateMode === "dry"
                          ? html`<span class="fan-meta-badge dry"
                              >${localize("fan.dry_hint", this.language)}</span
                            >`
                          : nothing
                      }
                    </div>
                    <div class="fan-speed-buttons">
                      ${fanCaps.roomOptions.map((opt) =>
                        this._renderFanSpeedButton(opt, fanDisabled),
                      )}
                    </div>
                  </div>
                `
              : nothing
          }
        </div>
      </ha-card>
    `;
  }

  private _effectiveDurationHours(): number {
    return this._durationTouched ? this._durationHours : this.hasSchedule ? this._durationHours : 0;
  }

  private _renderDurationButton(hours: number, labelKey: TranslationKey, disabled: boolean) {
    const active = this._effectiveDurationHours() === hours;
    return html`
      <button
        class="duration-button"
        type="button"
        ?active=${active}
        aria-pressed=${active}
        ?disabled=${disabled}
        @click=${() => {
          this._durationTouched = true;
          this._durationHours = hours;
        }}
      >
        ${localize(labelKey, this.language)}
      </button>
    `;
  }

  private _renderModeButton(mode: ClimateMode, labelKey: TranslationKey, icon: string) {
    const disabled = !this.config || this._busy;
    return html`
      <button
        class="mode-button"
        type="button"
        data-mode=${mode}
        ?active=${this.climateMode === mode}
        aria-pressed=${this.climateMode === mode}
        ?disabled=${disabled}
        @click=${() => this._onModeClick(mode)}
      >
        <ha-icon icon=${icon}></ha-icon>
        ${localize(labelKey, this.language)}
      </button>
    `;
  }

  private _renderPresetButton(
    type: Extract<OverrideType, "boost" | "eco">,
    labelKey: TranslationKey,
    icon: string,
    disabled: boolean,
  ) {
    const ov = this.getEffectiveOverride();
    return html`
      <button
        class="preset-button ${type}"
        type="button"
        ?active=${ov.active && ov.type === type}
        aria-pressed=${ov.active && ov.type === type}
        ?disabled=${disabled}
        @click=${() => this._onPreset(type)}
      >
        <ha-icon icon=${icon}></ha-icon>
        ${localize(labelKey, this.language)}
      </button>
    `;
  }

  private _renderFanSpeedButton(opt: FanSpeedOption, disabled: boolean) {
    const active = (this.fanSpeedMode || "auto").toLowerCase() === opt.value.toLowerCase();
    const heights = [4, 6, 8, 10, 12];
    return html`
      <button
        class="fan-speed-button"
        type="button"
        data-tone=${opt.tone}
        ?active=${active}
        aria-pressed=${active}
        ?disabled=${disabled}
        @click=${() => this._onFanSpeedClick(opt.value)}
      >
        ${
          opt.isAuto
            ? html`<ha-icon icon="mdi:fan-auto"></ha-icon>`
            : html`
                <span class="speed-bars" aria-hidden="true">
                  ${heights.map(
                    (h, idx) =>
                      html`<span
                        class="speed-bar ${idx < opt.bars ? "on" : ""}"
                        style="height:${h}px"
                      ></span>`,
                  )}
                </span>
              `
        }
        <span>${opt.label}</span>
      </button>
    `;
  }

  private _onFanSpeedClick(value: string): void {
    this.dispatchEvent(
      new CustomEvent("fan-speed-changed", {
        detail: { fanSpeedMode: value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _statusText(ov: ReturnType<typeof this.getEffectiveOverride>): string {
    if (!this.climateControlEnabled) {
      return localize("room.temperature_panel.status_off", this.language);
    }
    if (this._targetDirty) {
      return localize("room.temperature_panel.pending_status", this.language, {
        target: this._formatTemp(this._targetC(ov)),
        duration: this._durationLabel(),
      });
    }
    if (ov.active) {
      const label =
        ov.type === "boost"
          ? localize("override.comfort", this.language)
          : ov.type === "eco"
            ? localize("override.eco", this.language)
            : localize("override.custom", this.language);
      const temp = ov.temp != null ? ` · ${this._formatTemp(ov.temp)}` : "";
      return `${label}${temp} · ${this._overrideDurationText(ov.until)}`;
    }
    if (
      this.climateMode === "off" ||
      this.climateMode === "dry" ||
      this.climateMode === "fan_only"
    ) {
      return localize(
        this.climateMode === "dry"
          ? "mode.dry_desc"
          : this.climateMode === "fan_only"
            ? "mode.fan_only_desc"
            : "mode.off_desc",
        this.language,
      );
    }
    return this.climateControlActive
      ? localize("room.temperature_panel.status_on", this.language)
      : localize("room.temperature_panel.status_waiting", this.language);
  }

  private _targetC(ov = this.getEffectiveOverride()): number {
    if (this._targetDirty) return this._targetTempC;
    if (ov.active && ov.temp != null) return ov.temp;

    const live = this.config?.live;
    if (this.climateMode === "cool_only") {
      return live?.cool_target ?? live?.target_temp ?? this.comfortCool;
    }
    if (this.climateMode === "heat_only") {
      return live?.heat_target ?? live?.target_temp ?? this.comfortHeat;
    }
    return live?.target_temp ?? live?.heat_target ?? this.comfortHeat;
  }

  private _overrideDurationText(until: number | null): string {
    if (!until) return localize("hero.permanent", this.language);
    const remaining = Math.max(0, until - Date.now() / 1000);
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.ceil((remaining % 3600) / 60);
    const time =
      hours > 0 ? `${hours}h ${String(minutes).padStart(2, "0")}m` : `${Math.max(1, minutes)}m`;
    return localize("hero.remaining", this.language, { time });
  }

  private _durationLabel(): string {
    switch (this._effectiveDurationHours()) {
      case 1:
        return localize("room.temperature_panel.hold_1h", this.language);
      case 2:
        return localize("room.temperature_panel.hold_2h", this.language);
      case 4:
        return localize("room.temperature_panel.hold_4h", this.language);
      default:
        return localize(
          this.hasSchedule
            ? "room.temperature_panel.hold_permanent"
            : "room.temperature_panel.direct_label",
          this.language,
        );
    }
  }

  private _applyLabel(targetC: number): string {
    if (!this.hasSchedule && this._effectiveDurationHours() === 0) {
      return localize("room.temperature_panel.set_target", this.language, {
        target: this._formatTemp(targetC),
      });
    }
    return localize("room.temperature_panel.apply_value", this.language, {
      target: this._formatTemp(targetC),
      duration: this._durationLabel(),
    });
  }

  private _formatTemp(value: number | null | undefined): string {
    return value == null
      ? localize("room.status.not_set", this.language)
      : `${formatTemp(value, this.hass)}${tempUnit(this.hass)}`;
  }

  private _targetDisplayValue(value: number): string {
    const decimals = tempStep(this.hass).includes(".") ? 1 : 0;
    return toDisplay(value, this.hass).toFixed(decimals);
  }

  private _onControlToggle = (e: Event): void => {
    this.dispatchEvent(
      new CustomEvent("climate-control-toggle", {
        detail: (e.target as HTMLInputElement).checked,
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onModeClick(mode: ClimateMode): void {
    if (mode === this.climateMode) return;
    this.dispatchEvent(
      new CustomEvent("mode-changed", {
        detail: { mode },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _nudgeTarget(direction: -1 | 1): void {
    const displayStep = Number(tempStep(this.hass));
    const display = toDisplay(this._targetC(), this.hass) + direction * displayStep;
    this._setTargetDisplay(display);
  }

  private _onTargetInput = (e: Event): void => {
    const raw = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(raw)) return;
    this._setTargetDisplay(raw);
  };

  private _onTargetKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void this._onApplyTarget();
  };

  private _setTargetDisplay(displayValue: number): void {
    const range = tempRange(5, 35, this.hass);
    const min = Number(range.min);
    const max = Number(range.max);
    const clamped = Math.min(max, Math.max(min, displayValue));
    this._targetTempC = toCelsius(clamped, this.hass);
    this._targetDirty = true;
    this._overrideError = "";
  }

  private _onApplyTarget = async (): Promise<void> => {
    const durationHours = this._effectiveDurationHours();
    const targetC = this._targetC();
    if (!this.hasSchedule && durationHours === 0) {
      this.dispatchEvent(
        new CustomEvent("baseline-target-changed", {
          detail: { temperature: targetC },
          bubbles: true,
          composed: true,
        }),
      );
      this._targetDirty = false;
      if (this.getEffectiveOverride().active) {
        await this._onClearOverride();
      }
      return;
    }
    await this._setOverride("custom", targetC, durationHours);
  };

  private _onPreset = async (type: Extract<OverrideType, "boost" | "eco">): Promise<void> => {
    const temp =
      type === "boost"
        ? this.climateMode === "cool_only"
          ? this.comfortCool
          : this.comfortHeat
        : this.climateMode === "cool_only"
          ? this.ecoCool
          : this.ecoHeat;
    this._targetTempC = temp;
    this._targetDirty = false;
    await this._setOverride(type, temp, this._effectiveDurationHours());
  };

  private async _setOverride(
    type: OverrideType,
    temp: number,
    durationHours: number,
  ): Promise<void> {
    if (!this.config) return;
    this._busy = true;
    this._overrideError = "";
    this._optimisticOverride = {
      type,
      temp,
      until: durationHours > 0 ? Date.now() / 1000 + durationHours * 3600 : null,
    };
    this._optimisticClear = false;

    const msg: Record<string, unknown> = {
      type: "roommind/override/set",
      area_id: this.config.area_id,
      override_type: type,
    };
    if (durationHours > 0) {
      msg.duration = durationHours;
    }
    if (type === "custom") {
      msg.temperature = temp;
    }

    try {
      await this.hass.callWS(msg);
      this._targetDirty = false;
      this._fireRoomUpdated();
    } catch (err) {
      this._optimisticOverride = null;
      this._overrideError =
        err instanceof Error ? err.message : localize("override.error_set", this.language);
      // eslint-disable-next-line no-console
      console.error("Override set failed:", err);
    } finally {
      this._busy = false;
    }
  }

  private _onClearOverride = async (): Promise<void> => {
    if (!this.config) return;
    this._busy = true;
    this._optimisticClear = true;
    this._optimisticOverride = null;
    this._overrideError = "";

    try {
      await this.hass.callWS({
        type: "roommind/override/clear",
        area_id: this.config.area_id,
      });
      this._targetDirty = false;
      this._fireRoomUpdated();
    } catch (err) {
      this._optimisticClear = false;
      this._overrideError =
        err instanceof Error ? err.message : localize("override.error_clear", this.language);
      // eslint-disable-next-line no-console
      console.error("Override clear failed:", err);
    } finally {
      this._busy = false;
    }
  };

  private _fireRoomUpdated(): void {
    this.dispatchEvent(new CustomEvent("room-updated", { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-temperature-control-panel": RsTemperatureControlPanel;
  }
}
