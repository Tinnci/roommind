"""Forecast series normalization helpers for control algorithms."""

from __future__ import annotations

import math
from typing import Any


def build_outdoor_temperature_series(
    forecast: list[dict[str, Any]] | None,
    current_outdoor: float | None,
    n_blocks: int,
    *,
    fallback: float,
) -> list[float]:
    """Build a finite outdoor temperature series for model simulations.

    Missing ``temperature`` keys fall back to the current outdoor reading. Bad
    temperature values fall back to the last valid forecast value so transient
    weather-provider holes do not enter control math.
    """
    base = _finite_float(current_outdoor)
    if base is None:
        base = fallback

    if not forecast:
        return [base] * n_blocks

    series: list[float] = []
    last_valid = base
    for item in forecast:
        if not isinstance(item, dict):
            temp = last_valid
        elif "temperature" not in item:
            temp = base
        else:
            candidate = _finite_float(item.get("temperature"))
            temp = candidate if candidate is not None else last_valid
        series.append(temp)
        last_valid = temp

    while len(series) < n_blocks:
        series.append(series[-1] if series else base)
    return series[:n_blocks]


def _finite_float(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None
