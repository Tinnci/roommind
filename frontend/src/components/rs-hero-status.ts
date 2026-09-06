import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, HassArea, RoomConfig, OverrideType } from "../types";
import { getModeClass, formatMode } from "../utils/room-state";
import { modeStyles } from "../styles/shared-mode-styles";
import { localize } from "../utils/localize";
import { formatTemp, tempUnit, toDisplayDelta } from "../utils/temperature";
import { selectHeroMetricIds, type HeroMetricId } from "../utils/hero-metrics";
import "./shared/rs-info-icon";

const PENCIL_PATH =
  "M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z";
const CHECK_PATH = "M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z";

@customElement("rs-hero-status")
export class RsHeroStatus extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public area!: HassArea;
  @property({ attribute: false }) public config: RoomConfig | null = null;
  @property({ type: Boolean }) public climateControlActive = true;
  @property({ type: Boolean }) public isOutdoor = false;
  /** Optimistic override state passed from parent for instant feedback. */
  @property({ attribute: false }) public overrideInfo: {
    active: boolean;
    type: OverrideType | null;
    temp: number | null;
    until: number | null;
  } | null = null;
  @state() private _countdown = "";
  @state() private _editingName = false;
  @state() private _nameInput = "";
  @state() private _controlModeInfoExpanded = false;
  private _countdownTimer: ReturnType<typeof setInterval> | undefined;

  static override styles = [
    modeStyles,
    css`
      :host {
        display: block;
        --roommind-hero-tile: color-mix(
          in srgb,
          var(--roommind-surface, var(--card-background-color, #ffffff)) 96%,
          var(--primary-text-color, #000000)
        );
      }

      ha-card {
        padding: 22px 24px 20px;
        position: relative;
        overflow: hidden;
        border-radius: 8px;
        border: var(--roommind-border-subtle);
        box-shadow: none;
        background: var(--roommind-surface);
      }

      .hero-accent {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
      }

      .hero-accent-heating {
        background: linear-gradient(90deg, var(--warning-color, #ff9800), #ffb74d);
      }

      .hero-accent-cooling {
        background: linear-gradient(
          90deg,
          var(--roommind-info-color),
          color-mix(in srgb, var(--roommind-info-color) 62%, white)
        );
      }

      .hero-accent-idle {
        background: linear-gradient(90deg, var(--disabled-text-color, #bdbdbd), #e0e0e0);
      }

      .hero-accent-none {
        background: var(--divider-color, #e0e0e0);
      }

      .hero-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
      }

      .area-name {
        font-size: 22px;
        font-weight: 600;
        color: var(--primary-text-color);
        margin: 0;
        line-height: 1.2;
      }

      .hero-temps {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(170px, 0.42fr);
        gap: 16px;
        align-items: stretch;
        min-width: 0;
      }

      .hero-current-wrap {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
      }

      .hero-current {
        font-size: 54px;
        font-weight: 300;
        color: var(--primary-text-color);
        line-height: 1;
      }

      .hero-unit {
        font-size: 24px;
        font-weight: 300;
        color: var(--secondary-text-color);
      }

      .hero-target {
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-width: 0;
        padding: 12px 14px;
        border-radius: 8px;
        border: var(--roommind-border-faint);
        background: var(--roommind-hero-tile);
        text-align: left;
        box-sizing: border-box;
      }

      .hero-target-label {
        font-size: 12px;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        letter-spacing: 0;
      }

      .hero-target-value {
        font-size: 24px;
        font-weight: 650;
        color: var(--primary-text-color);
        line-height: 1.15;
      }

      /* Override-aware target styling */
      .hero-target-label.override-boost {
        color: var(--warning-color, #ff9800);
      }

      .hero-target-label.override-eco {
        color: var(--success-color, #4caf50);
      }

      .hero-target-label.override-custom {
        color: var(--roommind-info-color);
      }

      .hero-target-label ha-icon {
        --mdc-icon-size: 12px;
        vertical-align: middle;
      }

      .hero-target-countdown {
        font-size: 11px;
        color: var(--secondary-text-color);
        margin-top: 2px;
      }

      .hero-metric {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 28px;
        padding: 4px 9px;
        border-radius: 8px;
        font-size: 13px;
        line-height: 1.25;
        color: var(--secondary-text-color);
        background: var(--roommind-surface-muted);
        border: var(--roommind-border-faint);
        box-sizing: border-box;
      }

      .hero-metric ha-icon {
        --mdc-icon-size: 16px;
        flex-shrink: 0;
      }

      .hero-metric.warning {
        color: var(--warning-color, #ff9800);
        background: var(--roommind-warning-tint);
        border-color: var(--roommind-warning-border);
      }

      .hero-metric.critical {
        color: var(--error-color, #db4437);
        background: var(--roommind-error-tint);
        border-color: var(--roommind-error-border);
      }

      .hero-metric.info {
        color: var(--roommind-info-color);
        background: var(--roommind-info-tint);
        border-color: var(--roommind-info-border);
      }

      .hero-metrics {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 14px;
      }

      .hero-metrics:empty {
        display: none;
      }

      .hero-no-data {
        font-size: 14px;
        color: var(--disabled-text-color, #9e9e9e);
        font-style: italic;
        padding: 8px 0;
      }

      .hero-window-open {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        margin-bottom: 12px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 500;
        color: var(--warning-color, #ff9800);
        background: var(--roommind-warning-tint);
      }

      .hero-window-open ha-icon {
        --mdc-icon-size: 18px;
      }

      .name-row {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .name-edit-btn {
        --mdc-icon-button-size: 28px;
        --mdc-icon-size: 16px;
        color: var(--secondary-text-color);
        opacity: 0;
        transition: opacity 0.15s;
      }

      .name-row:hover .name-edit-btn {
        opacity: 1;
      }

      @media (hover: none) {
        .name-edit-btn {
          opacity: 0.5;
        }
      }

      .name-edit-row {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .name-input {
        font-size: 22px;
        font-weight: 400;
        color: var(--primary-text-color);
        background: transparent;
        border: none;
        border-bottom: 2px solid var(--primary-color);
        outline: none;
        padding: 0 0 2px;
        width: 100%;
        font-family: inherit;
      }

      .name-done-btn {
        --mdc-icon-button-size: 28px;
        --mdc-icon-size: 16px;
        color: var(--primary-color);
      }

      .name-clear-btn {
        background: none;
        border: none;
        color: var(--secondary-text-color);
        font-size: 12px;
        cursor: pointer;
        padding: 2px 0;
        text-decoration: underline;
      }

      .hero-status-pills {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        flex-shrink: 0;
      }

      @media (max-width: 620px) {
        ha-card {
          padding: 20px 16px;
        }

        .hero-header {
          align-items: flex-start;
          flex-direction: column;
          gap: 10px;
        }

        .hero-status-pills {
          align-items: flex-start;
        }

        .hero-temps {
          grid-template-columns: 1fr;
          gap: 12px;
        }

        .hero-target {
          width: 100%;
        }
      }
      .control-mode-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--secondary-text-color);
        cursor: pointer;
      }
      .control-mode-info-icon {
        --mdc-icon-size: 14px;
        opacity: 0.4;
      }
      .control-mode-badge:hover .control-mode-info-icon,
      .control-mode-info-icon.active {
        opacity: 0.8;
      }
      .control-mode-info-panel {
        padding: 8px 12px;
        margin-bottom: 8px;
        font-size: 12px;
        line-height: 1.5;
        color: var(--secondary-text-color);
        background: var(--roommind-surface-muted);
        border-radius: 8px;
      }

      .learning-paused rs-info-icon {
        margin-left: 2px;
      }

      .uncontrolled-hint {
        font-size: 12px;
        color: var(--disabled-text-color, #9e9e9e);
        margin-top: 8px;
      }
    `,
  ];

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._clearCountdownTimer();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("overrideInfo") || changed.has("config")) {
      this._updateCountdown();
    }
  }

  private _clearCountdownTimer(): void {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = undefined;
    }
  }

  private _getOverrideUntil(): number | null {
    if (this.overrideInfo?.active) return this.overrideInfo.until;
    return null;
  }

  private _updateCountdown(): void {
    this._clearCountdownTimer();
    const until = this._getOverrideUntil();
    if (!until) {
      // Check if it's a permanent override (active but no until)
      const ov = this._getEffectiveOverride();
      this._countdown = ov ? localize("hero.permanent", this.hass?.language ?? "en") : "";
      return;
    }

    const update = () => {
      const u = this._getOverrideUntil();
      if (!u) {
        this._countdown = "";
        this._clearCountdownTimer();
        return;
      }
      const remaining = u - Date.now() / 1000;
      if (remaining <= 0) {
        this._countdown = "";
        this._clearCountdownTimer();
        return;
      }
      const h = Math.floor(remaining / 3600);
      const m = Math.floor((remaining % 3600) / 60);
      this._countdown = h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    update();
    this._countdownTimer = setInterval(update, 30_000);
  }

  private _getEffectiveOverride() {
    if (this.overrideInfo?.active) return this.overrideInfo;
    return null;
  }

  private _renderTargetSection(live: NonNullable<RoomConfig["live"]>) {
    const targetTemp = live.target_temp;
    const l = this.hass?.language ?? "en";
    const ov = this._getEffectiveOverride();

    if (ov) {
      const icon =
        ov.type === "boost" ? "mdi:fire" : ov.type === "eco" ? "mdi:leaf" : "mdi:thermometer";
      const label =
        ov.type === "boost"
          ? localize("override.comfort", l)
          : ov.type === "eco"
            ? localize("override.eco", l)
            : localize("override.custom", l);
      const colorClass = `override-${ov.type}`;
      const displayTemp = ov.temp ?? targetTemp;

      return html`
        <div class="hero-target">
          <div class="hero-target-label ${colorClass}">
            <ha-icon icon=${icon}></ha-icon>
            ${label} ${localize("hero.override", l)}
          </div>
          <div class="hero-target-value">
            ${displayTemp !== null
              ? html`${formatTemp(displayTemp, this.hass)}${tempUnit(this.hass)}`
              : "--"}
          </div>
          ${this._countdown
            ? html`<div class="hero-target-countdown">
                ${localize("hero.remaining", l, { time: this._countdown })}
              </div>`
            : nothing}
        </div>
      `;
    }

    if (targetTemp !== null || (live.heat_target != null && live.cool_target != null)) {
      const climateMode = this.config?.climate_mode ?? "auto";
      const showRange =
        climateMode === "auto" &&
        live.heat_target != null &&
        live.cool_target != null &&
        live.heat_target !== live.cool_target;

      const display = showRange
        ? html`${formatTemp(live.heat_target!, this.hass)} –
          ${formatTemp(live.cool_target!, this.hass)}${tempUnit(this.hass)}`
        : html`${formatTemp((targetTemp ?? live.heat_target)!, this.hass)}${tempUnit(this.hass)}`;

      return html`
        <div class="hero-target">
          <div class="hero-target-label">${localize("hero.target", l)}</div>
          <div class="hero-target-value">${display}</div>
        </div>
      `;
    }

    return nothing;
  }

  private _renderHeroMetric(metric: HeroMetricId, live: NonNullable<RoomConfig["live"]>) {
    const l = this.hass?.language ?? "en";
    switch (metric) {
      case "humidity":
        return html`<div class="hero-metric">
          <ha-icon icon="mdi:water-percent"></ha-icon>
          ${localize("hero.humidity", l, { value: live.current_humidity!.toFixed(0) })}
        </div>`;
      case "perceivedTemp":
        return html`<div class="hero-metric info">
          <ha-icon icon="mdi:human-handsup"></ha-icon>
          ${localize("hero.perceived_temp", l, {
            value: formatTemp(live.perceived_temp!, this.hass),
            unit: tempUnit(this.hass),
          })}
        </div>`;
      case "nightMode":
        return html`<div class="hero-metric warning">
          <ha-icon icon="mdi:weather-night"></ha-icon>
          ${localize("hero.night_mode_active", l)}
        </div>`;
      case "rapidRecovery":
        return html`<div class="hero-metric warning">
          <ha-icon icon="mdi:rocket-launch-outline"></ha-icon>
          ${localize("hero.rapid_recovery_active", l)}
        </div>`;
      case "deviceSetpoint":
        return html`<div class="hero-metric">
          <ha-icon icon=${live.mode === "cooling" ? "mdi:snowflake" : "mdi:radiator"}></ha-icon>
          ${localize("hero.device_setpoint", l, {
            value: formatTemp(live.device_setpoint!, this.hass),
            unit: tempUnit(this.hass),
          })}
        </div>`;
      case "activeHeatSources":
        return html`<div class="hero-metric">
          <ha-icon icon="mdi:swap-horizontal"></ha-icon>
          ${live.active_heat_sources === "primary"
            ? localize("hero.heat_source_primary", l)
            : live.active_heat_sources === "secondary"
              ? localize("hero.heat_source_secondary", l)
              : localize("hero.heat_source_both", l)}
        </div>`;
      case "moldRisk":
        return html`<div
          class="hero-metric ${live.mold_risk_level === "critical"
            ? "critical"
            : live.mold_risk_level === "warning"
              ? "warning"
              : ""}"
        >
          <ha-icon icon="mdi:water-alert"></ha-icon>
          ${localize("room.mold_surface_rh", l, {
            value: String(live.mold_surface_rh!.toFixed(0)),
          })}
        </div>`;
      case "moldPrevention":
        return html`<div class="hero-metric info">
          <ha-icon icon="mdi:shield-check"></ha-icon>
          ${localize("card.mold_prevention", l, {
            delta: toDisplayDelta(live.mold_prevention_delta, this.hass).toFixed(0),
            unit: tempUnit(this.hass),
          })}
        </div>`;
      case "learningPaused":
        return html`<div class="hero-metric warning learning-paused">
          <ha-icon icon="mdi:school-outline"></ha-icon>
          ${localize("hero.mpc_learning_paused", l)}
          <rs-info-icon
            icon="mdi:information-outline"
            .text=${localize("hero.mpc_learning_paused.outdoor_unavailable", l)}
          ></rs-info-icon>
        </div>`;
      case "notControlled":
        return html`<div class="hero-metric uncontrolled-hint">
          ${localize("card.not_controlled", l)}
        </div>`;
    }
  }

  private _toggleControlModeInfo(): void {
    this._controlModeInfoExpanded = !this._controlModeInfoExpanded;
  }

  private _onEditName(): void {
    this._nameInput = this.config?.display_name || "";
    this._editingName = true;
    this.updateComplete.then(() => {
      const input = this.renderRoot.querySelector<HTMLInputElement>(".name-input");
      input?.focus();
      input?.select();
    });
  }

  private _onNameInput(e: Event): void {
    this._nameInput = (e.target as HTMLInputElement).value;
  }

  private _onNameKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") this._onNameDone();
    else if (e.key === "Escape") this._editingName = false;
  }

  private _onNameDone(): void {
    const value = this._nameInput.trim();
    this.dispatchEvent(
      new CustomEvent("display-name-changed", {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
    this._editingName = false;
  }

  private _onNameClear(): void {
    this.dispatchEvent(
      new CustomEvent("display-name-changed", {
        detail: { value: "" },
        bubbles: true,
        composed: true,
      }),
    );
    this._editingName = false;
    this._nameInput = "";
  }

  override render() {
    const live = this.config?.live;
    const mode = live?.mode;
    const accentClass = live
      ? mode === "heating"
        ? "hero-accent-heating"
        : mode === "cooling"
          ? "hero-accent-cooling"
          : "hero-accent-idle"
      : "hero-accent-none";

    return html`
      <ha-card>
        <div class="hero-accent ${accentClass}"></div>
        <div class="hero-header">
          ${this._editingName
            ? html`
                <div class="name-edit-row">
                  <input
                    class="name-input"
                    type="text"
                    .value=${this._nameInput}
                    placeholder=${localize("room.alias.placeholder", this.hass?.language ?? "en")}
                    @input=${this._onNameInput}
                    @keydown=${this._onNameKeydown}
                  />
                  <ha-icon-button
                    class="name-done-btn"
                    .path=${CHECK_PATH}
                    @click=${this._onNameDone}
                  ></ha-icon-button>
                </div>
                ${this.config?.display_name
                  ? html`<button class="name-clear-btn" @click=${this._onNameClear}>
                      ${localize("room.alias.clear", this.hass?.language ?? "en")}
                    </button>`
                  : nothing}
              `
            : html`
                <div class="name-row">
                  <h2 class="area-name">${this.config?.display_name || this.area.name}</h2>
                  <ha-icon-button
                    class="name-edit-btn"
                    .path=${PENCIL_PATH}
                    @click=${this._onEditName}
                  ></ha-icon-button>
                </div>
              `}
          ${!this.isOutdoor
            ? html`
                <div class="hero-status-pills">
                  ${live
                    ? html`
                        <span class="mode-pill ${getModeClass(live.mode)}">
                          <span class="mode-dot"></span>
                          ${live.observation_status === "unknown" ? localize("hero.output_unknown", this.hass?.language ?? "en") : formatMode(
                            live.mode,
                            this.hass?.language ?? "en",
                          )}${live.heating_power > 0 && live.heating_power < 100
                            ? html` ${live.heating_power}%`
                            : nothing}
                        </span>
                      `
                    : nothing}
                  ${this.config
                    ? html`
                        <span class="control-mode-badge" @click=${this._toggleControlModeInfo}>
                          ${this.config.temperature_sensor
                            ? localize(
                                "room.control_mode.full_control",
                                this.hass?.language ?? "en",
                              )
                            : localize("room.control_mode.managed", this.hass?.language ?? "en")}
                          <ha-icon
                            class="control-mode-info-icon ${this._controlModeInfoExpanded
                              ? "active"
                              : ""}"
                            icon="mdi:information-outline"
                          ></ha-icon>
                        </span>
                      `
                    : nothing}
                </div>
              `
            : nothing}
        </div>
        ${!this.isOutdoor && live?.commanded_mode
          ? html`<div class="control-mode-info-panel">${localize("hero.control_request", this.hass?.language ?? "en", {
              mode: formatMode(live.commanded_mode, this.hass?.language ?? "en"),
              power: String(live.requested_power ?? 0),
            })}${live.dispatch_status === "failed" ? html` · ${localize("hero.dispatch_failed", this.hass?.language ?? "en")}` : nothing}</div>`
          : nothing}
        ${this._controlModeInfoExpanded && this.config && !this.isOutdoor
          ? html`
              <div class="control-mode-info-panel">
                ${this.config.temperature_sensor
                  ? localize("room.control_mode.full_control_info", this.hass?.language ?? "en")
                  : localize("room.control_mode.managed_info", this.hass?.language ?? "en")}
              </div>
            `
          : nothing}
        ${live
          ? html`
              ${live.window_open && !this.isOutdoor
                ? html`<div class="hero-window-open">
                    <ha-icon icon="mdi:window-open-variant"></ha-icon>
                    ${localize("hero.window_open", this.hass?.language ?? "en")}
                  </div>`
                : nothing}
              <div class="hero-temps">
                <div class="hero-current-wrap">
                  ${live.current_temp !== null
                    ? html`
                        <span class="hero-current"
                          >${formatTemp(live.current_temp, this.hass)}</span
                        >
                        <span class="hero-unit">${tempUnit(this.hass)}</span>
                      `
                    : html`<span class="hero-current" style="opacity: 0.3">--</span>`}
                </div>
                ${!this.isOutdoor ? this._renderTargetSection(live) : nothing}
              </div>
              <div class="hero-metrics">
                ${selectHeroMetricIds({
                  live,
                  isOutdoor: this.isOutdoor,
                  climateControlActive: this.climateControlActive,
                  roomControlEnabled: this.config?.climate_control_enabled ?? true,
                }).map((metric) => this._renderHeroMetric(metric, live))}
              </div>
            `
          : this.config
            ? html`<div class="hero-no-data">
                ${localize("hero.waiting", this.hass?.language ?? "en")}
              </div>`
            : html`<div class="hero-no-data">
                ${localize("hero.not_configured", this.hass?.language ?? "en")}
              </div>`}
      </ha-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-hero-status": RsHeroStatus;
  }
}
