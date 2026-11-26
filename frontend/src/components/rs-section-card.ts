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
        border-radius: var(--roommind-radius-card, 14px);
        border: var(--roommind-border-subtle, 1px solid var(--divider-color, rgba(0, 0, 0, 0.08)));
        background: var(--roommind-surface);
        color: var(--primary-text-color);
        box-shadow: var(--roommind-shadow-card, none);
      }

      .section-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        row-gap: 8px;
        min-height: var(--roommind-header-min-height, 38px);
        padding: 11px 16px;
        background: var(--roommind-surface);
        border-bottom: var(
          --roommind-border-faint,
          1px solid var(--divider-color, rgba(0, 0, 0, 0.06))
        );
      }

      .section-icon-wrap {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        background: var(--roommind-primary-muted);
        color: var(--primary-color);
        flex: 0 0 auto;
      }

      .section-icon {
        --mdc-icon-size: 17px;
      }

      .section-title {
        font-size: 14px;
        font-weight: 650;
        color: var(--primary-text-color);
        margin: 0;
        flex: 1 1 140px;
        min-width: 0;
        line-height: 1.3;
        overflow-wrap: break-word;
        white-space: normal;
      }

      .edit-btn {
        --mdc-icon-button-size: 32px;
        --mdc-icon-size: 18px;
        color: var(--secondary-text-color);
        margin: -4px -8px -4px 0;
        flex-shrink: 0;
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
        padding: 12px 16px 14px;
        background: var(--roommind-surface);
      }
    `,
  ];

  override render() {
    return html`
      <ha-card>
        <div class="section-header">
          <span class="section-icon-wrap">
            <ha-icon class="section-icon" icon=${this.icon}></ha-icon>
          </span>
          <h3 class="section-title">${this.heading}</h3>
          ${
            this.badge
              ? html`<rs-badge .label=${this.badge} .hint=${this.badgeHint}></rs-badge>`
              : nothing
          }
          <slot name="header-extras"></slot>
          ${
            this.editable
              ? html`
                  <ha-icon-button
                    class="edit-btn"
                    .path=${PENCIL_PATH}
                    .label=${`Edit ${this.heading}`}
                    @click=${this._onEditClick}
                  ></ha-icon-button>
                `
              : nothing
          }
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
