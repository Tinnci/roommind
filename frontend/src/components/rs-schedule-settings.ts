import { html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ScheduleEntry, ClimateMode } from "../types";
import { localize } from "../utils/localize";
import { formatTemp, tempUnit } from "../utils/temperature";
import type { RoomConfig } from "../types";
import { RsScheduleBase } from "./shared/rs-schedule-base";
import "./rs-schedule-timeline";

@customElement("rs-schedule-settings")
export class RsScheduleSettings extends RsScheduleBase {
  @property({ attribute: false }) public roomConfig: RoomConfig | null = null;
  @property({ attribute: false }) public schedules: ScheduleEntry[] = [];
  /** Alias: parent passes .scheduleSelectorEntity, base uses selectorEntity. */
  @property({ type: String }) public set scheduleSelectorEntity(v: string) {
    this.selectorEntity = v;
  }
  public get scheduleSelectorEntity(): string {
    return this.selectorEntity;
  }
  /** Alias: parent passes .activeScheduleIndex, base uses activeIndex. */
  @property({ type: Number }) public set activeScheduleIndex(v: number) {
    this.activeIndex = v;
  }
  public get activeScheduleIndex(): number {
    return this.activeIndex;
  }
  @property({ type: Number }) public comfortHeat = 21.0;
  @property({ type: Number }) public comfortCool = 24.0;
  @property({ type: Number }) public ecoHeat = 17.0;
  @property({ type: Number }) public ecoCool = 27.0;
  @property({ type: String }) public climateMode: ClimateMode = "auto";

  static override styles = [
    RsScheduleBase.sharedStyles,
    css`
      .view-selector-info {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin-top: 8px;
      }
    `,
  ];

  override render() {
    if (!this.editing) {
      return this._renderViewMode();
    }
    return this._renderEditMode();
  }

  // ─── View mode ─────────────────────────────────────────────────

  private _renderViewMode() {
    const l = this.hass.language;
    const hasMultiple = this.schedules.length >= 2;

    return html`
      ${
        this.schedules.length > 0
          ? html`
              <div class="schedule-list">
                ${this.schedules.map((schedule, index) => {
                  const state = this._getScheduleState(index, this.schedules.length);
                  return html`
                    <div class="schedule-row ${state}">
                      ${
                        hasMultiple
                          ? html`<span class="schedule-number">${index + 1}</span>`
                          : nothing
                      }
                      <span class="schedule-status-dot"></span>
                      <span
                        class="schedule-name schedule-link"
                        @click=${() => this._openEntityInfo(schedule.entity_id)}
                        >${this._getFriendlyName(schedule.entity_id)}</span
                      >
                      <span class="schedule-status">${this._getStatusText(index, state)}</span>
                    </div>
                  `;
                })}
              </div>
            `
          : html`<div class="no-schedules">${localize("schedule.no_schedules", l)}</div>`
      }
      ${
        this.scheduleSelectorEntity
          ? html`<div class="view-selector-info">
              ${localize("schedule.view_selector_prefix", l)}
              <span
                class="schedule-link"
                @click=${() => this._openEntityInfo(this.scheduleSelectorEntity!)}
                >${this._getFriendlyName(this.scheduleSelectorEntity)}</span
              >
            </div>`
          : nothing
      }
    `;
  }

  // ─── Edit mode ─────────────────────────────────────────────────

  private _renderEditMode() {
    const l = this.hass.language;
    const count = this.schedules.length;
    const usedIds = new Set(this.schedules.map((s) => s.entity_id));
    const previewConfig: RoomConfig | null = this.roomConfig
      ? {
          ...this.roomConfig,
          schedules: this.schedules,
          schedule_selector_entity: this.scheduleSelectorEntity,
          comfort_heat: this.comfortHeat,
          comfort_cool: this.comfortCool,
          eco_heat: this.ecoHeat,
          eco_cool: this.ecoCool,
          climate_mode: this.climateMode,
        }
      : null;

    return html`
      ${
        previewConfig
          ? html`<rs-schedule-timeline
              style="margin-bottom: 12px;"
              .hass=${this.hass}
              .config=${previewConfig}
              .compact=${true}
              .language=${l}
            ></rs-schedule-timeline>`
          : nothing
      }
      ${this._renderScheduleList()}
      ${this._renderAddRow(
        localize("schedule.select_schedule", l),
        this._getAvailableEntities(usedIds),
        (eid) => this._addSchedule(eid),
        localize("schedule.create_helper_hint", l),
      )}
      ${this._renderSelectorSection(
        count,
        localize("schedule.selector_label", l),
        this.scheduleSelectorEntity ? this._getSelectorValueText(l) : "",
        localize("schedule.selector_warning", l),
        (value) => this._onSelectorEntityChange(value),
      )}
    `;
  }

  // ─── Schedule list ─────────────────────────────────────────────

  private _renderScheduleList() {
    const l = this.hass.language;
    const count = this.schedules.length;

    if (count === 0) {
      return html`<div class="no-schedules">${localize("schedule.no_schedules", l)}</div>`;
    }

    return html`
      <div class="schedule-list">
        ${this.schedules.map((schedule, index) => {
          const state = this._getScheduleState(index, count);
          return html`
            <div class="schedule-row ${state}">
              ${count >= 2 ? html`<span class="schedule-number">${index + 1}</span>` : nothing}
              <span class="schedule-status-dot"></span>
              <span class="schedule-name">${this._getFriendlyName(schedule.entity_id)}</span>
              <span class="schedule-status">${this._getStatusText(index, state)}</span>
              ${this._renderScheduleControls(
                index,
                count,
                (i, dir) => this._moveSchedule(i, dir),
                (i) => this._removeSchedule(i),
              )}
            </div>
          `;
        })}
      </div>
    `;
  }

  // ─── Selector value text ───────────────────────────────────────

  private _getSelectorValueText(l: string): string {
    const selectorState = this.hass?.states?.[this.scheduleSelectorEntity];
    if (!selectorState) return "";
    if (this.scheduleSelectorEntity.startsWith("input_boolean.")) {
      return localize("schedule.selector_value_boolean", l, {
        value: selectorState.state === "on" ? "On" : "Off",
      });
    }
    return localize("schedule.selector_value_number", l, {
      value: selectorState.state,
    });
  }

  // ─── Status text (temperature-specific) ────────────────────────

  private _getStatusText(index: number, state: "active" | "inactive" | "unreachable"): string {
    const l = this.hass.language;

    if (state === "unreachable") return localize("schedule.state_unreachable", l);
    if (state === "inactive") return localize("schedule.state_inactive", l);

    const schedule = this.schedules[index];
    if (!schedule) return localize("schedule.state_active", l);
    const entityState = this.hass?.states?.[schedule.entity_id];
    if (!entityState) return localize("schedule.state_active", l);

    const isOn = entityState.state === "on";
    if (isOn) {
      const attrs = entityState.attributes ?? {};
      const blockTemp = attrs.temperature as number | undefined;
      if (blockTemp != null) {
        return localize("schedule.from_schedule", l, {
          temp: String(blockTemp),
          unit: tempUnit(this.hass),
        });
      }
      const heatTemp = attrs.heat_temperature as number | undefined;
      const coolTemp = attrs.cool_temperature as number | undefined;
      if (heatTemp != null || coolTemp != null) {
        return localize("schedule.from_schedule_split", l, {
          heat: String(heatTemp ?? this.comfortHeat),
          cool: String(coolTemp ?? this.comfortCool),
          unit: tempUnit(this.hass),
        });
      }
      return localize("schedule.fallback", l, {
        temp: formatTemp(
          this.climateMode === "cool_only" ? this.comfortCool : this.comfortHeat,
          this.hass,
        ),
        unit: tempUnit(this.hass),
      });
    }

    return localize("schedule.eco_detail", l, {
      temp: formatTemp(this.climateMode === "cool_only" ? this.ecoCool : this.ecoHeat, this.hass),
      unit: tempUnit(this.hass),
    });
  }

  // ─── Schedule management ───────────────────────────────────────

  private _addSchedule(entityId: string) {
    this._emitSchedules([...this.schedules, { entity_id: entityId }]);
  }

  private _removeSchedule(index: number) {
    this._emitSchedules(this.schedules.filter((_, i) => i !== index));
  }

  private _moveSchedule(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= this.schedules.length) return;
    const next = [...this.schedules];
    const current = next[index];
    const targetEntry = next[target];
    if (!current || !targetEntry) return;
    [next[index], next[target]] = [targetEntry, current];
    this._emitSchedules(next);
  }

  private _emitSchedules(value: ScheduleEntry[]) {
    this.dispatchEvent(
      new CustomEvent("schedules-changed", {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onSelectorEntityChange(value: string) {
    this.dispatchEvent(
      new CustomEvent("schedule-selector-changed", {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-schedule-settings": RsScheduleSettings;
  }
}
