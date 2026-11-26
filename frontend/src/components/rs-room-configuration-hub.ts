import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  buildConfigurationHubItems,
  type ConfigurationEditSection,
  type ConfigurationHubMetrics,
} from "../utils/room-configuration-hub";
import type { ConfigurationRoomSection } from "../utils/room-detail-layout";
import { localize, type TranslationKey } from "../utils/localize";
import "./rs-section-card";

type RoomRole = "monitor" | "control" | "outdoor";

@customElement("rs-room-configuration-hub")
export class RsRoomConfigurationHub extends LitElement {
  @property({ attribute: false }) public sections: ConfigurationRoomSection[] = [];
  @property({ attribute: false }) public metrics: ConfigurationHubMetrics = {};
  @property({ type: Boolean }) public isOutdoor = false;
  @property({ type: String }) public roomRole: RoomRole = "monitor";
  @property({ type: Number }) public deviceCount = 0;
  @property({ type: String }) public language = "en";
  @property({ type: String }) public autoDetectStatus = "";
  @property({ type: Boolean }) public autoDetectBusy = false;

  @state() private _confirmMonitor = false;

  override render() {
    if (this.sections.length === 0) return nothing;
    const items = buildConfigurationHubItems(this.sections, this.metrics);
    const roles: { id: RoomRole; icon: string; labelKey: TranslationKey }[] = [
      { id: "monitor", icon: "mdi:eye-outline", labelKey: "room.role.monitor" },
      { id: "control", icon: "mdi:thermostat", labelKey: "room.role.control" },
      { id: "outdoor", icon: "mdi:tree", labelKey: "room.role.outdoor" },
    ];

    return html`
      <rs-section-card
        icon="mdi:tune-variant"
        .heading=${localize("room.section.configuration", this.language)}
      >
        ${
          !this.isOutdoor
            ? html`<button
                slot="header-extras"
                type="button"
                class="auto-detect-btn"
                ?disabled=${this.autoDetectBusy}
                @click=${this._emitAutoDetect}
              >
                <ha-icon icon="mdi:auto-fix"></ha-icon>
                <span>${localize("room.config.auto_detect", this.language)}</span>
              </button>`
            : nothing
        }
        <div class="role-bar" role="group" aria-label=${localize("room.role.label", this.language)}>
          ${roles.map(
            (r) => html`
              <button
                type="button"
                class="role-btn ${this.roomRole === r.id ? "active" : ""}"
                @click=${() => this._onRoleClick(r.id)}
              >
                <ha-icon icon=${r.icon}></ha-icon>
                <span>${localize(r.labelKey, this.language)}</span>
              </button>
            `,
          )}
        </div>
        ${
          this._confirmMonitor
            ? html`
                <div class="role-confirm">
                  <span>
                    ${localize("room.role.confirm_monitor", this.language, {
                      count: this.deviceCount,
                    })}
                  </span>
                  <div class="role-confirm-actions">
                    <button
                      type="button"
                      class="role-confirm-btn"
                      @click=${() => {
                        this._confirmMonitor = false;
                      }}
                    >
                      ${localize("room.role.cancel", this.language)}
                    </button>
                    <button
                      type="button"
                      class="role-confirm-btn danger"
                      @click=${this._confirmSwitchToMonitor}
                    >
                      ${localize("room.role.switch_action", this.language)}
                    </button>
                  </div>
                </div>
              `
            : nothing
        }
        ${
          this.autoDetectStatus
            ? html`<div class="auto-detect-status">${this.autoDetectStatus}</div>`
            : nothing
        }
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
      ${
        item.editable
          ? html`<ha-icon class="config-chevron" icon="mdi:chevron-right"></ha-icon>`
          : nothing
      }
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

  private _onRoleClick(role: RoomRole) {
    if (role === this.roomRole) {
      this._confirmMonitor = false;
      return;
    }
    if (role === "monitor" && this.roomRole === "control" && this.deviceCount > 0) {
      this._confirmMonitor = true;
      return;
    }
    this._confirmMonitor = false;
    this._emitRole(role);
  }

  private _confirmSwitchToMonitor() {
    this._confirmMonitor = false;
    this._emitRole("monitor");
  }

  private _emitRole(role: RoomRole) {
    this.dispatchEvent(
      new CustomEvent("role-changed", {
        detail: { role },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _emitAutoDetect() {
    this.dispatchEvent(
      new CustomEvent("auto-detect-area", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  static override styles = css`
    :host {
      display: block;
    }

    .auto-detect-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 999px;
      border: 1px solid rgba(var(--rgb-primary-color, 3, 169, 244), 0.35);
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.08);
      color: var(--primary-color);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      flex-shrink: 0;
      cursor: pointer;
    }

    .auto-detect-btn:disabled {
      opacity: 0.5;
      cursor: default;
    }

    .auto-detect-btn ha-icon {
      --mdc-icon-size: 15px;
    }

    .auto-detect-status {
      font-size: 12px;
      color: var(--primary-color);
      margin-bottom: 10px;
      font-weight: 500;
    }

    .role-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }

    .role-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 1 1 auto;
      gap: 6px;
      min-height: 34px;
      padding: 7px 10px;
      border-radius: 9px;
      border: var(--roommind-border-faint);
      background: var(--roommind-surface-subtle);
      color: var(--secondary-text-color);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      --mdc-icon-size: 15px;
      transition:
        background var(--roommind-motion-duration) ease,
        border-color var(--roommind-motion-duration) ease,
        color var(--roommind-motion-duration) ease;
    }

    .role-btn:hover {
      border-color: var(--roommind-card-border-hover);
      color: var(--primary-text-color);
    }

    .role-btn.active {
      border-color: rgba(var(--rgb-primary-color, 3, 169, 244), 0.45);
      background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.12);
      color: var(--primary-color);
    }

    .role-confirm {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px 12px;
      margin-bottom: 10px;
      border-radius: 9px;
      border: 1px solid var(--roommind-warning-border, rgba(255, 152, 0, 0.35));
      background: var(--roommind-warning-tint, rgba(255, 152, 0, 0.08));
      font-size: 12px;
      color: var(--primary-text-color);
    }

    .role-confirm-actions {
      display: inline-flex;
      gap: 6px;
    }

    .role-confirm-btn {
      padding: 4px 10px;
      border-radius: 7px;
      border: var(--roommind-border-subtle);
      background: var(--roommind-surface);
      color: var(--primary-text-color);
      font: inherit;
      font-size: 11.5px;
      font-weight: 600;
      white-space: nowrap;
      flex-shrink: 0;
      cursor: pointer;
    }

    .role-confirm-btn.danger {
      border-color: var(--roommind-warning-border, rgba(255, 152, 0, 0.45));
      color: var(--warning-color, #ed6c02);
    }

    .config-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
      gap: 8px;
    }

    .config-group {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) 16px;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-width: 0;
      min-height: 56px;
      box-sizing: border-box;
      border: var(--roommind-border-faint);
      border-radius: 10px;
      padding: 9px 11px;
      background: var(--roommind-surface-subtle);
      color: var(--primary-text-color);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition:
        background var(--roommind-motion-duration) ease,
        border-color var(--roommind-motion-duration) ease,
        transform var(--roommind-motion-duration) var(--roommind-motion-easing);
    }

    .config-group.partial {
      border-color: var(--roommind-warning-border);
    }

    .config-group.missing {
      border-color: var(--roommind-error-border);
    }

    .config-group:hover {
      background: var(--roommind-surface-hover);
      border-color: var(--roommind-card-border-hover);
      transform: translateY(-1px);
    }

    @media (prefers-reduced-motion: reduce) {
      .config-group:hover {
        transform: none;
      }
    }

    .config-group:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 2px;
    }

    .config-row-static {
      grid-template-columns: 26px minmax(0, 1fr) auto;
      align-items: start;
      cursor: default;
    }

    .config-row-static:hover {
      background: var(--roommind-surface);
    }

    .config-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 7px;
      background: var(--roommind-surface-muted);
    }

    .complete .config-icon {
      background: var(--roommind-success-tint);
      color: var(--roommind-success-color, #4caf50);
    }

    .complete .config-icon ha-icon {
      color: var(--roommind-success-color, #4caf50);
    }

    .partial .config-icon {
      background: var(--roommind-warning-tint);
      color: var(--roommind-warning-color, #ff9800);
    }

    .partial .config-icon ha-icon {
      color: var(--roommind-warning-color, #ff9800);
    }

    .missing .config-icon {
      background: var(--roommind-error-tint);
      color: var(--roommind-error-color, #f44336);
    }

    .missing .config-icon ha-icon {
      color: var(--roommind-error-color, #f44336);
    }

    .config-icon ha-icon,
    .config-chevron {
      --mdc-icon-size: 16px;
      color: var(--secondary-text-color);
    }

    .config-main {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .config-title-line {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
    }

    .config-title {
      flex: 1;
      min-width: 0;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.3;
      overflow-wrap: break-word;
      white-space: normal;
    }

    .config-status {
      flex-shrink: 0;
      max-width: 100%;
      min-height: 18px;
      padding: 1px 6px;
      border-radius: 6px;
      background: var(--roommind-surface-muted);
      color: var(--secondary-text-color);
      font-size: 10.5px;
      font-weight: 600;
      line-height: 1.5;
      white-space: nowrap;
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
      font-size: 11.5px;
      line-height: 1.35;
      overflow-wrap: break-word;
      white-space: normal;
    }

    .config-chevron {
      opacity: 0.54;
    }

    ha-switch {
      justify-self: end;
      align-self: start;
      flex: 0 0 auto;
      margin-top: -2px;
    }

    @media (max-width: 520px) {
      .config-grid {
        grid-template-columns: 1fr;
      }

      .config-row-static {
        grid-template-columns: 26px minmax(0, 1fr) auto;
        gap: 8px;
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "rs-room-configuration-hub": RsRoomConfigurationHub;
  }
}
