/**
 * rs-analytics-toolbar – Room quick-switcher, range bar, refresh & export/diagnostics controls.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, RoomConfig, AnalyticsData } from "../../types";
import { localize } from "../../utils/localize";
import { getSelectValue } from "../../utils/events";
import { formatTemp, tempUnit } from "../../utils/temperature";
import { buildCsvString, downloadString, buildExportFilename } from "../../utils/analytics-export";
import { copyToClipboard } from "../../utils/clipboard";
import { inputStyles } from "../../styles/input-styles";

interface RoomSelectorOption {
  area_id: string;
  name: string;
  currentTemp: number | null;
}

@customElement("rs-analytics-toolbar")
export class RsAnalyticsToolbar extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public rooms: Record<string, RoomConfig> = {};
  @property({ type: String }) public selectedRoom = "";
  @property({ type: Number }) public rangeStart = 0;
  @property({ type: Number }) public rangeEnd = 0;
  @property({ type: String }) public activeQuick: string | null = "24h";
  @property({ attribute: false }) public data: AnalyticsData | null = null;
  @property({ type: String }) public language = "en";

  @state() private _openDropdown: "csv" | "diag" | null = null;
  @state() private _diagLoading = false;
  @state() private _copiedAction: "csv" | "diag" | null = null;

  private _boundCloseDropdowns = this._closeDropdowns.bind(this);
  private _copiedTimer?: ReturnType<typeof setTimeout>;

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this._boundCloseDropdowns);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("click", this._boundCloseDropdowns);
    if (this._copiedTimer) clearTimeout(this._copiedTimer);
  }

  protected override updated(changedProps: Map<string, unknown>) {
    if ((changedProps.has("rooms") || changedProps.has("selectedRoom")) && this.selectedRoom) {
      this.updateComplete.then(() => {
        const select = this.renderRoot?.querySelector("ha-select") as
          (HTMLElement & { value?: string }) | null;
        if (select && select.value !== this.selectedRoom) {
          select.value = this.selectedRoom;
        }
      });
    }
  }

  override render() {
    const l = this.language;
    const configuredRooms = this._getConfiguredRooms();

    return html`
      <div class="toolbar-card">
        <div class="toolbar-top">
          ${this._renderRoomSelector(configuredRooms, l)}
          ${this.selectedRoom ? this._renderActions(l) : nothing}
        </div>
        ${this.selectedRoom ? this._renderRangeRow(l) : nothing}
      </div>
    `;
  }

  private _getConfiguredRooms(): RoomSelectorOption[] {
    return Object.entries(this.rooms).map(([area_id, config]) => {
      const area = this.hass?.areas?.[area_id];
      const currentTemp = config.live?.current_temp ?? null;
      return {
        area_id,
        name: config.display_name || area?.name || area_id,
        currentTemp: typeof currentTemp === "number" ? currentTemp : null,
      };
    });
  }

  private _renderRoomSelector(rooms: RoomSelectorOption[], l: string) {
    if (rooms.length === 0) return nothing;
    const unit = tempUnit(this.hass);

    if (rooms.length <= 8) {
      return html`
        <div class="room-pills" role="tablist" aria-label=${localize("analytics.select_room", l)}>
          ${rooms.map((r) => {
            const active = r.area_id === this.selectedRoom;
            return html`
              <button
                type="button"
                class="room-pill"
                role="tab"
                aria-selected=${active}
                ?active=${active}
                @click=${() => this._selectRoom(r.area_id)}
              >
                <span class="room-pill-name">${r.name}</span>
                ${
                  r.currentTemp !== null
                    ? html`<span class="room-pill-temp"
                        >${formatTemp(r.currentTemp, this.hass)}${unit}</span
                      >`
                    : nothing
                }
              </button>
            `;
          })}
        </div>
      `;
    }

    return html`
      <div class="selector-select-wrap">
        <ha-select
          .value=${this.selectedRoom}
          .label=${localize("analytics.select_room", l)}
          .options=${rooms.map((r) => ({ value: r.area_id, label: r.name }))}
          naturalMenuWidth
          fixedMenuPosition
          @selected=${this._onRoomSelected}
          @closed=${(e: Event) => e.stopPropagation()}
        >
          ${rooms.map((r) => html`<ha-list-item value=${r.area_id}>${r.name}</ha-list-item>`)}
        </ha-select>
      </div>
    `;
  }

  private _renderActions(l: string) {
    const hasData = this.data && (this.data.history.length > 0 || this.data.detail.length > 0);
    return html`
      <div class="action-buttons">
        <button
          type="button"
          class="tool-btn icon-only"
          title=${localize("analytics.refresh", l)}
          aria-label=${localize("analytics.refresh", l)}
          @click=${() =>
            this.dispatchEvent(
              new CustomEvent("refresh-requested", { bubbles: true, composed: true }),
            )}
        >
          <ha-icon icon="mdi:refresh"></ha-icon>
        </button>

        <div class="export-split">
          <button
            type="button"
            class="tool-btn"
            ?disabled=${!hasData}
            @click=${(e: Event) => {
              e.stopPropagation();
              this._toggleDropdown("csv");
            }}
          >
            <ha-icon icon=${this._copiedAction === "csv" ? "mdi:check" : "mdi:download"}></ha-icon>
            <span>
              ${
                this._copiedAction === "csv"
                  ? localize("analytics.copied_to_clipboard", l)
                  : localize("analytics.export", l)
              }
            </span>
            <ha-icon class="arrow-icon" icon="mdi:chevron-down"></ha-icon>
          </button>
          ${
            this._openDropdown === "csv"
              ? html`<div class="export-dropdown" @click=${(e: Event) => e.stopPropagation()}>
                  <button type="button" @click=${this._exportCsv}>
                    <ha-icon icon="mdi:download"></ha-icon>
                    ${localize("analytics.export_download", l)}
                  </button>
                  <button type="button" @click=${this._copyCsvToClipboard}>
                    <ha-icon icon="mdi:content-copy"></ha-icon>
                    ${localize("analytics.export_clipboard", l)}
                  </button>
                </div>`
              : nothing
          }
        </div>

        <div class="export-split">
          <button
            type="button"
            class="tool-btn"
            ?disabled=${this._diagLoading}
            @click=${(e: Event) => {
              e.stopPropagation();
              this._toggleDropdown("diag");
            }}
          >
            <ha-icon
              icon=${
                this._copiedAction === "diag"
                  ? "mdi:check"
                  : this._diagLoading
                    ? "mdi:loading"
                    : "mdi:bug-outline"
              }
            ></ha-icon>
            <span>
              ${
                this._copiedAction === "diag"
                  ? localize("analytics.copied_to_clipboard", l)
                  : localize("analytics.copy_diagnostics", l)
              }
            </span>
            <ha-icon class="arrow-icon" icon="mdi:chevron-down"></ha-icon>
          </button>
          ${
            this._openDropdown === "diag"
              ? html`<div class="export-dropdown" @click=${(e: Event) => e.stopPropagation()}>
                  <button type="button" @click=${this._exportDiagnostics}>
                    <ha-icon icon="mdi:download"></ha-icon>
                    ${localize("analytics.export_download", l)}
                  </button>
                  <button type="button" @click=${this._copyDiagnosticsToClipboard}>
                    <ha-icon icon="mdi:content-copy"></ha-icon>
                    ${localize("analytics.export_clipboard", l)}
                  </button>
                </div>`
              : nothing
          }
        </div>
      </div>
    `;
  }

  private _renderRangeRow(l: string) {
    const quickRanges = [
      { key: "6h", label: localize("analytics.range_6h", l), hours: 6 },
      { key: "24h", label: localize("analytics.range_1d", l), days: 1 },
      { key: "2d", label: localize("analytics.range_2d", l), days: 2 },
      { key: "7d", label: localize("analytics.range_7d", l), days: 7 },
      { key: "30d", label: localize("analytics.range_30d", l), days: 30 },
    ];

    const fmt = (ms: number) =>
      new Date(ms).toLocaleString(this.hass.language, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

    return html`
      <div class="range-row">
        <div class="range-bar">
          ${quickRanges.map(
            (r) => html`
              <button
                type="button"
                class="range-chip"
                ?active=${this.activeQuick === r.key}
                @click=${() => this._onQuickRange(r.key, r.days, r.hours)}
              >
                ${r.label}
              </button>
            `,
          )}
          <div class="range-chip picker-chip ${this.activeQuick === null ? "picker-active" : ""}">
            <ha-date-range-picker
              .hass=${this.hass}
              .startDate=${new Date(this.rangeStart)}
              .endDate=${new Date(this.rangeEnd)}
              .ranges=${false}
              time-picker
              auto-apply
              minimal
              @value-changed=${this._onDateRangeChanged}
            ></ha-date-range-picker>
          </div>
        </div>
        <span class="date-label ${this.activeQuick === null ? "custom-active" : ""}"
          >${fmt(this.rangeStart)} – ${fmt(this.rangeEnd)}</span
        >
      </div>
    `;
  }

  private _selectRoom(areaId: string) {
    if (areaId && areaId !== this.selectedRoom) {
      this.dispatchEvent(
        new CustomEvent("room-selected", {
          detail: { areaId },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private _onRoomSelected(e: Event) {
    const value = getSelectValue(e);
    if (value) this._selectRoom(value);
  }

  private _onQuickRange(key: string, days?: number, hours?: number) {
    const now = new Date();
    const start = new Date(now);
    if (hours != null) {
      start.setTime(now.getTime() - hours * 3600_000);
    } else if (days != null) {
      start.setDate(start.getDate() - (days - 1));
      start.setHours(0, 0, 0, 0);
    }
    this.dispatchEvent(
      new CustomEvent("range-changed", {
        detail: {
          activeQuick: key,
          rangeStart: start.getTime(),
          rangeEnd: now.getTime(),
          chartAnchor: now.getTime(),
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onDateRangeChanged(e: CustomEvent) {
    const { startDate, endDate } = e.detail.value as { startDate: Date; endDate: Date };
    if (!startDate || !endDate) return;
    this.dispatchEvent(
      new CustomEvent("range-changed", {
        detail: {
          activeQuick: null,
          rangeStart: startDate.getTime(),
          rangeEnd: endDate.getTime(),
          chartAnchor: endDate.getTime(),
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _markCopied(kind: "csv" | "diag") {
    this._copiedAction = kind;
    if (this._copiedTimer) clearTimeout(this._copiedTimer);
    this._copiedTimer = setTimeout(() => {
      this._copiedAction = null;
    }, 1800);
  }

  private _exportCsv() {
    if (!this.data) return;
    const csv = buildCsvString(this.data);
    if (!csv) return;
    const filename = buildExportFilename(
      this.hass,
      this.rooms,
      this.selectedRoom,
      this.rangeStart,
      this.rangeEnd,
      "",
      "csv",
    );
    downloadString(csv, filename, "text/csv");
    this._openDropdown = null;
  }

  private async _exportDiagnostics() {
    if (this._diagLoading) return;
    this._diagLoading = true;
    this._openDropdown = null;
    try {
      const result = await this.hass.callWS<Record<string, unknown>>({
        type: "roommind/diagnostics/get",
      });
      const json = JSON.stringify(result, null, 2);
      downloadString(json, "roommind_diagnostics.json", "application/json");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[RoomMind] diagnostics export failed:", err);
    } finally {
      this._diagLoading = false;
    }
  }

  private _copyCsvToClipboard() {
    if (!this.data) return;
    const csv = buildCsvString(this.data);
    if (!csv) return;
    copyToClipboard(csv);
    this._openDropdown = null;
    this._markCopied("csv");
  }

  private async _copyDiagnosticsToClipboard() {
    if (this._diagLoading) return;
    this._diagLoading = true;
    this._openDropdown = null;
    try {
      const result = await this.hass.callWS<Record<string, unknown>>({
        type: "roommind/diagnostics/get",
      });
      const json = JSON.stringify(result, null, 2);
      copyToClipboard(json);
      this._markCopied("diag");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[RoomMind] diagnostics clipboard failed:", err);
    } finally {
      this._diagLoading = false;
    }
  }

  private _toggleDropdown(id: "csv" | "diag") {
    this._openDropdown = this._openDropdown === id ? null : id;
  }

  private _closeDropdowns() {
    if (this._openDropdown) {
      this._openDropdown = null;
    }
  }

  static override styles = [
    inputStyles,
    css`
      :host {
        display: block;
      }

      .toolbar-card {
        display: grid;
        gap: 10px;
        padding: 12px 14px;
        border-radius: var(--roommind-radius-card, 12px);
        border: var(--roommind-border-subtle, 1px solid var(--divider-color));
        background: var(--roommind-surface, var(--card-background-color));
      }

      .toolbar-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }

      .room-pills {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        flex: 1 1 260px;
        min-width: 0;
      }

      .room-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 32px;
        padding: 4px 10px;
        border-radius: 999px;
        border: var(--roommind-border-subtle, 1px solid var(--divider-color));
        background: var(--roommind-surface-subtle);
        color: var(--primary-text-color);
        font: inherit;
        font-size: 12.5px;
        font-weight: 550;
        cursor: pointer;
        transition:
          background var(--roommind-motion-duration, 160ms) ease,
          border-color var(--roommind-motion-duration, 160ms) ease;
      }

      .room-pill:hover:not([active]) {
        border-color: var(--roommind-primary-border);
        background: var(--roommind-surface-hover);
      }

      .room-pill[active] {
        border-color: var(--roommind-primary-border);
        background: var(--roommind-primary-strong);
        color: var(--primary-color);
        font-weight: 650;
      }

      .room-pill-temp {
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        opacity: 0.78;
      }

      .selector-select-wrap {
        flex: 1 1 240px;
        min-width: 0;
      }

      .selector-select-wrap ha-select {
        width: 100%;
      }

      .action-buttons {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      .export-split {
        position: relative;
        display: inline-flex;
      }

      .tool-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-height: 32px;
        padding: 4px 10px;
        border: var(--roommind-border-subtle, 1px solid var(--divider-color));
        border-radius: var(--roommind-radius-control, 8px);
        background: var(--roommind-surface-subtle);
        color: var(--secondary-text-color);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
        white-space: nowrap;
        --mdc-icon-size: 15px;
      }

      .tool-btn.icon-only {
        padding: 4px 8px;
      }

      .tool-btn:hover:not([disabled]) {
        color: var(--primary-text-color);
        border-color: var(--primary-color);
        background: var(--roommind-surface-hover);
      }

      .tool-btn[disabled] {
        opacity: 0.45;
        cursor: default;
      }

      .arrow-icon {
        --mdc-icon-size: 14px;
        margin-right: -2px;
      }

      .export-dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        margin-top: 4px;
        min-width: 160px;
        background: var(--roommind-surface, var(--card-background-color));
        border: var(--roommind-border-subtle, 1px solid var(--divider-color));
        border-radius: var(--roommind-radius-control, 8px);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
        z-index: 10;
        overflow: hidden;
      }

      .export-dropdown button {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 9px 12px;
        border: none;
        background: transparent;
        color: var(--primary-text-color);
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        white-space: nowrap;
        --mdc-icon-size: 15px;
      }

      .export-dropdown button:hover {
        background: var(--roommind-primary-muted);
      }

      .export-dropdown button + button {
        border-top: var(--roommind-border-faint, 1px solid var(--divider-color));
      }

      .range-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
        padding-top: 8px;
        border-top: var(--roommind-border-faint, 1px solid var(--divider-color));
      }

      .range-bar {
        display: inline-flex;
        flex-wrap: wrap;
        border-radius: var(--roommind-radius-control, 8px);
        border: var(--roommind-border-subtle, 1px solid var(--divider-color));
        background: var(--roommind-surface-subtle);
        overflow: hidden;
      }

      .range-chip {
        padding: 6px 12px;
        border: none;
        border-right: var(--roommind-border-faint, 1px solid var(--divider-color));
        background: transparent;
        color: var(--secondary-text-color);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition:
          background 0.15s ease,
          color 0.15s ease;
        font-family: inherit;
        white-space: nowrap;
      }

      .range-chip:last-child {
        border-right: none;
      }

      .range-chip:hover:not([active]) {
        background: var(--roommind-primary-muted);
        color: var(--primary-text-color);
      }

      .range-chip[active] {
        background: var(--roommind-primary-strong);
        color: var(--primary-color);
      }

      .picker-chip {
        display: flex;
        align-items: center;
        padding: 0 2px;
        cursor: pointer;
      }

      .picker-chip ha-date-range-picker {
        --mdc-icon-size: 17px;
        --mdc-icon-button-size: 30px;
      }

      .picker-chip.picker-active {
        background: var(--roommind-primary-strong);
        color: var(--primary-color);
      }

      .date-label {
        font-size: 12px;
        color: var(--secondary-text-color);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .date-label.custom-active {
        color: var(--primary-color);
        font-weight: 600;
      }

      @media (max-width: 600px) {
        .toolbar-card {
          padding: 10px 12px;
        }

        .range-chip {
          padding: 6px 9px;
          font-size: 11.5px;
        }
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-analytics-toolbar": RsAnalyticsToolbar;
  }
}
