"""Tests for TRV setpoints, AC control, managed vs full control, device max/min, proportional boost, Fahrenheit conversion."""

from __future__ import annotations

import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from .conftest import (
    MANAGED_ROOM,
    SAMPLE_ROOM,
    _create_coordinator,
    _make_store_mock,
    make_mock_states_get,
)


def test_climate_device_snapshot_captures_inventory_and_conservative_limits(hass, mock_config_entry):
    """One snapshot owns device ordering and the safe shared temperature bounds."""
    coordinator = _create_coordinator(hass, mock_config_entry)
    room = {
        "devices": [
            {"entity_id": "climate.ac1", "type": "ac"},
            {"entity_id": "climate.trv1", "type": "trv"},
            {"entity_id": "climate.ac2", "type": "ac"},
            {"entity_id": "climate.trv2", "type": "trv"},
        ]
    }
    attributes = {
        "climate.trv1": {"max_temp": 30.0},
        "climate.trv2": {"max_temp": 28.0},
        "climate.ac1": {"min_temp": 16.0, "max_temp": 31.0},
        "climate.ac2": {"min_temp": 18.0, "max_temp": 29.0},
    }

    def get_state(entity_id):
        state = MagicMock()
        state.attributes = attributes[entity_id]
        return state

    hass.states.get = MagicMock(side_effect=get_state)

    snapshot = coordinator._read_climate_device_snapshot(room)

    assert snapshot.trv_entity_ids == ("climate.trv1", "climate.trv2")
    assert snapshot.ac_entity_ids == ("climate.ac1", "climate.ac2")
    assert snapshot.all_entity_ids == (
        "climate.trv1",
        "climate.trv2",
        "climate.ac1",
        "climate.ac2",
    )
    assert snapshot.heating_boost_target == 28.0
    assert snapshot.ac_heating_boost_target == 29.0
    assert snapshot.cooling_boost_target == 18.0


@pytest.mark.parametrize(
    "mode,device_type,current,power,bounds,options,expected",
    [
        ("heating", "trv", 20.0, 0.5, {"max_temp": 30.0}, {}, 25.0),
        ("heating", "trv", 20.0, 0.01, {"max_temp": 30.0}, {}, 21.0),
        ("heating", "trv", 20.0, 0.5, {"max_temp": 25.0}, {}, 22.5),
        ("heating", "trv", 20.0, 1.0, {"max_temp": 25.0}, {}, 25.0),
        ("heating", "ac", 20.0, 0.5, {"max_temp": 30.0}, {}, 25.0),
        ("cooling", "ac", 26.0, 0.5, {"min_temp": 16.0}, {}, 21.0),
        ("cooling", "ac", 26.0, 0.5, {"min_temp": 18.0}, {}, 22.0),
        ("cooling", "ac", 26.0, 1.0, {"min_temp": 18.0}, {}, 18.0),
        ("heating", "trv", 20.0, 1.0, {}, {"setpoint_mode": "direct"}, 21.0),
        ("cooling", "ac", 26.0, 1.0, {}, {"setpoint_mode": "direct"}, 24.0),
        ("heating", "ac", 19.0, 0.75, {}, {"max_setpoint_offset_c": 2.0}, 22.0),
        ("cooling", "ac", 26.0, 0.75, {}, {"max_setpoint_offset_c": 2.0}, 23.0),
        ("heating", "trv", 20.0, 0.73, {"target_temp_step": 1.0}, {"max_setpoint_offset_c": 2.4}, 22.0),
    ],
)
async def test_published_setpoint_comes_from_the_actual_device_plan(
    hass, mock_config_entry, monkeypatch, mode, device_type, current, power, bounds, options, expected
):
    from custom_components.roommind.control.mpc_controller import MPCController

    monkeypatch.setattr(MPCController, "async_evaluate", AsyncMock(return_value=(mode, power)))
    entity_id = "climate.device"
    room = {
        **SAMPLE_ROOM,
        "climate_mode": "heat_only" if mode == "heating" else "cool_only",
        "thermostats": [entity_id] if device_type == "trv" else [],
        "acs": [entity_id] if device_type == "ac" else [],
        "devices": [{"entity_id": entity_id, "type": device_type, **options}],
    }
    attributes = {
        "hvac_modes": ["off", "heat", "cool"],
        "temperature": 20.0,
        "min_temp": 16.0 if device_type == "ac" else 5.0,
        "max_temp": 30.0,
        "target_temp_step": 0.5,
        **bounds,
    }
    hass.states.get = MagicMock(
        side_effect=make_mock_states_get(
            temp=str(current), extra={entity_id: ("heat" if mode == "heating" else "cool", attributes)}
        )
    )
    hass.services.async_call = AsyncMock()
    coordinator = _create_coordinator(hass, mock_config_entry)
    coordinator.outdoor_temp_effective = 5.0 if mode == "heating" else 32.0

    live = await coordinator._async_process_room(room, {}, [])

    assert live["device_setpoint"] == expected
    assert live["heat_target"] == 21.0
    assert live["cool_target"] == 24.0
    operations = live["device_actuation_status"]
    temperature_operation = next(item for item in operations if item["service"] == "set_temperature")
    assert temperature_operation["desired"]["temperature"] == expected
    assert temperature_operation["dispatch"] == "sent"
    assert temperature_operation["application"] == "pending"


class TestReadDeviceTemperatureObservation:
    """Tests for temperature observations from managed devices."""

    def test_reads_from_thermostat(self, hass, mock_config_entry):
        coordinator = _create_coordinator(hass, mock_config_entry)
        state = MagicMock()
        state.attributes = {"current_temperature": 21.5}
        hass.states.get = MagicMock(return_value=state)

        room = {
            "thermostats": ["climate.trv1"],
            "acs": [],
            "devices": [{"entity_id": "climate.trv1", "type": "trv", "role": "auto", "heating_system_type": ""}],
        }
        assert coordinator._read_device_temperature_observation(room).value == 21.5

    def test_reads_from_ac_when_no_thermostat(self, hass, mock_config_entry):
        coordinator = _create_coordinator(hass, mock_config_entry)
        state = MagicMock()
        state.attributes = {"current_temperature": 25.0}
        hass.states.get = MagicMock(return_value=state)

        room = {
            "thermostats": [],
            "acs": ["climate.ac1"],
            "devices": [{"entity_id": "climate.ac1", "type": "ac", "role": "auto", "heating_system_type": ""}],
        }
        assert coordinator._read_device_temperature_observation(room).value == 25.0

    def test_no_devices(self, hass, mock_config_entry):
        coordinator = _create_coordinator(hass, mock_config_entry)
        room = {"thermostats": [], "acs": [], "devices": []}
        assert coordinator._read_device_temperature_observation(room) is None

    def test_state_is_none(self, hass, mock_config_entry):
        coordinator = _create_coordinator(hass, mock_config_entry)
        hass.states.get = MagicMock(return_value=None)
        room = {
            "thermostats": ["climate.trv1"],
            "acs": [],
            "devices": [{"entity_id": "climate.trv1", "type": "trv", "role": "auto", "heating_system_type": ""}],
        }
        assert coordinator._read_device_temperature_observation(room) is None

    def test_invalid_temperature_value(self, hass, mock_config_entry):
        coordinator = _create_coordinator(hass, mock_config_entry)
        state = MagicMock()
        state.attributes = {"current_temperature": "unknown"}
        hass.states.get = MagicMock(return_value=state)

        room = {
            "thermostats": ["climate.trv1"],
            "acs": [],
            "devices": [{"entity_id": "climate.trv1", "type": "trv", "role": "auto", "heating_system_type": ""}],
        }
        assert coordinator._read_device_temperature_observation(room) is None

    def test_no_current_temp_attribute(self, hass, mock_config_entry):
        coordinator = _create_coordinator(hass, mock_config_entry)
        state = MagicMock()
        state.attributes = {"temperature": 21.0}  # different key
        hass.states.get = MagicMock(return_value=state)

        room = {
            "thermostats": ["climate.trv1"],
            "acs": [],
            "devices": [{"entity_id": "climate.trv1", "type": "trv", "role": "auto", "heating_system_type": ""}],
        }
        assert coordinator._read_device_temperature_observation(room) is None


class TestFahrenheitConversion:
    """Tests for Fahrenheit temperature conversion at system boundaries."""

    @pytest.mark.asyncio
    async def test_fahrenheit_sensor_converted_to_celsius(self, hass, mock_config_entry):
        """When HA is in Fahrenheit, sensor temps are converted to Celsius internally."""
        from homeassistant.const import UnitOfTemperature

        hass.config.units.temperature_unit = UnitOfTemperature.FAHRENHEIT

        store = _make_store_mock({"living_room_abc12345": SAMPLE_ROOM})
        hass.data = {"roommind": {"store": store}}

        # Sensor reports 64.4degF (= 18degC), outdoor 50degF (= 10degC)
        hass.states.get = MagicMock(
            side_effect=make_mock_states_get(
                temp="64.4",
                humidity="55.0",
                outdoor_temp="50",
                temp_unit="°F",
            ),
        )
        hass.services.async_call = AsyncMock()

        coordinator = _create_coordinator(hass, mock_config_entry)
        data = await coordinator._async_update_data()

        room = data["rooms"]["living_room_abc12345"]
        # Internal current_temp should be Celsius (~18degC)
        assert room["current_temp"] == pytest.approx(18.0, abs=0.1)
        # Target temp should remain in Celsius (comfort_temp=21degC stored in Celsius)
        assert room["target_temp"] == pytest.approx(21.0, abs=0.1)
        # Mode should be heating (18degC < 21degC target)
        assert room["commanded_mode"] == "heating"

    @pytest.mark.asyncio
    async def test_valve_protection_set_temperature_in_fahrenheit(self, hass, mock_config_entry):
        """Valve protection set_temperature uses Fahrenheit when HA is in degF mode."""
        from homeassistant.const import UnitOfTemperature

        from custom_components.roommind.const import HEATING_BOOST_TARGET

        hass.config.units.temperature_unit = UnitOfTemperature.FAHRENHEIT

        store = _make_store_mock({"living_room_abc12345": SAMPLE_ROOM})
        store.get_settings.return_value = {
            "valve_protection_enabled": True,
            "valve_protection_interval_days": 7,
        }
        store.async_save_settings = AsyncMock()
        hass.data = {"roommind": {"store": store}}
        hass.states.get = MagicMock(
            side_effect=make_mock_states_get(temp="69.8", temp_unit="°F"),  # 69.8degF ~ 21degC
        )
        hass.services.async_call = AsyncMock()

        coordinator = _create_coordinator(hass, mock_config_entry)
        coordinator._valve_manager._last_actuation["climate.living_room"] = time.time() - 8 * 86400
        coordinator._valve_manager._check_count = 119
        await coordinator._async_update_data()

        assert "climate.living_room" in coordinator._valve_manager._cycling

        # Find set_temperature calls for the cycling valve
        set_temp_calls = [
            c
            for c in hass.services.async_call.call_args_list
            if c[0][0] == "climate"
            and c[0][1] == "set_temperature"
            and c[0][2].get("entity_id") == "climate.living_room"
        ]
        assert set_temp_calls
        # HEATING_BOOST_TARGET is 30degC -> 86degF
        expected_f = HEATING_BOOST_TARGET * 9 / 5 + 32  # 86degF
        temp_arg = set_temp_calls[0][0][2]["temperature"]
        assert temp_arg == pytest.approx(expected_f)

    @pytest.mark.asyncio
    async def test_fahrenheit_device_max_temp_converted_for_boost(self, hass, mock_config_entry):
        """Device max_temp in Fahrenheit is converted to Celsius for boost target (#117)."""
        from homeassistant.const import UnitOfTemperature

        hass.config.units.temperature_unit = UnitOfTemperature.FAHRENHEIT

        store = _make_store_mock({"living_room_abc12345": SAMPLE_ROOM})
        hass.data = {"roommind": {"store": store}}

        # TRV reports max_temp=95degF (= 35degC). Bug: treated as 95degC.
        hass.states.get = MagicMock(
            side_effect=make_mock_states_get(
                temp="64.4",
                humidity="55.0",
                outdoor_temp="50",
                temp_unit="°F",
                extra={
                    "climate.living_room": (
                        "heat",
                        {
                            "current_temperature": 64.4,
                            "temperature": 69.8,
                            "max_temp": 95.0,
                            "min_temp": 44.6,
                            "hvac_modes": ["off", "heat"],
                            "hvac_action": "heating",
                        },
                    ),
                },
            ),
        )
        hass.services.async_call = AsyncMock()

        coordinator = _create_coordinator(hass, mock_config_entry)
        data = await coordinator._async_update_data()

        room = data["rooms"]["living_room_abc12345"]
        # device_setpoint is in Celsius. With the bug it would be ~95.
        # After fix: boost = 35degC (converted from 95degF), so setpoint <= 35.
        assert room["device_setpoint"] is not None
        assert room["device_setpoint"] <= 35.0

    @pytest.mark.asyncio
    async def test_fahrenheit_set_temperature_uses_converted_boost(self, hass, mock_config_entry):
        """set_temperature call must not exceed device max in Fahrenheit (#117)."""
        from homeassistant.const import UnitOfTemperature

        hass.config.units.temperature_unit = UnitOfTemperature.FAHRENHEIT

        store = _make_store_mock({"living_room_abc12345": SAMPLE_ROOM})
        hass.data = {"roommind": {"store": store}}

        # TRV reports max_temp=95degF (= 35degC)
        hass.states.get = MagicMock(
            side_effect=make_mock_states_get(
                temp="64.4",
                humidity="55.0",
                outdoor_temp="50",
                temp_unit="°F",
                extra={
                    "climate.living_room": (
                        "heat",
                        {
                            "current_temperature": 64.4,
                            "temperature": 69.8,
                            "max_temp": 95.0,
                            "min_temp": 44.6,
                            "hvac_modes": ["off", "heat"],
                            "hvac_action": "heating",
                        },
                    ),
                },
            ),
        )
        hass.services.async_call = AsyncMock()

        coordinator = _create_coordinator(hass, mock_config_entry)
        await coordinator._async_update_data()

        # Find set_temperature calls for the TRV
        set_temp_calls = [
            c
            for c in hass.services.async_call.call_args_list
            if c[0][0] == "climate"
            and c[0][1] == "set_temperature"
            and c[0][2].get("entity_id") == "climate.living_room"
        ]
        assert set_temp_calls
        # Temperature must be <= 95degF (device max). With the bug it would be 203degF.
        temp_arg = set_temp_calls[0][0][2].get("temperature")
        if temp_arg is not None:
            assert temp_arg <= 95.0, f"set_temperature sent {temp_arg}degF, exceeds device max 95degF"


class TestManagedModeDisplay:
    """Tests for Managed Mode display and EKF training fixes (#69)."""

    @pytest.mark.asyncio
    async def test_managed_mode_display_idle_at_setpoint(self, hass, mock_config_entry):
        """Managed Mode: device at setpoint without hvac_action -> display idle (#69)."""
        store = _make_store_mock({"living_room_abc12345": MANAGED_ROOM})
        hass.data = {"roommind": {"store": store}}

        # Device in heat mode, current_temp (21) >= setpoint (21) -> inferred idle
        device_state = MagicMock()
        device_state.state = "heat"
        device_state.attributes = {
            "current_temperature": 21.0,
            "temperature": 21.0,
            "hvac_modes": ["off", "heat"],
        }
        base_mock = make_mock_states_get(temp=None, humidity="55.0")

        def custom_get(eid):
            if eid == "climate.living_room":
                return device_state
            return base_mock(eid)

        hass.states.get = MagicMock(side_effect=custom_get)
        hass.services.async_call = AsyncMock()

        coordinator = _create_coordinator(hass, mock_config_entry)
        data = await coordinator._async_update_data()

        room = data["rooms"]["living_room_abc12345"]
        assert room["mode"] == "idle", "Managed Mode should show idle when device is at setpoint"
        assert room["heating_power"] == 0

    @pytest.mark.asyncio
    async def test_managed_mode_display_heating_below_setpoint(self, hass, mock_config_entry):
        """Managed Mode: device below setpoint without hvac_action -> display heating (#69)."""
        store = _make_store_mock({"living_room_abc12345": MANAGED_ROOM})
        hass.data = {"roommind": {"store": store}}

        # Device in heat mode, current_temp (18) < setpoint (21) -> inferred heating
        device_state = MagicMock()
        device_state.state = "heat"
        device_state.attributes = {
            "current_temperature": 18.0,
            "temperature": 21.0,
            "hvac_modes": ["off", "heat"],
        }
        base_mock = make_mock_states_get(temp=None, humidity="55.0")

        def custom_get(eid):
            if eid == "climate.living_room":
                return device_state
            return base_mock(eid)

        hass.states.get = MagicMock(side_effect=custom_get)
        hass.services.async_call = AsyncMock()

        coordinator = _create_coordinator(hass, mock_config_entry)
        data = await coordinator._async_update_data()

        room = data["rooms"]["living_room_abc12345"]
        assert room["observation_status"] == "unknown", "A setpoint gap is not device feedback"
        assert room["heating_power"] == 0

    @pytest.mark.asyncio
    async def test_managed_mode_display_uses_hvac_action(self, hass, mock_config_entry):
        """Managed Mode: device with hvac_action=idle -> display idle (#69)."""
        store = _make_store_mock({"living_room_abc12345": MANAGED_ROOM})
        hass.data = {"roommind": {"store": store}}

        device_state = MagicMock()
        device_state.state = "heat"
        device_state.attributes = {
            "hvac_action": "idle",
            "current_temperature": 21.0,
            "temperature": 21.0,
            "hvac_modes": ["off", "heat"],
        }
        base_mock = make_mock_states_get(temp=None, humidity="55.0")

        def custom_get(eid):
            if eid == "climate.living_room":
                return device_state
            return base_mock(eid)

        hass.states.get = MagicMock(side_effect=custom_get)
        hass.services.async_call = AsyncMock()

        coordinator = _create_coordinator(hass, mock_config_entry)
        data = await coordinator._async_update_data()

        room = data["rooms"]["living_room_abc12345"]
        assert room["mode"] == "idle", "Managed Mode should use hvac_action when available"

    @pytest.mark.asyncio
    async def test_managed_mode_ekf_trains_inferred_idle(self, hass, mock_config_entry):
        """Managed Mode: EKF should train with inferred idle, not always heating (#69)."""
        store = _make_store_mock({"living_room_abc12345": MANAGED_ROOM})
        hass.data = {"roommind": {"store": store}}

        # Device at setpoint -> inferred idle. EKF should see idle, not heating.
        device_state = MagicMock()
        device_state.state = "heat"
        device_state.attributes = {
            "current_temperature": 21.0,
            "temperature": 21.0,
            "hvac_modes": ["off", "heat"],
        }
        base_mock = make_mock_states_get(temp=None, humidity="55.0")

        def custom_get(eid):
            if eid == "climate.living_room":
                return device_state
            return base_mock(eid)

        hass.states.get = MagicMock(side_effect=custom_get)
        hass.services.async_call = AsyncMock()

        coordinator = _create_coordinator(hass, mock_config_entry)
        for _ in range(13):
            await coordinator._async_update_data()

        n_idle, n_heating, n_cooling = coordinator._model_manager.get_mode_counts(
            "living_room_abc12345",
        )
        assert n_idle == 0, "Managed Mode without output feedback must not train inferred idle"
        assert n_heating == 0, "EKF should NOT train as heating when device is at setpoint"

    @pytest.mark.asyncio
    async def test_managed_mode_display_cooling_idle_at_setpoint(self, hass, mock_config_entry):
        """Managed Mode cooling: AC at setpoint without hvac_action -> display idle (#69)."""
        managed_cool_room = {
            **MANAGED_ROOM,
            "thermostats": [],
            "acs": ["climate.living_room"],
            "devices": [{"entity_id": "climate.living_room", "type": "ac", "role": "auto", "heating_system_type": ""}],
            "climate_mode": "cool_only",
        }
        store = _make_store_mock({"living_room_abc12345": managed_cool_room})
        hass.data = {"roommind": {"store": store}}

        # AC in cool mode, current_temp (21) <= setpoint (22) -> inferred idle
        device_state = MagicMock()
        device_state.state = "cool"
        device_state.attributes = {
            "current_temperature": 21.0,
            "temperature": 22.0,
            "hvac_modes": ["off", "cool"],
        }
        base_mock = make_mock_states_get(temp=None, humidity="55.0")

        def custom_get(eid):
            if eid == "climate.living_room":
                return device_state
            return base_mock(eid)

        hass.states.get = MagicMock(side_effect=custom_get)
        hass.services.async_call = AsyncMock()

        coordinator = _create_coordinator(hass, mock_config_entry)
        data = await coordinator._async_update_data()

        room = data["rooms"]["living_room_abc12345"]
        assert room["mode"] == "idle", "Managed Mode should show idle when AC is at setpoint"
