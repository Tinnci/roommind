/**
 * rs-settings-coil-dry – Global evaporator drying (anti-odour) settings.
 */
import { html, css, nothing } from "lit";
import { RsSettingsBase } from "./rs-settings-base";
import { customElement, property } from "lit/decorators.js";
import type { HomeAssistant, RoomConfig } from "../../types";
import { localize } from "../../utils/localize";
import { getSelectValue } from "../../utils/events";

const KEEP = "__keep__";

@customElement("rs-settings-coil-dry")
export class RsSettingsCoilDry extends RsSettingsBase {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public rooms: Record<string, RoomConfig> = {};
  @property({ type: Boolean }) public coilDryEnabled = false;
  @property({ type: Number }) public coilDryMinutes = 20;
  @property({ type: String }) public coilDryMode: "fan_only" | "dry" = "fan_only";
  @property({ type: String }) public coilDryFanMode = "low";
  @property({ type: Number }) public coilDryMinCoolingMinutes = 10;
  @property({ type: Number }) public coilDryDrainMinutes = 0;

  private _collectFanModes(): string[] {
    const found = new Set<string>(["low", "medium", "high"]);
    for (const room of Object.values(this.rooms)) {
      const devices = room.devices ?? [];
      for (const dev of devices) {
        if (dev.type !== "ac") continue;
        const modes = this.hass?.states?.[dev.entity_id]?.attributes?.fan_modes;
        if (Array.isArray(modes)) {
          for (const m of modes) {
            if (typeof m === "string" && m) found.add(m);
          }
        }
      }
      for (const eid of room.acs ?? []) {
        const modes = this.hass?.states?.[eid]?.attributes?.fan_modes;
        if (Array.isArray(modes)) {
          for (const m of modes) {
            if (typeof m === "string" && m) found.add(m);
          }
        }
      }
    }
    if (this.coilDryFanMode) found.add(this.coilDryFanMode);
    return [...found];
  }

  override render() {
    const l = this.hass.language;
    const fanModes = this._collectFanModes();
    const fanValue = this.coilDryFanMode === "" ? KEEP : this.coilDryFanMode;

    return html`
      <div class="toggle-row">
        <div class="toggle-text">
          <span class="toggle-label">${localize("coil_dry.switch", l)}</span>
          <span class="toggle-hint">${localize("coil_dry.hint", l)}</span>
        </div>
        <ha-switch
          .checked=${this.coilDryEnabled}
          @change=${(e: Event) =>
            this._fire("coilDryEnabled", (e.target as HTMLInputElement).checked)}
        ></ha-switch>
      </div>

      ${
        this.coilDryEnabled
          ? html`
              <div class="threshold-grid" style="margin-top: 14px">
                <div class="threshold-field">
                  <ha-textfield
                    .value=${String(this.coilDryMinutes)}
                    .label=${localize("coil_dry.duration_label", l)}
                    .suffix=${localize("coil_dry.duration_suffix", l)}
                    type="number"
                    step="1"
                    min="1"
                    max="60"
                    @change=${(e: Event) => {
                      const v = parseInt((e.target as HTMLInputElement).value, 10);
                      if (!isNaN(v) && v >= 1 && v <= 60) this._fire("coilDryMinutes", v);
                    }}
                  ></ha-textfield>
                  <span class="field-hint">${localize("coil_dry.duration_hint", l)}</span>
                </div>

                <div class="threshold-field">
                  <ha-textfield
                    .value=${String(this.coilDryMinCoolingMinutes)}
                    .label=${localize("coil_dry.min_cooling_label", l)}
                    .suffix=${localize("coil_dry.min_cooling_suffix", l)}
                    type="number"
                    step="1"
                    min="1"
                    max="240"
                    @change=${(e: Event) => {
                      const v = parseInt((e.target as HTMLInputElement).value, 10);
                      if (!isNaN(v) && v >= 1 && v <= 240)
                        this._fire("coilDryMinCoolingMinutes", v);
                    }}
                  ></ha-textfield>
                  <span class="field-hint">${localize("coil_dry.min_cooling_hint", l)}</span>
                </div>

                <div class="threshold-field">
                  <ha-textfield
                    .value=${String(this.coilDryDrainMinutes)}
                    .label=${localize("coil_dry.drain_label", l)}
                    .suffix=${localize("coil_dry.drain_suffix", l)}
                    type="number"
                    step="1"
                    min="0"
                    max="15"
                    @change=${(e: Event) => {
                      const v = parseInt((e.target as HTMLInputElement).value, 10);
                      if (!isNaN(v) && v >= 0 && v <= 15) this._fire("coilDryDrainMinutes", v);
                    }}
                  ></ha-textfield>
                  <span class="field-hint">${localize("coil_dry.drain_hint", l)}</span>
                </div>
              </div>

              <div class="threshold-grid" style="margin-top: 12px">
                <div class="threshold-field">
                  <ha-select
                    .label=${localize("coil_dry.mode_label", l)}
                    .value=${this.coilDryMode}
                    .options=${[
                      { value: "fan_only", label: localize("coil_dry.mode_fan_only", l) },
                      { value: "dry", label: localize("coil_dry.mode_dry", l) },
                    ]}
                    @selected=${(e: Event) => {
                      const v = getSelectValue(e) as "fan_only" | "dry" | undefined;
                      if (v && v !== this.coilDryMode) this._fire("coilDryMode", v);
                    }}
                    @closed=${(e: Event) => e.stopPropagation()}
                    fixedMenuPosition
                  >
                    <ha-list-item value="fan_only"
                      >${localize("coil_dry.mode_fan_only", l)}</ha-list-item
                    >
                    <ha-list-item value="dry">${localize("coil_dry.mode_dry", l)}</ha-list-item>
                  </ha-select>
                  <span class="field-hint ${this.coilDryMode === "dry" ? "warning" : ""}">
                    ${
                      this.coilDryMode === "dry"
                        ? localize("coil_dry.mode_dry_warning", l)
                        : localize("coil_dry.mode_hint", l)
                    }
                  </span>
                </div>

                <div class="threshold-field">
                  <ha-select
                    .label=${localize("coil_dry.fan_mode_label", l)}
                    .value=${fanValue}
                    .options=${[
                      { value: KEEP, label: localize("coil_dry.fan_mode_keep", l) },
                      ...fanModes.map((m) => ({ value: m, label: m })),
                    ]}
                    @selected=${(e: Event) => {
                      const v = getSelectValue(e);
                      if (v && v !== fanValue) {
                        this._fire("coilDryFanMode", v === KEEP ? "" : v);
                      }
                    }}
                    @closed=${(e: Event) => e.stopPropagation()}
                    fixedMenuPosition
                  >
                    <ha-list-item value=${KEEP}
                      >${localize("coil_dry.fan_mode_keep", l)}</ha-list-item
                    >
                    ${fanModes.map(
                      (m) => html`<ha-list-item value=${m}>${m}</ha-list-item>`,
                    )}
                  </ha-select>
                  <span class="field-hint">${localize("coil_dry.fan_mode_hint", l)}</span>
                </div>
              </div>
            `
          : nothing
      }
    `;
  }

  static override styles = [
    RsSettingsBase.settingsBaseStyles,
    css`
      .field-hint.warning {
        color: var(--warning-color, #ed6c02);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-settings-coil-dry": RsSettingsCoilDry;
  }
}
