import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  AirflowDeviceConfig,
  AirflowDeviceStatus,
  AirflowRole,
  HassArea,
  HomeAssistant,
} from "../types";
import { getEntitiesForArea } from "../utils/room-state";
import { getSelectValue, openEntityInfo } from "../utils/events";
import { localize } from "../utils/localize";
import { masterDetailStyles } from "../styles/master-detail-styles";
import { inputStyles } from "../styles/input-styles";
import "./shared/rs-master-detail";

const KEEP = "__keep__";

@customElement("rs-airflow-section")
export class RsAirflowSection extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public area!: HassArea;
  @property({ attribute: false }) public airflowDevices: AirflowDeviceConfig[] = [];
  @property({ attribute: false }) public statuses: AirflowDeviceStatus[] = [];
  @property({ type: Number }) public qFanMix = 0;
  @property({ type: Number }) public qVent = 0;
  @property({ type: Number }) public planLevel = 0;
  @property({ type: Number }) public mixPlanLevel = 0;
  @property({ type: Number }) public ventPlanLevel = 0;
  @property({ type: Boolean }) public active = false;
  @property({ type: Boolean }) public editing = false;
  @property() public language = "en";

  @state() private _selectedForEdit = "";

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("airflowDevices")) {
      const ids = new Set(this.airflowDevices.map((d) => d.entity_id));
      if (this._selectedForEdit && !ids.has(this._selectedForEdit)) {
        this._selectedForEdit = "";
      }
      if (!this._selectedForEdit && this.airflowDevices.length > 0) {
        this._selectedForEdit = this.airflowDevices[0].entity_id;
      }
    }
  }

  static styles = [
    masterDetailStyles,
    inputStyles,
    css`
      :host {
        display: block;
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin-bottom: 10px;
      }

      .summary-item {
        min-width: 0;
        padding: 8px 10px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
      }

      .summary-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        letter-spacing: 0.4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .summary-value {
        margin-top: 2px;
        font-size: 14px;
        font-weight: 600;
        color: var(--primary-text-color);
        font-variant-numeric: tabular-nums;
      }

      .view-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 0;
        font-size: 14px;
        color: var(--primary-text-color);
      }

      .view-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .entity-link {
        cursor: pointer;
      }

      .entity-link:hover {
        text-decoration: underline;
      }

      .pill,
      .meta-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        font-weight: 500;
        padding: 1px 7px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.05);
        color: var(--secondary-text-color);
        letter-spacing: 0.3px;
        text-transform: uppercase;
        flex-shrink: 0;
      }

      .pill.active {
        background: rgba(3, 169, 244, 0.12);
        color: var(--primary-color);
      }

      .pill.warning {
        background: rgba(255, 152, 0, 0.1);
        color: var(--warning-color, #ff9800);
      }

      .view-value {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        flex-shrink: 0;
      }

      .no-items,
      .empty-list {
        color: var(--secondary-text-color);
        font-size: 13px;
        padding: 8px 0;
      }

      .external-badge {
        display: inline-flex;
        align-items: center;
        font-size: 10px;
        font-weight: 500;
        color: var(--secondary-text-color);
        background: var(--divider-color, rgba(0, 0, 0, 0.06));
        padding: 1px 6px;
        border-radius: 4px;
        white-space: nowrap;
      }

      .picker-wrap {
        margin-top: 12px;
      }

      ha-entity-picker {
        width: 100%;
      }

      .detail-toggle-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 0;
      }

      .toggle-text {
        min-width: 0;
      }

      .toggle-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--primary-text-color);
      }

      .toggle-hint {
        margin-top: 2px;
        font-size: 12px;
        line-height: 1.4;
        color: var(--secondary-text-color);
      }

      .detail-field + .detail-field,
      .detail-field + .detail-toggle-row,
      .detail-toggle-row + .detail-toggle-row,
      .detail-toggle-row + .detail-field {
        margin-top: 12px;
      }

      @media (max-width: 520px) {
        .summary {
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
    if (this.airflowDevices.length === 0) {
      return html`<p class="no-items">${localize("airflow.no_devices", lang)}</p>`;
    }

    return html`
      <div class="summary">
        <div class="summary-item">
          <div class="summary-label">${localize("airflow.mix_factor", lang)}</div>
          <div class="summary-value">${this._percent(this.qFanMix)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">${localize("airflow.vent_factor", lang)}</div>
          <div class="summary-value">${this._percent(this.qVent)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">${localize("airflow.mix_plan_level", lang)}</div>
          <div class="summary-value">${this._percent(this.mixPlanLevel)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">${localize("airflow.vent_plan_level", lang)}</div>
          <div class="summary-value">${this._percent(this.ventPlanLevel)}</div>
        </div>
      </div>
      ${this.airflowDevices.map((device) => this._renderViewRow(device))}
    `;
  }

  private _renderViewRow(device: AirflowDeviceConfig) {
    const lang = this.language;
    const entityId = device.entity_id;
    const state = this.hass.states[entityId];
    const status = this._statusFor(entityId);
    const friendlyName = (state?.attributes?.friendly_name as string) || entityId;
    const unavailable = status && !status.available;
    const q = status?.q ?? 0;

    return html`
      <div class="view-row">
        <span class="view-name entity-link" @click=${() => openEntityInfo(this, entityId)}
          >${friendlyName}</span
        >
        <span class="pill">${this._roleLabel(device.role)}</span>
        ${device.control_enabled
          ? html`<span class="pill active"
              >${localize("airflow.control_enabled_short", lang)}</span
            >`
          : device.controllable
            ? html`<span class="pill">${localize("airflow.controllable_short", lang)}</span>`
            : nothing}
        ${unavailable
          ? html`<span class="pill warning">${localize("airflow.unavailable", lang)}</span>`
          : q > 0
            ? html`<span class="view-value">${this._percent(q)}</span>`
            : nothing}
      </div>
    `;
  }

  private _renderEdit() {
    const lang = this.language;
    const areaEntities = getEntitiesForArea(
      this.area.area_id,
      this.hass?.entities,
      this.hass?.devices,
    ).filter((e) => {
      const idAfterDot = e.entity_id.substring(e.entity_id.indexOf(".") + 1);
      return !idAfterDot.startsWith("roommind_");
    });
    const areaAirflow = areaEntities.filter((e) => this._isAirflowCandidate(e.entity_id));
    const areaIds = new Set(areaAirflow.map((e) => e.entity_id));
    const externalIds = this.airflowDevices
      .map((d) => d.entity_id)
      .filter((id) => !areaIds.has(id));
    const selected = this._selectedForEdit;
    const selectedInRoom = selected && this.airflowDevices.some((d) => d.entity_id === selected);

    return html`
      <rs-master-detail>
        <div slot="master" class="master">
          <div class="block-title">${localize("airflow.devices", lang)}</div>
          <div class="master-list">
            ${areaAirflow.length > 0
              ? areaAirflow.map((e) => this._renderMasterRow(e.entity_id, false))
              : html`<div class="empty-list">${localize("airflow.no_candidates", lang)}</div>`}
            ${externalIds.map((id) => this._renderMasterRow(id, true))}
          </div>
          <div class="picker-wrap">
            <ha-entity-picker
              .hass=${this.hass}
              .includeDomains=${["fan", "climate"]}
              .entityFilter=${this._entityFilter}
              .value=${""}
              .label=${localize("airflow.add_entity", lang)}
              @value-changed=${this._onEntityPicked}
            ></ha-entity-picker>
          </div>
        </div>

        <div slot="detail" class="detail-panel">
          ${selectedInRoom
            ? this._renderDeviceDetail(selected)
            : html`<div class="empty-detail">
                <ha-icon icon="mdi:gesture-tap"></ha-icon>
                <span>${localize("devices.select_to_configure", lang)}</span>
              </div>`}
        </div>
      </rs-master-detail>
    `;
  }

  private _renderMasterRow(entityId: string, external: boolean) {
    const device = this.airflowDevices.find((d) => d.entity_id === entityId);
    const isInRoom = !!device;
    const isFocused = this._selectedForEdit === entityId;
    const state = this.hass.states[entityId];
    const friendlyName = (state?.attributes?.friendly_name as string) || entityId;
    const status = this._statusFor(entityId);
    const q = status?.q ?? 0;
    const lang = this.language;

    return html`
      <div
        class="master-row ${isFocused ? "focused" : ""} ${isInRoom ? "in-room" : ""}"
        @click=${() => (this._selectedForEdit = entityId)}
      >
        <ha-checkbox
          .checked=${isInRoom}
          @click=${(e: Event) => e.stopPropagation()}
          @change=${(e: Event) => {
            const target = e.target as HTMLElement & { checked: boolean };
            this._onToggle(entityId, target.checked);
            if (target.checked) this._selectedForEdit = entityId;
          }}
        ></ha-checkbox>
        <div class="master-info">
          <div class="master-name-row">
            <span class="master-name">${friendlyName}</span>
            ${external
              ? html`<span class="external-badge">${localize("devices.other_area", lang)}</span>`
              : nothing}
          </div>
          <div class="master-meta">
            ${device
              ? html`<span class="meta-pill">${this._roleLabel(device.role)}</span>`
              : nothing}
            ${device?.control_enabled
              ? html`<span class="meta-pill"
                  >${localize("airflow.control_enabled_short", lang)}</span
                >`
              : nothing}
            ${q > 0 ? html`<span class="meta-pill">${this._percent(q)}</span>` : nothing}
          </div>
        </div>
      </div>
    `;
  }

  private _renderDeviceDetail(entityId: string) {
    const device = this.airflowDevices.find((d) => d.entity_id === entityId);
    if (!device) return nothing;

    const lang = this.language;
    const state = this.hass.states[entityId];
    const attrs = state?.attributes ?? {};
    const friendlyName = (attrs.friendly_name as string) || entityId;
    const isFan = entityId.startsWith("fan.");
    const isClimate = entityId.startsWith("climate.");
    const presetModes = this._stringArray(attrs.preset_modes);
    const swingModes = this._stringArray(attrs.swing_modes);
    const swingHorizontalModes = this._stringArray(attrs.swing_horizontal_modes);

    return html`
      <div class="detail-head">
        <div class="detail-title">${friendlyName}</div>
        <div class="detail-entity-id">${entityId}</div>
      </div>

      <div class="detail-field">
        <ha-select
          .label=${localize("airflow.role", lang)}
          .value=${device.role}
          .options=${this._roleOptions()}
          @selected=${(e: Event) =>
            this._updateDevice(entityId, { role: getSelectValue(e) as AirflowRole })}
          @closed=${(e: Event) => e.stopPropagation()}
          fixedMenuPosition
        >
          <ha-list-item value="circulation"
            >${localize("airflow.role_circulation", lang)}</ha-list-item
          >
          <ha-list-item value="ventilation"
            >${localize("airflow.role_ventilation", lang)}</ha-list-item
          >
          <ha-list-item value="hvac_fan">${localize("airflow.role_hvac_fan", lang)}</ha-list-item>
        </ha-select>
      </div>

      <div class="detail-toggle-row">
        <div class="toggle-text">
          <div class="toggle-title">${localize("airflow.controllable", lang)}</div>
          <div class="toggle-hint">${localize("airflow.controllable_hint", lang)}</div>
        </div>
        <ha-switch
          .checked=${device.controllable}
          @change=${(e: Event) => {
            const checked = (e.target as HTMLInputElement).checked;
            this._updateDevice(entityId, {
              controllable: checked,
              control_enabled: checked ? device.control_enabled : false,
            });
          }}
        ></ha-switch>
      </div>

      ${device.controllable
        ? html`
            <div class="detail-toggle-row">
              <div class="toggle-text">
                <div class="toggle-title">${localize("airflow.control_enabled", lang)}</div>
                <div class="toggle-hint">${localize("airflow.control_enabled_hint", lang)}</div>
              </div>
              <ha-switch
                .checked=${device.control_enabled}
                @change=${(e: Event) =>
                  this._updateDevice(entityId, {
                    control_enabled: (e.target as HTMLInputElement).checked,
                  })}
              ></ha-switch>
            </div>
          `
        : nothing}
      ${isFan ? this._renderFanPrefs(entityId, device, presetModes) : nothing}
      ${isClimate
        ? this._renderClimatePrefs(entityId, device, swingModes, swingHorizontalModes)
        : nothing}
    `;
  }

  private _renderFanPrefs(entityId: string, device: AirflowDeviceConfig, presetModes: string[]) {
    const lang = this.language;
    const oscillating =
      device.preferred_oscillating === true
        ? "true"
        : device.preferred_oscillating === false
          ? "false"
          : KEEP;

    return html`
      ${presetModes.length > 0
        ? html`
            <div class="detail-field">
              <ha-select
                .label=${localize("airflow.preset_mode", lang)}
                .value=${device.preferred_preset_mode || KEEP}
                @selected=${(e: Event) => {
                  const value = getSelectValue(e);
                  this._updateDevice(entityId, {
                    preferred_preset_mode: value === KEEP ? "" : value,
                  });
                }}
                @closed=${(e: Event) => e.stopPropagation()}
                fixedMenuPosition
              >
                <ha-list-item value=${KEEP}>${localize("airflow.keep", lang)}</ha-list-item>
                ${presetModes.map(
                  (mode) => html`<ha-list-item value=${mode}>${mode}</ha-list-item>`,
                )}
              </ha-select>
            </div>
          `
        : nothing}
      <div class="detail-field">
        <ha-select
          .label=${localize("airflow.direction", lang)}
          .value=${device.preferred_direction || KEEP}
          @selected=${(e: Event) => {
            const value = getSelectValue(e);
            this._updateDevice(entityId, { preferred_direction: value === KEEP ? "" : value });
          }}
          @closed=${(e: Event) => e.stopPropagation()}
          fixedMenuPosition
        >
          <ha-list-item value=${KEEP}>${localize("airflow.keep", lang)}</ha-list-item>
          <ha-list-item value="forward"
            >${localize("airflow.direction_forward", lang)}</ha-list-item
          >
          <ha-list-item value="reverse"
            >${localize("airflow.direction_reverse", lang)}</ha-list-item
          >
        </ha-select>
      </div>
      <div class="detail-field">
        <ha-select
          .label=${localize("airflow.oscillating", lang)}
          .value=${oscillating}
          @selected=${(e: Event) => {
            const value = getSelectValue(e);
            this._updateDevice(entityId, {
              preferred_oscillating:
                value === KEEP ? null : value === "true" ? true : value === "false" ? false : null,
            });
          }}
          @closed=${(e: Event) => e.stopPropagation()}
          fixedMenuPosition
        >
          <ha-list-item value=${KEEP}>${localize("airflow.keep", lang)}</ha-list-item>
          <ha-list-item value="true">${localize("airflow.on", lang)}</ha-list-item>
          <ha-list-item value="false">${localize("airflow.off", lang)}</ha-list-item>
        </ha-select>
      </div>
    `;
  }

  private _renderClimatePrefs(
    entityId: string,
    device: AirflowDeviceConfig,
    swingModes: string[],
    swingHorizontalModes: string[],
  ) {
    const lang = this.language;
    return html`
      ${swingModes.length > 0
        ? html`
            <div class="detail-field">
              <ha-select
                .label=${localize("airflow.swing_mode", lang)}
                .value=${device.preferred_swing_mode || KEEP}
                @selected=${(e: Event) => {
                  const value = getSelectValue(e);
                  this._updateDevice(entityId, {
                    preferred_swing_mode: value === KEEP ? "" : value,
                  });
                }}
                @closed=${(e: Event) => e.stopPropagation()}
                fixedMenuPosition
              >
                <ha-list-item value=${KEEP}>${localize("airflow.keep", lang)}</ha-list-item>
                ${swingModes.map(
                  (mode) => html`<ha-list-item value=${mode}>${mode}</ha-list-item>`,
                )}
              </ha-select>
            </div>
          `
        : nothing}
      ${swingHorizontalModes.length > 0
        ? html`
            <div class="detail-field">
              <ha-select
                .label=${localize("airflow.swing_horizontal_mode", lang)}
                .value=${device.preferred_swing_horizontal_mode || KEEP}
                @selected=${(e: Event) => {
                  const value = getSelectValue(e);
                  this._updateDevice(entityId, {
                    preferred_swing_horizontal_mode: value === KEEP ? "" : value,
                  });
                }}
                @closed=${(e: Event) => e.stopPropagation()}
                fixedMenuPosition
              >
                <ha-list-item value=${KEEP}>${localize("airflow.keep", lang)}</ha-list-item>
                ${swingHorizontalModes.map(
                  (mode) => html`<ha-list-item value=${mode}>${mode}</ha-list-item>`,
                )}
              </ha-select>
            </div>
          `
        : nothing}
    `;
  }

  private _onToggle(entityId: string, checked: boolean) {
    let next: AirflowDeviceConfig[];
    if (checked) {
      if (this.airflowDevices.some((d) => d.entity_id === entityId)) return;
      next = [...this.airflowDevices, this._defaultDevice(entityId)];
    } else {
      next = this.airflowDevices.filter((d) => d.entity_id !== entityId);
    }
    this._emit(next);
  }

  private _onEntityPicked = (e: CustomEvent) => {
    const entityId = e.detail?.value as string;
    const picker = e.target as HTMLElement & { value: string };
    picker.value = "";
    if (!entityId || this.airflowDevices.some((d) => d.entity_id === entityId)) return;
    const next = [...this.airflowDevices, this._defaultDevice(entityId)];
    this._selectedForEdit = entityId;
    this._emit(next);
  };

  private _updateDevice(entityId: string, patch: Partial<AirflowDeviceConfig>) {
    const next = this.airflowDevices.map((device) =>
      device.entity_id === entityId ? { ...device, ...patch } : device,
    );
    this._emit(next);
  }

  private _emit(devices: AirflowDeviceConfig[]) {
    this.dispatchEvent(
      new CustomEvent("airflow-devices-changed", {
        detail: { devices },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _defaultDevice(entityId: string): AirflowDeviceConfig {
    return {
      entity_id: entityId,
      role: entityId.startsWith("climate.") ? "hvac_fan" : "circulation",
      controllable: false,
      control_enabled: false,
      preferred_direction: "",
      preferred_oscillating: null,
      preferred_preset_mode: "",
      preferred_swing_mode: "",
      preferred_swing_horizontal_mode: "",
    };
  }

  private _entityFilter = (entity: { entity_id: string }): boolean => {
    const id = entity.entity_id;
    if (this.airflowDevices.some((d) => d.entity_id === id)) return false;
    return this._isAirflowCandidate(id);
  };

  private _isAirflowCandidate(entityId: string): boolean {
    if (entityId.startsWith("fan.")) return true;
    if (!entityId.startsWith("climate.")) return false;
    const attrs = this.hass.states[entityId]?.attributes ?? {};
    return (
      this._stringArray(attrs.fan_modes).length > 0 ||
      this._stringArray(attrs.swing_modes).length > 0 ||
      this._stringArray(attrs.swing_horizontal_modes).length > 0
    );
  }

  private _roleOptions() {
    return [
      { value: "circulation", label: this._roleLabel("circulation") },
      { value: "ventilation", label: this._roleLabel("ventilation") },
      { value: "hvac_fan", label: this._roleLabel("hvac_fan") },
    ];
  }

  private _roleLabel(role: AirflowRole): string {
    const key =
      role === "ventilation"
        ? "airflow.role_ventilation"
        : role === "hvac_fan"
          ? "airflow.role_hvac_fan"
          : "airflow.role_circulation";
    return localize(key, this.language);
  }

  private _statusFor(entityId: string): AirflowDeviceStatus | undefined {
    return this.statuses.find((status) => status.entity_id === entityId);
  }

  private _percent(value: number | null | undefined): string {
    return `${Math.round(Math.max(0, Math.min(1, Number(value ?? 0))) * 100)}%`;
  }

  private _stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String(item)) : [];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-airflow-section": RsAirflowSection;
  }
}
