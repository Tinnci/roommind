import { css } from "lit";

export const roommindThemeStyles = css`
  :host {
    color-scheme: light dark;
    --mdc-shape-small: var(--roommind-radius-control);
    --mdc-shape-medium: var(--roommind-radius-control);
    --md-filled-text-field-container-shape: var(--roommind-radius-control);
    --md-outlined-text-field-container-shape: var(--roommind-radius-control);
    --roommind-radius-card: 8px;
    --roommind-radius-control: 8px;
    --roommind-radius-small: 4px;
    --roommind-surface: var(
      --card-background-color,
      var(--secondary-background-color, var(--primary-background-color, #ffffff))
    );
    --roommind-panel-surface: color-mix(
      in srgb,
      var(--roommind-surface) 88%,
      var(--primary-text-color, #000000)
    );
    --roommind-dialog-surface: color-mix(
      in srgb,
      var(--roommind-surface) 90%,
      var(--primary-text-color, #000000)
    );
    --roommind-page-background: var(--primary-background-color, #ffffff);
    --roommind-dialog-backdrop: rgba(0, 0, 0, 0.54);
    --roommind-surface-subtle: color-mix(
      in srgb,
      var(--roommind-surface) 82%,
      var(--primary-text-color, #000000)
    );
    --roommind-surface-muted: color-mix(
      in srgb,
      var(--roommind-surface) 76%,
      var(--primary-text-color, #000000)
    );
    --roommind-surface-strong: color-mix(
      in srgb,
      var(--roommind-surface) 68%,
      var(--primary-text-color, #000000)
    );
    --roommind-surface-hover: color-mix(
      in srgb,
      var(--roommind-surface) 72%,
      var(--primary-text-color, #000000)
    );
    --roommind-surface-hover-strong: color-mix(
      in srgb,
      var(--roommind-surface) 60%,
      var(--primary-text-color, #000000)
    );
    --roommind-primary-subtle: color-mix(in srgb, var(--primary-color, #03a9f4) 4%, transparent);
    --roommind-primary-muted: color-mix(in srgb, var(--primary-color, #03a9f4) 8%, transparent);
    --roommind-primary-strong: color-mix(in srgb, var(--primary-color, #03a9f4) 12%, transparent);
    --roommind-primary-border: color-mix(in srgb, var(--primary-color, #03a9f4) 38%, transparent);
    --roommind-border-subtle: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
    --roommind-border-faint: 1px solid var(--divider-color, rgba(0, 0, 0, 0.06));
    --roommind-shadow-soft: 0 2px 10px rgba(0, 0, 0, 0.08);
    --roommind-shadow-dialog: 0 24px 48px rgba(0, 0, 0, 0.32);
    --roommind-header-min-height: 44px;
    --roommind-info-color: var(--info-color, #2196f3);
    --roommind-success-color: var(--success-color, #4caf50);
    --roommind-warning-color: var(--warning-color, #ff9800);
    --roommind-error-color: var(--error-color, #f44336);
    --roommind-info-tint: color-mix(in srgb, var(--roommind-info-color) 14%, transparent);
    --roommind-success-tint: color-mix(in srgb, var(--roommind-success-color) 14%, transparent);
    --roommind-warning-tint: color-mix(in srgb, var(--roommind-warning-color) 14%, transparent);
    --roommind-error-tint: color-mix(in srgb, var(--roommind-error-color) 14%, transparent);
    --roommind-info-border: color-mix(in srgb, var(--roommind-info-color) 28%, transparent);
    --roommind-success-border: color-mix(in srgb, var(--roommind-success-color) 28%, transparent);
    --roommind-warning-border: color-mix(in srgb, var(--roommind-warning-color) 28%, transparent);
    --roommind-error-border: color-mix(in srgb, var(--roommind-error-color) 28%, transparent);
  }
`;
