import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import "./shared/rs-badge";
import { roommindThemeStyles } from "../styles/theme-styles";

const PENCIL_PATH =
  "M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z";

@customElement("rs-section-card")
export class RsSectionCard extends LitElement {
  @property({ type: String }) public icon = "";
  @property({ type: String }) public heading = "";
  @property({ type: String }) public badge = "";
  @property({ type: String }) public badgeHint = "";
  @property({ type: Boolean }) public editable = false;

  static override styles = [
    roommindThemeStyles,
    css`
      :host {
        display: block;
      }

      ha-card {
        overflow: hidden;
        min-width: 0;
        border-radius: var(--roommind-radius-card, 8px);
        border: var(--roommind-border-subtle, 1px solid var(--divider-color, rgba(0, 0, 0, 0.08)));
        background: var(--roommind-panel-surface);
        color: var(--primary-text-color);
        box-shadow: none;
      }

      .section-header {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: var(--roommind-header-min-height, 44px);
        padding: 12px 16px 10px;
        background: var(--roommind-panel-surface);
        border-bottom: var(
          --roommind-border-faint,
          1px solid var(--divider-color, rgba(0, 0, 0, 0.06))
        );
      }

      .section-icon {
        --mdc-icon-size: 18px;
        opacity: 0.7;
      }

      .section-title {
        font-size: 15px;
        font-weight: 600;
        color: var(--primary-text-color);
        margin: 0;
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .edit-btn {
        --mdc-icon-button-size: 32px;
        --mdc-icon-size: 18px;
        color: var(--secondary-text-color);
        margin: -4px -8px -4px 0;
        opacity: 0.58;
        transition:
          opacity 0.15s ease,
          color 0.15s ease,
          background 0.15s ease;
      }

      @media (hover: hover) {
        ha-card:hover .edit-btn,
        ha-card:focus-within .edit-btn {
          opacity: 1;
          color: var(--primary-color);
        }
      }

      .section-body {
        padding: 14px 16px 16px;
        background: var(--roommind-panel-surface);
      }
    `,
  ];

  override render() {
    return html`
      <ha-card>
        <div class="section-header">
          <ha-icon class="section-icon" icon=${this.icon}></ha-icon>
          <h3 class="section-title">${this.heading}</h3>
          ${this.badge
            ? html`<rs-badge .label=${this.badge} .hint=${this.badgeHint}></rs-badge>`
            : nothing}
          <slot name="header-extras"></slot>
          ${this.editable
            ? html`
                <ha-icon-button
                  class="edit-btn"
                  .path=${PENCIL_PATH}
                  .label=${`Edit ${this.heading}`}
                  @click=${this._onEditClick}
                ></ha-icon-button>
              `
            : nothing}
        </div>
        <div class="section-body">
          <slot></slot>
        </div>
      </ha-card>
    `;
  }

  private _onEditClick() {
    this.dispatchEvent(new CustomEvent("edit-click", { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-section-card": RsSectionCard;
  }
}
