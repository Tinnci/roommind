/**
 * rs-settings-panel – Reusable accordion panel for settings sections.
 * Wraps ha-expansion-panel with icon, title, optional badge, and intro text.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import "../shared/rs-badge";

@customElement("rs-settings-panel")
export class RsSettingsPanel extends LitElement {
  @property({ type: String }) public icon = "";
  @property({ type: String }) public heading = "";
  @property({ type: String }) public summary = "";
  @property({ type: String }) public intro = "";
  @property({ type: String }) public badge = "";
  @property({ type: String }) public badgeHint = "";

  override render() {
    return html`
      <ha-expansion-panel outlined>
        <div slot="header" class="panel-header">
          <ha-icon .icon=${this.icon}></ha-icon>
          <span class="header-copy">
            <span class="panel-title">${this.heading}</span>
            ${this.summary ? html`<span class="panel-summary">${this.summary}</span>` : nothing}
          </span>
          ${this.badge
            ? html`<rs-badge .label=${this.badge} .hint=${this.badgeHint}></rs-badge>`
            : nothing}
        </div>
        <div class="panel-content">
          ${this.intro ? html`<p class="section-intro">${this.intro}</p>` : nothing}
          <slot></slot>
        </div>
      </ha-expansion-panel>
    `;
  }

  static override styles = css`
    :host {
      display: block;
    }

    .panel-header {
      display: flex;
      align-items: center;
      gap: 10px;
      --mdc-icon-size: 20px;
      color: var(--secondary-text-color);
      min-width: 0;
    }

    .header-copy {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }

    .panel-title {
      color: var(--primary-text-color);
      font-weight: 600;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .panel-summary {
      color: var(--secondary-text-color);
      font-size: 12px;
      font-weight: 500;
      line-height: 1.25;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .panel-content {
      padding: 14px 16px 16px;
    }

    .section-intro {
      color: var(--secondary-text-color);
      font-size: 13px;
      line-height: 1.5;
      margin: 0 0 14px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-settings-panel": RsSettingsPanel;
  }
}
