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

  .mode-idle {
    color: var(--secondary-text-color, #757575);
    background: var(--roommind-surface-muted);
  }
  .mode-idle .mode-dot {
    background: var(--disabled-text-color, #bdbdbd);
  }

  .mode-other {
    color: var(--secondary-text-color);
    background: var(--roommind-surface-muted);
  }
  .mode-other .mode-dot {
    background: var(--secondary-text-color);
  }
`;
