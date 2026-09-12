"""Room comfort controls must not masquerade as physical AC settings."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.components.climate import ClimateEntityFeature, HVACAction, HVACMode
from homeassistant.exceptions import ServiceValidationError

from custom_components.roommind.climate import RoomMindComfortClimate, RoomMindOverrideClimate
from custom_components.roommind.const import DOMAIN


@pytest.fixture
def comfort_entity():
    coordinator = MagicMock()
    coordinator.last_update_success = True
    coordinator.async_request_refresh = AsyncMock()
    store = MagicMock()
    store.get_room.return_value = {"devices": [{"entity_id": "climate.ac", "type": "ac"}]}
    store.get_settings.return_value = {}
    store.async_update_room = AsyncMock()
    coordinator.hass.data = {DOMAIN: {"store": store}}
    coordinator.data = {
        "rooms": {
            "bedroom": {
                "current_temp": 26.0,
                "current_temp_raw": 26.0,
                "target_temp": 24.0,
                "heat_target": 21.0,
                "cool_target": 24.0,
                "device_setpoint": 18.0,
                "commanded_mode": "cooling",
                "observed_mode": None,
                "observation_status": "unknown",
                "dispatch_status": "sent",
            }
        }
    }
    return RoomMindComfortClimate(coordinator, "bedroom"), coordinator, store


def test_room_target_is_effective_comfort_and_dispatch_does_not_imply_cooling(comfort_entity):
    entity, _, _ = comfort_entity
    assert entity.target_temperature == 24.0
    assert entity.current_temperature == 26.0
    assert entity.hvac_action is None
    assert entity.hvac_mode is HVACMode.AUTO
    assert entity.hvac_modes == [HVACMode.AUTO]
    assert not entity.supported_features & ClimateEntityFeature.TURN_OFF
    assert entity.extra_state_attributes["cool_target"] == 24.0
    assert entity.preset_mode == "schedule"


@pytest.mark.parametrize(
    "mode,action",
    [
        ("cooling", HVACAction.COOLING),
        ("heating", HVACAction.HEATING),
        ("idle", HVACAction.IDLE),
        ("fan_only", HVACAction.FAN),
    ],
)
def test_room_action_comes_only_from_the_observation(comfort_entity, mode, action):
    entity, coordinator, _ = comfort_entity
    coordinator.data["rooms"]["bedroom"].update(observed_mode=mode, observation_status="observed")
    assert entity.hvac_action == action


def test_cached_temperature_is_not_presented_as_a_current_measurement(comfort_entity):
    entity, coordinator, _ = comfort_entity
    coordinator.data["rooms"]["bedroom"].update(current_temp_raw=None, perceived_temp=25.2)
    assert entity.current_temperature is None
    assert entity.extra_state_attributes["perceived_temperature"] is None


@pytest.mark.parametrize("paused", ["room", "global", "outdoor"])
def test_comfort_control_is_unavailable_when_roommind_cannot_control(comfort_entity, paused):
    entity, _, store = comfort_entity
    if paused == "global":
        store.get_settings.return_value = {"climate_control_active": False}
    else:
        store.get_room.return_value["is_outdoor" if paused == "outdoor" else "climate_control_enabled"] = (
            paused == "outdoor"
        )
    assert not entity.available


async def test_setting_comfort_changes_policy_without_commanding_hardware(comfort_entity):
    entity, coordinator, store = comfort_entity
    await entity.async_set_temperature(temperature=23.5)
    store.async_update_room.assert_awaited_once_with(
        "bedroom", {"override_temp": 23.5, "override_until": None, "override_type": "custom"}
    )
    coordinator.async_request_refresh.assert_awaited_once()
    coordinator.hass.services.async_call.assert_not_called()


async def test_schedule_preset_resumes_policy_and_hold_uses_effective_target(comfort_entity):
    entity, _, store = comfort_entity
    await entity.async_set_preset_mode("hold")
    assert store.async_update_room.call_args.args[1]["override_temp"] == 24.0
    await entity.async_set_preset_mode("schedule")
    assert store.async_update_room.call_args.args[1] == {
        "override_temp": None,
        "override_until": None,
        "override_type": None,
    }


async def test_no_default_target_is_invented_before_a_room_has_a_plan(comfort_entity):
    entity, coordinator, store = comfort_entity
    coordinator.data = {}
    assert entity.target_temperature is None
    assert not entity.available
    with pytest.raises(ServiceValidationError):
        await entity.async_set_preset_mode("hold")
    store.async_update_room.assert_not_awaited()


async def test_legacy_off_keeps_its_resume_schedule_behavior(comfort_entity):
    _, coordinator, store = comfort_entity
    legacy = RoomMindOverrideClimate(coordinator, "bedroom")
    assert legacy.entity_id == "climate.roommind_bedroom_override"
    assert legacy.target_temperature == 24.0
    await legacy.async_set_hvac_mode(HVACMode.OFF)
    assert store.async_update_room.call_args.args[1]["override_temp"] is None
    assert "climate_control_enabled" not in store.async_update_room.call_args.args[1]


async def test_room_comfort_does_not_offer_an_ambiguous_off_command(comfort_entity):
    entity, _, store = comfort_entity
    with pytest.raises(ServiceValidationError):
        await entity.async_set_hvac_mode(HVACMode.OFF)
    store.async_update_room.assert_not_awaited()


async def test_temperature_service_cannot_silently_ignore_an_off_request(comfort_entity):
    entity, _, store = comfort_entity
    with pytest.raises(ServiceValidationError):
        await entity.async_set_temperature(temperature=23.5, hvac_mode=HVACMode.OFF)
    store.async_update_room.assert_not_awaited()


def test_comfort_policy_attributes_distinguish_perceived_temperature_and_requested_hold(comfort_entity):
    entity, coordinator, store = comfort_entity
    coordinator.data["rooms"]["bedroom"].update(
        effective_control_target="perceived_temperature", perceived_temp=25.2, override_suppressed=True
    )
    store.get_room.return_value.update(override_type="custom", override_temp=22.0, override_until=None)
    assert entity.target_temperature == 24.0
    assert entity.current_temperature == 26.0
    assert entity.extra_state_attributes["control_target"] == "perceived_temperature"
    assert entity.extra_state_attributes["perceived_temperature"] == 25.2
    assert entity.extra_state_attributes["override_temperature"] == 22.0
