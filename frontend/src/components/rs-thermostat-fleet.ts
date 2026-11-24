import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { CompressorGroup, HomeAssistant, RoomConfig } from "../types";
import { openEntityInfo } from "../utils/events";
import { localize, type TranslationKey } from "../utils/localize";
import { formatTemp, tempUnit } from "../utils/temperature";
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

  static override styles = css`
    :host {
      display: block;
    }

    .fleet-card {
      background: var(--roommind-surface, var(--card-background-color));
      border: var(--roommind-border-subtle, 1px solid var(--divider-color));
      border-radius: var(--roommind-radius-card, 16px);
      padding: 18px 20px;
    }

    .fleet-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 14px;
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
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 250px), 1fr));
      gap: 12px;
    }

    .unit-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 13px 14px;
      border-radius: var(--roommind-radius-control, 12px);
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
      font-size: 16px;
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
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this._openUnit(entityId);
    }
  }

  override render() {
    if (!this.config || this.config.is_outdoor || !this.hass) return nothing;
    const l = this.hass.language;
    const fleet = buildThermostatFleet(this.config, this.hass, this.compressorGroups);
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
          fleet.total === 0
            ? html`<div class="empty">${localize("fleet.no_units", l)}</div>`
            : html`
                <div class="unit-grid">
                  ${fleet.units.map((unit) => {
                    const isBadFeedback =
                      unit.feedback === "failed" ||
                      unit.feedback === "not_confirmed" ||
                      unit.feedback === "unsupported";
                    return html`
                      <div
                        class="unit-card"
                        role="button"
                        tabindex="0"
                        data-mode=${unit.hvacMode ?? "off"}
                        data-conflict=${String(unit.hasConflict)}
                        aria-label="${unit.name} · ${localize("fleet.open_device", l)}"
                        @click=${() => this._openUnit(unit.entityId)}
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
                            unit.fanMode
                              ? html`<span class="chip"
                                  >${localize("fleet.fan", l)}: ${unit.fanMode}</span
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
                          unit.diagnostic && isBadFeedback
                            ? html`<div class="diagnostic">${unit.diagnostic}</div>`
                            : nothing
                        }
                      </div>
                    `;
                  })}
                </div>
              `
        }
      </section>
    `;
  }
}
