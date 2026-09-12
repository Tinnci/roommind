"""Late device confirmation updates evidence without rewriting observations."""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.roommind.control.actuation import DeviceActuationResult, DispatchStatus

from .conftest import SAMPLE_ROOM, _create_coordinator, _make_store_mock, make_mock_states_get


@pytest.mark.parametrize("outcome,application", [("applied", "confirmed"), ("not_confirmed", "not_confirmed")])
@pytest.mark.parametrize(
    "status_key,entity_id,service,desired",
    [
        ("device_actuation_status", "climate.ac", "set_temperature", {"temperature": 22.0}),
        ("night_control_status", "switch.beep", "switch.turn_off", {"entity_id": "switch.beep"}),
    ],
)
def test_late_feedback_publishes_a_detached_snapshot(
    hass, mock_config_entry, outcome, application, status_key, entity_id, service, desired
):
    coordinator = _create_coordinator(hass, mock_config_entry)
    coordinator.async_update_listeners = MagicMock()
    coordinator._actuation_ledger.record_dispatch(
        DeviceActuationResult(entity_id, DispatchStatus.SENT, service, desired, context_id="current")
    )
    status = {
        "entity_id": entity_id,
        "context_id": "current",
        "dispatch": "sent",
        "acceptance": "unknown",
        "application": "pending",
    }
    previous = {
        "rooms": {
            "bedroom": {
                "observed_mode": None,
                "observation_status": "unknown",
                status_key: [status],
            }
        }
    }
    original = deepcopy(previous)
    coordinator.data = previous

    coordinator._handle_tcl_command_result(
        SimpleNamespace(data={"context_id": "current", "outcome": outcome, "transport_outcome": "accepted_by_local"})
    )

    current = coordinator.data["rooms"]["bedroom"]
    assert current[status_key][0]["application"] == application
    assert current[status_key][0]["acceptance"] == "accepted"
    assert current["observed_mode"] is None
    assert previous == original
    assert coordinator.data is not previous
    coordinator.async_update_listeners.assert_called_once()


def test_superseded_confirmation_does_not_change_the_current_plan(hass, mock_config_entry):
    coordinator = _create_coordinator(hass, mock_config_entry)
    coordinator.async_update_listeners = MagicMock()
    coordinator._actuation_ledger.record_dispatch(
        DeviceActuationResult("climate.ac", DispatchStatus.SENT, "set_temperature", {}, context_id="old")
    )
    previous = {"rooms": {"bedroom": {"device_actuation_status": [{"context_id": "new", "application": "pending"}]}}}
    coordinator.data = previous
    coordinator._handle_tcl_command_result(SimpleNamespace(data={"context_id": "old", "outcome": "applied"}))
    assert coordinator.data is previous
    coordinator.async_update_listeners.assert_not_called()


async def test_feedback_arriving_during_another_room_is_included_in_cycle_publication(hass, mock_config_entry):
    rooms = {area_id: {**SAMPLE_ROOM, "area_id": area_id} for area_id in ("first", "second")}
    hass.data = {"roommind": {"store": _make_store_mock(rooms)}}
    hass.states.get = MagicMock(side_effect=make_mock_states_get())
    coordinator = _create_coordinator(hass, mock_config_entry)
    coordinator.data = {}
    first_result = {
        "observed_mode": None,
        "observation_status": "unknown",
        "device_actuation_status": [{"context_id": "first", "acceptance": "unknown", "application": "pending"}],
    }

    async def process_room(room, *args, **kwargs):
        if room["area_id"] == "first":
            coordinator._actuation_ledger.record_dispatch(
                DeviceActuationResult("climate.ac", DispatchStatus.SENT, "set_temperature", {}, context_id="first")
            )
            return first_result
        coordinator._handle_tcl_command_result(SimpleNamespace(data={"context_id": "first", "outcome": "applied"}))
        return {}

    coordinator._async_process_room = AsyncMock(side_effect=process_room)
    result = await coordinator._async_update_data()

    assert coordinator._async_process_room.await_count == 2
    assert result["rooms"]["first"]["device_actuation_status"][0]["application"] == "confirmed"
    assert result["rooms"]["first"]["observed_mode"] is None
    assert first_result["device_actuation_status"][0]["application"] == "pending"
