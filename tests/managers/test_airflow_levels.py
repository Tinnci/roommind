"""Tests for shared airflow-level normalization."""

from __future__ import annotations

import pytest

from custom_components.roommind.managers.airflow_levels import (
    fan_mode_level,
    fan_preset_mode_level,
    resolve_fan_mode_for_policy,
    resolve_fan_target_for_policy,
)


@pytest.mark.parametrize(
    ("mode", "expected"),
    [
        (None, 0.0),
        ("off", 0.0),
        ("quiet", 1.0 / 3.0),
        ("medium", 2.0 / 3.0),
        ("auto", 0.5),
        ("turbo", 1.0),
    ],
)
def test_fan_mode_level_known_modes(mode, expected):
    assert fan_mode_level(mode) == pytest.approx(expected)


def test_fan_mode_level_uses_device_order_for_unknown_modes():
    modes = ["off", "one", "two", "three"]

    assert fan_mode_level("one", modes) == pytest.approx(1.0 / 3.0)
    assert fan_mode_level("two", modes) == pytest.approx(2.0 / 3.0)
    assert fan_mode_level("three", modes) == pytest.approx(1.0)


def test_preset_mode_defaults_are_conservative():
    assert fan_preset_mode_level("sleep") == pytest.approx(1.0 / 3.0)
    assert fan_preset_mode_level("unknown") == pytest.approx(0.5)


def test_resolve_fan_mode_for_policy_and_night_cap():
    modes = ["auto", "quiet", "low", "medium", "high", "turbo"]

    assert resolve_fan_mode_for_policy("auto", modes) == "auto"
    assert resolve_fan_mode_for_policy("turbo", modes) == "turbo"
    assert resolve_fan_mode_for_policy("turbo", modes, night_cap=0.35) == "low"
    assert resolve_fan_mode_for_policy("quiet", ["off", "silent", "mid", "strong"]) == "silent"


def test_resolve_fan_target_for_policy_percentage_vs_preset_only():
    pct, preset = resolve_fan_target_for_policy(
        "high",
        {"supported_features": 1, "percentage_step": 10},
    )
    assert pct == 80 or pct == 90
    assert preset is None

    pct2, preset2 = resolve_fan_target_for_policy(
        "quiet",
        {"supported_features": 8, "preset_modes": ["auto", "sleep", "turbo"]},
    )
    assert pct2 is None
    assert preset2 == "sleep"
