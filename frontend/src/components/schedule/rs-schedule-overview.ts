import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, RoomConfig } from "../../types";
import { localize, type TranslationKey } from "../../utils/localize";
import {
  createSchedule,
  deleteSchedule,
  isAdmin,
  isEditableSchedule,
  loadSchedule,
} from "../../utils/schedule-api";
import { TEMPLATES, emptyWeek } from "../../utils/schedule-week";
import "./rs-schedule-editor";

@customElement("rs-schedule-overview")
export class RsScheduleOverview extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public rooms: Record<string, RoomConfig> = {};

  @state() private _editingEntityId: string | null = null;
  @state() private _creating = false;
  @state() private _newName = "";
  @state() private _templateId: "split" | "day" | "home" | "empty" = "split";
  @state() private _busy = false;
  @state() private _error = "";

  private _roomUsage(entityId: string): string[] {
    const used: string[] = [];
    for (const [areaId, cfg] of Object.entries(this.rooms)) {
      const matchesSchedule =
        (cfg.schedules ?? []).some((s) => s.entity_id === entityId) ||
        (cfg.cover_schedules ?? []).some((s) => s.entity_id === entityId);
      if (matchesSchedule) {
        used.push(cfg.display_name || this.hass?.areas?.[areaId]?.name || areaId);
      }
    }
    return used;
  }

  private async _onCreate() {
    const name = this._newName.trim();
    if (!name || this._busy) return;
    this._busy = true;
    this._error = "";
    try {
      const tpl = TEMPLATES.find((t) => t.id === this._templateId);
      const week = tpl ? tpl.make() : emptyWeek();
      const entityId = await createSchedule(this.hass, name, week);
      this._creating = false;
      this._newName = "";
      this._editingEntityId = entityId;
    } catch {
      this._error = localize("schedule_editor.create_failed", this.hass?.language ?? "en");
    } finally {
      this._busy = false;
    }
  }

  private async _onDelete(entityId: string) {
    if (this._busy) return;
    this._busy = true;
    this._error = "";
    try {
      const loaded = await loadSchedule(this.hass, entityId);
      if (loaded.itemId) {
        await deleteSchedule(this.hass, loaded.itemId);
      }
    } catch {
      this._error = localize("schedule_editor.delete_failed", this.hass?.language ?? "en");
    } finally {
      this._busy = false;
    }
  }

  override render() {
    if (this._editingEntityId) {
      return html`<rs-schedule-editor
        .hass=${this.hass}
        .entityId=${this._editingEntityId}
        @schedule-back=${() => {
          this._editingEntityId = null;
        }}
      ></rs-schedule-editor>`;
    }

    const l = this.hass?.language ?? "en";
    const admin = isAdmin(this.hass);
    const scheduleIds = Object.keys(this.hass?.states ?? {})
      .filter((eid) => eid.startsWith("schedule."))
      .sort();

    return html`
      <div class="overview-wrap">
        <div class="overview-head">
          <div>
            <h2>${localize("schedule_editor.title", l)}</h2>
            <p class="subtitle">${localize("schedule_editor.subtitle", l)}</p>
          </div>
          ${
            admin
              ? html`<button
                  type="button"
                  class="primary-btn"
                  @click=${() => {
                    this._creating = !this._creating;
                  }}
                >
                  <ha-icon icon="mdi:plus"></ha-icon>
                  <span>${localize("schedule_editor.new_schedule", l)}</span>
                </button>`
              : nothing
          }
        </div>

        ${this._error ? html`<div class="error">${this._error}</div>` : nothing}
        ${
          this._creating
            ? html`
                <ha-card class="create-card">
                  <div class="create-grid">
                    <ha-textfield
                      .label=${localize("schedule_editor.name_label", l)}
                      .value=${this._newName}
                      @input=${(e: Event) => {
                        this._newName = (e.target as HTMLInputElement).value;
                      }}
                    ></ha-textfield>
                    <select
                      class="tpl-select"
                      .value=${this._templateId}
                      @change=${(e: Event) => {
                        this._templateId = (e.target as HTMLSelectElement).value as
                          "split" | "day" | "home" | "empty";
                      }}
                    >
                      ${TEMPLATES.map(
                        (t) =>
                          html`<option value=${t.id}>
                            ${localize(`schedule_editor.tpl_${t.id}` as TranslationKey, l)}
                          </option>`,
                      )}
                      <option value="empty">${localize("schedule_editor.tpl_empty", l)}</option>
                    </select>
                    <button
                      type="button"
                      class="primary-btn"
                      ?disabled=${this._busy || !this._newName.trim()}
                      @click=${this._onCreate}
                    >
                      ${localize("schedule_editor.create_confirm", l)}
                    </button>
                  </div>
                </ha-card>
              `
            : nothing
        }
        ${
          scheduleIds.length === 0
            ? html`<ha-card class="empty-card">${localize("schedule_editor.empty", l)}</ha-card>`
            : html`
                <div class="cards-grid">
                  ${scheduleIds.map((eid) => {
                    const st = this.hass.states[eid];
                    const name = (st?.attributes?.friendly_name as string) || eid;
                    const usage = this._roomUsage(eid);
                    const editable = isEditableSchedule(this.hass, eid) && admin;
                    return html`
                      <ha-card class="schedule-card">
                        <div class="card-top">
                          <div class="card-info" @click=${() => (this._editingEntityId = eid)}>
                            <div class="card-name">${name}</div>
                            <div class="card-eid">${eid}</div>
                          </div>
                          <span class="state-pill">${st?.state ?? ""}</span>
                        </div>
                        <div class="card-meta">
                          ${
                            usage.length > 0
                              ? usage.join(", ")
                              : localize("schedule_editor.unused", l)
                          }
                        </div>
                        <div class="card-actions">
                          <button
                            type="button"
                            class="secondary-btn"
                            @click=${() => (this._editingEntityId = eid)}
                          >
                            ${localize(editable ? "panel.edit" : "schedule_editor.view", l)}
                          </button>
                          ${
                            editable && usage.length === 0
                              ? html`<button
                                  type="button"
                                  class="danger-btn"
                                  ?disabled=${this._busy}
                                  @click=${() => void this._onDelete(eid)}
                                >
                                  ${localize("schedule_editor.delete_block", l)}
                                </button>`
                              : nothing
                          }
                        </div>
                      </ha-card>
                    `;
                  })}
                </div>
              `
        }
      </div>
    `;
  }

  static override styles = css`
    .overview-wrap {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 0 16px 24px;
    }
    .overview-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .overview-head h2 {
      margin: 0;
      font-size: 18px;
    }
    .subtitle {
      margin: 4px 0 0;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .primary-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border: none;
      border-radius: 8px;
      background: var(--primary-color);
      color: var(--text-primary-color, #fff);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .create-card {
      padding: 14px;
    }
    .create-grid {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .tpl-select {
      padding: 10px;
      border-radius: 6px;
      border: 1px solid var(--divider-color, #ccc);
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      font: inherit;
    }
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
      gap: 12px;
    }
    .schedule-card,
    .empty-card {
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .card-top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .card-info {
      cursor: pointer;
      min-width: 0;
    }
    .card-name {
      font-weight: 600;
      font-size: 14.5px;
    }
    .card-eid {
      font-size: 11.5px;
      color: var(--secondary-text-color);
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .state-pill {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--roommind-surface-muted);
      height: fit-content;
    }
    .card-meta {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .card-actions {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }
    .secondary-btn,
    .danger-btn {
      padding: 5px 12px;
      border-radius: 6px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.14));
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      font-size: 12.5px;
      cursor: pointer;
    }
    .danger-btn {
      color: var(--error-color, #db4437);
    }
    .error {
      color: var(--error-color, #db4437);
      font-size: 13px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-schedule-overview": RsScheduleOverview;
  }
}
