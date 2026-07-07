import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import "./rs-info-icon";

@customElement("rs-toggle-row")
export class RsToggleRow extends LitElement {
  @property({ type: String }) public label = "";
  @property({ type: String }) public hint = "";
  @property({ type: Boolean }) public checked = false;
  @property({ type: Boolean }) public disabled = false;

  static override styles = css`
    :host {
      display: block;
    }

    .toggle-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      min-width: 0;
    }

    .toggle-text {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }

    .toggle-label {
      min-width: 0;
      font-weight: 500;
      line-height: 1.35;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    ha-switch {
      flex-shrink: 0;
      margin-top: -4px;
    }
  `;

  override render() {
    return html`
      <div class="toggle-row">
        <div class="toggle-text">
          <span class="toggle-label">${this.label}</span>
          ${this.hint ? html`<rs-info-icon .text=${this.hint}></rs-info-icon>` : nothing}
        </div>
        <ha-switch
          .checked=${this.checked}
          .disabled=${this.disabled}
          @change=${this._onToggle}
        ></ha-switch>
      </div>
    `;
  }

  private _onToggle(e: Event) {
    this.dispatchEvent(
      new CustomEvent("toggle-changed", {
        detail: (e.target as HTMLInputElement).checked,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-toggle-row": RsToggleRow;
  }
}
