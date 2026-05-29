"""Tests for pure notification payload builders."""

from __future__ import annotations

from custom_components.roommind.utils.notification_payloads import (
    build_mold_prevention_payload,
    build_mold_risk_payload,
    build_outdoor_unavailable_payload,
)


def _translate(key: str, **placeholders: object) -> str:
    return f"{key}:{placeholders}"


def test_build_mold_risk_payload_formats_expected_keys_and_values() -> None:
    payload = build_mold_risk_payload(
        _translate,
        area_name="Living Room",
        humidity=72.4,
        surface_rh=80.6,
    )

    assert payload.tag_suffix == "risk"
    assert payload.title == "notifications.mold_risk.title:{}"
    assert "'area_name': 'Living Room'" in payload.message
    assert "'humidity': '72'" in payload.message
    assert "'surface_rh': '81'" in payload.message


def test_build_mold_prevention_payload_formats_expected_keys_and_values() -> None:
    payload = build_mold_prevention_payload(
        _translate,
        area_name="Living Room",
        delta=1.8,
        unit="°C",
    )

    assert payload.tag_suffix == "prevention"
    assert payload.title == "notifications.mold_prevention.title:{}"
    assert "'area_name': 'Living Room'" in payload.message
    assert "'delta': '2'" in payload.message
    assert "'unit': '°C'" in payload.message


def test_build_outdoor_unavailable_payload_formats_sources() -> None:
    payload = build_outdoor_unavailable_payload(
        _translate,
        sensor_id="sensor.outdoor",
        weather_entity="weather.home",
    )

    assert payload.tag_suffix == "outdoor_unavailable"
    assert payload.title == "notifications.outdoor_unavailable.title:{}"
    assert "'sensor_id': 'sensor.outdoor'" in payload.message
    assert "'weather_entity': 'weather.home'" in payload.message
