import { css } from "lit";

export const sensorSectionStyles = css`
  :host {
    display: block;
  }

  :host([editing]) {
    background: transparent;
  }

  .sensor-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    background: var(--roommind-surface-subtle);
    border: var(--roommind-border-subtle);
    border-radius: 8px;
  }

  .sensor-block + .sensor-block {
    margin-top: 12px;
  }

  .block-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 6px;
    cursor: pointer;
    user-select: none;
  }

  .block-header:hover .block-title {
    color: var(--primary-color);
  }

  .block-header ha-icon {
    --mdc-icon-size: 18px;
    color: var(--secondary-text-color);
  }

  .chevron {
    --mdc-icon-size: 18px;
    color: var(--secondary-text-color);
    transition: transform 0.2s ease;
  }

  .chevron.collapsed {
    transform: rotate(-90deg);
  }

  .block-body {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sensor-block.collapsed .block-header {
    padding-bottom: 0;
  }

  .block-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--primary-text-color);
    letter-spacing: 0;
    flex: 1;
  }

  .count-chip {
    font-size: 11px;
    font-weight: 500;
    padding: 1px 7px;
    border-radius: 8px;
    background: var(--roommind-surface-muted);
    color: var(--secondary-text-color);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .count-chip.has-selection {
    background: var(--roommind-primary-strong);
    color: var(--primary-color);
  }

  .row-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 168px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
  }

  .temperature-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .sensor-table {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .sensor-table-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--primary-text-color);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .sensor-table-hint {
    color: var(--secondary-text-color);
    font-size: 11.5px;
    line-height: 1.45;
    margin: -2px 0 4px 25px;
  }

  .sensor-table-title ha-icon {
    --mdc-icon-size: 17px;
    color: var(--secondary-text-color);
  }

  .sensor-table-row {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) auto auto auto auto;
    align-items: center;
    gap: 10px;
    min-width: 0;
    min-height: 44px;
    padding: 7px 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--roommind-surface-subtle);
    cursor: pointer;
  }

  .sensor-table-row:hover {
    background: var(--roommind-surface-hover);
  }

  .sensor-table-row.selected {
    border-color: var(--roommind-primary-border);
    background: var(--roommind-primary-muted);
  }

  .sensor-table-row ha-checkbox,
  .sensor-table-row ha-radio {
    margin: -4px 0;
  }

  .role-chip,
  .health-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 20px;
    padding: 2px 7px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.35;
    white-space: nowrap;
  }

  .role-chip {
    color: var(--primary-color);
    background: var(--roommind-primary-strong);
  }

  .role-chip.aux {
    color: var(--secondary-text-color);
    background: var(--roommind-surface-muted);
  }

  .role-chip.disabled {
    color: var(--secondary-text-color);
    background: var(--roommind-surface-subtle);
  }

  .priority-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .priority-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: var(--roommind-border-faint);
    border-radius: 6px;
    background: var(--roommind-surface-subtle);
    color: var(--secondary-text-color);
    cursor: pointer;
  }

  .priority-button:hover:not(:disabled),
  .priority-button:focus-visible:not(:disabled) {
    color: var(--primary-color);
    border-color: var(--roommind-primary-border);
    outline: none;
  }

  .priority-button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .priority-button ha-icon {
    --mdc-icon-size: 17px;
  }

  .health-chip {
    color: var(--secondary-text-color);
    background: var(--roommind-surface-muted);
  }

  .health-chip.fresh {
    color: var(--success-color, #4caf50);
    background: var(--roommind-success-tint);
  }

  .health-chip.aging {
    color: var(--warning-color, #ff9800);
    background: var(--roommind-warning-tint);
  }

  .health-chip.stale,
  .health-chip.unavailable {
    color: var(--error-color, #f44336);
    background: var(--roommind-error-tint);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 8px;
    cursor: pointer;
    border-left: 2px solid transparent;
    transition:
      background 0.15s,
      border-color 0.15s;
    min-width: 0;
  }

  .row:hover {
    background: var(--roommind-surface-hover);
  }

  .row.selected {
    background: var(--roommind-primary-muted);
    border-left-color: var(--primary-color);
  }

  .row ha-checkbox,
  .row ha-radio {
    flex-shrink: 0;
    margin: -4px 0;
  }

  .temp-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .temp-role {
    font-size: 10px;
    color: var(--secondary-text-color);
    text-transform: uppercase;
    letter-spacing: 0;
    min-width: 28px;
  }

  .row-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .row-name-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .row-name {
    font-size: 13px;
    font-weight: 450;
    color: var(--primary-text-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-eid {
    font-family: var(--code-font-family, monospace);
    font-size: 10.5px;
    color: var(--secondary-text-color);
    opacity: 0.65;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .external-badge {
    display: inline-flex;
    align-items: center;
    font-size: 9.5px;
    font-weight: 500;
    color: var(--warning-color, #ff9800);
    background: rgba(255, 152, 0, 0.1);
    padding: 1px 6px;
    border-radius: 8px;
    letter-spacing: 0;
    text-transform: uppercase;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .filtered-sensors-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
    padding-top: 8px;
    border-top: var(--roommind-border-faint);
  }

  .filtered-sensors-toggle {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    border: var(--roommind-border-subtle);
    background: var(--roommind-surface);
    color: var(--secondary-text-color);
    font: inherit;
    font-size: 11.5px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    --mdc-icon-size: 14px;
  }

  .filtered-sensors-toggle:hover {
    color: var(--primary-color);
    border-color: var(--roommind-primary-border);
  }

  .filtered-reason-badge {
    display: inline-flex;
    align-items: center;
    font-size: 9.5px;
    font-weight: 600;
    color: var(--secondary-text-color);
    background: var(--roommind-surface-muted);
    padding: 1px 6px;
    border-radius: 8px;
    letter-spacing: 0;
    text-transform: uppercase;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .value-chip {
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 500;
    padding: 3px 9px;
    border-radius: 8px;
    background: var(--roommind-surface-muted);
    color: var(--primary-text-color);
    font-variant-numeric: tabular-nums;
  }

  .row.selected .value-chip {
    background: var(--roommind-primary-strong);
    color: var(--primary-color);
  }

  .occupancy-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    transition: background 0.2s;
  }

  .occupancy-dot.on {
    background: var(--success-color, #4caf50);
    box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.18);
  }

  .occupancy-dot.off {
    background: var(--roommind-surface-strong);
  }

  .window-dot.on {
    background: var(--warning-color, #ff9800);
    box-shadow: 0 0 0 3px rgba(255, 152, 0, 0.18);
  }

  .window-dot.off {
    background: var(--roommind-surface-strong);
  }

  .delay-fields {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .delay-fields ha-textfield {
    flex: 1;
  }

  .delay-hint {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--warning-color, #ff9800);
    margin-top: 6px;
  }

  .delay-hint ha-icon {
    --mdc-icon-size: 16px;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .delay-view {
    font-size: 12px;
    color: var(--secondary-text-color);
    padding-top: 4px;
  }

  .empty-row {
    color: var(--secondary-text-color);
    font-size: 12.5px;
    font-style: italic;
    padding: 6px 4px;
    opacity: 0.7;
  }

  .add-row,
  .global-add {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .global-add {
    margin-top: 12px;
  }

  .add-row ha-entity-picker,
  .global-add ha-entity-picker {
    flex: 1;
  }

  .add-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    margin: 12px 0 0 0;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--secondary-text-color);
    font-size: 12px;
    font-weight: 500;
    border-radius: 6px;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .add-button:hover,
  .add-button:focus-visible {
    color: var(--primary-color);
    background: var(--roommind-primary-muted);
    outline: none;
  }

  .add-button ha-icon {
    --mdc-icon-size: 16px;
  }

  .picker-close {
    --mdc-icon-button-size: 32px;
    --mdc-icon-size: 18px;
    color: var(--secondary-text-color);
    flex-shrink: 0;
  }

  /* View mode rows */
  .view-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    font-size: 14px;
    color: var(--primary-text-color);
  }

  .view-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entity-link {
    cursor: pointer;
  }

  .entity-link:hover {
    text-decoration: underline;
  }

  .view-value {
    font-weight: 500;
    flex-shrink: 0;
  }

  .section-subtitle {
    font-size: 12px;
    font-weight: 500;
    color: var(--secondary-text-color);
    margin: 12px 0 4px 0;
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .section-subtitle:first-child {
    margin-top: 0;
  }

  .fusion-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    margin: 0 0 12px 0;
    border: var(--roommind-border-subtle);
    border-radius: 8px;
    background: var(--roommind-surface-subtle);
  }

  .fusion-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .fusion-title {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--primary-text-color);
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .fusion-conflict {
    font-size: 11px;
    font-weight: 600;
    color: var(--primary-color);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .fusion-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .fusion-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
  }

  .fusion-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 500;
    color: var(--primary-text-color);
  }

  .fusion-meta,
  .fusion-values {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    min-width: 0;
  }

  .fusion-meta {
    margin-top: 3px;
  }

  .fusion-chip {
    display: inline-flex;
    align-items: center;
    min-height: 18px;
    padding: 1px 6px;
    border-radius: 6px;
    font-size: 10.5px;
    line-height: 1.4;
    color: var(--secondary-text-color);
    background: var(--roommind-surface-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .fusion-chip.primary {
    color: var(--primary-color);
    background: var(--roommind-primary-strong);
  }

  .fusion-chip.aging {
    color: var(--warning-color, #ff9800);
    background: var(--roommind-warning-tint);
  }

  .fusion-chip.stale {
    color: var(--error-color, #f44336);
    background: var(--roommind-error-tint);
  }

  @media (max-width: 680px) {
    .sensor-table-row {
      grid-template-columns: 32px minmax(0, 1fr);
      align-items: start;
    }

    .sensor-table-row .value-chip,
    .sensor-table-row .health-chip,
    .sensor-table-row .role-chip,
    .sensor-table-row .priority-actions {
      grid-column: 2 / -1;
      justify-self: start;
    }

    .fusion-row {
      grid-template-columns: minmax(0, 1fr);
    }

    .fusion-values {
      justify-content: flex-start;
    }
  }
`;
