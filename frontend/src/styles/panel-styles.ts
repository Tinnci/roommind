import { css } from "lit";

export const panelStyles = css`
  :host {
    display: block;
    font-family: var(--primary-font-family, Roboto, sans-serif);
    color: var(--primary-text-color);
    background: var(--roommind-page-background);
    min-height: 100vh;
    --roommind-tile-surface: color-mix(
      in srgb,
      var(--roommind-surface) 94%,
      var(--primary-text-color, #000000)
    );
  }

  .toolbar {
    display: flex;
    align-items: center;
    height: 56px;
    padding: 0 12px;
    font-size: 20px;
    background-color: var(--app-header-background-color, var(--primary-background-color));
    color: var(--app-header-text-color, var(--primary-text-color));
    border-bottom: 1px solid var(--divider-color);
    box-sizing: border-box;
    position: sticky;
    top: 0;
    z-index: 4;
  }

  .toolbar .title {
    margin-left: 4px;
    font-weight: 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .toolbar ha-icon-button {
    color: var(--app-header-text-color, var(--primary-text-color));
  }

  .toolbar-view-switch {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    margin-right: 6px;
    border-radius: 10px;
    background: rgba(var(--rgb-primary-text-color, 0, 0, 0), 0.08);
  }

  .toolbar-view-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--app-header-text-color, var(--primary-text-color));
    opacity: 0.78;
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    --mdc-icon-size: 15px;
    transition:
      background 0.15s ease,
      opacity 0.15s ease;
  }

  .toolbar-view-btn.active {
    background: var(--roommind-surface, #ffffff);
    color: var(--primary-text-color);
    opacity: 1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  }

  .save-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 400;
    margin-right: 8px;
    opacity: 1;
    transition: opacity 0.3s ease;
  }

  .save-indicator.fade-out {
    opacity: 0;
  }

  .save-indicator ha-icon {
    --mdc-icon-size: 18px;
  }

  .save-indicator.saving {
    color: var(--primary-color, #03a9f4);
  }

  .save-indicator.saved {
    color: var(--success-color, #4caf50);
  }

  .save-indicator.error {
    color: var(--error-color, #d32f2f);
  }

  .tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--divider-color);
    padding: 0 16px;
    background: var(--primary-background-color);
    position: sticky;
    top: 56px;
    z-index: 3;
  }

  .tab {
    padding: 12px 24px;
    cursor: pointer;
    border: none;
    background: none;
    color: var(--secondary-text-color);
    font-size: 14px;
    font-weight: 500;
    border-bottom: 2px solid transparent;
    transition: all 0.2s ease;
    font-family: inherit;
  }

  .tab:hover {
    color: var(--primary-text-color);
  }

  .tab[active] {
    color: var(--primary-color);
    border-bottom-color: var(--primary-color);
  }

  .content {
    padding: 20px;
    max-width: 1200px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  @media (max-width: 600px) {
    .content {
      padding: 16px;
    }
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 16px;
    text-align: center;
    color: var(--secondary-text-color);
  }

  .placeholder ha-icon {
    margin-bottom: 16px;
  }

  .placeholder p {
    font-size: 15px;
    max-width: 400px;
    line-height: 1.5;
  }

  .area-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
    gap: 12px;
  }

  .room-section {
    margin-top: 20px;
  }

  .room-section:first-of-type {
    margin-top: 0;
  }

  .room-section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: 0 0 8px;
    min-width: 0;
  }

  .room-section-title {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    margin: 0;
    color: var(--primary-text-color);
    font-size: 15px;
    font-weight: 650;
    line-height: 1.3;
  }

  .room-section-title::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--secondary-text-color);
    flex: 0 0 auto;
  }

  .room-section.attention .room-section-title::before {
    background: var(--roommind-error-color);
  }

  .room-section.active .room-section-title::before {
    background: var(--roommind-warning-color);
  }

  .room-section.setup .room-section-title::before {
    background: var(--primary-color);
  }

  .room-section-count {
    flex: 0 0 auto;
    min-width: 24px;
    padding: 2px 8px;
    border-radius: 8px;
    background: var(--roommind-tile-surface);
    color: var(--secondary-text-color);
    font-size: 12px;
    font-weight: 600;
    text-align: center;
    box-sizing: border-box;
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 80px 16px;
    color: var(--secondary-text-color);
    font-size: 14px;
  }

  .overview-panel {
    margin-bottom: 16px;
    padding: 14px 16px;
    border-radius: var(--roommind-radius-card, 14px);
    border: var(--roommind-border-subtle);
    background: var(--roommind-surface);
    box-shadow: var(--roommind-shadow-card, none);
  }

  .overview-top {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-width: 0;
  }

  .overview-icon {
    width: 40px;
    height: 40px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: var(--roommind-primary-muted);
    color: var(--primary-color);
    flex: 0 0 auto;
  }

  .overview-icon.warning {
    background: var(--roommind-error-tint);
    color: var(--roommind-error-color);
  }

  .overview-icon.active {
    background: var(--roommind-warning-tint);
    color: var(--roommind-warning-color);
  }

  .overview-icon.monitoring {
    background: var(--roommind-info-tint);
    color: var(--roommind-info-color);
  }

  .overview-copy {
    flex: 1;
    min-width: 0;
  }

  .overview-title {
    margin: 0;
    color: var(--primary-text-color);
    font-size: 16px;
    font-weight: 600;
    line-height: 1.35;
  }

  .overview-subtitle {
    margin-top: 3px;
    color: var(--secondary-text-color);
    font-size: 13px;
    line-height: 1.4;
  }

  .stats-actions {
    display: flex;
    align-items: center;
    margin-left: auto;
    gap: 6px;
    flex: 0 0 auto;
  }

  .overview-flags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .overview-policy {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    width: 100%;
    margin-top: 10px;
    padding: 8px 10px;
    border: var(--roommind-border-faint);
    border-radius: 8px;
    background: var(--roommind-primary-muted);
    color: var(--primary-text-color);
    box-sizing: border-box;
  }

  .overview-policy ha-icon {
    --mdc-icon-size: 18px;
    color: var(--primary-color);
  }

  .overview-policy-copy {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .overview-policy-label {
    color: var(--secondary-text-color);
    font-size: 11px;
    line-height: 1.2;
  }

  .overview-policy-value {
    font-size: 13px;
    font-weight: 650;
    line-height: 1.3;
  }

  .overview-policy-exception {
    margin-left: auto;
    padding: 3px 8px;
    border-radius: 8px;
    background: var(--roommind-surface);
    color: var(--secondary-text-color);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }

  .overview-flag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 24px;
    padding: 2px 8px;
    border-radius: 8px;
    background: var(--roommind-tile-surface);
    color: var(--secondary-text-color);
    font-size: 12px;
    font-weight: 500;
    box-sizing: border-box;
  }

  .overview-flag ha-icon {
    --mdc-icon-size: 15px;
  }

  .overview-flag.warning {
    background: var(--roommind-error-tint);
    color: var(--roommind-error-color);
  }

  .overview-flag.active {
    background: var(--roommind-warning-tint);
    color: var(--roommind-warning-color);
  }

  .hidden-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    padding: 0 10px;
    border-radius: 999px;
    border: var(--roommind-border-subtle);
    background: var(--roommind-tile-surface);
    color: var(--secondary-text-color);
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    --mdc-icon-size: 15px;
    transition:
      border-color var(--roommind-motion-duration) ease,
      background var(--roommind-motion-duration) ease,
      color var(--roommind-motion-duration) ease;
  }

  .hidden-pill:hover,
  .hidden-pill.active {
    border-color: var(--primary-color);
    background: var(--roommind-primary-muted);
    color: var(--primary-color);
  }

  .hidden-pill-count {
    font-variant-numeric: tabular-nums;
    opacity: 0.85;
  }

  .hidden-rooms-panel {
    margin-bottom: 16px;
    padding: 14px 16px;
    border-radius: var(--roommind-radius-card, 14px);
    border: var(--roommind-border-subtle);
    background: var(--roommind-surface);
    box-shadow: var(--roommind-shadow-card, none);
  }

  .hidden-rooms-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }

  .hidden-rooms-title {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 13.5px;
    font-weight: 650;
    color: var(--primary-text-color);
    --mdc-icon-size: 17px;
  }

  .hidden-rooms-title ha-icon {
    color: var(--secondary-text-color);
  }

  .hidden-rooms-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .hidden-show-all-btn,
  .hidden-restore-btn,
  .section-tidy-btn,
  .undo-action-btn,
  .empty-restore-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: 999px;
    border: var(--roommind-border-subtle);
    background: var(--roommind-surface-subtle);
    color: var(--primary-color);
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
    cursor: pointer;
    --mdc-icon-size: 14px;
    transition:
      background var(--roommind-motion-duration) ease,
      border-color var(--roommind-motion-duration) ease;
  }

  .hidden-show-all-btn:hover,
  .hidden-restore-btn:hover,
  .section-tidy-btn:hover,
  .undo-action-btn:hover,
  .empty-restore-btn:hover {
    background: var(--roommind-primary-muted);
    border-color: var(--primary-color);
  }

  .hidden-close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--secondary-text-color);
    cursor: pointer;
    --mdc-icon-size: 16px;
  }

  .hidden-close-btn:hover {
    background: var(--roommind-surface-hover);
    color: var(--primary-text-color);
  }

  .hidden-rooms-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(230px, 100%), 1fr));
    gap: 8px;
  }

  .hidden-room-tile {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    border: var(--roommind-border-faint);
    background: var(--roommind-surface-subtle);
    min-width: 0;
  }

  .hidden-room-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
    padding: 0;
    border: none;
    background: transparent;
    text-align: left;
    font-family: inherit;
    cursor: pointer;
  }

  .hidden-room-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .hidden-room-info:hover .hidden-room-name {
    color: var(--primary-color);
  }

  .hidden-room-meta {
    font-size: 11px;
    color: var(--secondary-text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .section-heading-right {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .section-tidy-btn {
    font-size: 11px;
    padding: 2px 9px;
    color: var(--secondary-text-color);
  }

  .section-tidy-btn:hover {
    color: var(--primary-color);
  }

  .undo-toast {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 14px;
    padding: 9px 14px;
    border-radius: 12px;
    border: var(--roommind-primary-border);
    background: var(--roommind-surface);
    box-shadow: var(--roommind-shadow-card, none);
  }

  .undo-toast-copy {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 500;
    color: var(--primary-text-color);
    min-width: 0;
    --mdc-icon-size: 17px;
  }

  .undo-toast-copy ha-icon {
    color: var(--primary-color);
    flex-shrink: 0;
  }

  .undo-toast-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .empty-restore-btn {
    margin-top: 10px;
    padding: 7px 16px;
    font-size: 13px;
  }

  .floor-heading {
    font-size: 14px;
    font-weight: 500;
    color: var(--secondary-text-color);
    text-transform: uppercase;
    letter-spacing: 0;
    margin: 20px 0 8px 0;
  }

  .floor-heading:first-of-type {
    margin-top: 0;
  }

  .reorder-btn {
    --mdc-icon-button-size: 36px;
    --mdc-icon-size: 20px;
    color: var(--secondary-text-color);
  }

  .reorder-done {
    font-size: 14px;
    margin-left: auto;
  }

  @media (max-width: 600px) {
    .overview-top {
      align-items: center;
    }

    .overview-icon {
      width: 36px;
      height: 36px;
    }

    .stats-actions {
      align-self: flex-start;
    }
  }
`;
