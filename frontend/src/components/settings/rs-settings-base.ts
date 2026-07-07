/**
 * rs-settings-base – Shared base class for settings components.
 * Provides the common _fire() method and shared CSS classes.
 */
import { LitElement, css } from "lit";

export class RsSettingsBase extends LitElement {
  protected _fire(key: string, value: unknown): void {
    this.dispatchEvent(
      new CustomEvent("setting-changed", {
        detail: { key, value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  static settingsBaseStyles = css`
    :host {
      display: block;
    }

    /* Round HA's MDC-based inputs to match the rest of the design */
    ha-textfield,
    ha-select,
    ha-entity-picker,
    ha-combo-box {
      --mdc-shape-small: var(--roommind-radius-control, 8px);
      --mdc-shape-medium: var(--roommind-radius-control, 8px);
      --md-filled-text-field-container-shape: var(--roommind-radius-control, 8px);
      --md-outlined-text-field-container-shape: var(--roommind-radius-control, 8px);
      display: block;
      border-radius: var(--roommind-radius-control, 8px);
      overflow: hidden;
      isolation: isolate;
      clip-path: inset(0 round var(--roommind-radius-control, 8px));
    }

    ha-entity-picker {
      clip-path: inset(
        0 round var(--roommind-radius-control, 8px) var(--roommind-radius-control, 8px)
          var(--roommind-radius-small, 4px) var(--roommind-radius-small, 4px)
      );
    }

    .settings-section {
      padding: 16px 0;
      border-top: 1px solid var(--divider-color);
    }
    .settings-section:first-child,
    .settings-section.first {
      border-top: none;
      padding-top: 0;
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
      flex-direction: column;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }
    .toggle-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--primary-text-color);
      line-height: 1.35;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .toggle-hint {
      font-size: 13px;
      color: var(--secondary-text-color);
      line-height: 1.4;
      overflow-wrap: anywhere;
      white-space: normal;
    }

    .threshold-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .threshold-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .threshold-field ha-textfield {
      width: 100%;
    }
    .field-hint {
      color: var(--secondary-text-color);
      font-size: 12px;
    }

    @media (max-width: 600px) {
      .threshold-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
}
