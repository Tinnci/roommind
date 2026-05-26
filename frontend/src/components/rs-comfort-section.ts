import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type {
  AdjacentRoomConfig,
  CouplingStatus,
  HassArea,
  HomeAssistant,
  NightControlConfig,
  NightControlStatus,
  NightModeLiveStatus,
} from "../types";
import { inputStyles } from "../styles/input-styles";
import { getSelectValue, openEntityInfo } from "../utils/events";
import { localize, type TranslationKey } from "../utils/localize";

@customElement("rs-comfort-section")
export class RsComfortSection extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public area!: HassArea;
  @property({ type: Boolean }) public editing = false;
  @property({ type: Number }) public currentTemp: number | null = null;
  @property({ type: Number }) public perceivedTemp: number | null = null;
  @property({ type: Number }) public currentHumidity: number | null = null;
  @property() public controlTarget: "air_temperature" | "perceived_temperature" = "air_temperature";
  @property({ type: Number }) public roomVolumeM3: number | null = null;
  @property({ attribute: false }) public quietHours: { start: string; end: string } | null = null;
  @property({ type: Boolean }) public nightModeEnabled = true;
  @property({ type: Number }) public maxFanLevelNight = 0.5;
  @property({ type: Number }) public sleepTempRampC = 0;
  @property({ type: Boolean }) public nightAllowRapidRecovery = true;
  @property({ type: Number }) public rapidRecoveryDeltaC = 2.0;
  @property({ attribute: false }) public nightMode: NightModeLiveStatus | null = null;
  @property({ attribute: false }) public nightControls: NightControlConfig[] = [];
  @property({ attribute: false }) public nightControlStatus: NightControlStatus[] = [];
  @property({ attribute: false }) public adjacentRooms: AdjacentRoomConfig[] = [];
  @property({ attribute: false }) public couplingStatus: CouplingStatus[] = [];
  @property({ type: Boolean }) public rapidRecoveryActive = false;
  @property() public language = "en";

  static styles = [
    inputStyles,
    css`
      :host {
        display: block;
      }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin-bottom: 12px;
      }

      .summary-item,
      .config-card,
      .list-item {
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
      }

      .summary-item {
        padding: 9px 11px;
        min-width: 0;
      }

      .summary-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        letter-spacing: 0.35px;
      }

      .summary-value {
        margin-top: 3px;
        font-size: 14px;
        font-weight: 600;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
      }

      .summary-value.warning {
        color: var(--warning-color, #ff9800);
      }

      .muted,
      .empty {
        color: var(--secondary-text-color);
        font-size: 13px;
        line-height: 1.5;
      }

      .section-title {
        margin: 18px 0 8px;
        font-size: 13px;
        font-weight: 600;
        color: var(--primary-text-color);
      }

      .config-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .config-card {
        padding: 12px;
      }

      .toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .toggle-title {
        font-size: 14px;
        font-weight: 500;
      }

      .toggle-hint {
        margin-top: 3px;
        color: var(--secondary-text-color);
        font-size: 12px;
        line-height: 1.4;
      }

      .field-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-top: 10px;
      }

      ha-textfield,
      ha-select,
      ha-entity-picker {
        width: 100%;
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .list-item {
        padding: 12px;
      }

      .item-head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      }

      .item-title {
        flex: 1;
        min-width: 0;
        font-weight: 600;
        color: var(--primary-text-color);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .item-title.entity-link {
        cursor: pointer;
      }

      .item-title.entity-link:hover {
        text-decoration: underline;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 7px;
        border-radius: 8px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--secondary-text-color);
        background: rgba(255, 255, 255, 0.06);
      }

      .pill.active {
        color: var(--primary-color);
        background: rgba(3, 169, 244, 0.12);
      }

      .remove-btn,
      .add-btn {
        border: none;
        background: none;
        color: var(--primary-color);
        cursor: pointer;
        font: inherit;
        padding: 4px 0;
      }

      .remove-btn {
        color: var(--error-color, #d32f2f);
      }

      .mode-text {
        margin-top: 6px;
      }

      @media (max-width: 720px) {
        .summary-grid,
        .config-grid,
        .field-row {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];

  render() {
    return this.editing ? this._renderEdit() : this._renderView();
  }

  private _renderView() {
    const lang = this.language;
    const nightActive = this.nightMode?.active ?? false;
    const controlLabel =
      this.controlTarget === "perceived_temperature"
        ? localize("comfort.control_target_perceived", lang)
        : localize("comfort.control_target_air", lang);
    const couplingCount = this.couplingStatus.filter((item) => item.gate > 0 && item.k > 0).length;
    const nightApplied = this.nightControlStatus.filter(
      (item) => item.outcome === "applied",
    ).length;

    return html`
      <div class="summary-grid">
        <div class="summary-item">
          <div class="summary-label">${localize("comfort.perceived_temp", lang)}</div>
          <div class="summary-value">
            ${this.perceivedTemp == null ? "--" : `${this.perceivedTemp.toFixed(1)}°`}
          </div>
        </div>
        <div class="summary-item">
          <div class="summary-label">${localize("comfort.control_target", lang)}</div>
          <div class="summary-value">${controlLabel}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">${localize("comfort.night_mode", lang)}</div>
          <div class="summary-value ${nightActive ? "warning" : ""}">
            ${nightActive ? localize("comfort.active", lang) : localize("comfort.inactive", lang)}
          </div>
        </div>
        <div class="summary-item">
          <div class="summary-label">${localize("comfort.rapid_recovery", lang)}</div>
          <div class="summary-value ${this.rapidRecoveryActive ? "warning" : ""}">
            ${this.rapidRecoveryActive
              ? localize("comfort.active", lang)
              : localize("comfort.inactive", lang)}
          </div>
        </div>
        <div class="summary-item">
          <div class="summary-label">${localize("comfort.night_controls", lang)}</div>
          <div class="summary-value">${nightApplied}/${this.nightControls.length}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">${localize("comfort.room_coupling", lang)}</div>
          <div class="summary-value">${couplingCount}/${this.adjacentRooms.length}</div>
        </div>
      </div>
      <div class="muted">
        ${localize("comfort.summary", lang, {
          hours: this.quietHours ? `${this.quietHours.start}–${this.quietHours.end}` : "--",
          fan: this._percent(this.maxFanLevelNight),
          ramp: this.sleepTempRampC.toFixed(1),
        })}
      </div>
      ${this.couplingStatus.length
        ? html`
            <div class="section-title">${localize("comfort.live_coupling", lang)}</div>
            <div class="list">
              ${this.couplingStatus.map((item) => this._renderCouplingView(item))}
            </div>
          `
        : nothing}
    `;
  }

  private _renderCouplingView(item: CouplingStatus) {
    const lang = this.language;
    return html`<div class="list-item">
      <div class="item-head">
        <span class="item-title">${this._areaName(item.area_id)}</span>
        <span class="pill ${item.gate > 0 ? "active" : ""}">
          ${localize("comfort.gate", lang)} ${item.gate.toFixed(1)}
        </span>
        <span class="pill">k ${item.k.toFixed(3)}</span>
      </div>
      <div class="muted">
        ${localize("comfort.adjacent_temp", lang, { temp: item.temperature.toFixed(1) })}
      </div>
    </div>`;
  }

  private _renderEdit() {
    const lang = this.language;
    return html`
      <div class="config-grid">
        <div class="config-card">
          <div class="toggle-row">
            <div>
              <div class="toggle-title">${localize("comfort.night_mode", lang)}</div>
              <div class="toggle-hint">${localize("comfort.night_mode_hint", lang)}</div>
            </div>
            <ha-switch
              .checked=${this.nightModeEnabled}
              @change=${(e: Event) =>
                this._emit("night_mode_enabled", (e.target as HTMLInputElement).checked)}
            ></ha-switch>
          </div>
          <div class="field-row">
            <ha-textfield
              .label=${localize("comfort.quiet_start", lang)}
              .value=${this.quietHours?.start ?? "22:00"}
              @input=${(e: Event) =>
                this._updateQuiet("start", (e.target as HTMLInputElement).value)}
            ></ha-textfield>
            <ha-textfield
              .label=${localize("comfort.quiet_end", lang)}
              .value=${this.quietHours?.end ?? "07:00"}
              @input=${(e: Event) => this._updateQuiet("end", (e.target as HTMLInputElement).value)}
            ></ha-textfield>
          </div>
          <div class="field-row">
            ${this._numberField(
              "comfort.max_fan_level_night",
              "max_fan_level_night",
              this.maxFanLevelNight,
              0,
              1,
              0.05,
            )}
            ${this._numberField(
              "comfort.sleep_temp_ramp",
              "sleep_temp_ramp_c",
              this.sleepTempRampC,
              0,
              4,
              0.1,
            )}
          </div>
        </div>

        <div class="config-card">
          <ha-select
            .label=${localize("comfort.control_target", lang)}
            .value=${this.controlTarget}
            @selected=${(e: Event) => this._emit("control_target", getSelectValue(e))}
            @closed=${(e: Event) => e.stopPropagation()}
            fixedMenuPosition
          >
            <ha-list-item value="air_temperature"
              >${localize("comfort.control_target_air", lang)}</ha-list-item
            >
            <ha-list-item value="perceived_temperature"
              >${localize("comfort.control_target_perceived", lang)}</ha-list-item
            >
          </ha-select>
          <div class="field-row">
            ${this._numberField(
              "comfort.room_volume",
              "room_volume_m3",
              this.roomVolumeM3 ?? 0,
              0,
              600,
              1,
            )}
            ${this._numberField(
              "comfort.rapid_recovery_delta",
              "rapid_recovery_delta_c",
              this.rapidRecoveryDeltaC,
              0.5,
              6,
              0.1,
            )}
          </div>
          <div class="toggle-row mode-text">
            <div>
              <div class="toggle-title">
                ${localize("comfort.night_allow_rapid_recovery", lang)}
              </div>
              <div class="toggle-hint">
                ${localize("comfort.night_allow_rapid_recovery_hint", lang)}
              </div>
            </div>
            <ha-switch
              .checked=${this.nightAllowRapidRecovery}
              @change=${(e: Event) =>
                this._emit("night_allow_rapid_recovery", (e.target as HTMLInputElement).checked)}
            ></ha-switch>
          </div>
        </div>
      </div>

      <div class="section-title">${localize("comfort.night_controls", lang)}</div>
      <div class="list">
        ${this.nightControls.length
          ? this.nightControls.map((item, index) => this._renderNightControlEdit(item, index))
          : html`<div class="empty">${localize("comfort.no_night_controls", lang)}</div>`}
      </div>
      <button class="add-btn" @click=${this._addNightControl}>
        + ${localize("comfort.add_night_control", lang)}
      </button>

      <div class="section-title">${localize("comfort.adjacent_rooms", lang)}</div>
      <div class="list">
        ${this.adjacentRooms.length
          ? this.adjacentRooms.map((item, index) => this._renderAdjacentEdit(item, index))
          : html`<div class="empty">${localize("comfort.no_adjacent_rooms", lang)}</div>`}
      </div>
      <button class="add-btn" @click=${this._addAdjacent}>
        + ${localize("comfort.add_adjacent_room", lang)}
      </button>
    `;
  }

  private _renderNightControlEdit(item: NightControlConfig, index: number) {
    const lang = this.language;
    return html`<div class="list-item">
      <div class="item-head">
        <div
          class="item-title ${item.entity_id ? "entity-link" : ""}"
          @click=${() => item.entity_id && openEntityInfo(this, item.entity_id)}
        >
          ${item.entity_id || localize("comfort.night_control_new", lang)}
        </div>
        <ha-switch
          .checked=${item.enabled !== false}
          @change=${(e: Event) =>
            this._updateNightControl(index, { enabled: (e.target as HTMLInputElement).checked })}
        ></ha-switch>
        <button class="remove-btn" @click=${() => this._removeNightControl(index)}>
          ${localize("common.remove", lang)}
        </button>
      </div>
      <ha-entity-picker
        .hass=${this.hass}
        .includeDomains=${["light", "switch", "select", "input_select", "number", "input_number"]}
        .value=${item.entity_id ?? ""}
        .label=${localize("comfort.night_control_entity", lang)}
        @value-changed=${(e: CustomEvent) =>
          this._updateNightControl(index, { entity_id: e.detail?.value || "" })}
      ></ha-entity-picker>
      <div class="field-row">
        <ha-select
          .label=${localize("comfort.night_control_role", lang)}
          .value=${item.role ?? "other"}
          @selected=${(e: Event) =>
            this._updateNightControl(index, {
              role: getSelectValue(e) as NightControlConfig["role"],
            })}
          @closed=${(e: Event) => e.stopPropagation()}
          fixedMenuPosition
        >
          <ha-list-item value="indicator_light"
            >${localize("comfort.role_indicator_light", lang)}</ha-list-item
          >
          <ha-list-item value="display">${localize("comfort.role_display", lang)}</ha-list-item>
          <ha-list-item value="beeper">${localize("comfort.role_beeper", lang)}</ha-list-item>
          <ha-list-item value="sound">${localize("comfort.role_sound", lang)}</ha-list-item>
          <ha-list-item value="other">${localize("comfort.role_other", lang)}</ha-list-item>
        </ha-select>
        <ha-select
          .label=${localize("comfort.restore_after_night", lang)}
          .value=${item.restore_after_night === false ? "false" : "true"}
          @selected=${(e: Event) =>
            this._updateNightControl(index, { restore_after_night: getSelectValue(e) !== "false" })}
          @closed=${(e: Event) => e.stopPropagation()}
          fixedMenuPosition
        >
          <ha-list-item value="true">${localize("common.yes", lang)}</ha-list-item>
          <ha-list-item value="false">${localize("common.no", lang)}</ha-list-item>
        </ha-select>
      </div>
      <div class="field-row">
        <ha-textfield
          .label=${localize("comfort.night_value", lang)}
          .value=${String(item.night_value ?? "off")}
          @input=${(e: Event) =>
            this._updateNightControl(index, { night_value: (e.target as HTMLInputElement).value })}
        ></ha-textfield>
        <ha-textfield
          .label=${localize("comfort.day_value", lang)}
          .value=${String(item.day_value ?? "")}
          @input=${(e: Event) =>
            this._updateNightControl(index, { day_value: (e.target as HTMLInputElement).value })}
        ></ha-textfield>
      </div>
    </div>`;
  }

  private _renderAdjacentEdit(item: AdjacentRoomConfig, index: number) {
    const lang = this.language;
    const areas = Object.values(this.hass.areas ?? {}).filter(
      (area) => area.area_id !== this.area.area_id,
    );
    return html`<div class="list-item">
      <div class="item-head">
        <div class="item-title">
          ${item.area_id ? this._areaName(item.area_id) : localize("comfort.adjacent_new", lang)}
        </div>
        <ha-switch
          .checked=${item.enabled !== false}
          @change=${(e: Event) =>
            this._updateAdjacent(index, { enabled: (e.target as HTMLInputElement).checked })}
        ></ha-switch>
        <button class="remove-btn" @click=${() => this._removeAdjacent(index)}>
          ${localize("common.remove", lang)}
        </button>
      </div>
      <ha-select
        .label=${localize("comfort.adjacent_room", lang)}
        .value=${item.area_id ?? ""}
        @selected=${(e: Event) => this._updateAdjacent(index, { area_id: getSelectValue(e) })}
        @closed=${(e: Event) => e.stopPropagation()}
        fixedMenuPosition
      >
        <ha-list-item value="">${localize("comfort.select_room", lang)}</ha-list-item>
        ${areas.map(
          (area) => html`<ha-list-item value=${area.area_id}>${area.name}</ha-list-item>`,
        )}
      </ha-select>
      <div class="field-row">
        <ha-entity-picker
          .hass=${this.hass}
          .includeDomains=${["binary_sensor", "input_boolean", "sensor"]}
          .value=${item.door_sensor_entity || item.link_sensor_entity || ""}
          .label=${localize("comfort.door_sensor", lang)}
          @value-changed=${(e: CustomEvent) =>
            this._updateAdjacent(index, {
              door_sensor_entity: e.detail?.value || "",
              link_sensor_entity: e.detail?.value || "",
            })}
        ></ha-entity-picker>
        ${this._numberField(
          "comfort.coupling_weight",
          `adjacent:${index}:coupling_weight`,
          item.coupling_weight ?? 0,
          0,
          2,
          0.01,
        )}
      </div>
      <div class="toggle-row mode-text">
        <div>
          <div class="toggle-title">${localize("comfort.allow_borrowed_conditioning", lang)}</div>
          <div class="toggle-hint">
            ${localize("comfort.allow_borrowed_conditioning_hint", lang)}
          </div>
        </div>
        <ha-switch
          .checked=${item.allow_borrowed_conditioning !== false}
          @change=${(e: Event) =>
            this._updateAdjacent(index, {
              allow_borrowed_conditioning: (e.target as HTMLInputElement).checked,
            })}
        ></ha-switch>
      </div>
    </div>`;
  }

  private _numberField(
    labelKey: TranslationKey,
    key: string,
    value: number,
    min: number,
    max: number,
    step: number,
  ) {
    return html`<ha-textfield
      .label=${localize(labelKey, this.language)}
      type="number"
      .min=${String(min)}
      .max=${String(max)}
      .step=${String(step)}
      .value=${String(value)}
      @input=${(e: Event) => this._onNumberInput(key, e)}
    ></ha-textfield>`;
  }

  private _onNumberInput(key: string, e: Event) {
    const value = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    if (key.startsWith("adjacent:")) {
      const [, rawIndex, field] = key.split(":");
      this._updateAdjacent(Number(rawIndex), { [field]: value } as Partial<AdjacentRoomConfig>);
      return;
    }
    const saveValue = key === "room_volume_m3" && value <= 0 ? null : value;
    this._emit(key, saveValue);
  }

  private _updateQuiet(part: "start" | "end", value: string) {
    const next = {
      start: this.quietHours?.start ?? "22:00",
      end: this.quietHours?.end ?? "07:00",
      [part]: value,
    };
    this._emit("quiet_hours", next);
  }

  private _addNightControl = () => {
    const next = [
      ...this.nightControls,
      {
        entity_id: "",
        role: "indicator_light",
        enabled: true,
        night_value: "off",
        restore_after_night: true,
      },
    ];
    this._emit("night_controls", next);
  };

  private _updateNightControl(index: number, patch: Partial<NightControlConfig>) {
    const next = this.nightControls.map((item, i) => (i === index ? { ...item, ...patch } : item));
    this._emit("night_controls", next);
  }

  private _removeNightControl(index: number) {
    this._emit(
      "night_controls",
      this.nightControls.filter((_, i) => i !== index),
    );
  }

  private _addAdjacent = () => {
    const firstArea = Object.values(this.hass.areas ?? {}).find(
      (item) => item.area_id !== this.area.area_id,
    );
    const next = [
      ...this.adjacentRooms,
      { area_id: firstArea?.area_id ?? "", enabled: true, allow_borrowed_conditioning: true },
    ];
    this._emit("adjacent_rooms", next);
  };

  private _updateAdjacent(index: number, patch: Partial<AdjacentRoomConfig>) {
    const next = this.adjacentRooms.map((item, i) => (i === index ? { ...item, ...patch } : item));
    this._emit("adjacent_rooms", next);
  }

  private _removeAdjacent(index: number) {
    this._emit(
      "adjacent_rooms",
      this.adjacentRooms.filter((_, i) => i !== index),
    );
  }

  private _emit(key: string, value: unknown) {
    this.dispatchEvent(
      new CustomEvent("setting-changed", {
        detail: { key, value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _areaName(areaId: string): string {
    return this.hass.areas?.[areaId]?.name ?? areaId;
  }

  private _percent(value: number | null | undefined): string {
    return `${Math.round(Math.max(0, Math.min(1, Number(value ?? 0))) * 100)}%`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-comfort-section": RsComfortSection;
  }
}
