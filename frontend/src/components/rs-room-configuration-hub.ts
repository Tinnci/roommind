import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  buildConfigurationHubItems,
  type ConfigurationEditSection,
  type ConfigurationHubMetrics,
} from "../utils/room-configuration-hub";
import type { ConfigurationRoomSection } from "../utils/room-detail-layout";
import { localize } from "../utils/localize";
import "./rs-section-card";

@customElement("rs-room-configuration-hub")
export class RsRoomConfigurationHub extends LitElement {
  @property({ attribute: false }) public sections: ConfigurationRoomSection[] = [];
  @property({ attribute: false }) public metrics: ConfigurationHubMetrics = {};
  @property({ type: Boolean }) public isOutdoor = false;
  @property({ type: String }) public language = "en";

  override render() {
    if (this.sections.length === 0) return nothing;
    const items = buildConfigurationHubItems(this.sections, this.metrics);

    return html`
      <rs-section-card
        icon="mdi:tune-variant"
        .heading=${localize("room.section.configuration", this.language)}
      >
        <div class="config-grid">
          ${items.map((item) =>
            item.editable
              ? html`
                  <button
                    class="config-group ${item.tone}"
                    type="button"
                    @click=${() => this._emitEdit(item.editSection!)}
                    aria-label=${`${localize("panel.edit", this.language)} ${localize(
                      item.titleKey,
                      this.language,
                    )}`}
                  >
                    ${this._renderGroupBody(item)}
                  </button>
                `
              : html`
                  <div class="config-group config-row-static ${item.tone}">
                    ${this._renderGroupBody(item)}
                    <ha-switch
                      .checked=${this.isOutdoor}
                      @change=${(e: Event) =>
                        this._emitOutdoorChange((e.target as HTMLInputElement).checked)}
                    ></ha-switch>
                  </div>
                `,
          )}
        </div>
      </rs-section-card>
    `;
  }

  private _renderGroupBody(item: ReturnType<typeof buildConfigurationHubItems>[number]) {
    return html`
      <span class="config-icon"><ha-icon icon=${item.icon}></ha-icon></span>
      <span class="config-main">
        <span class="config-title-line">
          <span class="config-title">${localize(item.titleKey, this.language)}</span>
          <span class="config-status">${this._toneLabel(item.tone)}</span>
        </span>
        <span class="config-meta">${localize(item.metaKey, this.language, item.metaParams)}</span>
      </span>
      ${item.editable
        ? html`<ha-icon class="config-chevron" icon="mdi:chevron-right"></ha-icon>`
        : nothing}
    `;
  }

  private _toneLabel(tone: string) {
    switch (tone) {
      case "complete":
        return localize("room.config.status_complete", this.language);
      case "partial":
        return localize("room.config.status_partial", this.language);
      case "missing":
        return localize("room.config.status_missing", this.language);
      default:
        return localize("room.config.status_optional", this.language);
    }
  }

  private _emitEdit(section: ConfigurationEditSection) {
    this.dispatchEvent(
      new CustomEvent("configuration-edit", {
        detail: { section },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _emitOutdoorChange(value: boolean) {
    this.dispatchEvent(
      new CustomEvent("outdoor-changed", {
        detail: value,
        bubbles: true,
        composed: true,
      }),
    );
  }

  static override styles = css`
    :host {
      display: block;
    }

    .config-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr));
      gap: 8px;
    }

    .config-group {
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr) 20px;
      align-items: center;
      gap: 12px;
      width: 100%;
      min-height: 74px;
      border: var(--roommind-border-subtle);
      border-radius: var(--roommind-radius-control, 8px);
      padding: 10px;
      background: var(--roommind-surface);
      color: var(--primary-text-color);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .config-group.complete {
      border-color: var(--roommind-success-border);
    }

    .config-group.partial {
      border-color: var(--roommind-warning-border);
    }

    .config-group.missing {
      border-color: var(--roommind-error-border);
    }

    .config-group:hover,
    .config-group:focus-visible {
      background: var(--roommind-surface-hover);
      outline: none;
    }

    .config-row-static {
      cursor: default;
    }

    .config-row-static:hover {
      background: var(--roommind-surface);
    }

    .config-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: var(--roommind-surface-muted);
    }

    .config-icon ha-icon,
    .config-chevron {
      --mdc-icon-size: 20px;
      color: var(--secondary-text-color);
    }

    .config-main {
      display: flex;
      flex-direction: column;
      gap: 5px;
      min-width: 0;
    }

    .config-title-line {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .config-title {
      flex: 1;
      min-width: 0;
      font-size: 14px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .config-status {
      flex-shrink: 0;
      min-height: 18px;
      padding: 1px 7px;
      border-radius: 6px;
      background: var(--roommind-surface-muted);
      color: var(--secondary-text-color);
      font-size: 10.5px;
      font-weight: 600;
      line-height: 1.5;
    }

    .complete .config-status {
      background: var(--roommind-success-tint);
      color: var(--success-color, #4caf50);
    }

    .partial .config-status {
      background: var(--roommind-warning-tint);
      color: var(--warning-color, #ff9800);
    }

    .missing .config-status {
      background: var(--roommind-error-tint);
      color: var(--error-color, #f44336);
    }

    .config-meta {
      color: var(--secondary-text-color);
      font-size: 12px;
      line-height: 1.35;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .config-chevron {
      opacity: 0.54;
    }

    @media (max-width: 520px) {
      .config-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-room-configuration-hub": RsRoomConfigurationHub;
  }
}
