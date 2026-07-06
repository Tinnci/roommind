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
  @property() public language = "en";

  @state() private _targetTempC = 21;
  @state() private _targetDirty = false;
  @state() private _durationHours = 2;
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
        background: var(--roommind-panel-surface);
        color: var(--primary-text-color);
        box-shadow: var(--roommind-shadow-soft);
      }

      .control-card {
        display: grid;
        gap: 16px;
        padding: 16px;
      }

      .control-card.paused {
        box-shadow: none;
      }

      .control-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-width: 0;
      }

      .title-block {
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr);
        gap: 10px;
        align-items: center;
        min-width: 0;
      }

      .title-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: var(--roommind-radius-control, 8px);
        background: var(--roommind-primary-muted);
        color: var(--primary-color);
      }

      .title-icon ha-icon {
        --mdc-icon-size: 20px;
      }

      .title-copy {
        min-width: 0;
      }

      .panel-title {
        margin: 0;
        color: var(--primary-text-color);
        font-size: 16px;
        font-weight: 650;
        line-height: 1.25;
      }

      .panel-status {
        display: block;
        margin-top: 3px;
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

      .control-grid {
        display: grid;
        grid-template-columns: minmax(260px, 1.35fr) minmax(280px, 1fr);
        gap: 14px;
        align-items: stretch;
      }

      .target-zone,
      .side-zone {
        min-width: 0;
        border: var(--roommind-border-subtle);
        border-radius: var(--roommind-radius-control, 8px);
        background: var(--roommind-surface);
      }

      .target-zone {
        display: grid;
        gap: 14px;
        padding: 14px;
      }

      .side-zone {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 12px;
      }

      .section-label {
        color: var(--secondary-text-color);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0;
        line-height: 1.2;
        text-transform: uppercase;
      }

      .target-editor {
        display: grid;
        grid-template-columns: 42px minmax(140px, 1fr) 42px;
        gap: 8px;
        align-items: center;
      }

      .step-button,
      .mode-button,
      .duration-button,
      .preset-button,
      .action-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-width: 0;
        border-radius: var(--roommind-radius-control, 8px);
        border: var(--roommind-border-subtle);
        background: var(--roommind-panel-surface);
        color: var(--primary-text-color);
        font: inherit;
        cursor: pointer;
        transition:
          background 0.15s ease,
          border-color 0.15s ease,
          color 0.15s ease,
          opacity 0.15s ease;
      }

      .step-button {
        width: 42px;
        height: 42px;
        padding: 0;
      }

      .step-button ha-icon,
      .mode-button ha-icon,
      .preset-button ha-icon,
      .action-button ha-icon {
        --mdc-icon-size: 18px;
        flex: 0 0 auto;
      }

      .target-input {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: baseline;
        width: 100%;
        min-height: 42px;
        box-sizing: border-box;
        border: var(--roommind-border-subtle);
        border-radius: var(--roommind-radius-control, 8px);
        background: var(--roommind-surface);
        padding: 0 12px;
      }

      .target-native {
        width: 100%;
        min-width: 0;
        height: 42px;
        box-sizing: border-box;
        border: none;
        outline: none;
        background: transparent;
        color: var(--primary-text-color);
        font: inherit;
        font-size: 28px;
        font-weight: 650;
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
        font-size: 14px;
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
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
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

      .duration-row {
        display: grid;
        gap: 8px;
      }

      .duration-buttons {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
      }

      .action-button {
        min-height: 38px;
        padding: 0 12px;
        font-size: 13px;
        font-weight: 650;
      }

      .action-button.primary {
        border-color: var(--roommind-primary-border);
        background: var(--roommind-primary-strong);
        color: var(--primary-color);
      }

      .insight-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .insight {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr);
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding: 9px 10px;
        border-radius: var(--roommind-radius-control, 8px);
        background: var(--roommind-surface);
        border: var(--roommind-border-faint);
      }

      .insight.warning {
        border-color: var(--roommind-warning-border);
        background: var(--roommind-warning-tint);
      }

      .insight.critical {
        border-color: var(--roommind-error-border);
        background: var(--roommind-error-tint);
      }

      .insight-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: var(--roommind-radius-small, 4px);
        background: var(--roommind-primary-subtle);
        color: var(--secondary-text-color);
      }

      .insight.warning .insight-icon {
        background: var(--roommind-warning-tint);
        color: var(--warning-color, #ff9800);
      }

      .insight.critical .insight-icon {
        background: var(--roommind-error-tint);
        color: var(--error-color, #f44336);
      }

      .insight-icon ha-icon {
        --mdc-icon-size: 17px;
      }

      .insight-label {
        display: block;
        color: var(--secondary-text-color);
        font-size: 11px;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .insight-value {
        display: block;
        margin-top: 3px;
        color: var(--primary-text-color);
        font-size: 14px;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
        line-height: 1.25;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .mode-row,
      .preset-row {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .mode-buttons {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
      }

      .mode-button,
      .duration-button,
      .preset-button {
        min-height: 38px;
        padding: 0 9px;
        font-size: 12.5px;
        font-weight: 650;
        white-space: nowrap;
        overflow: hidden;
      }

      .mode-button[active],
      .duration-button[active],
      .preset-button[active] {
        border-color: var(--roommind-primary-border);
        background: var(--roommind-primary-strong);
        color: var(--primary-color);
      }

      .preset-buttons {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
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

      .error {
        color: var(--error-color, #d32f2f);
        font-size: 12px;
        line-height: 1.4;
      }

      @media (max-width: 900px) {
        .control-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 520px) {
        .control-card {
          padding: 12px;
          gap: 12px;
        }

        .control-header {
          align-items: flex-start;
        }

        .panel-status {
          white-space: normal;
        }

        .target-editor {
          grid-template-columns: 40px minmax(0, 1fr) 40px;
        }

        .target-native {
          font-size: 24px;
        }

        .insight-grid,
        .mode-buttons {
          grid-template-columns: 1fr;
        }

        .duration-buttons {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .preset-buttons {
          grid-template-columns: 1fr 1fr;
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

          <div class="control-grid">
            <section class="target-zone">
              <span class="section-label"
                >${localize("room.temperature_panel.target", this.language)}</span
              >
              <div class="target-editor">
                <button
                  class="step-button"
                  type="button"
                  title=${localize("common.decrease", this.language)}
                  aria-label=${localize("common.decrease", this.language)}
                  ?disabled=${disabled}
                  @click=${() => this._nudgeTarget(-1)}
                >
                  <ha-icon icon="mdi:minus"></ha-icon>
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
                    ?disabled=${disabled}
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
                  ?disabled=${disabled}
                  @click=${() => this._nudgeTarget(1)}
                >
                  <ha-icon icon="mdi:plus"></ha-icon>
                </button>
              </div>
              <div class="target-actions">
                <button
                  class="action-button primary"
                  type="button"
                  ?disabled=${disabled}
                  @click=${this._onApplyTarget}
                >
                  <ha-icon icon="mdi:check"></ha-icon>
                  ${this._applyLabel(targetC)}
                </button>
                ${ov.active
                  ? html`
                      <button
                        class="action-button"
                        type="button"
                        ?disabled=${!this.config || this._busy}
                        @click=${this._onClearOverride}
                      >
                        <ha-icon icon="mdi:autorenew"></ha-icon>
                        ${localize("room.temperature_panel.restore", this.language)}
                      </button>
                    `
                  : nothing}
              </div>
              ${this._targetDirty
                ? html`
                    <div class="pending-note">
                      <ha-icon icon="mdi:alert-circle-outline"></ha-icon>
                      ${localize("room.temperature_panel.pending_hint", this.language)}
                    </div>
                  `
                : nothing}
              ${this._overrideError
                ? html`<div class="error">${this._overrideError}</div>`
                : nothing}
              <div class="duration-row">
                <span class="section-label"
                  >${localize("room.temperature_panel.hold", this.language)}</span
                >
                <div class="duration-buttons">
                  ${this._renderDurationButton(1, "room.temperature_panel.hold_1h", disabled)}
                  ${this._renderDurationButton(2, "room.temperature_panel.hold_2h", disabled)}
                  ${this._renderDurationButton(4, "room.temperature_panel.hold_4h", disabled)}
                  ${this._renderDurationButton(
                    0,
                    "room.temperature_panel.hold_permanent",
                    disabled,
                  )}
                </div>
              </div>
            </section>

            <section class="side-zone">
              <span class="section-label"
                >${localize("room.temperature_panel.dynamics", this.language)}</span
              >
              <div class="insight-grid">
                ${this._renderInsight(
                  "room.temperature_panel.current",
                  this._formatTemp(this._currentTemp()),
                  "mdi:thermometer",
                )}
                ${this._renderInsight(
                  "room.temperature_panel.humidity",
                  this._humidityValue(),
                  "mdi:water-percent",
                  this._humidityTone(),
                )}
                ${this._renderInsight(
                  "room.temperature_panel.model",
                  this._modelValue(),
                  "mdi:brain",
                )}
                ${this._renderInsight(
                  "room.temperature_panel.airflow",
                  this._airflowValue(),
                  "mdi:fan",
                )}
              </div>

              <div class="mode-row">
                <span class="section-label"
                  >${localize("room.temperature_panel.mode", this.language)}</span
                >
                <div class="mode-buttons">
                  ${this._renderModeButton("auto", "mode.auto", "mdi:autorenew")}
                  ${this._renderModeButton("heat_only", "mode.heat_only", "mdi:fire")}
                  ${this._renderModeButton("cool_only", "mode.cool_only", "mdi:snowflake")}
                </div>
              </div>

              <div class="preset-row">
                <span class="section-label"
                  >${localize("room.temperature_panel.shortcuts", this.language)}</span
                >
                <div class="preset-buttons">
                  ${this._renderPresetButton("boost", "override.comfort", "mdi:fire", disabled)}
                  ${this._renderPresetButton("eco", "override.eco", "mdi:leaf", disabled)}
                </div>
              </div>
            </section>
          </div>
        </div>
      </ha-card>
    `;
  }

  private _renderInsight(labelKey: TranslationKey, value: string, icon: string, tone = "") {
    return html`
      <span class="insight ${tone}">
        <span class="insight-icon"><ha-icon icon=${icon}></ha-icon></span>
        <span class="insight-copy">
          <span class="insight-label">${localize(labelKey, this.language)}</span>
          <span class="insight-value" title=${value}>${value}</span>
        </span>
      </span>
    `;
  }

  private _renderDurationButton(hours: number, labelKey: TranslationKey, disabled: boolean) {
    return html`
      <button
        class="duration-button"
        type="button"
        ?active=${this._durationHours === hours}
        ?disabled=${disabled}
        @click=${() => {
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
        ?active=${this.climateMode === mode}
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
        ?disabled=${disabled}
        @click=${() => this._onPreset(type)}
      >
        <ha-icon icon=${icon}></ha-icon>
        ${localize(labelKey, this.language)}
      </button>
    `;
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

  private _currentTemp(): number | null {
    const live = this.config?.live;
    if (!live) return null;
    if (live.effective_control_target === "perceived_temperature" && live.perceived_temp != null) {
      return live.perceived_temp;
    }
    return live.current_temp;
  }

  private _humidityValue(): string {
    const humidity = this.config?.live?.current_humidity;
    return humidity == null
      ? localize("room.status.not_set", this.language)
      : `${Math.round(humidity)}%`;
  }

  private _humidityTone(): string {
    const risk = this.config?.live?.mold_risk_level;
    if (risk === "critical") return "critical";
    if (risk === "warning" || this.config?.live?.mold_prevention_active) return "warning";
    return "";
  }

  private _modelValue(): string {
    const live = this.config?.live;
    const label = live?.mpc_active
      ? localize("card.mpc_active", this.language)
      : localize("card.mpc_learning", this.language);
    if (live?.confidence == null) return label;
    return `${label} · ${Math.round(live.confidence * 100)}%`;
  }

  private _airflowValue(): string {
    const live = this.config?.live;
    if (!live || (!live.airflow_active && !live.airflow_ach)) {
      return localize("room.temperature_panel.airflow_idle", this.language);
    }
    const ach = `${live.airflow_ach?.toFixed(1) ?? "0.0"} ${localize("airflow.ach", this.language)}`;
    const plan = Math.round((live.airflow_plan_level ?? 0) * 100);
    return plan > 0 ? `${ach} · ${plan}%` : ach;
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
    switch (this._durationHours) {
      case 1:
        return localize("room.temperature_panel.hold_1h", this.language);
      case 2:
        return localize("room.temperature_panel.hold_2h", this.language);
      case 4:
        return localize("room.temperature_panel.hold_4h", this.language);
      default:
        return localize("room.temperature_panel.hold_permanent", this.language);
    }
  }

  private _applyLabel(targetC: number): string {
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
    await this._setOverride("custom", this._targetC(), this._durationHours);
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
    await this._setOverride(type, temp, this._durationHours);
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
