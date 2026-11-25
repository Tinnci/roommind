/**
 * rs-sleep-bar – Sleep Tonight quick controls & dual-zone heated blanket / bed microclimate card.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HassArea, HomeAssistant, RoomConfig, SleepDeviceConfig } from "../types";
import { localize, type TranslationKey } from "../utils/localize";
import { buildSleepSafetyBadges, discoverSleepDeviceInArea } from "../utils/sleep-device";
import { tempUnit, toDisplayDelta } from "../utils/temperature";
import { roommindThemeStyles } from "../styles/theme-styles";

const GEARS = [0, 1, 2, 3, 4, 5, 6] as const;

@customElement("rs-sleep-bar")
export class RsSleepBar extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public area!: HassArea;
  @property({ attribute: false }) public config: RoomConfig | null = null;
  @property({ type: String }) public language = "en";

  @state() private _busy = false;
  @state() private _error = "";

  private _detectedDevice(): SleepDeviceConfig | null {
    if (!this.hass || !this.area || this.config?.sleep_device) return null;
    return discoverSleepDeviceInArea(this.area.area_id, this.hass);
  }

  override render() {
    if (!this.config || this.config.is_outdoor) return nothing;

    const l = this.language || this.hass?.language || "en";
    const live = this.config.live;
    const night = live?.night_mode;
    const sleepDevice = this.config.sleep_device ?? null;
    const sleepStatus = live?.sleep_device_status ?? null;
    const detected = this._detectedDevice();

    const hasQuietHours = Boolean(this.config.quiet_hours?.start && this.config.quiet_hours?.end);
    if (
      !hasQuietHours &&
      !sleepDevice &&
      !detected &&
      this.config.sleep_trigger_mode !== "entity"
    ) {
      return nothing;
    }

    const phase = night?.phase ?? (night?.active ? "sleep" : "day");
    const phaseKey: TranslationKey =
      phase === "pre_warm"
        ? "sleep.phase.pre_warm"
        : phase === "pre_wake"
          ? "sleep.phase.pre_wake"
          : phase === "sleep"
            ? "sleep.phase.sleep"
            : "sleep.phase.day";
    const triggerKey: TranslationKey =
      night?.trigger_source === "override"
        ? "sleep.trigger.override"
        : night?.trigger_source === "entity"
          ? "sleep.trigger.entity"
          : "sleep.trigger.clock";

    const tonightOverride = night?.tonight_override ?? null;
    const coupledActive = Boolean(night?.coupled_offset_active);
    const coupledDeltaC = this.config.sleep_coupled_offset_c ?? 0;
    const safetyBadges = buildSleepSafetyBadges(sleepStatus);

    return html`
      <ha-card class="sleep-card" data-phase=${phase}>
        <div class="sleep-header">
          <div class="sleep-title-group">
            <span class="sleep-icon" data-phase=${phase}>
              <ha-icon
                icon=${
                  phase === "pre_warm"
                    ? "mdi:fire"
                    : phase === "sleep"
                      ? "mdi:weather-night"
                      : phase === "pre_wake"
                        ? "mdi:weather-sunset-up"
                        : "mdi:bed-outline"
                }
              ></ha-icon>
            </span>
            <div class="sleep-titles">
              <div class="sleep-title-row">
                <h3 class="sleep-title">${localize("sleep.title", l)}</h3>
                <span class="phase-pill" data-phase=${phase}>${localize(phaseKey, l)}</span>
                ${
                  night?.trigger_source && night.trigger_source !== "none"
                    ? html`<span class="meta-pill">${localize(triggerKey, l)}</span>`
                    : nothing
                }
                ${
                  coupledActive && coupledDeltaC > 0
                    ? html`<span class="coupled-pill">
                        ${localize("sleep.coupled_active", l, {
                          delta: toDisplayDelta(coupledDeltaC, this.hass).toFixed(1),
                          unit: tempUnit(this.hass),
                        })}
                      </span>`
                    : nothing
                }
              </div>
            </div>
          </div>

          <div class="tonight-actions">
            <button
              type="button"
              class="action-pill ${tonightOverride === "pre_warm" ? "active warm" : ""}"
              ?disabled=${this._busy}
              @click=${() => this._runAction("pre_warm")}
            >
              <ha-icon icon="mdi:radiator"></ha-icon>
              <span>${localize("sleep.action.pre_warm", l)}</span>
            </button>
            <button
              type="button"
              class="action-pill ${tonightOverride === "sleep" ? "active" : ""}"
              ?disabled=${this._busy}
              @click=${() => this._runAction("sleep_now")}
            >
              <ha-icon icon="mdi:sleep"></ha-icon>
              <span>${localize("sleep.action.sleep_now", l)}</span>
            </button>
            <button
              type="button"
              class="action-pill ${tonightOverride === "skip" ? "active skip" : ""}"
              ?disabled=${this._busy}
              @click=${() => this._runAction("skip_tonight")}
            >
              <ha-icon icon="mdi:sleep-off"></ha-icon>
              <span>${localize("sleep.action.skip_tonight", l)}</span>
            </button>
            ${
              tonightOverride
                ? html`<button
                    type="button"
                    class="action-pill clear"
                    ?disabled=${this._busy}
                    @click=${() => this._runAction("clear")}
                  >
                    ${localize("sleep.action.clear_override", l)}
                  </button>`
                : nothing
            }
          </div>
        </div>

        ${
          detected && !sleepDevice
            ? html`
                <div class="discover-banner">
                  <div class="discover-copy">
                    <ha-icon icon="mdi:auto-fix"></ha-icon>
                    <span>${localize("sleep.link_banner", l)} (${detected.name})</span>
                  </div>
                  <button
                    type="button"
                    class="link-btn"
                    ?disabled=${this._busy}
                    @click=${() => this._linkDetected(detected)}
                  >
                    ${localize("sleep.link_btn", l)}
                  </button>
                </div>
              `
            : nothing
        }
        ${
          sleepDevice && sleepStatus
            ? html`
                <div class="blanket-strip">
                  <div class="blanket-top-row">
                    <div class="blanket-toggles">
                      ${
                        sleepDevice.power_entity
                          ? html`<button
                              type="button"
                              class="toggle-chip ${sleepStatus.power_on ? "on" : ""}"
                              ?disabled=${this._busy || !sleepStatus.remote_enabled}
                              @click=${() => this._runAction("toggle_power")}
                            >
                              <ha-icon icon="mdi:power"></ha-icon>
                              <span>${localize("sleep.action.power", l)}</span>
                            </button>`
                          : nothing
                      }
                      ${
                        sleepDevice.sleep_switch_entity
                          ? html`<button
                              type="button"
                              class="toggle-chip ${sleepStatus.sleep_switch_on ? "on accent" : ""}"
                              ?disabled=${this._busy || !sleepStatus.remote_enabled}
                              @click=${() => this._runAction("toggle_sleep_switch")}
                            >
                              <ha-icon icon="mdi:chart-bell-curve-cumulative"></ha-icon>
                              <span>${localize("sleep.action.sleep_switch", l)}</span>
                            </button>`
                          : nothing
                      }
                      ${
                        sleepDevice.zone_a_sleep_entity || sleepDevice.zone_b_sleep_entity
                          ? html`<button
                              type="button"
                              class="toggle-chip"
                              ?disabled=${this._busy || !sleepStatus.remote_enabled}
                              @click=${() =>
                                this._runAction("sync_curve", {
                                  zone_a_enabled: true,
                                  zone_b_enabled: true,
                                })}
                            >
                              <ha-icon icon="mdi:sync"></ha-icon>
                              <span>${localize("sleep.action.sync_curve", l)}</span>
                            </button>`
                          : nothing
                      }
                    </div>
                    ${
                      safetyBadges.length > 0
                        ? html`<div class="safety-row">
                            ${safetyBadges.map(
                              (b) => html`
                                <span class="safety-pill" data-tone=${b.tone}>
                                  <ha-icon .icon=${b.icon}></ha-icon>
                                  <span>${localize(b.key, l)}</span>
                                </span>
                              `,
                            )}
                          </div>`
                        : nothing
                    }
                  </div>

                  <div class="zones-grid">
                    ${this._renderZoneRow(
                      "A",
                      localize("sleep.zone_a", l),
                      sleepStatus.gear_a ?? 0,
                      sleepStatus.countdown_a ?? null,
                      sleepStatus.gear_b ?? 0,
                      sleepStatus.remote_enabled,
                      l,
                    )}
                    ${
                      sleepDevice.gears_entity || sleepDevice.zone_b_sleep_entity
                        ? this._renderZoneRow(
                            "B",
                            localize("sleep.zone_b", l),
                            sleepStatus.gear_b ?? 0,
                            sleepStatus.countdown_b ?? null,
                            sleepStatus.gear_a ?? 0,
                            sleepStatus.remote_enabled,
                            l,
                          )
                        : nothing
                    }
                  </div>
                </div>
              `
            : nothing
        }
        ${this._error ? html`<div class="error-line">${this._error}</div>` : nothing}
      </ha-card>
    `;
  }

  private _renderZoneRow(
    zone: "A" | "B",
    label: string,
    activeGear: number,
    countdownMin: number | null,
    otherGear: number,
    remoteEnabled: boolean,
    lang: string,
  ) {
    return html`
      <div class="zone-card">
        <div class="zone-head">
          <span class="zone-label">${label}</span>
          ${
            countdownMin != null && countdownMin > 0
              ? html`<span class="zone-cd"
                  >${localize("sleep.countdown", lang, { min: countdownMin })}</span
                >`
              : nothing
          }
        </div>
        <div class="gear-pills">
          ${GEARS.map((g) => {
            const selected = activeGear === g;
            return html`
              <button
                type="button"
                class="gear-pill ${selected ? "active" : ""} ${g === 0 ? "off" : ""}"
                ?disabled=${this._busy || !remoteEnabled}
                @click=${() =>
                  this._runAction(
                    "set_gears",
                    zone === "A"
                      ? { gear_a: g, gear_b: otherGear }
                      : { gear_a: otherGear, gear_b: g },
                  )}
              >
                ${g === 0 ? localize("sleep.gear_off", lang) : localize("sleep.gear_n", lang, { n: g })}
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }

  private async _runAction(action: string, extra: Record<string, unknown> = {}) {
    if (!this.hass || !this.area || this._busy) return;
    this._busy = true;
    this._error = "";
    try {
      const res = await this.hass.callWS<{ ok?: boolean; reason?: string }>({
        type: "roommind/sleep/action",
        area_id: this.area.area_id,
        action,
        ...extra,
      });
      if (res && res.ok === false && res.reason === "remote_disabled") {
        this._error = localize("sleep.safety.remote_disabled", this.language || this.hass.language);
      }
      this.dispatchEvent(new CustomEvent("room-updated", { bubbles: true, composed: true }));
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._busy = false;
    }
  }

  private _linkDetected(detected: SleepDeviceConfig) {
    this.dispatchEvent(
      new CustomEvent("sleep-device-linked", {
        detail: { sleepDevice: detected },
        bubbles: true,
        composed: true,
      }),
    );
  }

  static override styles = [
    roommindThemeStyles,
    css`
      :host {
        display: block;
      }

      .sleep-card {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 13px 16px;
        border-radius: var(--roommind-radius-card, 14px);
        border: var(--roommind-border-subtle);
        background: var(--roommind-surface);
        box-shadow: var(--roommind-shadow-card, none);
      }

      .sleep-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }

      .sleep-title-group {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .sleep-icon {
        width: 30px;
        height: 30px;
        border-radius: 9px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--roommind-primary-muted);
        color: var(--primary-color);
        --mdc-icon-size: 17px;
        flex: 0 0 auto;
      }

      .sleep-icon[data-phase="pre_warm"] {
        background: var(--roommind-warning-tint);
        color: var(--roommind-warning-color);
      }

      .sleep-icon[data-phase="sleep"] {
        background: var(--roommind-info-tint);
        color: var(--roommind-info-color);
      }

      .sleep-title-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      .sleep-title {
        margin: 0;
        font-size: 14px;
        font-weight: 650;
        color: var(--primary-text-color);
      }

      .phase-pill,
      .meta-pill,
      .coupled-pill {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 7px;
        background: var(--roommind-surface-muted);
        color: var(--secondary-text-color);
      }

      .phase-pill[data-phase="pre_warm"] {
        background: var(--roommind-warning-tint);
        color: var(--roommind-warning-color);
      }

      .phase-pill[data-phase="sleep"] {
        background: var(--roommind-info-tint);
        color: var(--roommind-info-color);
      }

      .phase-pill[data-phase="pre_wake"] {
        background: var(--roommind-success-tint);
        color: var(--roommind-success-color);
      }

      .coupled-pill {
        background: var(--roommind-success-tint);
        color: var(--roommind-success-color);
      }

      .tonight-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      .action-pill,
      .toggle-chip,
      .link-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 28px;
        padding: 0 10px;
        border-radius: 8px;
        border: var(--roommind-border-subtle);
        background: var(--roommind-surface-subtle);
        color: var(--primary-text-color);
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        --mdc-icon-size: 14px;
        transition: all 0.14s ease;
      }

      .action-pill:hover:not(:disabled),
      .toggle-chip:hover:not(:disabled),
      .link-btn:hover:not(:disabled) {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }

      .action-pill.active,
      .toggle-chip.on {
        border-color: var(--primary-color);
        background: var(--roommind-primary-muted);
        color: var(--primary-color);
      }

      .action-pill.active.warm {
        border-color: var(--roommind-warning-color);
        background: var(--roommind-warning-tint);
        color: var(--roommind-warning-color);
      }

      .action-pill.active.skip {
        border-color: var(--roommind-error-color);
        background: var(--roommind-error-tint);
        color: var(--roommind-error-color);
      }

      .discover-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
        padding: 9px 12px;
        border-radius: 10px;
        border: var(--roommind-primary-border);
        background: var(--roommind-primary-subtle);
      }

      .discover-copy {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 12.5px;
        font-weight: 600;
        color: var(--primary-text-color);
        --mdc-icon-size: 16px;
      }

      .discover-copy ha-icon {
        color: var(--primary-color);
      }

      .link-btn {
        background: var(--primary-color);
        color: var(--text-primary-color, #fff);
        border-color: var(--primary-color);
      }

      .link-btn:hover:not(:disabled) {
        color: var(--text-primary-color, #fff);
        filter: brightness(1.06);
      }

      .blanket-strip {
        display: grid;
        gap: 8px;
        padding-top: 8px;
        border-top: var(--roommind-border-faint);
      }

      .blanket-top-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }

      .blanket-toggles,
      .safety-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      .safety-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 6px;
        background: var(--roommind-surface-muted);
        color: var(--secondary-text-color);
        --mdc-icon-size: 13px;
      }

      .safety-pill[data-tone="ok"] {
        background: var(--roommind-success-tint);
        color: var(--roommind-success-color);
      }

      .safety-pill[data-tone="warning"] {
        background: var(--roommind-warning-tint);
        color: var(--roommind-warning-color);
      }

      .safety-pill[data-tone="error"] {
        background: var(--roommind-error-tint);
        color: var(--roommind-error-color);
      }

      .safety-pill[data-tone="info"] {
        background: var(--roommind-info-tint);
        color: var(--roommind-info-color);
      }

      .zones-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 8px;
      }

      .zone-card {
        display: grid;
        gap: 6px;
        padding: 8px 10px;
        border-radius: 9px;
        border: var(--roommind-border-faint);
        background: var(--roommind-surface-subtle);
      }

      .zone-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11.5px;
        font-weight: 650;
        color: var(--secondary-text-color);
      }

      .gear-pills {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }

      .gear-pill {
        min-width: 34px;
        height: 24px;
        padding: 0 7px;
        border-radius: 6px;
        border: var(--roommind-border-subtle);
        background: var(--roommind-surface);
        color: var(--secondary-text-color);
        font-family: inherit;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }

      .gear-pill.active {
        background: var(--roommind-warning-tint);
        border-color: var(--roommind-warning-color);
        color: var(--roommind-warning-color);
      }

      .gear-pill.active.off {
        background: var(--roommind-surface-muted);
        border-color: var(--secondary-text-color);
        color: var(--primary-text-color);
      }

      .error-line {
        font-size: 12px;
        color: var(--roommind-error-color);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-sleep-bar": RsSleepBar;
  }
}
