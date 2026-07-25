import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  AirflowCommandStatus,
  AirflowDeviceConfig,
  AirflowDeviceStatus,
  AirflowRole,
  CurvePoint,
  HVACOutputStatus,
  HassArea,
  HomeAssistant,
} from "../types";
import { getEntitiesForArea } from "../utils/room-state";
import { getSelectValue, openEntityInfo } from "../utils/events";
import { localize, type TranslationKey } from "../utils/localize";
import { masterDetailStyles } from "../styles/master-detail-styles";
import { inputStyles } from "../styles/input-styles";
import {
  airflowBehaviorPreferenceCount,
  airflowModelingPreferenceCount,
} from "../utils/airflow-settings-layout";
import { toAirflowDeviceUiSchema } from "../utils/airflow-device-profile";
import "./shared/rs-master-detail";

const KEEP = "";

const SKIP_REASON_TRANSLATION_KEYS: Record<string, TranslationKey> = {
  control_disabled: "airflow.skip_reason_control_disabled",
  unsupported_domain: "airflow.skip_reason_unsupported_domain",
  service_error: "airflow.skip_reason_service_error",
  direction_unsupported: "airflow.skip_reason_direction_unsupported",
  oscillate_unsupported: "airflow.skip_reason_oscillate_unsupported",
  preset_unsupported: "airflow.skip_reason_preset_unsupported",
  fan_mode_unsupported: "airflow.skip_reason_fan_mode_unsupported",
  swing_unsupported: "airflow.skip_reason_swing_unsupported",
  swing_horizontal_unsupported: "airflow.skip_reason_swing_horizontal_unsupported",
  fan_only_not_supported: "airflow.skip_reason_fan_only_not_supported",
  fan_only_not_roommind_owned: "airflow.skip_reason_fan_only_not_roommind_owned",
  climate_off: "airflow.skip_reason_climate_off",
  idle_climate_airflow_requires_fan_only:
    "airflow.skip_reason_idle_climate_airflow_requires_fan_only",
  entity_unavailable: "airflow.skip_reason_entity_unavailable",
  no_target_value: "airflow.skip_reason_no_target_value",
  invalid_target_state: "airflow.skip_reason_invalid_target_state",
  invalid_option: "airflow.skip_reason_invalid_option",
  invalid_number: "airflow.skip_reason_invalid_number",
};

@customElement("rs-airflow-section")
export class RsAirflowSection extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public area!: HassArea;
  @property({ attribute: false }) public airflowDevices: AirflowDeviceConfig[] = [];
  @property({ attribute: false }) public statuses: AirflowDeviceStatus[] = [];
  @property({ attribute: false }) public commandStatuses: AirflowCommandStatus[] = [];
  @property({ attribute: false }) public hvacOutputStatus: HVACOutputStatus | null = null;
  @property({ type: Number }) public qFanMix = 0;
  @property({ type: Number }) public qVent = 0;
  @property({ type: Number }) public airflowAch = 0;
  @property({ type: Number }) public planLevel = 0;
  @property({ type: Number }) public mixPlanLevel = 0;
  @property({ type: Number }) public ventPlanLevel = 0;
  @property({ type: Boolean }) public active = false;
  @property({ type: Boolean }) public editing = false;
  @property() public language = "en";

  @state() private _selectedForEdit = "";

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has("airflowDevices")) {
      const ids = new Set(this.airflowDevices.map((d) => d.entity_id));
      if (this._selectedForEdit && !ids.has(this._selectedForEdit)) {
        this._selectedForEdit = "";
      }
      if (!this._selectedForEdit && this.airflowDevices.length > 0) {
        this._selectedForEdit = this.airflowDevices[0]?.entity_id ?? "";
      }
    }
  }

  static override styles = [
    masterDetailStyles,
    inputStyles,
    css`
      :host {
        display: block;
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 8px;
        margin-bottom: 10px;
      }

      .summary-item {
        min-width: 0;
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--roommind-surface-subtle);
        border: var(--roommind-border-faint);
      }

      .summary-label {
        font-size: 10px;
        font-weight: 600;
        color: var(--secondary-text-color);
        text-transform: uppercase;
        letter-spacing: 0;
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
        padding: 8px 0;
        font-size: 14px;
        color: var(--primary-text-color);
        min-width: 0;
        border-top: var(--roommind-border-faint);
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
        background: var(--roommind-surface-muted);
        color: var(--secondary-text-color);
        letter-spacing: 0;
        text-transform: uppercase;
        flex-shrink: 0;
      }

      .pill.active {
        background: var(--roommind-primary-strong);
        color: var(--primary-color);
      }

      .pill.warning {
        background: var(--roommind-warning-tint);
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
        background: var(--roommind-surface-muted);
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

      .native-textarea {
        width: 100%;
        min-height: 68px;
        box-sizing: border-box;
        border: 1px solid var(--divider-color);
        border-radius: 8px;
        padding: 8px;
        color: var(--primary-text-color);
        background: var(--roommind-surface);
        font: inherit;
      }

      .preference-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin-top: 10px;
      }

      .preference-button {
        min-height: 56px;
        border: var(--roommind-border-subtle);
        border-radius: 8px;
        padding: 8px;
        background: var(--roommind-surface-subtle);
        color: var(--primary-text-color);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .preference-button:hover,
      .preference-button:focus-visible,
      .preference-button.selected {
        border-color: var(--roommind-primary-border);
        background: var(--roommind-primary-strong);
        outline: none;
      }

      .preference-title {
        display: block;
        font-size: 13px;
        font-weight: 700;
      }

      .preference-copy {
        display: block;
        margin-top: 3px;
        color: var(--secondary-text-color);
        font-size: 11px;
        line-height: 1.35;
      }

      .detail-field + .detail-field,
      .detail-field + .detail-toggle-row,
      .detail-toggle-row + .detail-toggle-row,
      .detail-toggle-row + .detail-field {
        margin-top: 12px;
      }

      .detail-group {
        margin-top: 14px;
        border-top: var(--roommind-border-faint);
        padding-top: 12px;
      }

      .detail-group summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        cursor: pointer;
        color: var(--primary-text-color);
        font-size: 13px;
        font-weight: 600;
        list-style: none;
      }

      .detail-group summary::-webkit-details-marker {
        display: none;
      }

      .detail-group summary::after {
        content: "v";
        color: var(--secondary-text-color);
        transition: transform 120ms ease;
      }

      .detail-group:not([open]) summary::after {
        transform: rotate(-90deg);
      }

      .group-count {
        margin-left: auto;
        color: var(--secondary-text-color);
        font-size: 11px;
        font-weight: 500;
      }

      .detail-group-body {
        margin-top: 12px;
      }

      @media (max-width: 520px) {
        .view-row {
          align-items: flex-start;
          flex-wrap: wrap;
        }

        .view-name {
          flex-basis: 100%;
        }

        .preference-grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];

  override render() {
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
          <div class="summary-label">${localize("airflow.ach", lang)}</div>
          <div class="summary-value">${this.airflowAch.toFixed(2)}/h</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">${localize("airflow.mix_plan_level", lang)}</div>
          <div class="summary-value">${this._percent(this.mixPlanLevel)}</div>
        </div>
        <div class="summary-item">
          <div class="summary-label">${localize("airflow.vent_plan_level", lang)}</div>
          <div class="summary-value">${this._percent(this.ventPlanLevel)}</div>
        </div>
        ${this.hvacOutputStatus
          ? html`<div class="summary-item">
              <div class="summary-label">${localize("airflow.hvac_output", lang)}</div>
              <div class="summary-value">
                ${this.hvacOutputStatus.stage} ·
                ${this.hvacOutputStatus.delivered_capacity_factor.toFixed(2)}x
              </div>
            </div>`
          : nothing}
      </div>
      ${this.airflowDevices.map((device) => this._renderViewRow(device))}
    `;
  }

  private _renderViewRow(device: AirflowDeviceConfig) {
    const lang = this.language;
    const entityId = device.entity_id;
    const state = this.hass.states[entityId];
    const status = this._statusFor(entityId);
    const command = this._commandFor(entityId);
    const friendlyName = (state?.attributes?.friendly_name as string) || entityId;
    const unavailable = status && !status.available;
    const q = status?.q ?? 0;
    const planned =
      command?.planned_level ??
      (device.role === "ventilation" ? this.ventPlanLevel : this.mixPlanLevel);
    const observed = command?.observed_q ?? q;
    const commandLabel = command ? this._commandLabel(command) : "";
    const showWarning = command && command.outcome !== "applied";

    return html`
      <div class="view-row">
        <span class="view-name entity-link" @click=${() => openEntityInfo(this, entityId)}
          >${friendlyName}</span
        >
        <span class="pill">${this._roleLabel(device.role)}</span>
        <span class="pill">${this._preferenceLabel(device.effect_weight ?? 1)}</span>
        ${device.control_enabled
          ? html`<span class="pill active"
              >${localize("airflow.control_enabled_short", lang)}</span
            >`
          : device.controllable
            ? html`<span class="pill">${localize("airflow.controllable_short", lang)}</span>`
            : nothing}
        ${unavailable
          ? html`<span class="pill warning">${localize("airflow.unavailable", lang)}</span>`
          : html`
              <span class="pill"
                >${localize("airflow.planned_level", lang)} ${this._percent(planned)}</span
              >
              <span class="view-value"
                >${localize("airflow.actual_level", lang)} ${this._percent(observed)}</span
              >
            `}
        ${showWarning
          ? html`<span class="pill warning" title=${this._skipReasonLabel(command?.skip_reason)}
              >${commandLabel}</span
            >`
          : nothing}
        ${command?.night_capped
          ? html`<span class="pill warning">${localize("airflow.night_capped", lang)}</span>`
          : nothing}
        ${command?.assumed_state_confidence && command.assumed_state_confidence !== "observed"
          ? html`<span class="pill warning"
              >${this._confidenceLabel(command.assumed_state_confidence)}</span
            >`
          : nothing}
        ${command?.skipped_services?.length
          ? html`<span
              class="pill warning"
              title=${command.skipped_services
                .map((item) => `${item.service}: ${this._skipReasonLabel(item.reason)}`)
                .join("\n")}
              >${command.skipped_services.length} ${localize("airflow.skipped", lang)}</span
            >`
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

      ${this._renderWindPreference(entityId, device)}

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
      ${this._renderBehaviorGroup(
        entityId,
        device,
        isFan,
        isClimate,
        presetModes,
        swingModes,
        swingHorizontalModes,
      )}
      ${this._renderModelingGroup(entityId, device)}
    `;
  }

  private _renderBehaviorGroup(
    entityId: string,
    device: AirflowDeviceConfig,
    isFan: boolean,
    isClimate: boolean,
    presetModes: string[],
    swingModes: string[],
    swingHorizontalModes: string[],
  ) {
    const hasClimatePrefs =
      isClimate &&
      (presetModes.length > 0 || swingModes.length > 0 || swingHorizontalModes.length > 0);
    if (!isFan && !hasClimatePrefs) return nothing;
    const profile = toAirflowDeviceUiSchema(device);

    return html`
      <details class="detail-group">
        <summary>
          ${localize("airflow.behavior_preferences", this.language)}
          <span class="group-count">
            ${localize("airflow.configured_count", this.language, {
              count: airflowBehaviorPreferenceCount(profile.behavior_preferences),
            })}
          </span>
        </summary>
        <div class="detail-group-body">
          ${isFan ? this._renderFanPrefs(entityId, device, presetModes) : nothing}
          ${hasClimatePrefs
            ? this._renderClimatePrefs(
                entityId,
                device,
                presetModes,
                swingModes,
                swingHorizontalModes,
              )
            : nothing}
        </div>
      </details>
    `;
  }

  private _renderWindPreference(entityId: string, device: AirflowDeviceConfig) {
    const lang = this.language;
    const selected = this._preferenceKey(device.effect_weight ?? 1);
    const options = [
      {
        key: "gentle",
        value: 0.65,
        title: localize("airflow.preference_gentle", lang),
        copy: localize("airflow.preference_gentle_hint", lang),
      },
      {
        key: "balanced",
        value: 1,
        title: localize("airflow.preference_balanced", lang),
        copy: localize("airflow.preference_balanced_hint", lang),
      },
      {
        key: "strong",
        value: 1.35,
        title: localize("airflow.preference_strong", lang),
        copy: localize("airflow.preference_strong_hint", lang),
      },
    ] as const;

    return html`
      <div class="detail-group">
        <div class="toggle-title">${localize("airflow.wind_preference", lang)}</div>
        <div class="toggle-hint">${localize("airflow.wind_preference_hint", lang)}</div>
        <div class="preference-grid">
          ${options.map(
            (option) => html`
              <button
                class="preference-button ${selected === option.key ? "selected" : ""}"
                type="button"
                @click=${() => this._updateDevice(entityId, { effect_weight: option.value })}
              >
                <span class="preference-title">${option.title}</span>
                <span class="preference-copy">${option.copy}</span>
              </button>
            `,
          )}
        </div>
      </div>
    `;
  }

  private _renderModelingGroup(entityId: string, device: AirflowDeviceConfig) {
    const profile = toAirflowDeviceUiSchema(device);
    return html`
      <details class="detail-group">
        <summary>
          ${localize("airflow.advanced_modeling", this.language)}
          <span class="group-count">
            ${localize("airflow.configured_count", this.language, {
              count: airflowModelingPreferenceCount(profile.modeling_profile),
            })}
          </span>
        </summary>
        <div class="detail-group-body">${this._renderAdvancedPrefs(entityId, device)}</div>
      </details>
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
    presetModes: string[],
    swingModes: string[],
    swingHorizontalModes: string[],
  ) {
    const lang = this.language;
    return html`
      ${presetModes.length > 0
        ? html`
            ${this._renderPresetSelect(
              entityId,
              device,
              "preferred_preset_mode_thermal",
              "airflow.preset_mode_thermal",
              presetModes,
            )}
            ${this._renderPresetSelect(
              entityId,
              device,
              "preferred_preset_mode_idle",
              "airflow.preset_mode_idle",
              presetModes,
            )}
            ${this._renderPresetSelect(
              entityId,
              device,
              "preferred_preset_mode_night",
              "airflow.preset_mode_night",
              presetModes,
            )}
          `
        : nothing}
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

  private _renderPresetSelect(
    entityId: string,
    device: AirflowDeviceConfig,
    key:
      | "preferred_preset_mode_thermal"
      | "preferred_preset_mode_idle"
      | "preferred_preset_mode_night",
    labelKey: TranslationKey,
    presetModes: string[],
  ) {
    return html`
      <div class="detail-field">
        <ha-select
          .label=${localize(labelKey, this.language)}
          .value=${device[key] || KEEP}
          @selected=${(e: Event) => {
            const value = getSelectValue(e);
            this._updateDevice(entityId, {
              [key]: value === KEEP ? "" : value,
            } as Partial<AirflowDeviceConfig>);
          }}
          @closed=${(e: Event) => e.stopPropagation()}
          fixedMenuPosition
        >
          <ha-list-item value=${KEEP}>${localize("airflow.keep", this.language)}</ha-list-item>
          ${presetModes.map((mode) => html`<ha-list-item value=${mode}>${mode}</ha-list-item>`)}
        </ha-select>
      </div>
    `;
  }

  private _renderAdvancedPrefs(entityId: string, device: AirflowDeviceConfig) {
    const lang = this.language;
    return html`
      <div class="detail-field">
        <ha-entity-picker
          .hass=${this.hass}
          .includeDomains=${["sensor", "number", "input_number"]}
          .value=${device.power_sensor_entity || ""}
          .label=${localize("airflow.power_sensor", lang)}
          @value-changed=${(e: CustomEvent) =>
            this._updateDevice(entityId, { power_sensor_entity: e.detail?.value || "" })}
        ></ha-entity-picker>
      </div>
      <div class="detail-field">
        <ha-select
          .label=${localize("airflow.compressor_stage_observer", lang)}
          .value=${device.compressor_stage_observer || "auto"}
          @selected=${(e: Event) =>
            this._updateDevice(entityId, {
              compressor_stage_observer:
                (getSelectValue(e) as AirflowDeviceConfig["compressor_stage_observer"]) ?? "auto",
            })}
          @closed=${(e: Event) => e.stopPropagation()}
          fixedMenuPosition
        >
          <ha-list-item value="auto">${localize("airflow.observer_auto", lang)}</ha-list-item>
          <ha-list-item value="power_sensor"
            >${localize("airflow.observer_power", lang)}</ha-list-item
          >
          <ha-list-item value="thermal_slope"
            >${localize("airflow.observer_slope", lang)}</ha-list-item
          >
          <ha-list-item value="disabled"
            >${localize("airflow.observer_disabled", lang)}</ha-list-item
          >
        </ha-select>
      </div>
      <div class="detail-field">
        <ha-textfield
          .label=${localize("airflow.assumed_state_ttl", lang)}
          type="number"
          min="0"
          max="3600"
          .value=${String(device.assumed_state_ttl_s ?? device.assumed_state_ttl ?? 120)}
          @input=${(e: Event) =>
            this._updateDevice(entityId, {
              assumed_state_ttl_s: Number((e.target as HTMLInputElement).value),
            })}
        ></ha-textfield>
      </div>
      <div class="detail-field">
        <label class="summary-label">${localize("airflow.fan_capacity_curve", lang)}</label>
        <textarea
          class="native-textarea"
          .value=${this._curveToText(device.fan_capacity_curve, "capacity_factor")}
          placeholder="0:1, 0.5:1.12, 1:1.25"
          @input=${(e: Event) =>
            this._updateDevice(entityId, {
              fan_capacity_curve: this._parseCurveText(
                (e.target as HTMLTextAreaElement).value,
                "capacity_factor",
              ),
            })}
        ></textarea>
      </div>
      <div class="detail-field">
        <label class="summary-label">${localize("airflow.fan_power_curve", lang)}</label>
        <textarea
          class="native-textarea"
          .value=${this._curveToText(device.fan_power_curve, "power_w")}
          placeholder="0:0, 0.5:18, 1:45"
          @input=${(e: Event) =>
            this._updateDevice(entityId, {
              fan_power_curve: this._parseCurveText(
                (e.target as HTMLTextAreaElement).value,
                "power_w",
              ),
            })}
        ></textarea>
      </div>
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
      preferred_preset_mode_thermal: "",
      preferred_preset_mode_idle: "",
      preferred_preset_mode_night: "",
      preferred_preset_mode_away: "",
      preferred_swing_mode: "",
      preferred_swing_horizontal_mode: "",
      effect_weight: 1,
      airflow_m3h: null,
      power_sensor_entity: "",
      assumed_state_ttl: null,
      assumed_state_ttl_s: 120,
      compressor_stage_observer: "auto",
      fan_capacity_curve: [],
      fan_power_curve: [],
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

  private _preferenceKey(weight: number): "gentle" | "balanced" | "strong" {
    if (weight < 0.85) return "gentle";
    if (weight > 1.15) return "strong";
    return "balanced";
  }

  private _preferenceLabel(weight: number): string {
    const key = this._preferenceKey(weight);
    return localize(`airflow.preference_${key}` as TranslationKey, this.language);
  }

  private _statusFor(entityId: string): AirflowDeviceStatus | undefined {
    return this.statuses.find((status) => status.entity_id === entityId);
  }

  private _commandFor(entityId: string): AirflowCommandStatus | undefined {
    return this.commandStatuses.find((status) => status.entity_id === entityId);
  }

  private _commandLabel(status: AirflowCommandStatus): string {
    const key =
      status.outcome === "unsupported_fan_only"
        ? "airflow.command_unsupported_fan_only"
        : status.outcome === "skipped_off_climate"
          ? "airflow.command_skipped_off_climate"
          : status.outcome === "blocked_by_mode" && status.skip_reason === "control_disabled"
            ? "airflow.command_control_disabled"
            : status.outcome === "blocked_by_mode"
              ? "airflow.command_blocked_by_mode"
              : status.outcome === "failed"
                ? "airflow.command_failed"
                : "airflow.command_applied";
    return localize(key, this.language);
  }

  private _percent(value: number | null | undefined): string {
    return `${Math.round(Math.max(0, Math.min(1, Number(value ?? 0))) * 100)}%`;
  }

  private _confidenceLabel(value: string): string {
    const key =
      value === "assumed"
        ? "airflow.confidence_assumed"
        : value === "stale"
          ? "airflow.confidence_stale"
          : value === "conflicting"
            ? "airflow.confidence_conflicting"
            : value === "observed"
              ? "airflow.confidence_observed"
              : "airflow.confidence_unknown";
    return localize(key, this.language);
  }

  private _skipReasonLabel(value: string | null | undefined): string {
    if (!value) return "";
    const key = SKIP_REASON_TRANSLATION_KEYS[value];
    return key ? localize(key, this.language) : value;
  }

  private _curveToText(
    curve: AirflowDeviceConfig["fan_capacity_curve"] | AirflowDeviceConfig["fan_power_curve"],
    key: "capacity_factor" | "power_w",
  ): string {
    return (curve ?? [])
      .filter((point) => Number.isFinite(point.level) && Number.isFinite(Number(point[key])))
      .map((point) => `${point.level}:${Number(point[key]).toFixed(key === "power_w" ? 0 : 2)}`)
      .join(", ");
  }

  private _parseCurveText(
    text: string,
    key: "capacity_factor",
  ): NonNullable<AirflowDeviceConfig["fan_capacity_curve"]>;
  private _parseCurveText(
    text: string,
    key: "power_w",
  ): NonNullable<AirflowDeviceConfig["fan_power_curve"]>;
  private _parseCurveText(text: string, key: "capacity_factor" | "power_w"): CurvePoint[] {
    return text
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [rawLevel, rawValue] = part.split(":").map((chunk) => chunk.trim());
        const level = Number(rawLevel);
        const value = Number(rawValue);
        if (!Number.isFinite(level) || !Number.isFinite(value)) return null;
        const normalizedLevel = Math.max(0, Math.min(1, level));
        return key === "capacity_factor"
          ? { level: normalizedLevel, capacity_factor: value }
          : { level: normalizedLevel, power_w: value };
      })
      .filter((point): point is CurvePoint => point !== null)
      .sort((a, b) => a.level - b.level);
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
