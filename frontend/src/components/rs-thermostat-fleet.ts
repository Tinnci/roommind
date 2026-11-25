import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { CompressorGroup, HomeAssistant, RoomConfig } from "../types";
import { openEntityInfo } from "../utils/events";
import { localize, type TranslationKey } from "../utils/localize";
import { formatTemp, tempUnit } from "../utils/temperature";
import {
  buildRoomFanCapabilities,
  fanSpeedBars,
  fanSpeedTone,
  formatFanModeLabel,
  type UnitFanControlModel,
} from "../utils/fan-control";
import { buildThermostatFleet, type ThermostatUnitStatus } from "../utils/thermostat-fleet";

const HA_MODE_KEYS: Record<string, TranslationKey> = {
  heat: "control.mode.heat",
  cool: "control.mode.cool",
  auto: "mode.auto",
  heat_cool: "mode.auto",
  dry: "control.mode.dry",
  fan_only: "mode.fan_only",
  off: "control.mode.off",
};

const FEEDBACK_KEYS: Record<NonNullable<ThermostatUnitStatus["feedback"]>, TranslationKey> = {
  sent: "control.feedback.sent",
  accepted: "control.feedback.accepted",
  confirmed: "control.feedback.confirmed",
  not_confirmed: "control.feedback.not_confirmed",
  skipped: "control.feedback.skipped",
  deferred: "control.feedback.deferred",
  failed: "control.feedback.failed",
  unsupported: "control.feedback.unsupported",
};

@customElement("rs-thermostat-fleet")
export class RsThermostatFleet extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config: RoomConfig | null = null;
  @property({ attribute: false }) public compressorGroups: CompressorGroup[] = [];

  @state() private _expandedUnits: Set<string> = new Set();
  @state() private _optimistic: Record<string, Record<string, unknown>> = {};
  @state() private _fanError = "";

  static override styles = css`
    :host {
      display: block;
    }

    .fleet-card {
      background: var(--roommind-surface, var(--card-background-color));
      border: var(--roommind-border-subtle, 1px solid var(--divider-color));
      border-radius: var(--roommind-radius-card, 12px);
      padding: 12px 16px;
    }

    .fleet-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }

    .fleet-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--primary-text-color);
    }

    .fleet-title ha-icon {
      --mdc-icon-size: 18px;
      color: var(--primary-color);
    }

    .header-badges {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 999px;
      background: var(--roommind-surface-muted, rgba(0, 0, 0, 0.06));
      color: var(--secondary-text-color);
    }

    .badge.conflict {
      background: var(--roommind-error-tint, rgba(244, 67, 54, 0.14));
      color: var(--roommind-error-color, #d32f2f);
    }

    .badge.compressor {
      background: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, transparent);
      color: var(--primary-color);
    }

    .empty {
      font-size: 13px;
      color: var(--secondary-text-color);
    }

    .unit-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
      gap: 8px;
    }

    .unit-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px;
      border-radius: var(--roommind-radius-control, 8px);
      background: var(--roommind-surface-subtle, rgba(0, 0, 0, 0.02));
      border: var(--roommind-border-faint, 1px solid rgba(0, 0, 0, 0.08));
      border-left: 3px solid var(--divider-color, rgba(0, 0, 0, 0.14));
      cursor: pointer;
      transition:
        border-color 0.18s ease,
        background 0.18s ease,
        transform 0.18s ease;
    }

    .unit-card:hover {
      border-color: rgba(var(--rgb-primary-color, 3, 169, 244), 0.35);
      transform: translateY(-1px);
    }

    .unit-card:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }

    .unit-card[data-mode="heat"] {
      border-left-color: var(--roommind-warning-color, #ff9800);
    }

    .unit-card[data-mode="cool"],
    .unit-card[data-mode="dry"] {
      border-left-color: var(--roommind-info-color, #2196f3);
    }

    .unit-card[data-mode="fan_only"] {
      border-left-color: var(--roommind-success-color, #26a69a);
    }

    .unit-card[data-conflict="true"] {
      border-left-color: var(--roommind-error-color, #f44336);
      background: color-mix(in srgb, var(--roommind-error-color, #f44336) 5%, transparent);
    }

    .unit-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }

    .unit-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--primary-text-color);
      line-height: 1.3;
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .unit-meta {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      flex-wrap: wrap;
    }

    .chip {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 6px;
      background: var(--roommind-surface-muted, rgba(0, 0, 0, 0.06));
      color: var(--secondary-text-color);
    }

    .chip.master {
      background: color-mix(in srgb, var(--roommind-warning-color, #ff9800) 15%, transparent);
      color: var(--roommind-warning-color, #ef6c00);
    }

    .unit-telemetry {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 10px;
    }

    .mode-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 999px;
      background: var(--roommind-surface-muted, rgba(0, 0, 0, 0.06));
      color: var(--secondary-text-color);
    }

    .mode-badge[data-mode="heat"] {
      background: var(--roommind-warning-tint, rgba(255, 152, 0, 0.14));
      color: var(--roommind-warning-color, #e65100);
    }

    .mode-badge[data-mode="cool"],
    .mode-badge[data-mode="dry"] {
      background: var(--roommind-info-tint, rgba(33, 150, 243, 0.14));
      color: var(--roommind-info-color, #1565c0);
    }

    .mode-badge[data-mode="fan_only"] {
      background: var(--roommind-success-tint, rgba(38, 166, 154, 0.14));
      color: var(--roommind-success-color, #00796b);
    }

    .setpoint-block {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .setpoint-label {
      font-size: 10px;
      color: var(--secondary-text-color);
    }

    .setpoint-value {
      font-size: 15px;
      font-weight: 700;
      color: var(--primary-text-color);
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
    }

    .unit-temp {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .unit-footer {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      align-items: center;
    }

    .chip.overdrive {
      background: color-mix(in srgb, var(--roommind-info-color, #2196f3) 12%, transparent);
      color: var(--roommind-info-color, #1565c0);
    }

    .chip.feedback-ok {
      background: var(--roommind-success-tint, rgba(76, 175, 80, 0.14));
      color: var(--roommind-success-color, #2e7d32);
    }

    .chip.feedback-bad {
      background: var(--roommind-error-tint, rgba(244, 67, 54, 0.14));
      color: var(--roommind-error-color, #c62828);
    }

    .diagnostic {
      font-size: 11px;
      color: var(--roommind-error-color, #c62828);
      line-height: 1.3;
    }

    .chip-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 6px;
      border: 1px solid color-mix(in srgb, var(--primary-color, #03a9f4) 28%, transparent);
      background: color-mix(in srgb, var(--primary-color, #03a9f4) 8%, transparent);
      color: var(--primary-color);
      cursor: pointer;
    }

    .chip-btn:hover {
      background: color-mix(in srgb, var(--primary-color, #03a9f4) 15%, transparent);
    }

    .chip-btn ha-icon {
      --mdc-icon-size: 13px;
    }

    .mini-bars {
      display: inline-flex;
      align-items: flex-end;
      gap: 1.5px;
      height: 10px;
    }

    .mini-bar {
      width: 2px;
      border-radius: 1px;
      background: currentColor;
      opacity: 0.25;
    }

    .mini-bar.on {
      opacity: 1;
    }

    .unit-drawer {
      margin-top: 4px;
      padding-top: 8px;
      border-top: var(--roommind-border-faint, 1px solid rgba(0, 0, 0, 0.08));
      display: grid;
      gap: 8px;
      cursor: default;
    }

    .drawer-group {
      display: grid;
      gap: 4px;
    }

    .drawer-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--secondary-text-color);
    }

    .pill-row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .option-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 6px;
      border: var(--roommind-border-faint, 1px solid rgba(0, 0, 0, 0.12));
      background: var(--roommind-surface, var(--card-background-color));
      color: var(--primary-text-color);
      font: inherit;
      font-size: 11.5px;
      font-weight: 600;
      cursor: pointer;
    }

    .option-pill:hover {
      border-color: var(--primary-color);
    }

    .option-pill[active] {
      border-color: var(--primary-color);
      background: color-mix(in srgb, var(--primary-color, #03a9f4) 14%, transparent);
      color: var(--primary-color);
    }

    .option-pill[active][data-tone="calm"] {
      border-color: var(--roommind-success-color, #26a69a);
      background: var(--roommind-success-tint, rgba(38, 166, 154, 0.14));
      color: var(--roommind-success-color, #00796b);
    }

    .option-pill[active][data-tone="strong"] {
      border-color: var(--roommind-warning-color, #ff9800);
      background: var(--roommind-warning-tint, rgba(255, 152, 0, 0.14));
      color: var(--roommind-warning-color, #ef6c00);
    }

    .standalone-fans-block {
      margin-top: 10px;
      padding-top: 10px;
      border-top: var(--roommind-border-faint, 1px solid rgba(0, 0, 0, 0.08));
      display: grid;
      gap: 8px;
    }

    .standalone-fans-block.no-top {
      margin-top: 0;
      padding-top: 0;
      border-top: none;
    }

    .standalone-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--secondary-text-color);
    }

    .standalone-title ha-icon {
      --mdc-icon-size: 15px;
      color: var(--primary-color);
    }

    .fan-card {
      padding: 10px 12px;
      border-radius: var(--roommind-radius-control, 8px);
      background: var(--roommind-surface-subtle, rgba(0, 0, 0, 0.02));
      border: var(--roommind-border-faint, 1px solid rgba(0, 0, 0, 0.08));
      border-left: 3px solid var(--divider-color, rgba(0, 0, 0, 0.14));
      display: grid;
      gap: 8px;
    }

    .fan-card[data-on="true"] {
      border-left-color: var(--roommind-success-color, #26a69a);
    }

    .fan-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .fan-slider-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .fan-range {
      flex: 1;
      min-width: 0;
      accent-color: var(--primary-color);
      cursor: pointer;
    }

    .fan-pct-readout {
      font-size: 12px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--primary-color);
      min-width: 34px;
      text-align: right;
    }

    .fan-error {
      margin-top: 6px;
      font-size: 12px;
      color: var(--roommind-error-color, #c62828);
    }

    @media (max-width: 600px) {
      .fleet-card {
        padding: 14px 14px;
      }
    }
  `;

  private _formatMode(mode: string | null): string {
    const l = this.hass.language;
    if (!mode) return localize("control.no_feedback", l);
    return HA_MODE_KEYS[mode] ? localize(HA_MODE_KEYS[mode], l) : mode;
  }

  private _formatSetpoint(unit: ThermostatUnitStatus): string {
    const u = tempUnit(this.hass);
    if (unit.setpointC != null) return `${formatTemp(unit.setpointC, this.hass)}${u}`;
    if (unit.setpointLowC != null && unit.setpointHighC != null) {
      return `${formatTemp(unit.setpointLowC, this.hass)}–${formatTemp(unit.setpointHighC, this.hass)}${u}`;
    }
    return "—";
  }

  private _formatDelta(deltaC: number): string {
    const u = tempUnit(this.hass);
    const val = this.hass.config?.unit_system?.temperature === "°F" ? (deltaC * 9) / 5 : deltaC;
    const sign = val > 0 ? "+" : "";
    return `${sign}${val.toFixed(1)}${u}`;
  }

  private _openUnit(entityId: string) {
    openEntityInfo(this, entityId);
  }

  private _onCardKeyDown(e: KeyboardEvent, entityId: string) {
    if ((e.target as HTMLElement)?.closest(".unit-drawer, .chip-btn, button, input")) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this._openUnit(entityId);
    }
  }

  private _toggleDrawer(e: Event, entityId: string) {
    e.stopPropagation();
    const next = new Set(this._expandedUnits);
    if (next.has(entityId)) next.delete(entityId);
    else next.add(entityId);
    this._expandedUnits = next;
  }

  private _optVal<T>(entityId: string, key: string, liveVal: T): T {
    const patch = this._optimistic[entityId];
    return patch && key in patch ? (patch[key] as T) : liveVal;
  }

  private async _sendUnitFanPatch(entityId: string, payload: Record<string, unknown>) {
    if (!this.config || !this.hass) return;
    this._fanError = "";
    this._optimistic = {
      ...this._optimistic,
      [entityId]: { ...(this._optimistic[entityId] ?? {}), ...payload },
    };
    try {
      await this.hass.callWS({
        type: "roommind/fan/set",
        area_id: this.config.area_id,
        entity_id: entityId,
        ...payload,
      });
      setTimeout(() => {
        const current = this._optimistic[entityId];
        if (!current) return;
        const nextPatch = { ...current };
        for (const key of Object.keys(payload)) {
          if (nextPatch[key] === payload[key]) delete nextPatch[key];
        }
        const rest = { ...this._optimistic };
        if (Object.keys(nextPatch).length === 0) delete rest[entityId];
        else rest[entityId] = nextPatch;
        this._optimistic = rest;
      }, 2000);
    } catch {
      this._fanError = localize("fan.error_set", this.hass.language);
      const rest = { ...this._optimistic };
      delete rest[entityId];
      this._optimistic = rest;
    }
  }

  private _renderMiniBars(modeOrPct: string | number | null | undefined, allModes?: string[]) {
    const bars = fanSpeedBars(modeOrPct, allModes);
    const heights = [4, 6, 8, 9, 10];
    return html`
      <span class="mini-bars" aria-hidden="true">
        ${heights.map(
          (h, idx) =>
            html`<span class="mini-bar ${idx < bars ? "on" : ""}" style="height:${h}px"></span>`,
        )}
      </span>
    `;
  }

  override render() {
    if (!this.config || this.config.is_outdoor || !this.hass) return nothing;
    const l = this.hass.language;
    const fleet = buildThermostatFleet(this.config, this.hass, this.compressorGroups);
    const fanCaps = buildRoomFanCapabilities(this.config, this.hass);
    const u = tempUnit(this.hass);

    return html`
      <section class="fleet-card">
        <div class="fleet-header">
          <div class="fleet-title">
            <ha-icon icon="mdi:hvac"></ha-icon>
            <span>${localize("fleet.title", l)}</span>
          </div>
          <div class="header-badges">
            ${
              fleet.total > 0
                ? html`<span class="badge">
                    ${localize("fleet.active_count", l, {
                      active: fleet.active,
                      total: fleet.total,
                    })}
                  </span>`
                : nothing
            }
            ${fleet.sharedCompressorGroups.map(
              (groupName) =>
                html`<span class="badge compressor"
                  >${localize("fleet.compressor_group", l, { name: groupName })}</span
                >`,
            )}
            ${
              fleet.hasConflict
                ? html`<span class="badge conflict">${localize("fleet.conflict", l)}</span>`
                : nothing
            }
          </div>
        </div>

        ${
          fleet.total === 0 && fanCaps.standaloneFans.length === 0
            ? html`<div class="empty">${localize("fleet.no_units", l)}</div>`
            : nothing
        }
        ${
          fleet.total > 0
            ? html`
                <div class="unit-grid">
                  ${fleet.units.map((unit) => {
                    const isBadFeedback =
                      unit.feedback === "failed" ||
                      unit.feedback === "not_confirmed" ||
                      unit.feedback === "unsupported";
                    const liveFanMode = this._optVal(unit.entityId, "fan_mode", unit.fanMode);
                    const liveSwing = this._optVal(unit.entityId, "swing_mode", unit.swingMode);
                    const liveHSwing = this._optVal(
                      unit.entityId,
                      "swing_horizontal_mode",
                      unit.swingHorizontalMode,
                    );
                    const livePreset = this._optVal(unit.entityId, "preset_mode", unit.presetMode);
                    const hasUnitAirflow =
                      unit.fanModes.length > 0 ||
                      unit.swingModes.length > 0 ||
                      unit.swingHorizontalModes.length > 0 ||
                      unit.presetModes.length > 0;
                    const expanded = this._expandedUnits.has(unit.entityId);

                    return html`
                      <div
                        class="unit-card"
                        role="button"
                        tabindex="0"
                        data-mode=${unit.hvacMode ?? "off"}
                        data-conflict=${String(unit.hasConflict)}
                        aria-label="${unit.name} · ${localize("fleet.open_device", l)}"
                        @click=${(e: Event) => {
                          if ((e.target as HTMLElement)?.closest(".unit-drawer, .chip-btn")) return;
                          this._openUnit(unit.entityId);
                        }}
                        @keydown=${(e: KeyboardEvent) => this._onCardKeyDown(e, unit.entityId)}
                      >
                        <div class="unit-top">
                          <div class="unit-name">${unit.name}</div>
                          <div class="unit-meta">
                            <span class="chip">
                              ${localize(unit.type === "ac" ? "fleet.type.ac" : "fleet.type.trv", l)}
                            </span>
                            ${
                              unit.role !== "auto"
                                ? html`<span class="chip">
                                    ${localize(
                                      unit.role === "primary"
                                        ? "fleet.role.primary"
                                        : "fleet.role.secondary",
                                      l,
                                    )}
                                  </span>`
                                : nothing
                            }
                            ${
                              unit.isMaster
                                ? html`<span class="chip master"
                                    >${localize("fleet.master", l)}</span
                                  >`
                                : nothing
                            }
                          </div>
                        </div>

                        <div class="unit-telemetry">
                          <span class="mode-badge" data-mode=${unit.hvacMode ?? "off"}>
                            ${this._formatMode(unit.hvacMode)}
                          </span>
                          <div class="setpoint-block">
                            <span class="setpoint-label">${localize("fleet.setpoint", l)}</span>
                            <span class="setpoint-value">${this._formatSetpoint(unit)}</span>
                          </div>
                          ${
                            unit.unitTempC != null
                              ? html`
                                  <div class="unit-temp">
                                    <div class="setpoint-label">
                                      ${localize("fleet.room_temp", l)}
                                    </div>
                                    <div class="setpoint-value">
                                      ${formatTemp(unit.unitTempC, this.hass)}${u}
                                    </div>
                                  </div>
                                `
                              : nothing
                          }
                        </div>

                        <div class="unit-footer">
                          ${
                            hasUnitAirflow
                              ? html`
                                  <button
                                    type="button"
                                    class="chip-btn"
                                    aria-expanded=${expanded}
                                    title=${localize("fan.controls_toggle", l)}
                                    @click=${(e: Event) => this._toggleDrawer(e, unit.entityId)}
                                  >
                                    ${this._renderMiniBars(liveFanMode, unit.fanModes)}
                                    <span
                                      >${localize("fleet.fan", l)}:
                                      ${
                                        liveFanMode
                                          ? formatFanModeLabel(liveFanMode, l)
                                          : localize("fan.controls_toggle", l)
                                      }</span
                                    >
                                    <ha-icon
                                      icon=${expanded ? "mdi:chevron-up" : "mdi:chevron-down"}
                                    ></ha-icon>
                                  </button>
                                `
                              : liveFanMode
                                ? html`<span class="chip"
                                    >${localize("fleet.fan", l)}: ${liveFanMode}</span
                                  >`
                                : nothing
                          }
                          ${
                            unit.overdriveDeltaC != null
                              ? html`<span class="chip overdrive">
                                  ${localize("fleet.overdrive", l, {
                                    offset: this._formatDelta(unit.overdriveDeltaC),
                                  })}
                                </span>`
                              : nothing
                          }
                          ${
                            unit.feedback
                              ? html`<span
                                  class="chip ${
                                    isBadFeedback
                                      ? "feedback-bad"
                                      : unit.feedback === "confirmed" ||
                                          unit.feedback === "accepted"
                                        ? "feedback-ok"
                                        : ""
                                  }"
                                >
                                  ${localize(FEEDBACK_KEYS[unit.feedback], l)}
                                </span>`
                              : nothing
                          }
                        </div>

                        ${
                          expanded && hasUnitAirflow
                            ? this._renderClimateDrawer(
                                unit,
                                liveFanMode,
                                liveSwing,
                                liveHSwing,
                                livePreset,
                                l,
                              )
                            : nothing
                        }
                        ${
                          unit.diagnostic && isBadFeedback
                            ? html`<div class="diagnostic">${unit.diagnostic}</div>`
                            : nothing
                        }
                      </div>
                    `;
                  })}
                </div>
              `
            : nothing
        }
        ${
          fanCaps.standaloneFans.length > 0
            ? html`
                <div class="standalone-fans-block ${fleet.total === 0 ? "no-top" : ""}">
                  <div class="standalone-title">
                    <ha-icon icon="mdi:fan"></ha-icon>
                    <span>${localize("fan.standalone_fans", l)}</span>
                  </div>
                  <div class="unit-grid">
                    ${fanCaps.standaloneFans.map((fan) => this._renderStandaloneFan(fan, l))}
                  </div>
                </div>
              `
            : nothing
        }
        ${this._fanError ? html`<div class="fan-error">${this._fanError}</div>` : nothing}
      </section>
    `;
  }

  private _renderClimateDrawer(
    unit: ThermostatUnitStatus,
    liveFan: string | null,
    liveSwing: string | null,
    liveHSwing: string | null,
    livePreset: string | null,
    l: string,
  ) {
    return html`
      <div class="unit-drawer" @click=${(e: Event) => e.stopPropagation()}>
        ${
          unit.fanModes.length > 0
            ? html`
                <div class="drawer-group">
                  <span class="drawer-label">${localize("fan.label", l)}</span>
                  <div class="pill-row">
                    ${unit.fanModes.map(
                      (mode) => html`
                        <button
                          type="button"
                          class="option-pill"
                          data-tone=${fanSpeedTone(mode)}
                          ?active=${liveFan === mode}
                          @click=${() => this._sendUnitFanPatch(unit.entityId, { fan_mode: mode })}
                        >
                          ${this._renderMiniBars(mode, unit.fanModes)}
                          <span>${formatFanModeLabel(mode, l)}</span>
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
            : nothing
        }
        ${
          unit.swingModes.length > 0
            ? html`
                <div class="drawer-group">
                  <span class="drawer-label">${localize("fan.swing", l)}</span>
                  <div class="pill-row">
                    ${unit.swingModes.map(
                      (mode) => html`
                        <button
                          type="button"
                          class="option-pill"
                          ?active=${liveSwing === mode}
                          @click=${() =>
                            this._sendUnitFanPatch(unit.entityId, { swing_mode: mode })}
                        >
                          ${formatFanModeLabel(mode, l)}
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
            : nothing
        }
        ${
          unit.swingHorizontalModes.length > 0
            ? html`
                <div class="drawer-group">
                  <span class="drawer-label">${localize("fan.swing_horizontal", l)}</span>
                  <div class="pill-row">
                    ${unit.swingHorizontalModes.map(
                      (mode) => html`
                        <button
                          type="button"
                          class="option-pill"
                          ?active=${liveHSwing === mode}
                          @click=${() =>
                            this._sendUnitFanPatch(unit.entityId, { swing_horizontal_mode: mode })}
                        >
                          ${formatFanModeLabel(mode, l)}
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
            : nothing
        }
        ${
          unit.presetModes.length > 0
            ? html`
                <div class="drawer-group">
                  <span class="drawer-label">${localize("fan.preset", l)}</span>
                  <div class="pill-row">
                    ${unit.presetModes.map(
                      (mode) => html`
                        <button
                          type="button"
                          class="option-pill"
                          ?active=${livePreset === mode}
                          @click=${() =>
                            this._sendUnitFanPatch(unit.entityId, { preset_mode: mode })}
                        >
                          ${formatFanModeLabel(mode, l)}
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
            : nothing
        }
      </div>
    `;
  }

  private _renderStandaloneFan(fan: UnitFanControlModel, l: string) {
    const isOn = this._optVal(fan.entityId, "turn_on", fan.isOn);
    const pct = this._optVal(fan.entityId, "percentage", fan.percentage ?? (isOn ? 50 : 0));
    const preset = this._optVal(fan.entityId, "preset_mode", fan.presetMode);
    const osc = this._optVal(fan.entityId, "oscillating", fan.oscillating ?? false);
    const dir = this._optVal(fan.entityId, "direction", fan.direction ?? "forward");

    return html`
      <div class="fan-card" data-on=${String(isOn)}>
        <div class="fan-head">
          <button
            type="button"
            class="unit-name"
            style="background:none;border:0;padding:0;text-align:left;cursor:pointer;"
            @click=${() => this._openUnit(fan.entityId)}
          >
            ${fan.name}
          </button>
          <button
            type="button"
            class="option-pill"
            data-tone="calm"
            ?active=${isOn}
            @click=${() =>
              this._sendUnitFanPatch(fan.entityId, {
                turn_on: !isOn,
                ...(isOn ? { percentage: 0 } : {}),
              })}
          >
            ${localize(isOn ? "airflow.on" : "fan.off", l)}
          </button>
        </div>

        ${
          fan.supportsSetSpeed
            ? html`
                <div class="drawer-group">
                  <div class="fan-slider-row">
                    <input
                      class="fan-range"
                      type="range"
                      min="0"
                      max="100"
                      step=${fan.percentageStep}
                      .value=${String(isOn ? pct : 0)}
                      aria-label=${fan.name}
                      @change=${(e: Event) => {
                        const val = Number((e.target as HTMLInputElement).value);
                        void this._sendUnitFanPatch(fan.entityId, {
                          percentage: val,
                          turn_on: val > 0,
                        });
                      }}
                    />
                    <span class="fan-pct-readout"
                      >${localize("fan.speed_pct", l, { value: isOn ? pct : 0 })}</span
                    >
                  </div>
                  <div class="pill-row">
                    ${[25, 50, 75, 100].map(
                      (stepPct) => html`
                        <button
                          type="button"
                          class="option-pill"
                          data-tone=${fanSpeedTone(stepPct)}
                          ?active=${isOn && Math.abs(pct - stepPct) <= 5}
                          @click=${() =>
                            this._sendUnitFanPatch(fan.entityId, {
                              percentage: stepPct,
                              turn_on: true,
                            })}
                        >
                          ${localize("fan.speed_pct", l, { value: stepPct })}
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
            : nothing
        }
        ${
          fan.presetModes.length > 0
            ? html`
                <div class="drawer-group">
                  <span class="drawer-label">${localize("fan.preset", l)}</span>
                  <div class="pill-row">
                    ${fan.presetModes.map(
                      (mode) => html`
                        <button
                          type="button"
                          class="option-pill"
                          ?active=${preset === mode}
                          @click=${() =>
                            this._sendUnitFanPatch(fan.entityId, {
                              preset_mode: mode,
                              turn_on: true,
                            })}
                        >
                          ${formatFanModeLabel(mode, l)}
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
            : nothing
        }
        ${
          fan.supportsOscillate || fan.supportsDirection
            ? html`
                <div class="pill-row">
                  ${
                    fan.supportsOscillate
                      ? html`
                          <button
                            type="button"
                            class="option-pill"
                            ?active=${Boolean(osc)}
                            @click=${() =>
                              this._sendUnitFanPatch(fan.entityId, { oscillating: !osc })}
                          >
                            ${localize("fan.oscillate", l)}
                          </button>
                        `
                      : nothing
                  }
                  ${
                    fan.supportsDirection
                      ? html`
                          <button
                            type="button"
                            class="option-pill"
                            ?active=${dir === "reverse"}
                            @click=${() =>
                              this._sendUnitFanPatch(fan.entityId, {
                                direction: dir === "forward" ? "reverse" : "forward",
                              })}
                          >
                            ${localize(
                              dir === "reverse" ? "fan.direction_reverse" : "fan.direction_forward",
                              l,
                            )}
                          </button>
                        `
                      : nothing
                  }
                </div>
              `
            : nothing
        }
      </div>
    `;
  }
}
