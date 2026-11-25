import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { CompressorGroup, HomeAssistant, HassArea, RoomConfig } from "../types";
import {
  getComfortDelta,
  getDisplayMode,
  getModeClass,
  formatMode,
  isTemperatureCached,
} from "../utils/room-state";
import { modeStyles } from "../styles/shared-mode-styles";
import { localize } from "../utils/localize";
import { mdiEyeOff } from "../utils/icons";
import { formatTemp, tempUnit, toDisplayDelta } from "../utils/temperature";
import { isOverrideEffective } from "../utils/room-overview-status";
import { buildThermostatFleet } from "../utils/thermostat-fleet";
import { buildRoomFanCapabilities, fanSpeedBars, formatFanModeLabel } from "../utils/fan-control";
import { resolveRoomReason } from "../utils/room-state-reason";
import "./rs-thermal-band";

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
  @property({ attribute: false }) public compressorGroups: CompressorGroup[] = [];

  static override styles = [
    modeStyles,
    css`
      :host {
        display: block;
        --roommind-tile-surface: color-mix(
          in srgb,
          var(--roommind-surface, var(--card-background-color, #ffffff)) 97%,
          var(--primary-text-color, #000000)
        );
      }

      ha-card {
        --room-glow: transparent;
        --room-stripe: transparent;
        cursor: pointer;
        touch-action: manipulation;
        transition:
          box-shadow var(--roommind-motion-duration) ease,
          transform var(--roommind-motion-duration) var(--roommind-motion-easing),
          border-color var(--roommind-motion-duration) ease;
        overflow: hidden;
        position: relative;
        height: 100%;
        box-sizing: border-box;
        border-radius: var(--roommind-radius-card);
        border: var(--roommind-border-subtle);
        box-shadow: var(--roommind-shadow-card, none);
        background:
          radial-gradient(ellipse at top right, var(--room-glow), transparent 70%),
          var(--roommind-surface);
      }

      ha-card::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: var(--room-stripe);
        pointer-events: none;
      }

      ha-card[data-activity="heating"] {
        --room-glow: color-mix(in srgb, var(--roommind-warning-color) 10%, transparent);
        --room-stripe: var(--roommind-warning-color);
      }

      ha-card[data-activity="cooling"],
      ha-card[data-activity="dry"] {
        --room-glow: color-mix(in srgb, var(--roommind-info-color) 10%, transparent);
        --room-stripe: var(--roommind-info-color);
      }

      ha-card[data-activity="fan_only"] {
        --room-glow: color-mix(in srgb, var(--roommind-success-color) 9%, transparent);
        --room-stripe: var(--roommind-success-color);
      }

      ha-card:hover {
        border-color: var(
          --roommind-card-border-hover,
          rgba(var(--rgb-primary-color, 3, 169, 244), 0.34)
        );
        box-shadow: var(--roommind-shadow-card-hover, 0 2px 10px rgba(0, 0, 0, 0.08));
        transform: translateY(-1px);
      }

      ha-card:active {
        transform: scale(0.99);
      }

      ha-card:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 3px;
      }

      .header-hide-btn,
      .quick-hide-btn {
        --mdc-icon-button-size: 26px;
        --mdc-icon-size: 15px;
        color: var(--secondary-text-color);
        opacity: 0.35;
        transition:
          opacity var(--roommind-motion-duration) ease,
          color var(--roommind-motion-duration) ease;
        flex: 0 0 auto;
      }

      .header-hide-btn {
        margin: -3px -6px 0 0;
      }

      ha-card:hover .header-hide-btn,
      ha-card:hover .quick-hide-btn,
      ha-card:focus-within .header-hide-btn,
      ha-card:focus-within .quick-hide-btn {
        opacity: 0.65;
      }

      @media (hover: none) {
        .header-hide-btn,
        .quick-hide-btn {
          opacity: 0.6;
        }
      }

      .header-hide-btn:hover,
      .quick-hide-btn:hover {
        opacity: 1 !important;
        color: var(--primary-text-color);
      }

      .card-inner {
        padding: 15px 16px 12px;
        display: flex;
        flex-direction: column;
        height: 100%;
        box-sizing: border-box;
      }

      /* Header row: title stack + mode pill */
      .card-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        min-width: 0;
      }

      .title-stack {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
        min-width: 0;
        flex: 1 1 auto;
      }

      .area-name {
        font-size: 15.5px;
        font-weight: 650;
        color: var(--primary-text-color);
        margin: 0;
        min-width: 0;
        line-height: 1.25;
        overflow-wrap: anywhere;
        white-space: normal;
      }

      .reason-pill {
        display: inline-flex;
        align-items: center;
        font-size: 10.5px;
        font-weight: 600;
        line-height: 1.25;
        padding: 2px 7px;
        border-radius: 7px;
        background: var(--roommind-tile-surface, rgba(0, 0, 0, 0.05));
        color: var(--secondary-text-color);
        white-space: nowrap;
      }

      .reason-pill[data-tone="warning"] {
        background: var(--roommind-warning-tint);
        color: var(--roommind-warning-color);
      }

      .reason-pill[data-tone="accent"] {
        background: var(--roommind-primary-muted, rgba(3, 169, 244, 0.14));
        color: var(--primary-color);
      }

      .reason-pill[data-tone="info"] {
        background: var(--roommind-info-tint);
        color: var(--roommind-info-color);
      }

      /* Card-specific mode-pill overrides (smaller than default) */
      .mode-pill {
        gap: 5px;
        font-size: 11.5px;
        padding: 2px 9px;
        border-radius: 8px;
        max-width: 100%;
        white-space: normal;
      }

      .mode-dot {
        width: 7px;
        height: 7px;
      }

      .metrics-row {
        display: grid;
        grid-template-columns: minmax(0, 1.15fr) minmax(104px, 0.85fr);
        gap: 8px;
        margin-top: 12px;
      }

      .metric-block {
        min-width: 0;
        min-height: 54px;
        padding: 0;
        box-sizing: border-box;
      }

      .metric-label {
        display: block;
        color: var(--secondary-text-color);
        font-size: 11.5px;
        line-height: 1.25;
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .temp-value {
        display: flex;
        align-items: baseline;
        gap: 4px;
        min-width: 0;
      }

      .current-temp,
      .target-temp {
        font-size: 30px;
        font-weight: 400;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.03em;
        color: var(--primary-text-color);
        line-height: 1;
      }

      .target-temp {
        font-size: 21px;
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

      .delta-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        margin-top: 4px;
        font-size: 11px;
        font-weight: 600;
        line-height: 1.25;
        color: var(--secondary-text-color);
        --mdc-icon-size: 13px;
      }

      .delta-chip ha-icon {
        flex: 0 0 auto;
      }

      .delta-chip.below {
        color: var(--roommind-warning-color);
      }

      .delta-chip.above {
        color: var(--roommind-info-color);
      }

      .delta-chip.on-target {
        color: var(--roommind-success-color);
      }

      /* Footer row: humidity + MPC status */
      .unit-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 8px;
      }

      .unit-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 10.5px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 6px;
        background: var(--roommind-surface-subtle, rgba(0, 0, 0, 0.04));
        border: var(--roommind-border-faint, 1px solid rgba(0, 0, 0, 0.08));
        color: var(--secondary-text-color);
        max-width: 100%;
        font-variant-numeric: tabular-nums;
      }

      .unit-pill[data-mode="heat"] {
        color: var(--roommind-warning-color, #ef6c00);
        background: var(--roommind-warning-tint, rgba(255, 152, 0, 0.1));
      }

      .unit-pill[data-mode="cool"],
      .unit-pill[data-mode="dry"] {
        color: var(--roommind-info-color, #1565c0);
        background: var(--roommind-info-tint, rgba(33, 150, 243, 0.1));
      }

      .unit-pill[data-mode="fan_only"] {
        color: var(--roommind-success-color, #00796b);
        background: var(--roommind-success-tint, rgba(38, 166, 154, 0.1));
      }

      .unit-pill[data-conflict="true"] {
        color: var(--roommind-error-color, #c62828);
        background: var(--roommind-error-tint, rgba(244, 67, 54, 0.12));
      }

      .unit-pill-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 110px;
      }

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
        min-width: 0;
        max-width: 100%;
      }

      .status-badge,
      .mpc-badge,
      .mold-badge,
      .outdoor-badge {
        max-width: 100%;
        line-height: 1.25;
        overflow-wrap: anywhere;
        white-space: normal;
      }

      .status-badge ha-icon,
      .mpc-badge ha-icon,
      .mold-badge ha-icon,
      .outdoor-badge ha-icon {
        flex: 0 0 auto;
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
        margin-top: 4px;
      }

      .footer-left {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        min-width: 0;
      }

      .fan-mini-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        color: var(--secondary-text-color);
        padding: 2px 6px;
        border-radius: 6px;
        background: var(--roommind-tile-surface, rgba(0, 0, 0, 0.04));
        --mdc-icon-size: 13px;
      }

      .fan-mini-bars {
        display: inline-flex;
        align-items: flex-end;
        gap: 1.5px;
        height: 10px;
      }

      .fan-mini-bar {
        width: 2px;
        border-radius: 1px;
        background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.16);
      }

      .fan-mini-bar:nth-child(1) {
        height: 3px;
      }
      .fan-mini-bar:nth-child(2) {
        height: 5px;
      }
      .fan-mini-bar:nth-child(3) {
        height: 7px;
      }
      .fan-mini-bar:nth-child(4) {
        height: 8.5px;
      }
      .fan-mini-bar:nth-child(5) {
        height: 10px;
      }

      .fan-mini-bar.on {
        background: var(--primary-color, #03a9f4);
      }

      .quick-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: auto;
        padding-top: 9px;
        border-top: var(--roommind-border-faint, 1px solid rgba(0, 0, 0, 0.06));
      }

      .quick-actions-left {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .quick-actions-right {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .stepper-group {
        display: inline-flex;
        align-items: center;
        border-radius: 8px;
        border: var(--roommind-border-subtle);
        background: var(--roommind-tile-surface, var(--secondary-background-color));
        overflow: hidden;
      }

      .stepper-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 26px;
        padding: 0 6px;
        border: none;
        background: transparent;
        color: var(--primary-text-color);
        font-family: inherit;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition:
          background 0.12s ease,
          color 0.12s ease;
      }

      .stepper-btn + .stepper-btn {
        border-left: var(--roommind-border-faint, 1px solid rgba(0, 0, 0, 0.08));
      }

      .stepper-btn:hover {
        background: var(--roommind-primary-muted, rgba(3, 169, 244, 0.1));
        color: var(--primary-color);
      }

      .quick-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-width: 28px;
        height: 28px;
        padding: 0 8px;
        border-radius: 8px;
        border: var(--roommind-border-subtle);
        background: var(--roommind-tile-surface, var(--secondary-background-color));
        color: var(--primary-text-color);
        font-family: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        --mdc-icon-size: 14px;
        transition:
          border-color 0.12s ease,
          background 0.12s ease,
          color 0.12s ease;
      }

      .quick-btn:hover {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }

      .quick-btn.is-paused {
        border-color: color-mix(in srgb, var(--roommind-warning-color) 45%, transparent);
        background: var(--roommind-warning-tint);
        color: var(--roommind-warning-color);
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

      @media (prefers-reduced-motion: reduce) {
        ha-card:hover,
        ha-card:active {
          transform: none;
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
    const mode = getDisplayMode(live, this.config);
    const reason =
      isConfigured && live ? resolveRoomReason(this.config, this.climateControlActive) : null;

    return html`
      <ha-card
        data-activity=${isConfigured ? (mode ?? "unknown") : "none"}
        role="link"
        tabindex=${this.reordering ? -1 : 0}
        aria-label=${this.config?.display_name || this.area.name}
        @click=${this._onCardClick}
        @keydown=${(event: KeyboardEvent) => {
          if (event.target === event.currentTarget && event.key === "Enter") this._onCardClick();
        }}
      >
        ${
          this.reordering
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
            : nothing
        }
        <div class="card-inner">
          <div class="card-header">
            <div class="title-stack">
              <h3 class="area-name">${this.config?.display_name || this.area.name}</h3>
              ${
                reason
                  ? html`<span class="reason-pill" data-tone=${reason.tone}>
                      ${localize(reason.key, this.hass.language)}
                    </span>`
                  : nothing
              }
            </div>
            ${
              isConfigured && live
                ? html`
                    <span class="mode-pill ${getModeClass(mode)}">
                      <span class="mode-dot"></span>
                      ${
                        mode === null
                          ? localize("hero.output_unknown", this.hass.language)
                          : formatMode(mode, this.hass.language)
                      }
                    </span>
                  `
                : !this.reordering
                  ? html`<ha-icon-button
                      class="header-hide-btn"
                      .path=${mdiEyeOff}
                      .label=${localize("panel.hide_room", this.hass.language)}
                      title=${localize("panel.hide_room", this.hass.language)}
                      aria-label=${localize("panel.hide_room", this.hass.language)}
                      @click=${this._onHideClick}
                    ></ha-icon-button>`
                  : nothing
            }
          </div>

          ${
            isConfigured
              ? this._renderConfigured(reason?.key ?? null)
              : this.config?.live &&
                  (this.config.live.current_temp !== null ||
                    this.config.live.current_humidity !== null)
                ? this._renderSensorOnly()
                : this._renderUnconfigured(hasClimateDevices)
          }
        </div>
      </ha-card>
    `;
  }

  private _renderConfigured(reasonKey: string | null) {
    const live = this.config?.live;

    if (!live) {
      return html`<div class="waiting">${localize("card.waiting", this.hass.language)}</div>`;
    }

    const showMpcIcon = this.controlMode === "mpc";
    const showOverride = live.override_active && !reasonKey?.startsWith("reason.override_");
    const showWindow = live.window_open && reasonKey !== "reason.window_open";
    const showAway = live.presence_away && reasonKey !== "reason.presence_away";
    const showMoldRisk =
      live.mold_risk_level && live.mold_risk_level !== "ok" && reasonKey !== "reason.mold_risk";
    const showMoldPrevention =
      live.mold_prevention_active && reasonKey !== "reason.mold_prevention";

    return html`
      <div class="metrics-row">
        <div class="metric-block">
          <span class="metric-label"
            >${localize(
              isTemperatureCached(live)
                ? "room.temperature_cached"
                : "room.temperature_panel.current",
              this.hass.language,
            )}</span
          >
          <div class="temp-value">
            ${
              live.current_temp !== null
                ? html`
                    <span class="current-temp">${formatTemp(live.current_temp, this.hass)}</span>
                    <span class="temp-unit">${tempUnit(this.hass)}</span>
                  `
                : html`<span class="no-temp">--</span>`
            }
          </div>
        </div>
        <div class="metric-block target-info">
          <span class="metric-label">${localize("card.target", this.hass.language)}</span>
          ${this._renderTargetInfo(live)} ${this._renderDeltaChip(live)}
        </div>
      </div>
      <rs-thermal-band .hass=${this.hass} .config=${this.config} compact></rs-thermal-band>
      ${this._renderUnitStrip()}
      <div class="card-footer">
        <span class="footer-left">
          ${
            live.current_humidity !== null
              ? html`<span class="humidity-info">
                  <ha-icon icon="mdi:water-percent"></ha-icon> ${localize(
                    "card.humidity",
                    this.hass.language,
                    {
                      value: live.current_humidity.toFixed(0),
                    },
                  )}
                </span>`
              : nothing
          }
          ${this._renderFanMini()}
        </span>
        <span class="badge-row">
          ${
            showOverride
              ? html`<span class="status-badge override">
                  <ha-icon
                    icon=${
                      isOverrideEffective(this.config!, this.climateControlActive)
                        ? "mdi:timer-outline"
                        : "mdi:pause-circle-outline"
                    }
                  ></ha-icon>
                  ${
                    isOverrideEffective(this.config!, this.climateControlActive)
                      ? localize("card.override_active", this.hass.language)
                      : localize("card.override_paused", this.hass.language)
                  }
                </span>`
              : nothing
          }
          ${
            showWindow
              ? html`<span class="status-badge window">
                  <ha-icon icon="mdi:window-open-variant"></ha-icon>
                  ${localize("card.window_open", this.hass.language)}
                </span>`
              : nothing
          }
          ${
            showAway
              ? html`<span class="status-badge away">
                  <ha-icon icon="mdi:home-off-outline"></ha-icon>
                  ${localize("card.presence_away", this.hass.language)}
                </span>`
              : nothing
          }
          ${
            showMoldRisk
              ? html`<span class="mold-badge ${live.mold_risk_level}">
                  <ha-icon icon="mdi:water-alert"></ha-icon>
                  ${
                    live.mold_risk_level === "critical"
                      ? localize("card.mold_critical", this.hass.language)
                      : localize("card.mold_warning", this.hass.language)
                  }
                </span>`
              : nothing
          }
          ${
            showMoldPrevention
              ? html`<span class="mold-badge prevention">
                  <ha-icon icon="mdi:shield-check"></ha-icon>
                  ${localize("card.mold_prevention", this.hass.language, {
                    delta: toDisplayDelta(live.mold_prevention_delta, this.hass).toFixed(0),
                    unit: tempUnit(this.hass),
                  })}
                </span>`
              : nothing
          }
          ${
            showMpcIcon
              ? html`<span class="mpc-badge ${live.mpc_active ? "active" : "learning"}">
                  <ha-icon .icon=${live.mpc_active ? "mdi:brain" : "mdi:school-outline"}></ha-icon>
                  ${
                    live.mpc_active
                      ? localize("card.mpc_active", this.hass.language)
                      : localize("card.mpc_learning", this.hass.language)
                  }
                </span>`
              : nothing
          }
        </span>
      </div>
      ${!this.reordering ? this._renderQuickActions(live) : nothing}
    `;
  }

  private _renderFanMini() {
    if (!this.config || !this.hass) return nothing;
    const caps = buildRoomFanCapabilities(this.config, this.hass);
    if (!caps.hasFanControl) return nothing;
    const l = this.hass.language;
    const activeUnit =
      caps.units.find((u) => u.isOn && u.fanMode) ??
      caps.units.find((u) => u.fanMode) ??
      caps.standaloneFans.find((u) => u.isOn && u.percentage != null) ??
      caps.standaloneFans[0];
    const policy = this.config.fan_speed_mode;
    let bars: 0 | 1 | 2 | 3 | 4 | 5 = 0;
    let label = "";
    if (activeUnit?.fanMode) {
      bars = fanSpeedBars(activeUnit.fanMode, activeUnit.fanModes);
      label = formatFanModeLabel(activeUnit.fanMode, l);
    } else if (activeUnit?.percentage != null && activeUnit.isOn) {
      bars = fanSpeedBars(activeUnit.percentage);
      label = `${Math.round(activeUnit.percentage)}%`;
    } else if (policy) {
      bars = fanSpeedBars(policy);
      label = formatFanModeLabel(policy, l);
    }
    if (bars === 0 && !label) return nothing;
    return html`
      <span class="fan-mini-pill">
        <ha-icon icon="mdi:fan"></ha-icon>
        <span class="fan-mini-bars" aria-hidden="true">
          ${[1, 2, 3, 4, 5].map(
            (idx) => html`<span class="fan-mini-bar ${idx <= bars ? "on" : ""}"></span>`,
          )}
        </span>
        ${label ? html`<span>${label}</span>` : nothing}
      </span>
    `;
  }

  private _renderQuickActions(live: NonNullable<RoomConfig["live"]>) {
    const l = this.hass.language;
    const isPaused = this.config?.climate_control_enabled === false;
    const canNudge = live.target_temp !== null || live.heat_target !== null;

    return html`
      <div class="quick-actions" @click=${(e: Event) => e.stopPropagation()}>
        <div class="quick-actions-left">
          ${
            canNudge
              ? html`
                  <div class="stepper-group">
                    <button
                      type="button"
                      class="stepper-btn"
                      aria-label=${localize("overview.action.decrease_target", l)}
                      title=${localize("overview.action.decrease_target", l)}
                      @click=${(e: Event) => this._onNudgeTarget(e, -1)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      class="stepper-btn"
                      aria-label=${localize("overview.action.increase_target", l)}
                      title=${localize("overview.action.increase_target", l)}
                      @click=${(e: Event) => this._onNudgeTarget(e, 1)}
                    >
                      +
                    </button>
                  </div>
                `
              : nothing
          }
          <button
            type="button"
            class="quick-btn ${isPaused ? "is-paused" : ""}"
            aria-label=${localize(
              isPaused ? "overview.action.resume_room" : "overview.action.pause_room",
              l,
            )}
            title=${localize(
              isPaused ? "overview.action.resume_room" : "overview.action.pause_room",
              l,
            )}
            @click=${this._onToggleRoomControl}
          >
            <ha-icon icon=${isPaused ? "mdi:play" : "mdi:pause"}></ha-icon>
          </button>
        </div>
        <div class="quick-actions-right">
          <button
            type="button"
            class="quick-btn"
            aria-label=${localize("overview.action.open_analytics", l)}
            title=${localize("overview.action.open_analytics", l)}
            @click=${this._onOpenAnalytics}
          >
            <ha-icon icon="mdi:chart-line"></ha-icon>
          </button>
          <ha-icon-button
            class="quick-hide-btn"
            .path=${mdiEyeOff}
            .label=${localize("panel.hide_room", l)}
            title=${localize("panel.hide_room", l)}
            aria-label=${localize("panel.hide_room", l)}
            @click=${this._onHideClick}
          ></ha-icon-button>
        </div>
      </div>
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

  private _renderUnitStrip() {
    if (!this.config || !this.hass) return nothing;
    const fleet = buildThermostatFleet(this.config, this.hass, this.compressorGroups);
    if (fleet.total < 2 && !fleet.hasConflict) return nothing;
    const u = tempUnit(this.hass);
    const visible = fleet.units.slice(0, 3);
    const extra = fleet.units.length - visible.length;

    return html`
      <div class="unit-strip">
        ${visible.map(
          (unit) => html`
            <span
              class="unit-pill"
              data-mode=${unit.hvacMode ?? "off"}
              data-conflict=${String(unit.hasConflict)}
            >
              <span class="unit-pill-name">${unit.name}</span>
              ${
                unit.setpointC != null
                  ? html`<span>${formatTemp(unit.setpointC, this.hass)}${u}</span>`
                  : nothing
              }
            </span>
          `,
        )}
        ${
          extra > 0
            ? html`<span class="unit-pill"
                >${localize("fleet.more_units", this.hass.language, { count: extra })}</span
              >`
            : nothing
        }
      </div>
    `;
  }

  private _renderDeltaChip(live: NonNullable<RoomConfig["live"]>) {
    const delta = getComfortDelta(live, this.config?.climate_mode ?? "auto");
    if (delta === null) return nothing;
    const absDelta = Math.abs(toDisplayDelta(delta, this.hass));
    if (absDelta < 0.2) {
      return html`<div class="delta-chip on-target">
        <ha-icon icon="mdi:check-circle-outline"></ha-icon>
        ${localize("card.delta_on_target", this.hass.language)}
      </div>`;
    }

    const key = delta > 0 ? "card.delta_above" : "card.delta_below";
    const icon = delta > 0 ? "mdi:thermometer-chevron-down" : "mdi:thermometer-chevron-up";
    return html`<div class="delta-chip ${delta > 0 ? "above" : "below"}">
      <ha-icon .icon=${icon}></ha-icon>
      ${localize(key, this.hass.language, {
        delta: absDelta.toFixed(1),
        unit: tempUnit(this.hass),
      })}
    </div>`;
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
              ${
                live.current_temp !== null
                  ? html`
                      <span class="current-temp">${formatTemp(live.current_temp, this.hass)}</span>
                      <span class="temp-unit">${tempUnit(this.hass)}</span>
                    `
                  : html`<span class="no-temp">--</span>`
              }
            </div>
          </div>
          <div class="metric-block">
            <span class="metric-label">${localize("card.humidity_label", this.hass.language)}</span>
            <div class="temp-value">
              ${
                live.current_humidity !== null
                  ? html`<span class="target-temp">${live.current_humidity.toFixed(0)}</span>
                      <span class="temp-unit">%</span>`
                  : html`<span class="no-temp">--</span>`
              }
            </div>
          </div>
        </div>
      </div>
      <div class="card-footer">
        <span class="humidity-info"></span>
        <span class="badge-row">
          ${
            isOutdoor
              ? html`<span class="outdoor-badge">
                  <ha-icon icon="mdi:tree"></ha-icon>
                  ${localize("card.outdoor", this.hass.language)}
                </span>`
              : nothing
          }
          ${
            live.mold_risk_level && live.mold_risk_level !== "ok"
              ? html`<span class="mold-badge ${live.mold_risk_level}">
                  <ha-icon icon="mdi:water-alert"></ha-icon>
                  ${
                    live.mold_risk_level === "critical"
                      ? localize("card.mold_critical", this.hass.language)
                      : localize("card.mold_warning", this.hass.language)
                  }
                </span>`
              : nothing
          }
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
        ${localize(ce !== 1 ? "card.climate_devices" : "card.climate_device", l)}${
          ts > 0
            ? ` \u00B7 ${ts} ${localize(ts !== 1 ? "card.temp_sensors" : "card.temp_sensor", l)}`
            : ""
        }
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

  private _onNudgeTarget(e: Event, direction: -1 | 1) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("room-nudge-target", {
        detail: { areaId: this.area.area_id, direction },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onToggleRoomControl(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("room-toggle-control", {
        detail: { areaId: this.area.area_id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onOpenAnalytics(e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("room-open-analytics", {
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
