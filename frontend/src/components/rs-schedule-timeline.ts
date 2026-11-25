/**
 * rs-schedule-timeline – Visual 24h Day-to-Night Schedule + Sleep Phase + Bed Device timeline.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  ClimateMode,
  HomeAssistant,
  RoomConfig,
  RoomScheduleBlocksResponse,
  ScheduleBlock,
} from "../types";
import { localize, type TranslationKey } from "../utils/localize";
import { formatTemp, tempUnit, toDisplayDelta } from "../utils/temperature";
import {
  buildTimelineModel,
  formatMinutesHhmm,
  getLocalWeekday,
  getMinutesOfDay,
  WEEKDAY_ORDER,
  type WeekdayId,
} from "../utils/schedule-timeline";
import { roommindThemeStyles } from "../styles/theme-styles";

const DAY_KEYS: Record<WeekdayId, TranslationKey> = {
  monday: "schedule.day.mon",
  tuesday: "schedule.day.tue",
  wednesday: "schedule.day.wed",
  thursday: "schedule.day.thu",
  friday: "schedule.day.fri",
  saturday: "schedule.day.sat",
  sunday: "schedule.day.sun",
};

@customElement("rs-schedule-timeline")
export class RsScheduleTimeline extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public config: RoomConfig | null = null;
  @property({ type: Boolean }) public compact = false;
  @property({ type: String }) public language = "en";

  @state() private _weekday: WeekdayId = getLocalWeekday();
  @state() private _blocksResponse: RoomScheduleBlocksResponse | null = null;
  @state() private _selectedIdx: number | null = null;

  private _loadedAreaId = "";
  private _loadedScheduleSig = "";

  protected override willUpdate(changedProps: Map<string, unknown>) {
    if (changedProps.has("config") && this.config && this.hass) {
      const sig = `${this.config.area_id}:${(this.config.schedules ?? []).map((s) => s.entity_id).join(",")}`;
      if (sig !== this._loadedScheduleSig) {
        this._loadedAreaId = this.config.area_id;
        this._loadedScheduleSig = sig;
        this._fetchBlocks();
      }
    }
  }

  private async _fetchBlocks() {
    if (!this.hass?.callWS || !this._loadedAreaId) return;
    if ((this.config?.schedules?.length ?? 0) === 0) {
      this._blocksResponse = null;
      return;
    }
    try {
      const res = await this.hass.callWS<RoomScheduleBlocksResponse>({
        type: "roommind/schedules/blocks",
        area_id: this._loadedAreaId,
      });
      this._blocksResponse = res;
    } catch {
      this._blocksResponse = null;
    }
  }

  override render() {
    if (!this.config || !this.hass || this.config.is_outdoor) return nothing;
    const hasSchedules = (this.config.schedules?.length ?? 0) > 0;
    const hasSleep = Boolean(
      (this.config.quiet_hours?.start && this.config.quiet_hours?.end) || this.config.sleep_device,
    );
    if (!hasSchedules && !hasSleep) return nothing;

    const l = this.language || this.hass.language || "en";
    const unit = tempUnit(this.hass);
    const today = getLocalWeekday();
    const nowMinutes = this._weekday === today ? getMinutesOfDay() : null;

    const activeIndex = Math.max(
      0,
      this._blocksResponse?.active_index ?? this.config.live?.active_schedule_index ?? 0,
    );
    const activeSchedule = this.config.schedules?.[activeIndex] ?? this.config.schedules?.[0];
    const dayBlocks: ScheduleBlock[] = activeSchedule
      ? (this._blocksResponse?.blocks_by_entity?.[activeSchedule.entity_id]?.[this._weekday] ?? [])
      : [];

    const model = buildTimelineModel({
      weekday: this._weekday,
      nowMinutes,
      blocks: dayBlocks,
      climateMode: (this.config.climate_mode ?? "auto") as ClimateMode,
      comfortHeat: this.config.comfort_heat ?? this.config.comfort_temp ?? 21.0,
      comfortCool: this.config.comfort_cool ?? 24.0,
      ecoHeat: this.config.eco_heat ?? this.config.eco_temp ?? 17.0,
      ecoCool: this.config.eco_cool ?? 27.0,
      nightModeEnabled: this.config.night_mode_enabled ?? true,
      quietHours: this.config.quiet_hours ?? null,
      prewarmMinutes: this.config.sleep_prewarm_minutes ?? 30,
      prewakeMinutes: this.config.sleep_prewake_minutes ?? 30,
      sleepRampC: this.config.sleep_temp_ramp_c ?? 0,
      coupledOffsetC: this.config.sleep_coupled_offset_c ?? 0,
      sleepDevice: this.config.sleep_device ?? null,
      maxFanLevelNight: this.config.max_fan_level_night ?? 0.5,
    });

    const selectedSeg =
      this._selectedIdx != null ? (model.airSegments[this._selectedIdx] ?? null) : null;
    const selectorEid = this.config.schedule_selector_entity;

    return html`
      <ha-card class="timeline-card">
        <div class="tl-header">
          <div class="tl-title-wrap">
            <span class="tl-icon"><ha-icon icon="mdi:calendar-clock"></ha-icon></span>
            <div>
              <h3 class="tl-title">${localize("schedule.timeline.title", l)}</h3>
              ${
                model.nextTransition
                  ? html`<div class="tl-subtitle">
                      ${localize("schedule.timeline.next", l, {
                        time: formatMinutesHhmm(model.nextTransition.minute),
                        target:
                          model.nextTransition.targetC != null
                            ? `${formatTemp(model.nextTransition.targetC, this.hass)}${unit}`
                            : "--",
                        in: this._formatIn(model.nextTransition.inMinutes),
                      })}
                    </div>`
                  : nothing
              }
            </div>
          </div>

          <div class="tl-header-right">
            ${
              !this.compact
                ? html`<button
                    type="button"
                    class="tl-edit-btn"
                    @click=${this._emitEditSchedule}
                    aria-label=${localize("panel.edit", l)}
                  >
                    <ha-icon icon="mdi:pencil-outline"></ha-icon>
                  </button>`
                : nothing
            }
          </div>
        </div>

        <div class="tl-controls">
          <div class="day-pills" role="tablist">
            ${WEEKDAY_ORDER.map(
              (day) => html`
                <button
                  type="button"
                  role="tab"
                  aria-selected=${this._weekday === day}
                  class="day-pill ${this._weekday === day ? "active" : ""} ${day === today ? "today" : ""}"
                  @click=${() => {
                    this._weekday = day;
                    this._selectedIdx = null;
                  }}
                >
                  ${localize(DAY_KEYS[day], l)}
                </button>
              `,
            )}
          </div>
          ${this._renderProfileSwitcher(activeIndex, selectorEid, l)}
        </div>

        <div class="tracks-wrap">
          <div class="track-row">
            <span class="track-label">${localize("schedule.timeline.air_track", l)}</span>
            <div class="track-bar air-bar">
              ${model.airSegments.map((seg, idx) => {
                const left = (seg.startMin / 1440) * 100;
                const width = ((seg.endMin - seg.startMin) / 1440) * 100;
                const tone =
                  seg.targetC == null
                    ? "off"
                    : seg.sleepPhase === "sleep"
                      ? "sleep"
                      : seg.isEco
                        ? "eco"
                        : "comfort";
                return html`
                  <button
                    type="button"
                    class="air-seg ${tone} ${this._selectedIdx === idx ? "selected" : ""}"
                    style="left: ${left}%; width: ${width}%;"
                    @click=${() => {
                      this._selectedIdx = this._selectedIdx === idx ? null : idx;
                    }}
                  >
                    ${
                      width >= 10 && seg.targetC != null
                        ? html`<span>${formatTemp(seg.targetC, this.hass)}${unit}</span>`
                        : nothing
                    }
                  </button>
                `;
              })}
              ${
                nowMinutes !== null
                  ? html`<span class="now-line" style="left: ${(nowMinutes / 1440) * 100}%"></span>`
                  : nothing
              }
            </div>
          </div>

          ${
            model.sleepSegments.length > 0
              ? html`
                  <div class="track-row">
                    <span class="track-label">${localize("schedule.timeline.sleep_track", l)}</span>
                    <div class="track-bar sleep-bar">
                      ${model.sleepSegments.map((seg) => {
                        const left = (seg.startMin / 1440) * 100;
                        const width = ((seg.endMin - seg.startMin) / 1440) * 100;
                        const lblKey: TranslationKey =
                          seg.phase === "pre_warm"
                            ? "sleep.phase.pre_warm"
                            : seg.phase === "pre_wake"
                              ? "sleep.phase.pre_wake"
                              : "sleep.phase.sleep";
                        return html`
                          <span
                            class="phase-seg ${seg.phase}"
                            style="left: ${left}%; width: ${width}%;"
                            title=${`${formatMinutesHhmm(seg.startMin)}–${formatMinutesHhmm(seg.endMin)} ${localize(lblKey, l)}`}
                          >
                            ${width >= 12 ? localize(lblKey, l) : nothing}
                          </span>
                        `;
                      })}
                      ${
                        nowMinutes !== null
                          ? html`<span
                              class="now-line"
                              style="left: ${(nowMinutes / 1440) * 100}%"
                            ></span>`
                          : nothing
                      }
                    </div>
                  </div>
                `
              : nothing
          }
          ${
            model.deviceSegments.some((s) => s.gearA !== null)
              ? html`
                  <div class="track-row">
                    <span class="track-label"
                      >${localize("schedule.timeline.device_track", l)}</span
                    >
                    <div class="track-bar device-bar">
                      ${model.deviceSegments.map((seg) => {
                        const left = (seg.startMin / 1440) * 100;
                        const width = ((seg.endMin - seg.startMin) / 1440) * 100;
                        const gearLabel =
                          seg.gearA != null && seg.gearA > 0
                            ? localize("sleep.gear_n", l, { n: seg.gearA })
                            : localize("sleep.gear_off", l);
                        return html`
                          <span
                            class="dev-seg ${seg.phase}"
                            style="left: ${left}%; width: ${width}%;"
                          >
                            ${width >= 10 ? gearLabel : nothing}
                          </span>
                        `;
                      })}
                      ${
                        nowMinutes !== null
                          ? html`<span
                              class="now-line"
                              style="left: ${(nowMinutes / 1440) * 100}%"
                            ></span>`
                          : nothing
                      }
                    </div>
                  </div>
                `
              : nothing
          }

          <div class="axis-ticks">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
        </div>

        ${
          selectedSeg
            ? html`
                <div class="seg-detail">
                  <span class="seg-time">
                    ${formatMinutesHhmm(selectedSeg.startMin)} –
                    ${formatMinutesHhmm(selectedSeg.endMin)}
                  </span>
                  <span class="seg-badge">
                    ${
                      selectedSeg.isEco
                        ? localize("schedule.timeline.eco", l)
                        : localize("schedule.timeline.comfort", l)
                    }
                  </span>
                  ${
                    selectedSeg.sleepPhase !== "day"
                      ? html`<span class="seg-badge phase">
                          ${localize(
                            selectedSeg.sleepPhase === "pre_warm"
                              ? "sleep.phase.pre_warm"
                              : selectedSeg.sleepPhase === "pre_wake"
                                ? "sleep.phase.pre_wake"
                                : "sleep.phase.sleep",
                            l,
                          )}
                        </span>`
                      : nothing
                  }
                  <span class="seg-temp">
                    ${
                      selectedSeg.targetC != null
                        ? `${formatTemp(selectedSeg.targetC, this.hass)}${unit}`
                        : "--"
                    }
                    ${
                      selectedSeg.coupledOffsetApplied &&
                      (this.config.sleep_coupled_offset_c ?? 0) > 0
                        ? ` (−${toDisplayDelta(this.config.sleep_coupled_offset_c ?? 0, this.hass).toFixed(1)}${unit})`
                        : ""
                    }
                  </span>
                </div>
              `
            : nothing
        }
      </ha-card>
    `;
  }

  private _renderProfileSwitcher(activeIndex: number, selectorEid: string, lang: string) {
    const schedules = this.config?.schedules ?? [];
    if (schedules.length < 2) return nothing;

    return html`
      <div class="profile-pills" title=${localize("schedule.timeline.profile", lang)}>
        ${schedules.map((s, idx) => {
          const name = String(
            this.hass?.states?.[s.entity_id]?.attributes?.friendly_name || s.entity_id,
          );
          const isActive = idx === activeIndex;
          const canSwitch = Boolean(selectorEid);
          return html`
            <button
              type="button"
              class="profile-pill ${isActive ? "active" : ""}"
              ?disabled=${!canSwitch}
              @click=${() => this._switchScheduleProfile(selectorEid, idx)}
            >
              ${name}
            </button>
          `;
        })}
      </div>
    `;
  }

  private async _switchScheduleProfile(selectorEid: string, index: number) {
    if (!selectorEid || !this.hass?.callService) return;
    if (selectorEid.startsWith("input_boolean.")) {
      await this.hass.callService("input_boolean", index === 0 ? "turn_on" : "turn_off", {
        entity_id: selectorEid,
      });
    } else if (selectorEid.startsWith("input_number.")) {
      await this.hass.callService("input_number", "set_value", {
        entity_id: selectorEid,
        value: index + 1,
      });
    } else if (selectorEid.startsWith("input_select.")) {
      const options = (this.hass.states[selectorEid]?.attributes?.options as string[]) ?? [];
      const opt = options[index];
      if (opt) {
        await this.hass.callService("input_select", "select_option", {
          entity_id: selectorEid,
          option: opt,
        });
      }
    }
    this.dispatchEvent(new CustomEvent("room-updated", { bubbles: true, composed: true }));
  }

  private _emitEditSchedule() {
    this.dispatchEvent(
      new CustomEvent("configuration-edit", {
        detail: { section: "schedule" },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _formatIn(mins: number): string {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  static override styles = [
    roommindThemeStyles,
    css`
      :host {
        display: block;
      }

      .timeline-card {
        display: grid;
        gap: 10px;
        padding: 13px 16px;
        border-radius: var(--roommind-radius-card, 14px);
        border: var(--roommind-border-subtle);
        background: var(--roommind-surface);
        box-shadow: var(--roommind-shadow-card, none);
      }

      .tl-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .tl-title-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }

      .tl-icon {
        width: 28px;
        height: 28px;
        border-radius: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--roommind-primary-muted);
        color: var(--primary-color);
        --mdc-icon-size: 17px;
        flex: 0 0 auto;
      }

      .tl-title {
        margin: 0;
        font-size: 14px;
        font-weight: 650;
        color: var(--primary-text-color);
      }

      .tl-subtitle {
        font-size: 11.5px;
        color: var(--secondary-text-color);
        margin-top: 1px;
      }

      .tl-edit-btn {
        width: 30px;
        height: 30px;
        border-radius: 8px;
        border: var(--roommind-border-subtle);
        background: var(--roommind-surface-subtle);
        color: var(--secondary-text-color);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        --mdc-icon-size: 16px;
      }

      .tl-edit-btn:hover {
        color: var(--primary-color);
        border-color: var(--primary-color);
      }

      .tl-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }

      .day-pills,
      .profile-pills {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
      }

      .day-pill,
      .profile-pill {
        padding: 3px 8px;
        border-radius: 999px;
        border: var(--roommind-border-faint);
        background: var(--roommind-surface-subtle);
        color: var(--secondary-text-color);
        font-family: inherit;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }

      .day-pill.today {
        border-color: var(--roommind-primary-border);
      }

      .day-pill.active,
      .profile-pill.active {
        background: var(--primary-color);
        border-color: var(--primary-color);
        color: var(--text-primary-color, #fff);
      }

      .tracks-wrap {
        display: grid;
        gap: 6px;
      }

      .track-row {
        display: grid;
        grid-template-columns: 74px minmax(0, 1fr);
        align-items: center;
        gap: 8px;
      }

      .track-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--secondary-text-color);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .track-bar {
        position: relative;
        height: 24px;
        border-radius: 7px;
        background: var(--roommind-surface-subtle);
        border: var(--roommind-border-faint);
        overflow: hidden;
      }

      .track-bar.sleep-bar,
      .track-bar.device-bar {
        height: 18px;
      }

      .air-seg,
      .phase-seg,
      .dev-seg {
        position: absolute;
        top: 0;
        bottom: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-family: inherit;
        font-size: 10.5px;
        font-weight: 650;
        white-space: nowrap;
        overflow: hidden;
        box-sizing: border-box;
      }

      .air-seg {
        border: none;
        border-right: 1px solid rgba(255, 255, 255, 0.25);
        cursor: pointer;
        padding: 0 3px;
        color: var(--primary-text-color);
      }

      .air-seg.comfort {
        background: color-mix(in srgb, var(--roommind-warning-color) 26%, transparent);
      }

      .air-seg.eco {
        background: var(--roommind-surface-muted);
        color: var(--secondary-text-color);
      }

      .air-seg.sleep {
        background: color-mix(in srgb, var(--roommind-info-color) 26%, transparent);
      }

      .air-seg.selected {
        outline: 2px solid var(--primary-color);
        outline-offset: -2px;
        z-index: 2;
      }

      .phase-seg {
        font-size: 10px;
        color: var(--primary-text-color);
      }

      .phase-seg.pre_warm {
        background: var(--roommind-warning-tint);
        color: var(--roommind-warning-color);
      }

      .phase-seg.sleep {
        background: var(--roommind-info-tint);
        color: var(--roommind-info-color);
      }

      .phase-seg.pre_wake {
        background: var(--roommind-success-tint);
        color: var(--roommind-success-color);
      }

      .dev-seg.pre_warm {
        background: color-mix(in srgb, var(--roommind-warning-color) 22%, transparent);
        color: var(--roommind-warning-color);
      }

      .dev-seg.sleep {
        background: color-mix(in srgb, var(--primary-color) 20%, transparent);
        color: var(--primary-color);
      }

      .now-line {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 2px;
        background: var(--roommind-error-color, #f44336);
        z-index: 3;
        pointer-events: none;
      }

      .axis-ticks {
        display: flex;
        justify-content: space-between;
        padding-left: 82px;
        font-size: 10px;
        color: var(--secondary-text-color);
        font-variant-numeric: tabular-nums;
      }

      .seg-detail {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 7px 10px;
        border-radius: 8px;
        background: var(--roommind-surface-subtle);
        border: var(--roommind-border-faint);
        font-size: 12px;
      }

      .seg-time {
        font-weight: 650;
        font-variant-numeric: tabular-nums;
      }

      .seg-badge {
        padding: 1px 7px;
        border-radius: 6px;
        background: var(--roommind-surface-muted);
        color: var(--secondary-text-color);
        font-size: 11px;
        font-weight: 600;
      }

      .seg-badge.phase {
        background: var(--roommind-info-tint);
        color: var(--roommind-info-color);
      }

      .seg-temp {
        margin-left: auto;
        font-weight: 700;
        color: var(--primary-color);
        font-variant-numeric: tabular-nums;
      }

      @media (max-width: 520px) {
        .track-row {
          grid-template-columns: 58px minmax(0, 1fr);
        }

        .axis-ticks {
          padding-left: 66px;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-schedule-timeline": RsScheduleTimeline;
  }
}
