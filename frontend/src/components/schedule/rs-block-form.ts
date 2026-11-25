import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant } from "../../types";
import { localize } from "../../utils/localize";
import { DAY_MINUTES, hm, parseTime, type ScheduleBlock, type BlockData } from "../../utils/schedule-week";
import { tempUnit } from "../../utils/temperature";

export function blockTempText(data: BlockData | undefined, unit: string): string {
  if (!data) return "";
  if (typeof data.temperature === "number") return `${data.temperature}${unit}`;
  const parts: string[] = [];
  if (typeof data.heat_temperature === "number") parts.push(`${data.heat_temperature}${unit}`);
  if (typeof data.cool_temperature === "number") parts.push(`${data.cool_temperature}${unit}`);
  return parts.join(" / ");
}

export function buildUpdatedBlockData(
  existing: BlockData | undefined,
  tempValue: string,
): BlockData | undefined {
  const next: BlockData = { ...(existing ?? {}) };
  delete next.heat_temperature;
  delete next.cool_temperature;
  const trimmed = tempValue.trim();
  if (!trimmed) {
    delete next.temperature;
  } else {
    const parsed = parseFloat(trimmed);
    if (Number.isFinite(parsed)) next.temperature = parsed;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

@customElement("rs-block-form")
export class RsBlockForm extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;
  @property({ attribute: false }) public block: ScheduleBlock | null = null;
  @property({ type: Boolean }) public readOnly = false;

  @state() private _startStr = "08:00";
  @state() private _endStr = "10:00";
  @state() private _tempStr = "";

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("block") && this.block) {
      this._startStr = hm(this.block.start);
      this._endStr = hm(this.block.end === DAY_MINUTES ? DAY_MINUTES : this.block.end);
      const t = this.block.data?.temperature;
      this._tempStr = typeof t === "number" ? String(t) : "";
    }
  }

  private _onApply() {
    if (!this.block) return;
    const start = parseTime(this._startStr);
    const end = this._endStr === "24:00" || this._endStr === "00:00" ? DAY_MINUTES : parseTime(this._endStr);
    if (end <= start) return;
    this.dispatchEvent(
      new CustomEvent("block-apply", {
        detail: {
          start,
          end,
          data: buildUpdatedBlockData(this.block.data, this._tempStr),
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    if (!this.block) return nothing;
    const l = this.hass?.language ?? "en";

    return html`
      <div class="block-form">
        <div class="form-row">
          <ha-textfield
            type="time"
            .label=${localize("schedule_editor.start_time", l)}
            .value=${this._startStr}
            ?disabled=${this.readOnly}
            @change=${(e: Event) => {
              this._startStr = (e.target as HTMLInputElement).value;
            }}
          ></ha-textfield>
          <ha-textfield
            type="time"
            .label=${localize("schedule_editor.end_time", l)}
            .value=${this._endStr === "24:00" ? "23:59" : this._endStr}
            ?disabled=${this.readOnly}
            @change=${(e: Event) => {
              this._endStr = (e.target as HTMLInputElement).value;
            }}
          ></ha-textfield>
          <ha-textfield
            type="number"
            step="0.5"
            .suffix=${tempUnit(this.hass)}
            .label=${localize("schedule_editor.block_temp", l)}
            .value=${this._tempStr}
            ?disabled=${this.readOnly}
            @change=${(e: Event) => {
              this._tempStr = (e.target as HTMLInputElement).value;
            }}
          ></ha-textfield>
        </div>
        ${
          !this.readOnly
            ? html`
                <div class="form-actions">
                  <button type="button" class="btn-primary" @click=${this._onApply}>
                    ${localize("schedule_editor.apply_block", l)}
                  </button>
                  <button
                    type="button"
                    class="btn-danger"
                    @click=${() =>
                      this.dispatchEvent(
                        new CustomEvent("block-delete", { bubbles: true, composed: true }),
                      )}
                  >
                    ${localize("schedule_editor.delete_block", l)}
                  </button>
                </div>
              `
            : nothing
        }
      </div>
    `;
  }

  static override styles = css`
    .block-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      border-radius: 8px;
      background: var(--roommind-surface-subtle, rgba(0, 0, 0, 0.03));
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.1));
    }
    .form-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 10px;
    }
    .form-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    button {
      padding: 6px 14px;
      border-radius: 6px;
      border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.14));
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .btn-primary {
      background: var(--primary-color);
      border-color: var(--primary-color);
      color: var(--text-primary-color, #fff);
    }
    .btn-danger {
      color: var(--error-color, #db4437);
      border-color: var(--error-color, #db4437);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-block-form": RsBlockForm;
  }
}
