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
        <div class="config-list">
          ${items.map((item) =>
            item.editable
              ? html`
                  <button
                    class="config-row"
                    type="button"
                    @click=${() => this._emitEdit(item.editSection!)}
                    aria-label=${`${localize("panel.edit", this.language)} ${localize(
                      item.titleKey,
                      this.language,
                    )}`}
                  >
                    <ha-icon icon=${item.icon}></ha-icon>
                    <span class="config-row-main">
                      <span class="config-row-title"
                        >${localize(item.titleKey, this.language)}</span
                      >
                      <span class="config-row-meta"
                        >${localize(item.metaKey, this.language, item.metaParams)}</span
                      >
                    </span>
                    <ha-icon class="config-chevron" icon="mdi:chevron-right"></ha-icon>
                  </button>
                `
              : html`
                  <div class="config-row config-row-static">
                    <ha-icon icon=${item.icon}></ha-icon>
                    <span class="config-row-main">
                      <span class="config-row-title"
                        >${localize(item.titleKey, this.language)}</span
                      >
                      <span class="config-row-meta"
                        >${localize(item.metaKey, this.language, item.metaParams)}</span
                      >
                    </span>
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

    .config-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .config-row {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      width: 100%;
      min-height: 48px;
      border: 0;
      border-radius: var(--roommind-radius-control, 8px);
      padding: 8px 10px;
      background: transparent;
      color: var(--primary-text-color);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .config-row:hover,
    .config-row:focus-visible {
      background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.045);
      outline: none;
    }

    .config-row-static {
      cursor: default;
    }

    .config-row-static:hover {
      background: transparent;
    }

    .config-row ha-icon {
      --mdc-icon-size: 20px;
      color: var(--secondary-text-color);
    }

    .config-row-main {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .config-row-title {
      font-size: 14px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .config-row-meta {
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
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-room-configuration-hub": RsRoomConfigurationHub;
  }
}
