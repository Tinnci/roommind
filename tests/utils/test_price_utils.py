"""Tests for electricity price signal parsing and target shifting."""

from __future__ import annotations

import pytest

from custom_components.roommind.const import TargetTemps
from custom_components.roommind.utils.price_utils import (
    LEVEL_CHEAP,
    LEVEL_EXPENSIVE,
    LEVEL_NORMAL,
    PriceSignal,
    PriceSlot,
    apply_price_shift,
    level_of,
    price_thresholds,
    signal_from_state,
)


def test_price_thresholds_rejects_flat_tariffs():
    assert price_thresholds([0.20, 0.21, 0.205, 0.20]) is None
    thresholds = price_thresholds([0.10, 0.20, 0.30, 0.40])
    assert thresholds is not None
    assert level_of(0.10, thresholds) == LEVEL_CHEAP
    assert level_of(0.25, thresholds) == LEVEL_NORMAL
    assert level_of(0.40, thresholds) == LEVEL_EXPENSIVE


def test_signal_from_forecast_attributes_and_direction():
    now = 1_700_000_000.0
    attrs = {
        "data": [
            {"start": now, "end": now + 3600, "value": 0.10},
            {"start": now + 3600, "end": now + 7200, "value": 0.25},
            {"start": now + 7200, "end": now + 10800, "value": 0.45},
        ]
    }
    signal = signal_from_state("sensor", "0.10", attrs, now)
    assert isinstance(signal, PriceSignal)
    assert signal.current_level == LEVEL_CHEAP
    # Expensive hour follows within lookahead -> +1 charge
    assert signal.direction_at(now) == 1
    assert signal.direction_at(now + 7200) == -1


def test_apply_price_shift_respects_direction_and_auto_band():
    targets = TargetTemps(heat=20.0, cool=24.0)
    assert apply_price_shift(targets, 1, 1.5) == TargetTemps(heat=21.5, cool=22.5)
    assert apply_price_shift(targets, -1, 1.5) == TargetTemps(heat=18.5, cool=25.5)

    # Charging never flips heat above cool in a narrow band
    narrow = TargetTemps(heat=21.0, cool=22.0)
    shifted = apply_price_shift(narrow, 1, 2.0)
    assert shifted.heat == pytest.approx(21.5)
    assert shifted.cool == pytest.approx(21.5)


def test_signal_from_switch_domain():
    sig_on = signal_from_state("binary_sensor", "on", {}, 1000.0)
    assert sig_on is not None
    assert sig_on.current_level == LEVEL_CHEAP
    assert sig_on.direction_at(1000.0) == 1

    sig_off = signal_from_state("binary_sensor", "off", {}, 1000.0)
    assert sig_off is not None
    assert sig_off.direction_at(1000.0) == 0


def test_price_signal_normalizes_no_upcoming_expensive_slot():
    now = 1_700_000_000.0
    sig = PriceSignal(
        current_price=0.10,
        current_level=LEVEL_CHEAP,
        slots=[
            PriceSlot(now, now + 3600, 0.10),
            PriceSlot(now + 3600, now + 7200, 0.12),
        ],
        thresholds=(0.11, 0.30),
        now=now,
    )
    assert sig.direction_at(now) == 0
