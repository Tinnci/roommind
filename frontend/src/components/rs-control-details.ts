import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import type { DeviceActuationStatus, DeviceObservation, HomeAssistant, RoomConfig } from "../types";
import { actuationFeedback, nightControlFeedback } from "../utils/actuation-status";
import { openEntityInfo } from "../utils/events";
import { localize, type TranslationKey } from "../utils/localize";
import { formatMode } from "../utils/room-state";
import { formatTemp, tempUnit } from "../utils/temperature";

const feedbackKeys: Record<ReturnType<typeof nightControlFeedback>, TranslationKey> = {
  sent: "control.feedback.sent",
  accepted: "control.feedback.accepted",
  confirmed: "control.feedback.confirmed",
  not_confirmed: "control.feedback.not_confirmed",
  skipped: "control.feedback.skipped",
  deferred: "control.feedback.deferred",
  failed: "control.feedback.failed",
  unsupported: "control.feedback.unsupported",
  observed: "control.night_observed",
  unknown: "control.no_feedback",
};

const modeKeys: Record<string, TranslationKey> = {
  heat: "control.mode.heat",
  cool: "control.mode.cool",
  auto: "mode.auto",
  heat_cool: "mode.auto",
  off: "control.mode.off",
  fan_only: "mode.fan_only",
  dry: "control.mode.dry",
};

@customElement("rs-control-details")
export class RsControlDetails extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config: RoomConfig | null = null;
  @property({ type: Boolean }) public controlEnabled = true;
  @state() private _expanded = false;

  static override styles = css`
    :host {
      display: block;
    }
    details {
      border: var(--roommind-border-subtle, 1px solid var(--divider-color));
      border-radius: var(--roommind-radius-card);
      background: var(--card-background-color);
    }
    summary {
      cursor: pointer;
      padding: 18px 24px;
      color: var(--primary-text-color);
      font-weight: 600;
    }
    summary:focus-visible,
    button:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }
    .summary-status {
      display: inline;
      margin-left: 10px;
      font-size: 12px;
      font-weight: 400;
      color: var(--secondary-text-color);
    }
    .body {
      padding: 0 24px 24px;
    }
    p,
    .source {
      color: var(--secondary-text-color);
      font-size: 13px;
      line-height: 1.5;
      margin: 0 0 12px;
    }
    .request {
      margin-bottom: 14px;
      font-size: 14px;
      color: var(--primary-text-color);
    }
    .devices {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
      gap: 12px;
    }
    article {
      min-width: 0;
      padding: 14px;
      border: var(--roommind-border-faint, 1px solid var(--divider-color));
      border-radius: var(--roommind-radius-control);
      background: var(--roommind-surface-subtle);
    }
    button {
      background: none;
      border: 0;
      padding: 0;
      color: var(--primary-color);
      text-align: left;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      overflow-wrap: anywhere;
    }
    .observation {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin: 12px 0;
      font-size: 13px;
    }
    .label {
      color: var(--secondary-text-color);
    }
    .value {
      text-align: right;
      color: var(--primary-text-color);
      overflow-wrap: anywhere;
    }
    .operations {
      display: grid;
      gap: 10px;
    }
    .operation {
      display: grid;
      gap: 3px;
      font-size: 13px;
    }
    .plan {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: var(--primary-text-color);
    }
    .feedback {
      color: var(--secondary-text-color);
      font-size: 12px;
    }
    .feedback[data-feedback="failed"],
    .feedback[data-feedback="unsupported"],
    .feedback[data-feedback="not_confirmed"] {
      color: var(--error-color);
    }
    .feedback[data-feedback="deferred"] {
      color: var(--warning-color);
    }
    .feedback[data-feedback="confirmed"],
    .feedback[data-feedback="observed"] {
      color: var(--success-color);
    }
    h3 {
      margin: 18px 0 12px;
      font-size: 14px;
      color: var(--primary-text-color);
    }
    .night {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 0;
      flex-wrap: wrap;
    }
    @media (max-width: 480px) {
      summary {
        padding: 14px;
      }
      .body {
        padding: 0 14px 14px;
      }
      .summary-status {
        display: block;
        margin: 5px 0 0 17px;
      }
    }
  `;

  private _name(entityId: string): string {
    return String(this.hass.states[entityId]?.attributes.friendly_name || entityId);
  }

  private _mode(mode: unknown): string {
    if (typeof mode !== "string") return localize("control.no_feedback", this.hass.language);
    return modeKeys[mode] ? localize(modeKeys[mode], this.hass.language) : mode;
  }

  private _temperature(observation: DeviceObservation | undefined): string {
    if (!observation?.available) return localize("control.no_feedback", this.hass.language);
    if (observation.temperature != null)
      return `${formatTemp(observation.temperature, this.hass)}${tempUnit(this.hass)}`;
    if (observation.target_temp_low != null && observation.target_temp_high != null) {
      return `${formatTemp(observation.target_temp_low, this.hass)}–${formatTemp(observation.target_temp_high, this.hass)}${tempUnit(this.hass)}`;
    }
    return localize("control.no_feedback", this.hass.language);
  }

  private _setting(value: string | number | boolean | null | undefined): string {
    if (value === "on" || value === true) return localize("control.mode.on", this.hass.language);
    if (value === "off" || value === false) return localize("control.mode.off", this.hass.language);
    if (value == null || value === "unknown" || value === "unavailable")
      return localize("control.no_feedback", this.hass.language);
    return String(value);
  }

  private _operation(operation: DeviceActuationStatus) {
    const language = this.hass.language;
    const feedback = actuationFeedback(operation);
    const desired = operation.desired;
    let label: TranslationKey = "control.operation.other";
    let value = "—";
    if (operation.service === "set_temperature") {
      label = "control.planned_temperature";
      // Planned payloads are already in HA units, unlike canonical observations.
      const unit = operation.temperature_unit ?? tempUnit(this.hass);
      if (typeof desired.temperature === "number")
        value = `${desired.temperature.toFixed(1)}${unit}`;
      else if (
        typeof desired.target_temp_low === "number" &&
        typeof desired.target_temp_high === "number"
      )
        value = `${desired.target_temp_low.toFixed(1)}–${desired.target_temp_high.toFixed(1)}${unit}`;
    } else if (operation.service === "set_hvac_mode") {
      label = "control.planned_mode";
      value = this._mode(desired.hvac_mode);
    } else if (operation.service === "set_fan_mode") {
      label = "control.planned_fan";
      value = String(desired.fan_mode ?? "—");
    }
    return html`<div class="operation">
      <div class="plan"><span>${localize(label, language)}</span><span>${value}</span></div>
      <span class="feedback" data-feedback=${feedback}
        >${localize(feedbackKeys[feedback], language)}</span
      >
      ${operation.diagnostic && ["failed", "unsupported"].includes(feedback)
        ? html`<span class="feedback">${operation.diagnostic}</span>`
        : nothing}
    </div>`;
  }

  override render() {
    const live = this.config?.live;
    if (!live) return nothing;
    const language = this.hass.language;
    const operations = live.device_actuation_status ?? [];
    const observations = live.device_observations ?? [];
    const feedback = [
      ...operations.map(actuationFeedback),
      ...(live.night_control_status ?? []).map(nightControlFeedback),
    ];
    const noteworthy = (
      ["failed", "unsupported", "not_confirmed", "deferred", "sent", "accepted"] as const
    ).find((value) => feedback.includes(value));
    const ids = [
      ...new Set([
        ...(this.config?.devices ?? []).map((device) => device.entity_id),
        ...observations.map((observation) => observation.entity_id),
        ...operations.map((operation) => operation.entity_id),
      ]),
    ];
    return html`<details
      @toggle=${(event: Event) => {
        this._expanded = (event.target as HTMLDetailsElement).open;
      }}
    >
      <summary>
        ${localize("control.details", language)}${noteworthy
          ? html`<span class="summary-status feedback" data-feedback=${noteworthy}
              >${localize(feedbackKeys[noteworthy], language)}</span
            >`
          : nothing}
      </summary>
      ${this._expanded
        ? html`<div class="body">
            <p>${localize("control.explanation", language)}</p>
            <div class="request">
              ${this.controlEnabled && live.commanded_mode
                ? localize("hero.control_request", language, {
                    mode: formatMode(live.commanded_mode, language),
                    power: String(live.requested_power ?? 0),
                  })
                : localize("card.not_controlled", language)}
            </div>
            <div class="source">
              ${localize("room.status.primary_sensor", language)}:
              ${this.config?.temperature_sensor
                ? this._name(this.config.temperature_sensor)
                : localize("room.status.not_set", language)}
            </div>
            <div class="devices">
              ${repeat(
                ids,
                (id) => id,
                (id) => {
                  const observation = observations.find((item) => item.entity_id === id);
                  const commands = operations.filter((item) => item.entity_id === id);
                  return html`<article data-entity-id=${id}>
                    <button @click=${() => openEntityInfo(this, id)}>${this._name(id)}</button>
                    <div class="observation">
                      <span class="label"
                        >${localize(
                          observation?.assumed_state
                            ? "control.assumed_mode"
                            : "control.reported_mode",
                          language,
                        )}</span
                      ><span class="value">${this._mode(observation?.hvac_mode)}</span>
                      <span class="label"
                        >${localize(
                          observation?.assumed_state
                            ? "control.assumed_temperature"
                            : "control.reported_temperature",
                          language,
                        )}</span
                      ><span class="value">${this._temperature(observation)}</span>
                    </div>
                    <div class="operations">
                      ${commands.length
                        ? commands.map((command) => this._operation(command))
                        : html`<span class="feedback"
                            >${localize("control.no_commands", language)}</span
                          >`}
                    </div>
                  </article>`;
                },
              )}
            </div>
            ${live.night_control_status?.length
              ? html`<h3>${localize("comfort.night_controls", language)}</h3>
                  ${repeat(
                    live.night_control_status,
                    (status) => status.entity_id,
                    (status) =>
                      html`<div class="night">
                        <button @click=${() => openEntityInfo(this, status.entity_id)}>
                          ${this._name(status.entity_id)}
                        </button>
                        <span class="feedback">
                          ${localize("control.night_setting", language, {
                            target: this._setting(status.target_value),
                            reported: this._setting(status.observed_value),
                          })}
                        </span>
                        <span class="feedback" data-feedback=${nightControlFeedback(status)}>
                          ${localize(feedbackKeys[nightControlFeedback(status)], language)}
                        </span>
                      </div>`,
                  )}`
              : nothing}
          </div>`
        : nothing}
    </details>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-control-details": RsControlDetails;
  }
}
