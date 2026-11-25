/**
 * rs-settings-price – Peak-valley electricity price shifting settings.
 */
import { html, nothing } from "lit";
import { RsSettingsBase } from "./rs-settings-base";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant } from "../../types";
import { localize } from "../../utils/localize";
import "../shared/rs-entity-picker-field";

@customElement("rs-settings-price")
export class RsSettingsPrice extends RsSettingsBase {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ type: String }) public priceEntity = "";

  override render() {
    const l = this.hass.language;
    const stateObj = this.priceEntity ? this.hass.states?.[this.priceEntity] : undefined;

    return html`
      <div class="toggle-text" style="margin-bottom: 12px">
        <span class="toggle-hint">${localize("settings.price_hint", l)}</span>
      </div>

      <rs-entity-picker-field
        .hass=${this.hass}
        .label=${localize("settings.price_entity", l)}
        .value=${this.priceEntity}
        .includeDomains=${["sensor", "binary_sensor", "input_boolean", "switch", "event"]}
        @value-changed=${(e: CustomEvent<{ value: string }>) => {
          const val = e.detail.value ?? "";
          if (val !== this.priceEntity) this._fire("priceEntity", val);
        }}
      ></rs-entity-picker-field>

      ${
        this.priceEntity && stateObj
          ? html`
              <p class="field-hint" style="margin-top: 8px">
                ${localize("settings.price_current_state", l, {
                  state: String(stateObj.state),
                  unit: String(stateObj.attributes?.unit_of_measurement ?? ""),
                })}
              </p>
            `
          : nothing
      }
    `;
  }

  static override styles = [RsSettingsBase.settingsBaseStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-settings-price": RsSettingsPrice;
  }
}
