"""Tests for adjacent-room coupling estimation."""

from custom_components.roommind.managers.room_coupling_manager import RoomCouplingManager


def test_updates_positive_coupling_when_door_open_and_temperatures_diverge():
    mgr = RoomCouplingManager()

    observation = mgr.update(
        room_id="bedroom",
        adjacent_room_id="hall",
        room_temp=26.0,
        adjacent_temp=22.0,
        room_slope_c_per_h=-0.4,
        outdoor_temp=30.0,
        outdoor_alpha=0.05,
        gate=1.0,
    )

    assert observation.k > 0
    assert observation.confidence > 0


def test_inactive_or_small_delta_does_not_update_coupling():
    mgr = RoomCouplingManager()

    observation = mgr.update(
        room_id="bedroom",
        adjacent_room_id="hall",
        room_temp=22.1,
        adjacent_temp=22.0,
        room_slope_c_per_h=0.0,
        outdoor_temp=22.0,
        outdoor_alpha=0.05,
        gate=1.0,
    )

    assert observation.confidence == 0
