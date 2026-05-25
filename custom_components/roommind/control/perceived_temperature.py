"""Perceived-temperature approximations for airflow-aware comfort control."""

from __future__ import annotations

import math


def perceived_temperature(
    *,
    air_temp_c: float,
    humidity: float | None,
    q_mix: float,
    mode: str,
    airflow_cooling_gain: float = 1.2,
    draft_penalty_gain: float = 0.6,
) -> float:
    """Return a conservative perceived temperature estimate in degC."""
    airflow = max(0.0, min(1.0, q_mix))
    humidity_penalty = 0.0
    if humidity is not None and humidity > 60.0:
        humidity_penalty = min(2.0, (humidity - 60.0) / 20.0)
    if mode == "cooling":
        return round(air_temp_c - airflow_cooling_gain * math.sqrt(airflow) + humidity_penalty, 3)
    if mode == "heating":
        return round(air_temp_c - draft_penalty_gain * math.sqrt(airflow), 3)
    return round(air_temp_c + humidity_penalty, 3)
