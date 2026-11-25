"""Shared safe scalar parsing utilities."""

from __future__ import annotations

import math
from typing import Any


def safe_float(value: Any) -> float | None:
    """Parse finite float from numeric/string input, returning None otherwise."""
    if isinstance(value, bool) or value in ("", None):
        return None
    try:
        parsed = float(value)
    except TypeError, ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def safe_int(value: Any, *, allow_float_str: bool = False) -> int | None:
    """Parse integer from numeric/string input, returning None on invalid values."""
    if isinstance(value, bool) or value in ("", None):
        return None
    try:
        return int(value)
    except TypeError, ValueError:
        if not allow_float_str:
            return None
        try:
            parsed = float(value)
        except TypeError, ValueError:
            return None
        return int(parsed) if math.isfinite(parsed) else None
