import { css } from "lit";

/**
 * Shared CSS for mode-pill and mode-dot styles used by
 * rs-area-card and rs-room-detail (hero section).
 */
export const modeStyles = css`
  .mode-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 500;
    padding: 4px 14px;
    border-radius: var(--roommind-radius-control, 8px);
  }

  .mode-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .mode-pill.mode-unverified-output .mode-dot {
    background: transparent !important;
    border: 1.5px solid currentColor;
    box-sizing: border-box;
  }

  .mode-heating {
    color: var(--warning-color, #ff9800);
    background: var(--roommind-warning-tint);
  }
  .mode-heating .mode-dot {
    background: var(--warning-color, #ff9800);
  }

  .mode-cooling {
    color: var(--roommind-info-color);
    background: var(--roommind-info-tint);
  }
  .mode-cooling .mode-dot {
    background: var(--roommind-info-color);
  }

  .mode-dry {
    color: var(--roommind-dry-color, #009688);
    background: color-mix(in srgb, var(--roommind-dry-color, #009688) 14%, transparent);
  }
  .mode-dry .mode-dot {
    background: var(--roommind-dry-color, #009688);
  }

  .mode-fan {
    color: var(--roommind-fan-color, #00acc1);
    background: color-mix(in srgb, var(--roommind-fan-color, #00acc1) 14%, transparent);
  }
  .mode-fan .mode-dot {
    background: var(--roommind-fan-color, #00acc1);
  }

  .mode-off {
    color: var(--disabled-text-color, #9e9e9e);
    background: var(--roommind-surface-muted);
  }
  .mode-off .mode-dot {
    background: var(--disabled-text-color, #9e9e9e);
  }

  .mode-idle {
    color: var(--secondary-text-color, #757575);
    background: var(--roommind-surface-muted);
  }
  .mode-idle .mode-dot {
    background: var(--disabled-text-color, #bdbdbd);
  }

  .mode-monitoring {
    color: var(--roommind-info-color, #0288d1);
    background: var(--roommind-info-tint, rgba(3, 169, 244, 0.12));
  }
  .mode-monitoring .mode-dot {
    background: var(--roommind-info-color, #0288d1);
  }

  .mode-other {
    color: var(--secondary-text-color);
    background: var(--roommind-surface-muted);
  }
  .mode-other .mode-dot {
    background: var(--secondary-text-color);
  }
`;
