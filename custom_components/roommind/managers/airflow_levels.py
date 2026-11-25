"""Normalize Home Assistant fan modes to RoomMind airflow levels."""

from __future__ import annotations

from typing import Any

from homeassistant.components.fan import FanEntityFeature

_OFF_MODES = {"off", "none", "stop", "stopped"}

CANONICAL_FAN_TIERS = ("auto", "quiet", "low", "medium", "high", "turbo")

CANONICAL_TIER_LEVELS: dict[str, float] = {
    "quiet": 0.15,
    "low": 0.33,
    "medium": 0.60,
    "high": 0.85,
    "turbo": 1.0,
}

CANONICAL_TIER_PERCENTAGES: dict[str, int] = {
    "quiet": 20,
    "low": 35,
    "medium": 60,
    "high": 85,
    "turbo": 100,
}

_TIER_SYNONYMS: dict[str, tuple[str, ...]] = {
    "auto": ("auto", "smart", "natural", "breeze"),
    "quiet": ("quiet", "silent", "sleep", "diffuse", "eco", "minimum", "min", "1"),
    "low": ("low", "1", "quiet", "silent", "2"),
    "medium": ("medium", "mid", "middle", "normal", "standard", "2", "3"),
    "high": ("high", "strong", "4"),
    "turbo": ("turbo", "boost", "max", "maximum", "full", "strong", "5", "high"),
}


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


def _tier_for_level(level: float) -> str:
    if level <= 0.22:
        return "quiet"
    if level <= 0.45:
        return "low"
    if level <= 0.72:
        return "medium"
    if level <= 0.92:
        return "high"
    return "turbo"


def _snap_percentage(pct: int, step: Any) -> int:
    try:
        step_num = float(step)
    except TypeError, ValueError:
        step_num = 0.0
    if step_num > 0:
        pct = round(pct / step_num * step_num) if step_num < 1 else round(pct / step_num) * round(step_num)
    return max(1, min(100, int(round(pct))))


def resolve_fan_mode_for_policy(
    policy: str | None,
    fan_modes: list[str],
    *,
    fallback_level: float | None = None,
    night_cap: float | None = None,
) -> str | None:
    """Resolve a room fan speed policy or MPC level to the best HA fan_mode string."""
    if not fan_modes:
        return None
    raw = (policy or "auto").strip()
    key = raw.lower()
    active_modes = [mode for mode in fan_modes if str(mode).lower() not in _OFF_MODES]
    by_lower = {str(mode).lower(): mode for mode in fan_modes}

    if key == "auto":
        if fallback_level is not None:
            if fallback_level <= 0.0:
                return by_lower.get("off")
            target = min(float(fallback_level), float(night_cap)) if night_cap is not None else float(fallback_level)
            if not active_modes:
                return None
            return min(active_modes, key=lambda mode: abs(fan_mode_level(mode, fan_modes) - target))
        native_auto = by_lower.get("auto")
        if native_auto is not None and (
            night_cap is None or fan_mode_level(native_auto, fan_modes) <= float(night_cap) + 0.05
        ):
            return native_auto
        if night_cap is not None and active_modes:
            cap = float(night_cap)
            return min(active_modes, key=lambda mode: abs(fan_mode_level(mode, fan_modes) - cap))
        return None

    direct = by_lower.get(key)
    if direct is not None and str(direct).lower() not in _OFF_MODES:
        if night_cap is None or fan_mode_level(direct, fan_modes) <= float(night_cap) + 0.05:
            return direct

    if not active_modes:
        return None

    target_level = CANONICAL_TIER_LEVELS.get(key, fan_mode_level(raw, fan_modes))
    if night_cap is not None:
        target_level = min(target_level, float(night_cap))
        lookup_tier = _tier_for_level(target_level) if target_level < CANONICAL_TIER_LEVELS.get(key, 1.0) else key
    else:
        lookup_tier = key

    for synonym in _TIER_SYNONYMS.get(lookup_tier, ()):
        candidate = by_lower.get(synonym)
        if candidate is not None and str(candidate).lower() not in _OFF_MODES:
            if fan_mode_level(candidate, fan_modes) <= target_level + 0.15:
                return candidate

    return min(active_modes, key=lambda mode: abs(fan_mode_level(mode, fan_modes) - target_level))


def resolve_fan_target_for_policy(
    policy: str | None,
    attrs: dict[str, Any],
    *,
    night_cap: float | None = None,
) -> tuple[int | None, str | None]:
    """Resolve a policy string into (percentage, preset_mode) for a fan.* entity."""
    raw = (policy or "auto").strip()
    key = raw.lower()
    preset_modes = [str(item) for item in attrs.get("preset_modes") or []]
    by_lower_preset = {mode.lower(): mode for mode in preset_modes if mode.lower() not in _OFF_MODES}

    supported = attrs.get("supported_features")
    try:
        supports_speed = supported is None or bool(int(supported) & int(FanEntityFeature.SET_SPEED))
    except TypeError, ValueError:
        supports_speed = True

    if supports_speed and (supported is not None or attrs.get("percentage") is not None or not preset_modes):
        if key.startswith("pct:"):
            try:
                pct = int(float(key.split(":", 1)[1]))
            except ValueError:
                pct = 60
        else:
            pct = CANONICAL_TIER_PERCENTAGES.get(key, round(fan_mode_level(raw) * 100))
        if night_cap is not None:
            pct = min(pct, round(float(night_cap) * 100))
        return _snap_percentage(pct, attrs.get("percentage_step")), None

    if by_lower_preset:
        direct = by_lower_preset.get(key)
        if direct and (night_cap is None or fan_preset_mode_level(direct, preset_modes) <= float(night_cap) + 0.05):
            return None, direct
        target_level = CANONICAL_TIER_LEVELS.get(key, 0.5)
        if night_cap is not None:
            target_level = min(target_level, float(night_cap))
        for synonym in _TIER_SYNONYMS.get(key, ()):
            candidate = by_lower_preset.get(synonym)
            if candidate and fan_preset_mode_level(candidate, preset_modes) <= target_level + 0.15:
                return None, candidate
        active_presets = list(by_lower_preset.values())
        return None, min(active_presets, key=lambda mode: abs(fan_preset_mode_level(mode, preset_modes) - target_level))

    return None, None
