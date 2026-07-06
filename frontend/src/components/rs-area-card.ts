import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant, HassArea, RoomConfig } from "../types";
import { getModeClass, formatMode } from "../utils/room-state";
import { modeStyles } from "../styles/shared-mode-styles";
import { localize } from "../utils/localize";
import { mdiEyeOff } from "../utils/icons";
import { formatTemp, tempUnit, toDisplayDelta } from "../utils/temperature";

@customElement("rs-area-card")
export class RsAreaCard extends LitElement {
  @property({ attribute: false }) public area!: HassArea;
  @property({ attribute: false }) public config: RoomConfig | null = null;
  @property({ type: Number }) public climateEntityCount = 0;
  @property({ type: Number }) public tempSensorCount = 0;
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ type: String }) public controlMode: "mpc" | "bangbang" = "bangbang";
  @property({ type: Boolean }) public climateControlActive = true;
  @property({ type: Boolean }) public reordering = false;
  @property({ type: Boolean }) public canMoveUp = false;
  @property({ type: Boolean }) public canMoveDown = false;

  static override styles = [
    modeStyles,
    css`
      :host {
        display: block;
        --roommind-tile-surface: color-mix(
          in srgb,
          var(--roommind-surface, var(--card-background-color, #ffffff)) 94%,
          var(--primary-text-color, #000000)
        );
      }

      ha-card {
        cursor: pointer;
        transition:
          box-shadow 0.2s ease,
          transform 0.15s ease,
          border-color 0.15s ease;
        overflow: hidden;
        position: relative;
        height: 100%;
        box-sizing: border-box;
        border-radius: 8px;
        border: var(--roommind-border-subtle);
        box-shadow: none;
      }

      ha-card:hover {
        border-color: rgba(var(--rgb-primary-color, 3, 169, 244), 0.34);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
        transform: translateY(-1px);
      }

      .hide-btn {
        --mdc-icon-button-size: 28px;
        --mdc-icon-size: 16px;
        color: var(--secondary-text-color);
        opacity: 0;
        transition: opacity 0.2s ease;
        position: absolute;
        top: 8px;
        right: 8px;
      }

      ha-card:hover .hide-btn {
        opacity: 0.4;
      }

      .hide-btn:hover {
        opacity: 1 !important;
      }

      /* Colored left accent based on mode */
      .accent {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 4px;
      }

      .accent-heating {
        background: var(--warning-color, #ff9800);
      }

      .accent-cooling {
        background: var(--roommind-info-color);
      }

      .accent-idle {
        background: var(--disabled-text-color, #bdbdbd);
      }

      .accent-unconfigured {
        background: transparent;
      }

      .card-inner {
        padding: 18px 18px 14px;
      }

      /* Header row: name + badge */
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-width: 0;
      }

      .area-name {
        font-size: 15px;
        font-weight: 600;
        color: var(--primary-text-color);
        margin: 0;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Card-specific mode-pill overrides (smaller than default) */
      .mode-pill {
        gap: 5px;
        font-size: 12px;
        padding: 3px 10px;
        border-radius: 8px;
      }

      .mode-dot {
        width: 7px;
        height: 7px;
      }

      .metrics-row {
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(112px, 0.85fr);
        gap: 10px;
        margin-top: 14px;
      }

      .metric-block {
        min-width: 0;
        min-height: 76px;
        padding: 10px 12px;
        border-radius: 8px;
        background: var(--roommind-tile-surface);
        border: var(--roommind-border-faint);
        box-sizing: border-box;
      }

      .metric-label {
        display: block;
        color: var(--secondary-text-color);
        font-size: 12px;
        line-height: 1.25;
        margin-bottom: 7px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .temp-value {
        display: flex;
        align-items: baseline;
        gap: 5px;
        min-width: 0;
      }

      .current-temp,
      .target-temp {
        font-size: 36px;
        font-weight: 400;
        color: var(--primary-text-color);
        line-height: 1;
      }

      .target-temp {
        font-size: 24px;
        font-weight: 600;
      }

      .temp-unit {
        font-size: 15px;
        font-weight: 400;
        color: var(--secondary-text-color);
      }

      .target-info {
        min-width: 0;
      }

      .target-value {
        display: inline-flex;
        align-items: baseline;
        min-width: 0;
        font-weight: 600;
        color: var(--primary-text-color);
      }

      .delta-line {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 26px;
        margin-top: 10px;
        padding: 4px 9px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 500;
        background: var(--roommind-tile-surface);
        color: var(--secondary-text-color);
        box-sizing: border-box;
      }

      .delta-line ha-icon {
        --mdc-icon-size: 15px;
      }

      .delta-line.below {
        color: var(--roommind-warning-color);
        background: var(--roommind-warning-tint);
      }

      .delta-line.above {
        color: var(--roommind-info-color);
        background: var(--roommind-info-tint);
      }

      .delta-line.on-target {
        color: var(--roommind-success-color);
        background: var(--roommind-success-tint);
      }

      /* Footer row: humidity + MPC status */
      .card-footer {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        margin-top: 10px;
        min-height: 20px;
      }

      .humidity-info {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 500;
        color: var(--secondary-text-color);
        min-height: 22px;
      }

      .humidity-info ha-icon {
        --mdc-icon-size: 15px;
      }

      .status-badge,
      .mpc-badge,
      .mold-badge,
      .outdoor-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 500;
        padding: 2px 8px 2px 6px;
        border-radius: 8px;
        --mdc-icon-size: 14px;
      }

      .status-badge.override {
        color: var(--warning-color, #ff9800);
        background: var(--roommind-warning-tint);
      }

      .status-badge.window {
        color: var(--roommind-warning-color);
        background: var(--roommind-warning-tint);
      }

      .status-badge.away {
        color: var(--roommind-info-color);
        background: var(--roommind-info-tint);
      }

      .mpc-badge.active {
        color: var(--success-color, #4caf50);
        background: var(--roommind-success-tint);
      }

      .mpc-badge.learning {
        color: var(--secondary-text-color);
        background: var(--roommind-surface-muted);
      }

      .mold-badge.warning {
        color: var(--warning-color, #ff9800);
        background: var(--roommind-warning-tint);
      }

      .mold-badge.critical {
        color: var(--error-color, #db4437);
        background: var(--roommind-error-tint);
      }

      .mold-badge.prevention {
        color: var(--roommind-info-color);
        background: var(--roommind-info-tint);
      }

      .outdoor-badge {
        color: var(--success-color, #4caf50);
        background: var(--roommind-success-tint);
      }

      .badge-row {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .sensor-only .metrics-row {
        grid-template-columns: minmax(0, 1fr) minmax(104px, 0.72fr);
      }

      .no-temp {
        font-size: 24px;
        font-weight: 300;
        color: var(--secondary-text-color);
        line-height: 1;
      }

      .uncontrolled-hint {
        font-size: 11px;
        color: var(--disabled-text-color, #9e9e9e);
        margin-top: 6px;
      }

      .reorder-overlay {
        position: absolute;
        inset: 0;
        z-index: 2;
        display: flex;
        pointer-events: none;
        border-radius: inherit;
        overflow: hidden;
      }

      .reorder-half {
        pointer-events: auto;
        flex: 0 0 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.15s ease;
        background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.05);
      }

      .reorder-half.left {
        border-radius: inherit;
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        border-right: 1px solid rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
      }

      .reorder-half.right {
        border-radius: inherit;
        border-top-left-radius: 0;
        border-bottom-left-radius: 0;
        border-left: 1px solid rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
        margin-left: auto;
      }

      .reorder-half:hover {
        background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.1);
      }

      .reorder-half ha-icon-button {
        --mdc-icon-button-size: 36px;
        --mdc-icon-size: 20px;
        color: var(--secondary-text-color);
        pointer-events: none;
      }

      .reorder-half:hover ha-icon-button {
        color: var(--primary-text-color);
      }

      .reorder-half.disabled {
        opacity: 0.25;
        cursor: default;
      }

      .reorder-half.disabled:hover {
        background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.05);
      }

      /* Device summary for unconfigured cards */
      .device-summary {
        font-size: 13px;
        color: var(--secondary-text-color);
        margin-top: 8px;
      }

      .device-summary.empty {
        color: var(--disabled-text-color, #9e9e9e);
        font-style: italic;
      }

      /* Configure prompt for unconfigured areas */
      .configure-prompt {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 12px;
        padding-top: 12px;
        border-top: var(--roommind-border-faint);
      }

      .configure-text {
        font-size: 13px;
        color: var(--secondary-text-color);
      }

      .configure-arrow {
        font-size: 18px;
        color: var(--primary-color);
      }

      /* Waiting state */
      .waiting {
        font-size: 13px;
        color: var(--disabled-text-color, #9e9e9e);
        font-style: italic;
        margin-top: 8px;
      }

      @media (max-width: 430px) {
        .metrics-row,
        .sensor-only .metrics-row {
          grid-template-columns: 1fr;
        }

        .metric-block {
          min-height: 68px;
        }
      }
    `,
  ];

  override render() {
    const hasClimateDevices = this.climateEntityCount > 0;
    const hasClimateSelected =
      (this.config?.devices?.length ?? 0) > 0 ||
      (this.config?.thermostats?.length ?? 0) > 0 ||
      (this.config?.acs?.length ?? 0) > 0;
    const isOutdoor = this.config?.is_outdoor ?? false;
    const isConfigured = this.config !== null && hasClimateSelected && !isOutdoor;
    const live = this.config?.live;
    const mode = live?.mode;

    const hasSensorData =
      (!isConfigured || isOutdoor) &&
      live &&
      (live.current_temp !== null || live.current_humidity !== null);
    const accentClass = isConfigured
      ? mode === "heating"
        ? "accent-heating"
        : mode === "cooling"
          ? "accent-cooling"
          : "accent-idle"
      : hasSensorData
        ? "accent-idle"
        : "accent-unconfigured";

    return html`
      <ha-card @click=${this._onCardClick}>
        <div class="accent ${accentClass}"></div>
        ${!this.reordering
          ? html`<ha-icon-button
              class="hide-btn"
              .path=${mdiEyeOff}
              @click=${this._onHideClick}
            ></ha-icon-button>`
          : nothing}
        ${this.reordering
          ? html`<div class="reorder-overlay">
              <div
                class="reorder-half left ${!this.canMoveUp ? "disabled" : ""}"
                @click=${this._onMoveUp}
              >
                <ha-icon-button
                  .path=${"M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z"}
                ></ha-icon-button>
              </div>
              <div
                class="reorder-half right ${!this.canMoveDown ? "disabled" : ""}"
                @click=${this._onMoveDown}
              >
                <ha-icon-button
                  .path=${"M8.59,16.58L13.17,12L8.59,7.41L10,6L16,12L10,18L8.59,16.58Z"}
                ></ha-icon-button>
              </div>
            </div>`
          : nothing}
        <div class="card-inner">
          <div class="card-header">
            <h3 class="area-name">${this.config?.display_name || this.area.name}</h3>
            ${isConfigured && live
              ? html`
                  <span class="mode-pill ${getModeClass(live.mode)}">
                    <span class="mode-dot"></span>
                    ${formatMode(live.mode, this.hass.language)}${live.heating_power > 0 &&
                    live.heating_power < 100
                      ? html` ${live.heating_power}%`
                      : nothing}
                  </span>
                `
              : nothing}
          </div>

          ${isConfigured
            ? this._renderConfigured()
            : this.config?.live &&
                (this.config.live.current_temp !== null ||
                  this.config.live.current_humidity !== null)
              ? this._renderSensorOnly()
              : this._renderUnconfigured(hasClimateDevices)}
        </div>
      </ha-card>
    `;
  }

  private _renderConfigured() {
    const live = this.config?.live;

    if (!live) {
      return html`<div class="waiting">${localize("card.waiting", this.hass.language)}</div>`;
    }

    const showMpcIcon = this.controlMode === "mpc";

    return html`
      <div class="metrics-row">
        <div class="metric-block">
          <span class="metric-label"
            >${localize("room.temperature_panel.current", this.hass.language)}</span
          >
          <div class="temp-value">
            ${live.current_temp !== null
              ? html`
                  <span class="current-temp">${formatTemp(live.current_temp, this.hass)}</span>
                  <span class="temp-unit">${tempUnit(this.hass)}</span>
                `
              : html`<span class="no-temp">--</span>`}
          </div>
        </div>
        <div class="metric-block target-info">
          <span class="metric-label">${localize("card.target", this.hass.language)}</span>
          ${this._renderTargetInfo(live)}
        </div>
      </div>
      ${this._renderDeltaLine(live)}
      <div class="card-footer">
        <span class="humidity-info">
          ${live.current_humidity !== null
            ? html`<ha-icon icon="mdi:water-percent"></ha-icon> ${localize(
                  "card.humidity",
                  this.hass.language,
                  {
                    value: live.current_humidity.toFixed(0),
                  },
                )}`
            : nothing}
        </span>
        <span class="badge-row">
          ${live.override_active
            ? html`<span class="status-badge override">
                <ha-icon icon="mdi:timer-outline"></ha-icon>
                ${localize("card.override_active", this.hass.language)}
              </span>`
            : nothing}
          ${live.window_open
            ? html`<span class="status-badge window">
                <ha-icon icon="mdi:window-open-variant"></ha-icon>
                ${localize("card.window_open", this.hass.language)}
              </span>`
            : nothing}
          ${live.presence_away
            ? html`<span class="status-badge away">
                <ha-icon icon="mdi:home-off-outline"></ha-icon>
                ${localize("card.presence_away", this.hass.language)}
              </span>`
            : nothing}
          ${live.mold_risk_level && live.mold_risk_level !== "ok"
            ? html`<span class="mold-badge ${live.mold_risk_level}">
                <ha-icon icon="mdi:water-alert"></ha-icon>
                ${live.mold_risk_level === "critical"
                  ? localize("card.mold_critical", this.hass.language)
                  : localize("card.mold_warning", this.hass.language)}
              </span>`
            : nothing}
          ${live.mold_prevention_active
            ? html`<span class="mold-badge prevention">
                <ha-icon icon="mdi:shield-check"></ha-icon>
                ${localize("card.mold_prevention", this.hass.language, {
                  delta: toDisplayDelta(live.mold_prevention_delta, this.hass).toFixed(0),
                  unit: tempUnit(this.hass),
                })}
              </span>`
            : nothing}
          ${showMpcIcon
            ? html`<span class="mpc-badge ${live.mpc_active ? "active" : "learning"}">
                <ha-icon .icon=${live.mpc_active ? "mdi:brain" : "mdi:school-outline"}></ha-icon>
                ${live.mpc_active
                  ? localize("card.mpc_active", this.hass.language)
                  : localize("card.mpc_learning", this.hass.language)}
              </span>`
            : nothing}
        </span>
      </div>
      ${!this.climateControlActive || this.config?.climate_control_enabled === false
        ? html`<div class="uncontrolled-hint">
            ${localize("card.not_controlled", this.hass.language)}
          </div>`
        : nothing}
    `;
  }

  private _renderTargetInfo(live: NonNullable<RoomConfig["live"]>) {
    if (live.target_temp === null && live.heat_target === null) return nothing;

    // Show range for auto mode with different heat/cool targets
    const climateMode = this.config?.climate_mode ?? "auto";
    const showRange =
      climateMode === "auto" &&
      live.heat_target != null &&
      live.cool_target != null &&
      live.heat_target !== live.cool_target;

    const targetDisplay = showRange
      ? html`<span class="target-value">
          <span class="target-temp">${formatTemp(live.heat_target!, this.hass)}</span>
          <span class="temp-unit">
            - ${formatTemp(live.cool_target!, this.hass)}${tempUnit(this.hass)}
          </span>
        </span>`
      : html`<span class="target-value">
          <span class="target-temp"
            >${formatTemp((live.target_temp ?? live.heat_target)!, this.hass)}</span
          ><span class="temp-unit">${tempUnit(this.hass)}</span>
        </span>`;

    return html`${targetDisplay}`;
  }

  private _renderDeltaLine(live: NonNullable<RoomConfig["live"]>) {
    const current = live.current_temp;
    const target = this._effectiveTargetTemp(live);
    if (current === null || target === null) return nothing;

    const delta = current - target;
    const absDelta = Math.abs(toDisplayDelta(delta, this.hass));
    if (absDelta < 0.2) {
      return html`<div class="delta-line on-target">
        <ha-icon icon="mdi:check-circle-outline"></ha-icon>
        ${localize("card.delta_on_target", this.hass.language)}
      </div>`;
    }

    const key = delta > 0 ? "card.delta_above" : "card.delta_below";
    const icon = delta > 0 ? "mdi:thermometer-chevron-down" : "mdi:thermometer-chevron-up";
    return html`<div class="delta-line ${delta > 0 ? "above" : "below"}">
      <ha-icon .icon=${icon}></ha-icon>
      ${localize(key, this.hass.language, {
        delta: absDelta.toFixed(1),
        unit: tempUnit(this.hass),
      })}
    </div>`;
  }

  private _effectiveTargetTemp(live: NonNullable<RoomConfig["live"]>): number | null {
    if (live.target_temp !== null) return live.target_temp;
    if (live.mode === "cooling" && live.cool_target !== null) return live.cool_target;
    if (live.mode === "heating" && live.heat_target !== null) return live.heat_target;
    if (live.heat_target !== null && live.cool_target !== null) {
      return (live.heat_target + live.cool_target) / 2;
    }
    return live.heat_target ?? live.cool_target ?? null;
  }

  private _renderSensorOnly() {
    const live = this.config!.live!;
    const isOutdoor = this.config?.is_outdoor ?? false;

    return html`
      <div class="sensor-only">
        <div class="metrics-row">
          <div class="metric-block">
            <span class="metric-label"
              >${localize("room.temperature_panel.current", this.hass.language)}</span
            >
            <div class="temp-value">
              ${live.current_temp !== null
                ? html`
                    <span class="current-temp">${formatTemp(live.current_temp, this.hass)}</span>
                    <span class="temp-unit">${tempUnit(this.hass)}</span>
                  `
                : html`<span class="no-temp">--</span>`}
            </div>
          </div>
          <div class="metric-block">
            <span class="metric-label">${localize("card.humidity_label", this.hass.language)}</span>
            <div class="temp-value">
              ${live.current_humidity !== null
                ? html`<span class="target-temp">${live.current_humidity.toFixed(0)}</span>
                    <span class="temp-unit">%</span>`
                : html`<span class="no-temp">--</span>`}
            </div>
          </div>
        </div>
      </div>
      <div class="card-footer">
        <span class="humidity-info"></span>
        <span class="badge-row">
          ${isOutdoor
            ? html`<span class="outdoor-badge">
                <ha-icon icon="mdi:tree"></ha-icon>
                ${localize("card.outdoor", this.hass.language)}
              </span>`
            : nothing}
          ${live.mold_risk_level && live.mold_risk_level !== "ok"
            ? html`<span class="mold-badge ${live.mold_risk_level}">
                <ha-icon icon="mdi:water-alert"></ha-icon>
                ${live.mold_risk_level === "critical"
                  ? localize("card.mold_critical", this.hass.language)
                  : localize("card.mold_warning", this.hass.language)}
              </span>`
            : nothing}
        </span>
      </div>
    `;
  }

  private _renderUnconfigured(hasClimateDevices: boolean) {
    const l = this.hass.language;
    if (!hasClimateDevices) {
      return html`<div class="device-summary empty">${localize("card.no_climate", l)}</div>`;
    }

    const ce = this.climateEntityCount;
    const ts = this.tempSensorCount;
    return html`
      <div class="device-summary">
        ${ce}
        ${localize(ce !== 1 ? "card.climate_devices" : "card.climate_device", l)}${ts > 0
          ? ` \u00B7 ${ts} ${localize(ts !== 1 ? "card.temp_sensors" : "card.temp_sensor", l)}`
          : ""}
      </div>
      <div class="configure-prompt">
        <span class="configure-text">${localize("card.tap_configure", l)}</span>
        <span class="configure-arrow">›</span>
      </div>
    `;
  }

  private _onCardClick() {
    this.dispatchEvent(
      new CustomEvent("area-selected", {
        detail: { areaId: this.area.area_id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onMoveUp(e: Event) {
    e.stopPropagation();
    if (!this.canMoveUp) return;
    this.dispatchEvent(
      new CustomEvent("move-room-up", {
        detail: { areaId: this.area.area_id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onMoveDown(e: Event) {
    e.stopPropagation();
    if (!this.canMoveDown) return;
    this.dispatchEvent(
      new CustomEvent("move-room-down", {
        detail: { areaId: this.area.area_id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onHideClick(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("hide-room", {
        detail: { areaId: this.area.area_id },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-area-card": RsAreaCard;
  }
}
