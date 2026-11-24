"""Tests for DeviceInfo helpers."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from custom_components.roommind.const import DOMAIN, VERSION
from custom_components.roommind.utils.device_info import hub_device_info, room_device_info


def test_room_device_info_uses_area_name_when_available(monkeypatch):
    area = SimpleNamespace(name="Living Room")
    registry = MagicMock()
    registry.async_get_area.return_value = area
    monkeypatch.setattr("homeassistant.helpers.area_registry.async_get", lambda _hass: registry)

    coordinator = MagicMock()
    info = room_device_info(coordinator, "living_room")
    assert info["identifiers"] == {(DOMAIN, "living_room")}
    assert info["name"] == "RoomMind Living Room"
    assert info["suggested_area"] == "Living Room"
    assert info["sw_version"] == VERSION


def test_hub_device_info_metadata():
    info = hub_device_info()
    assert info["identifiers"] == {(DOMAIN, "hub")}
    assert info["name"] == "RoomMind Hub"
    assert info["sw_version"] == VERSION
