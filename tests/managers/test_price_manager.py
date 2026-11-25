"""Tests for PriceManager coordinator helper."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.roommind.managers.price_manager import PriceManager
from custom_components.roommind.utils.price_utils import LEVEL_CHEAP


@pytest.mark.asyncio
async def test_price_manager_switch_holds_level_and_reports_status(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr("custom_components.roommind.managers.price_manager.time.time", lambda: now[0])
    hass = MagicMock()
    hass.states.get.return_value = SimpleNamespace(state="on", attributes={})

    mgr = PriceManager(hass)
    sig = await mgr.async_update({"price_entity": "input_boolean.cheap_power"})
    assert sig is not None
    assert sig.current_level == LEVEL_CHEAP

    st = mgr.status()
    assert st is not None
    assert st["readable"] is True
    assert st["kind"] == "switch"
    assert st["level"] == LEVEL_CHEAP

    # Switch turns off: holds previous level until LEVEL_HOLD_S (900s) elapses
    hass.states.get.return_value = SimpleNamespace(state="off", attributes={})
    now[0] += 300
    sig2 = await mgr.async_update({"price_entity": "input_boolean.cheap_power"})
    assert sig2 is not None and sig2.current_level == LEVEL_CHEAP

    now[0] += 901
    sig3 = await mgr.async_update({"price_entity": "input_boolean.cheap_power"})
    assert sig3 is not None and sig3.current_level == "normal"
