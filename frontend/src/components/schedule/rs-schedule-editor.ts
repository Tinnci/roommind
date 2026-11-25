import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant } from "../../types";
import { localize, type TranslationKey } from "../../utils/localize";
import { fireSaveStatus } from "../../utils/events";
import { loadSchedule, saveSchedule, isAdmin, type LoadedSchedule } from "../../utils/schedule-api";
import {
  WEEKDAYS,
  DAY_GROUPS,
  createBlock,
  suggestBlock,
  removeBlock,
  setBlockTimes,
  updateBlockData,
  copyDay,
  hm,
  type Week,
  type BlockData,
} from "../../utils/schedule-week";
import { tempUnit } from "../../utils/temperature";
import { blockTempText } from "./rs-block-form";
import "./rs-block-form";

@customElement("rs-schedule-editor")
export class RsScheduleEditor extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ type: String }) public entityId = "";

  @state() private _loaded: LoadedSchedule | null = null;
  @state() private _week: Week = [];
  @state() private _loading = false;
  @state() private _error = "";
  @state() private _selectedDay = 0;
  @state() private _selectedIndex: number | null = null;

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("entityId") && this.entityId && this.hass) {
      void this._load();
    }
  }

  private async _load() {
    this._loading = true;
    this._error = "";
    this._selectedIndex = null;
    try {
      const loaded = await loadSchedule(this.hass, this.entityId);
      this._loaded = loaded;
      this._week = loaded.week;
    } catch {
      this._error = localize("schedule_editor.load_failed", this.hass?.language ?? "en");
    } finally {
      this._loading = false;
    }
  }

  private get _readOnly(): boolean {
    return !this._loaded?.itemId || !isAdmin(this.hass);
  }

  private async _persist(nextWeek: Week) {
    if (!this._loaded?.itemId || this._readOnly) return;
    this._week = nextWeek;
    fireSaveStatus(this, "saving");
    try {
      await saveSchedule(
        this.hass,
        this._loaded.itemId,
        this._loaded.name,
        this._loaded.icon,
        nextWeek,
      );
      fireSaveStatus(this, "saved");
    } catch {
      this._error = localize("schedule_editor.save_failed", this.hass?.language ?? "en");
      fireSaveStatus(this, "error");
    }
  }

  private _addSuggested(dayIdx: number) {
    if (this._readOnly) return;
    const suggestion = suggestBlock(this._week[dayIdx] ?? []);
    if (!suggestion) return;
    const created = createBlock(this._week, dayIdx, suggestion.start, suggestion.end);
    if (!created) return;
    this._selectedDay = dayIdx;
    this._selectedIndex = created.index;
    void this._persist(created.week);
  }

  private _onBlockApply(e: CustomEvent<{ start: number; end: number; data?: BlockData }>) {
    if (this._selectedIndex === null) return;
    let next = setBlockTimes(
      this._week,
      this._selectedDay,
      this._selectedIndex,
      e.detail.start,
      e.detail.end,
    );
    if (!next) {
      this._error = localize("schedule_editor.overlap_error", this.hass?.language ?? "en");
      return;
    }
    this._error = "";
    next = updateBlockData(next, this._selectedDay, this._selectedIndex, e.detail.data);
    void this._persist(next);
  }

  private _onBlockDelete() {
    if (this._selectedIndex === null) return;
    const next = removeBlock(this._week, this._selectedDay, this._selectedIndex);
    this._selectedIndex = null;
    void this._persist(next);
  }

  override render() {
    const l = this.hass?.language ?? "en";
    if (this._loading) {
      return html`<div class="state">${localize("panel.loading", l)}</div>`;
    }
    if (!this._loaded) {
      return this._error ? html`<div class="error">${this._error}</div>` : nothing;
    }

    const activeBlock =
      this._selectedIndex !== null
        ? (this._week[this._selectedDay]?.[this._selectedIndex] ?? null)
        : null;

    return html`
      <ha-card>
        <div class="editor-head">
          <button
            type="button"
            class="back-btn"
            @click=${() =>
              this.dispatchEvent(
                new CustomEvent("schedule-back", { bubbles: true, composed: true }),
              )}
          >
            <ha-icon icon="mdi:arrow-left"></ha-icon>
            <span>${localize("settings_hub.back", l)}</span>
          </button>
          <div class="editor-title">
            <h2>${this._loaded.name}</h2>
            <span class="entity-id">${this._loaded.entityId}</span>
          </div>
          ${
            this._readOnly
              ? html`<span class="ro-badge">${localize("schedule_editor.read_only", l)}</span>`
              : nothing
          }
        </div>

        ${this._error ? html`<div class="error">${this._error}</div>` : nothing}

        <div class="week-list">
          ${WEEKDAYS.map((dayName, dayIdx) => {
            const blocks = this._week[dayIdx] ?? [];
            return html`
              <div class="day-row ${this._selectedDay === dayIdx ? "is-selected" : ""}">
                <div class="day-header">
                  <span class="day-label"
                    >${localize(`schedule_editor.day_${dayName}` as TranslationKey, l)}</span
                  >
                  ${
                    !this._readOnly
                      ? html`
                          <div class="day-actions">
                            <button
                              type="button"
                              class="chip-btn"
                              @click=${() => this._addSuggested(dayIdx)}
                            >
                              + ${localize("schedule_editor.add_block", l)}
                            </button>
                            <button
                              type="button"
                              class="chip-btn"
                              @click=${() =>
                                void this._persist(
                                  copyDay(this._week, dayIdx, [...DAY_GROUPS.all]),
                                )}
                            >
                              ${localize("schedule_editor.copy_all", l)}
                            </button>
                          </div>
                        `
                      : nothing
                  }
                </div>
                <div class="blocks-wrap">
                  ${
                    blocks.length > 0
                      ? blocks.map((b, idx) => {
                          const isSelected =
                            this._selectedDay === dayIdx && this._selectedIndex === idx;
                          const tempText = blockTempText(b.data, tempUnit(this.hass));
                          return html`
                            <button
                              type="button"
                              class="block-chip ${isSelected ? "active" : ""}"
                              @click=${() => {
                                this._selectedDay = dayIdx;
                                this._selectedIndex = idx;
                              }}
                            >
                              <span>${hm(b.start)}–${hm(b.end)}</span>
                              ${tempText ? html`<span class="block-temp">${tempText}</span>` : nothing}
                            </button>
                          `;
                        })
                      : html`<span class="empty-day">—</span>`
                  }
                </div>
              </div>
            `;
          })}
        </div>

        ${
          activeBlock
            ? html`<div class="form-wrap">
                <rs-block-form
                  .hass=${this.hass}
                  .block=${activeBlock}
                  .readOnly=${this._readOnly}
                  @block-apply=${this._onBlockApply}
                  @block-delete=${this._onBlockDelete}
                ></rs-block-form>
              </div>`
            : nothing
        }
      </ha-card>
    `;
  }

  static override styles = css`
    ha-card {
      padding: 16px;
      border-radius: var(--roommind-radius-card, 14px);
    }
    .editor-head {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .back-btn,
    .chip-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.14));
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      font-size: 12.5px;
      cursor: pointer;
    }
    .editor-title {
      flex: 1;
      min-width: 180px;
    }
    .editor-title h2 {
      margin: 0;
      font-size: 17px;
    }
    .entity-id {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .ro-badge {
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 999px;
      background: var(--roommind-surface-muted);
      color: var(--secondary-text-color);
    }
    .week-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .day-row {
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
      background: var(--roommind-surface-subtle, rgba(0, 0, 0, 0.02));
    }
    .day-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .day-label {
      font-size: 13px;
      font-weight: 600;
    }
    .day-actions {
      display: flex;
      gap: 6px;
    }
    .blocks-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .block-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 8px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.14));
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      font: inherit;
      font-size: 12.5px;
      cursor: pointer;
    }
    .block-chip.active {
      border-color: var(--primary-color);
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.1);
    }
    .block-temp {
      font-weight: 600;
      color: var(--primary-color);
    }
    .empty-day {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .form-wrap {
      margin-top: 14px;
    }
    .error {
      color: var(--error-color, #db4437);
      font-size: 13px;
      margin-bottom: 10px;
    }
    .state {
      padding: 32px;
      text-align: center;
      color: var(--secondary-text-color);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-schedule-editor": RsScheduleEditor;
  }
}
