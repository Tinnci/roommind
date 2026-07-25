"""Normalize Home Assistant fan modes to RoomMind airflow levels."""

from __future__ import annotations

from typing import Any

_OFF_MODES = {"off", "none", "stop", "stopped"}


def fan_mode_level(mode: Any, fan_modes: list[str] | None = None) -> float:
    """Map a climate fan mode to a normalized 0..1 airflow level."""
    if mode is None:
        return 0.0
    text = str(mode).lower()
    if text in _OFF_MODES:
        return 0.0
    if text in {"quiet", "silent", "low", "minimum", "min"}:
        return 1.0 / 3.0
    if text in {"medium", "mid", "middle", "normal"}:
        return 2.0 / 3.0
    if text in {"high", "max", "maximum", "turbo", "boost", "strong", "on"}:
        return 1.0
    if text == "auto":
        return 0.5
    if fan_modes and mode in fan_modes:
        active_modes = [candidate for candidate in fan_modes if str(candidate).lower() not in _OFF_MODES]
        if mode in active_modes and active_modes:
            return (active_modes.index(mode) + 1) / len(active_modes)
    return 1.0


def fan_preset_mode_level(mode: Any, preset_modes: list[str] | None = None) -> float:
    """Map a fan preset mode to a conservative normalized airflow level."""
    text = str(mode).lower()
    if text in _OFF_MODES:
        return 0.0
    if text in {"sleep", "night", "quiet", "silent", "eco", "minimum", "min"}:
        return 1.0 / 3.0
    if text in {"auto", "smart", "breeze", "natural", "normal", "standard", "comfort"}:
        return 0.5
    if text in {"high", "max", "maximum", "turbo", "boost", "strong", "full", "on"}:
        return 1.0
    if preset_modes and mode in preset_modes:
        active_modes = [candidate for candidate in preset_modes if str(candidate).lower() not in _OFF_MODES]
        if mode in active_modes and active_modes:
            return (active_modes.index(mode) + 1) / len(active_modes)
    return 0.5
