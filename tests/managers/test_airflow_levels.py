"""Tests for shared airflow-level normalization."""

from __future__ import annotations

import pytest

from custom_components.roommind.managers.airflow_levels import (
    fan_mode_level,
    fan_preset_mode_level,
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
