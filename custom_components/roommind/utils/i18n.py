"""Small runtime translation helper for backend-generated user text."""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any, cast

from homeassistant.core import HomeAssistant

_TRANSLATION_DIR = Path(__file__).parents[1] / "translations"
_RUNTIME_TRANSLATION_DIR = Path(__file__).parents[1] / "runtime_translations"
_DEFAULT_LANGUAGE = "en"
_SUPPORTED_LANGUAGES = {"en", "de", "zh-Hans"}


@cache
def _load_language(language: str) -> dict[str, Any]:
    path = _TRANSLATION_DIR / f"{language}.json"
    return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))


@cache
def _load_runtime_language(language: str) -> dict[str, Any]:
    path = _RUNTIME_TRANSLATION_DIR / f"{language}.json"
    return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))


def _normalise_language(language: str | None) -> str:
    if not language:
        return _DEFAULT_LANGUAGE
    if language in _SUPPORTED_LANGUAGES:
        return language
    if language.lower().startswith("zh"):
        return "zh-Hans"
    short = language.split("-", 1)[0]
    return short if short in _SUPPORTED_LANGUAGES else _DEFAULT_LANGUAGE


def _lookup(data: dict[str, Any], key: str) -> str | None:
    current: Any = data
    for part in key.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current if isinstance(current, str) else None


def get_translation(hass: HomeAssistant, key: str, **placeholders: Any) -> str:
    """Return a translated backend string using Home Assistant's configured language."""
    language = _normalise_language(getattr(getattr(hass, "config", None), "language", None))
    template = (
        _lookup(_load_runtime_language(language), key)
        or _lookup(_load_language(language), key)
        or _lookup(_load_runtime_language(_DEFAULT_LANGUAGE), key)
        or _lookup(_load_language(_DEFAULT_LANGUAGE), key)
        or key
    )
    return template.format(**placeholders)
