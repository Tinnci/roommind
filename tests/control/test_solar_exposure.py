"""Tests for explicit solar exposure semantics."""

from __future__ import annotations

from custom_components.roommind.control.solar import SolarExposure


def test_solar_exposure_names_raw_shaded_and_oriented_values():
    exposure = SolarExposure(raw_solar=0.8, shading_factor=0.25, orientation_factor=0.5)

    assert exposure.raw_solar == 0.8
    assert exposure.shaded_solar == 0.2
    assert exposure.oriented_solar == 0.4
