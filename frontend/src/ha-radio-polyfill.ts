/**
 * Polyfill for `ha-radio`, removed in Home Assistant 2026.6.
 *
 * RoomMind still renders `<ha-radio>` through its local radio group wrapper.
 * When HA does not provide that element, this wrapper preserves the small API
 * surface RoomMind uses: checked, value, name, disabled, and change events.
 */
import { LitElement, html, css, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";

export class HaRadioPolyfill extends LitElement {
  @property({ type: Boolean, reflect: true }) public checked = false;
  @property({ type: Boolean, reflect: true }) public disabled = false;
  @property({ type: String }) public name = "";
  @property({ type: String }) public value = "";

  static override shadowRootOptions: ShadowRootInit = {
    mode: "open",
    delegatesFocus: true,
  };

  static override styles = css`
    :host {
      display: inline-flex;
      align-items: center;
    }

    input {
      width: 18px;
      height: 18px;
      margin: 0;
      accent-color: var(--primary-color, #03a9f4);
      cursor: pointer;
    }

    input:disabled {
      cursor: default;
      opacity: 0.5;
    }
  `;

  protected override render(): TemplateResult {
    return html`
      <input
        type="radio"
        .checked=${this.checked}
        .value=${this.value}
        name=${this.name || undefined}
        ?disabled=${this.disabled}
        @change=${this._onChange}
      />
    `;
  }

  private _onChange(e: Event): void {
    this.checked = (e.target as HTMLInputElement).checked;
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-radio": HaRadioPolyfill;
  }
}
