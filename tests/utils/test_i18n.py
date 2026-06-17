"""Internationalization coverage tests."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

from custom_components.roommind.utils.i18n import get_translation

LANGUAGES = ("en", "de", "zh-Hans")
BACKEND_TRANSLATION_ROOT = Path("custom_components/roommind/translations")
RUNTIME_TRANSLATION_ROOT = Path("custom_components/roommind/runtime_translations")
FRONTEND_LOCALE_ROOT = Path("frontend/src/locales")

RUNTIME_NOTIFICATION_KEYS = (
    "notifications.outdoor_unavailable.title",
    "notifications.outdoor_unavailable.message",
    "notifications.common.not_configured",
    "notifications.mold_risk.title",
    "notifications.mold_risk.message",
    "notifications.mold_prevention.title",
    "notifications.mold_prevention.message",
)

AIRFLOW_SKIP_REASON_KEYS = (
    "airflow.skip_reason_control_disabled",
    "airflow.skip_reason_unsupported_domain",
    "airflow.skip_reason_service_error",
    "airflow.skip_reason_direction_unsupported",
    "airflow.skip_reason_oscillate_unsupported",
    "airflow.skip_reason_preset_unsupported",
    "airflow.skip_reason_fan_mode_unsupported",
    "airflow.skip_reason_swing_unsupported",
    "airflow.skip_reason_swing_horizontal_unsupported",
    "airflow.skip_reason_fan_only_not_supported",
    "airflow.skip_reason_fan_only_not_roommind_owned",
    "airflow.skip_reason_climate_off",
    "airflow.skip_reason_idle_climate_airflow_requires_fan_only",
    "airflow.skip_reason_entity_unavailable",
    "airflow.skip_reason_no_target_value",
    "airflow.skip_reason_invalid_target_state",
    "airflow.skip_reason_invalid_option",
    "airflow.skip_reason_invalid_number",
)


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _flatten(value: object, prefix: str = "") -> dict[str, object]:
    if not isinstance(value, dict):
        return {prefix: value}
    result: dict[str, object] = {}
    for key, child in value.items():
        result.update(_flatten(child, f"{prefix}.{key}" if prefix else key))
    return result


def test_backend_translation_keys_are_complete_across_supported_languages() -> None:
    """HA-side translations must not silently fall back because one locale is missing a key."""
    flattened = {
        language: _flatten(_load_json(BACKEND_TRANSLATION_ROOT / f"{language}.json")) for language in LANGUAGES
    }
    expected_keys = set().union(*(set(keys) for keys in flattened.values()))

    for language in LANGUAGES:
        assert set(flattened[language]) == expected_keys


def test_backend_translations_only_use_home_assistant_schema_keys() -> None:
    """Runtime-only text must not leak into HA's strict translation schema."""
    for language in LANGUAGES:
        assert "notifications" not in _load_json(BACKEND_TRANSLATION_ROOT / f"{language}.json")


def test_frontend_locale_keys_are_complete_across_supported_languages() -> None:
    """Frontend locale files must stay structurally identical for all supported languages."""
    flattened = {language: _flatten(_load_json(FRONTEND_LOCALE_ROOT / f"{language}.json")) for language in LANGUAGES}
    expected_keys = set().union(*(set(keys) for keys in flattened.values()))

    for language in LANGUAGES:
        assert set(flattened[language]) == expected_keys


def test_runtime_notification_translations_exist_in_backend_locales() -> None:
    """Notifications sent outside the frontend need runtime translations."""
    for language in LANGUAGES:
        flattened = _flatten(_load_json(RUNTIME_TRANSLATION_ROOT / f"{language}.json"))
        for key in RUNTIME_NOTIFICATION_KEYS:
            assert key in flattened, f"{language} is missing {key}"


def test_runtime_translation_keys_are_complete_across_supported_languages() -> None:
    """Runtime-only locale files must stay structurally identical."""
    flattened = {
        language: _flatten(_load_json(RUNTIME_TRANSLATION_ROOT / f"{language}.json")) for language in LANGUAGES
    }
    expected_keys = set().union(*(set(keys) for keys in flattened.values()))

    for language in LANGUAGES:
        assert set(flattened[language]) == expected_keys


def test_frontend_airflow_skip_reasons_have_supported_translations() -> None:
    """Backend skip_reason codes shown in the UI must have user-facing labels."""
    for language in LANGUAGES:
        flattened = _flatten(_load_json(FRONTEND_LOCALE_ROOT / f"{language}.json"))
        for key in AIRFLOW_SKIP_REASON_KEYS:
            assert key in flattened, f"{language} is missing {key}"


def test_backend_translation_formats_placeholders_from_hass_language() -> None:
    hass = MagicMock()
    hass.config.language = "zh-Hans"

    text = get_translation(
        hass,
        "notifications.mold_risk.message",
        area_name="卧室",
        humidity=72,
        surface_rh=81,
    )

    assert "卧室" in text
    assert "72%" in text
    assert "81%" in text
    assert "Mold risk" not in text


def test_backend_translation_falls_back_to_english_for_unknown_language() -> None:
    hass = MagicMock()
    hass.config.language = "fr"

    assert get_translation(hass, "notifications.mold_prevention.title") == "RoomMind: Mold prevention"
