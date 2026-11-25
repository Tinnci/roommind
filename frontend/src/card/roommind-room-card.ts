import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, RoomConfig } from "../types";
import { localize, type TranslationKey } from "../utils/localize";
import { getModeClass, resolveRoomModePresentation } from "../utils/room-state";
import { hasClimateDevice, isRoomControlEffective } from "../utils/room-overview-status";
import { assessRoomComfort, calculateDewPointC } from "../utils/environment-monitor";
import { formatTemp, tempStep, tempUnit, toDisplay, toCelsiusDelta } from "../utils/temperature";
import { modeStyles } from "../styles/shared-mode-styles";
import { roommindThemeStyles } from "../styles/theme-styles";
import { refreshRooms, setFeedHass, subscribeRooms, type RoomsSnapshot } from "./rooms-feed";

export interface RoomMindCardConfig {
  type?: string;
  area_id?: string;
  room?: string;
}

@customElement("roommind-room-card")
export class RoomMindRoomCard extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config: RoomMindCardConfig = {};
  @state() private _snapshot: RoomsSnapshot | null = null;
  @state() private _busy = false;
  private _unsub: (() => void) | null = null;

  public setConfig(config: RoomMindCardConfig): void {
    this._config = config ?? {};
  }

  public static getConfigElement(): HTMLElement {
    return document.createElement("roommind-room-card-editor");
  }

  public static getStubConfig(): RoomMindCardConfig {
    return { type: "custom:roommind-room-card", area_id: "" };
  }

  public getCardSize(): number {
    return 3;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hass) setFeedHass(this.hass);
    this._unsub = subscribeRooms((snap) => {
      this._snapshot = snap;
    });
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("hass") && this.hass) {
      setFeedHass(this.hass);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsub?.();
    this._unsub = null;
  }

  private get _areaId(): string {
    return this._config.area_id || this._config.room || "";
  }

  private async _nudgeTarget(deltaC: number, room: RoomConfig): Promise<void> {
    if (!this.hass?.callWS || this._busy) return;
    const live = room.live;
    const base =
      live?.override_active && live.override_temp != null
        ? live.override_temp
        : (live?.target_temp ??
          live?.heat_target ??
          live?.cool_target ??
          live?.current_temp ??
          22.0);
    const next = Math.max(5, Math.min(35, Math.round((base + deltaC) * 10) / 10));
    this._busy = true;
    try {
      await this.hass.callWS({
        type: "roommind/override/set",
        area_id: this._areaId,
        temperature: next,
        duration_hours: 2,
      });
      await refreshRooms();
    } finally {
      this._busy = false;
    }
  }

  private async _clearOverride(): Promise<void> {
    if (!this.hass?.callWS || this._busy) return;
    this._busy = true;
    try {
      await this.hass.callWS({
        type: "roommind/override/clear",
        area_id: this._areaId,
      });
      await refreshRooms();
    } finally {
      this._busy = false;
    }
  }

  private async _toggleClimateControl(room: RoomConfig): Promise<void> {
    if (!this.hass?.callWS || this._busy) return;
    this._busy = true;
    try {
      await this.hass.callWS({
        type: "roommind/rooms/save",
        area_id: this._areaId,
        climate_control_enabled: room.climate_control_enabled === false,
      });
      await refreshRooms();
    } finally {
      this._busy = false;
    }
  }

  override render() {
    const l = this.hass?.language ?? "en";
    const areaId = this._areaId;
    if (!areaId) {
      return html`<ha-card
        ><div class="card-empty">${localize("roomcard.select_room", l)}</div></ha-card
      >`;
    }
    const room = this._snapshot?.rooms?.[areaId];
    if (!room) {
      return html`<ha-card><div class="card-empty">${localize("panel.loading", l)}</div></ha-card>`;
    }

    const live = room.live;
    const isMonitorOnly = !room.is_outdoor && !hasClimateDevice(room);
    const areaName = room.display_name || this.hass?.areas?.[areaId]?.name || areaId;
    const modeInfo = resolveRoomModePresentation(live, room);
    const controlActive = isRoomControlEffective(
      room,
      this._snapshot?.climate_control_active ?? true,
    );
    const targetTemp =
      live?.override_active && live.override_temp != null ? live.override_temp : live?.target_temp;
    const step = toCelsiusDelta(parseFloat(tempStep(this.hass)) || 0.5, this.hass);
    const comfort = assessRoomComfort(
      live?.current_temp ?? null,
      live?.current_humidity ?? null,
      live?.mold_risk_level,
    );
    const dewPoint = calculateDewPointC(live?.current_temp ?? null, live?.current_humidity ?? null);
    const showComfortPill =
      comfort !== null &&
      (isMonitorOnly || comfort.tone === "warning" || comfort.tone === "critical");
    const aqChips = [
      live?.co2 != null ? `CO₂ ${Math.round(live.co2)} ppm` : "",
      live?.pm25 != null ? `PM2.5 ${live.pm25.toFixed(1)}` : "",
      live?.voc != null ? `VOC ${Math.round(live.voc)}` : "",
    ];
    const footerChips = [
      dewPoint !== null
        ? localize("card.dew_point_short", l, {
            value: formatTemp(dewPoint, this.hass),
            unit: tempUnit(this.hass),
          })
        : "",
      ...aqChips,
    ].filter(Boolean);

    return html`
      <ha-card>
        <div class="card-head">
          <div class="card-title-col">
            <div class="card-name">${areaName}</div>
            <div class="card-badges">
              ${
                isMonitorOnly
                  ? html`<span class="mode-pill mode-monitoring">
                      <span class="mode-dot"></span>
                      ${localize("room.control_mode.monitor_only", l)}
                    </span>`
                  : html`<span class="mode-pill ${getModeClass(modeInfo.mode)}">
                      <span class="mode-dot"></span>
                      ${localize(modeInfo.labelKey as TranslationKey, l)}
                    </span>`
              }
              ${
                showComfortPill
                  ? html`<span class="status-pill" data-tone=${comfort.tone}>
                      ${localize(comfort.labelKey, l)}
                    </span>`
                  : nothing
              }
              ${
                live?.window_open
                  ? html`<span class="status-pill warn">${localize("card.window_open", l)}</span>`
                  : nothing
              }
              ${
                live?.air_quality_bad
                  ? html`<span class="status-pill warn"
                      >${localize("hero.air_quality_bad", l, {
                        reason: (live.air_quality_reason ?? "AQ").toUpperCase(),
                      })}</span
                    >`
                  : nothing
              }
            </div>
          </div>
          ${
            !isMonitorOnly && !room.is_outdoor
              ? html`<ha-switch
                  .checked=${room.climate_control_enabled !== false}
                  .disabled=${this._busy}
                  @change=${() => this._toggleClimateControl(room)}
                ></ha-switch>`
              : nothing
          }
        </div>

        <div class="card-metrics">
          <div class="metric-main">
            <span class="metric-val">
              ${
                live?.current_temp != null
                  ? `${formatTemp(live.current_temp, this.hass)}${tempUnit(this.hass)}`
                  : "--"
              }
            </span>
            ${
              live?.current_humidity != null
                ? html`<span class="metric-sub">${live.current_humidity.toFixed(0)}% RH</span>`
                : nothing
            }
          </div>

          ${
            !isMonitorOnly && !room.is_outdoor && controlActive
              ? html`
                  <div class="target-controls">
                    <button
                      type="button"
                      class="step-btn"
                      ?disabled=${this._busy}
                      @click=${() => this._nudgeTarget(-step, room)}
                    >
                      −
                    </button>
                    <div class="target-readout">
                      <span class="target-val">
                        ${
                          targetTemp != null
                            ? `${toDisplay(targetTemp, this.hass).toFixed(1)}${tempUnit(this.hass)}`
                            : "--"
                        }
                      </span>
                      ${
                        live?.override_active
                          ? html`<button
                              type="button"
                              class="override-clear"
                              @click=${this._clearOverride}
                            >
                              ${localize("roomcard.clear_override", l)}
                            </button>`
                          : nothing
                      }
                    </div>
                    <button
                      type="button"
                      class="step-btn"
                      ?disabled=${this._busy}
                      @click=${() => this._nudgeTarget(step, room)}
                    >
                      +
                    </button>
                  </div>
                `
              : nothing
          }
        </div>

        ${
          footerChips.length > 0
            ? html`<div class="card-footer">${footerChips.join(" · ")}</div>`
            : nothing
        }
      </ha-card>
    `;
  }

  static override styles = [
    roommindThemeStyles,
    modeStyles,
    css`
      :host {
        display: block;
      }
      ha-card {
        padding: 14px 16px;
        border-radius: var(--ha-card-border-radius, 12px);
      }
      .card-empty {
        padding: 16px;
        color: var(--secondary-text-color);
        text-align: center;
      }
      .card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .card-name {
        font-size: 15px;
        font-weight: 600;
        color: var(--primary-text-color);
      }
      .card-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 4px;
      }
      .status-pill {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 999px;
      }
      .status-pill.warn,
      .status-pill[data-tone="warning"] {
        background: var(--roommind-warning-tint, rgba(255, 152, 0, 0.16));
        color: var(--warning-color, #ed6c02);
      }
      .status-pill[data-tone="success"] {
        background: var(--roommind-success-tint, rgba(76, 175, 80, 0.14));
        color: var(--roommind-success-color, #4caf50);
      }
      .status-pill[data-tone="info"] {
        background: var(--roommind-info-tint, rgba(33, 150, 243, 0.14));
        color: var(--roommind-info-color, #2196f3);
      }
      .status-pill[data-tone="critical"] {
        background: var(--roommind-error-tint, rgba(244, 67, 54, 0.14));
        color: var(--error-color, #f44336);
      }
      .card-metrics {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 12px;
      }
      .metric-main {
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .metric-val {
        font-size: 24px;
        font-weight: 650;
        font-variant-numeric: tabular-nums;
      }
      .metric-sub {
        font-size: 12.5px;
        color: var(--secondary-text-color);
      }
      .target-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .step-btn {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.14));
        background: var(--secondary-background-color, transparent);
        color: var(--primary-text-color);
        font-size: 16px;
        cursor: pointer;
      }
      .target-readout {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 56px;
      }
      .target-val {
        font-size: 14px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .override-clear {
        background: none;
        border: none;
        padding: 0;
        color: var(--primary-color);
        font-size: 11px;
        cursor: pointer;
      }
      .card-footer {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
        font-size: 12px;
        color: var(--secondary-text-color);
      }
    `,
  ];
}

@customElement("roommind-room-card-editor")
export class RoomMindRoomCardEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @state() private _config: RoomMindCardConfig = {};

  public setConfig(config: RoomMindCardConfig): void {
    this._config = config ?? {};
  }

  override render() {
    const l = this.hass?.language ?? "en";
    const areas = Object.values(this.hass?.areas ?? {});
    const selected = this._config.area_id || this._config.room || "";

    return html`
      <div style="display: flex; flex-direction: column; gap: 12px; padding: 8px 0">
        <label style="font-size: 13px; font-weight: 500"
          >${localize("roomcard.select_room", l)}</label
        >
        <select
          style="padding: 8px; border-radius: 6px; border: 1px solid var(--divider-color, #ccc)"
          .value=${selected}
          @change=${(e: Event) => {
            const area_id = (e.target as HTMLSelectElement).value;
            this.dispatchEvent(
              new CustomEvent("config-changed", {
                detail: { config: { ...this._config, area_id } },
                bubbles: true,
                composed: true,
              }),
            );
          }}
        >
          <option value="">--</option>
          ${areas.map((a) => html`<option value=${a.area_id} ?selected=${a.area_id === selected}>${a.name}</option>`)}
        </select>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "roommind-room-card": RoomMindRoomCard;
    "roommind-room-card-editor": RoomMindRoomCardEditor;
  }
}
