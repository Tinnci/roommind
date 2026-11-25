"""Sensor platform for RoomMind."""

from __future__ import annotations

import math

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import PERCENTAGE, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import EntityPlatform, RoomMindCoordinator, has_climate_control_devices
from .utils.device_info import room_device_info
from .utils.entity_translation import room_translation_placeholders


def _compute_dew_point_c(temp_c: float | None, humidity: float | None) -> float | None:
    """Compute Magnus-Tetens dew point in °C rounded to 0.1 °C."""
    if temp_c is None or humidity is None or humidity <= 0 or humidity > 100:
        return None
    a = 17.625
    b = 243.04
    gamma = math.log(humidity / 100.0) + (a * temp_c) / (b + temp_c)
    if a - gamma == 0:
        return None
    return round((b * gamma) / (a - gamma), 1)


def create_room_sensors(coordinator: RoomMindCoordinator, area_id: str) -> list[SensorEntity]:
    """Create the climate-control sensor entities for a room."""
    return [
        RoomMindTargetTemperatureSensor(coordinator, area_id),
        RoomMindModeSensor(coordinator, area_id),
    ]


def create_room_monitor_sensors(coordinator: RoomMindCoordinator, area_id: str) -> list[SensorEntity]:
    """Create passive climate monitoring sensor entities for a room."""
    return [
        RoomMindTemperatureSensor(coordinator, area_id),
        RoomMindHumiditySensor(coordinator, area_id),
        RoomMindDewPointSensor(coordinator, area_id),
        RoomMindMoldRiskSensor(coordinator, area_id),
    ]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up RoomMind sensor entities from a config entry."""
    coordinator: RoomMindCoordinator = hass.data[DOMAIN][entry.entry_id]
    store = hass.data[DOMAIN]["store"]

    rooms = store.get_rooms()
    controlled_area_ids = [area_id for area_id, room in rooms.items() if has_climate_control_devices(room)]
    coordinator.register_entity_platform(
        EntityPlatform.SENSOR,
        async_add_entities,
        create_room_sensors,
        controlled_area_ids,
    )
    coordinator.register_entity_platform(
        EntityPlatform.MONITOR_SENSOR,
        async_add_entities,
        create_room_monitor_sensors,
        rooms,
    )
    entities: list[SensorEntity] = []
    for area_id in controlled_area_ids:
        entities.extend(create_room_sensors(coordinator, area_id))
    for area_id in rooms:
        entities.extend(create_room_monitor_sensors(coordinator, area_id))
    if entities:
        async_add_entities(entities)


class _RoomMindBaseSensor(CoordinatorEntity, SensorEntity):
    """Base class for all RoomMind room sensors."""

    _attr_has_entity_name = True
    _data_key: str  # Key in the room state dict (e.g. "current_temp")

    def __init__(
        self,
        coordinator: RoomMindCoordinator,
        area_id: str,
        suffix: str,
        name_label: str,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._area_id = area_id
        self._attr_unique_id = f"{DOMAIN}_{area_id}_{suffix}"
        self._attr_translation_key = suffix
        self._attr_translation_placeholders = room_translation_placeholders(coordinator, area_id)
        self._attr_device_info = room_device_info(coordinator, area_id)
        self.entity_id = f"sensor.{DOMAIN}_{area_id}_{suffix}"

    @property
    def native_value(self) -> float | str | None:
        """Return the sensor value from the coordinator data."""
        room = (self.coordinator.data or {}).get("rooms", {}).get(self._area_id)
        if room:
            val = room.get(self._data_key)
            return val if isinstance(val, (float, int, str)) and not isinstance(val, bool) else None
        return None


class RoomMindTargetTemperatureSensor(_RoomMindBaseSensor):
    """Sensor showing the target temperature for a RoomMind room."""

    _attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
    _data_key = "target_temp"

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator, area_id, "target_temperature", "Target Temperature")
        self._attr_unique_id = f"{DOMAIN}_{area_id}_target_temp"
        self.entity_id = f"sensor.{DOMAIN}_{area_id}_target_temp"


class RoomMindModeSensor(_RoomMindBaseSensor):
    """Sensor showing the current mode for a RoomMind room."""

    _data_key = "mode"

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator, area_id, "mode", "Mode")

    @property
    def native_value(self) -> str | None:
        """Return observed activity; missing feedback cannot establish idle."""
        room = (self.coordinator.data or {}).get("rooms", {}).get(self._area_id)
        if room:
            if room.get("observation_status") == "unknown":
                return None
            val = room.get("observed_mode", room.get("mode"))
            return str(val) if val in {"idle", "heating", "cooling", "dry", "fan_only"} else None
        return None


class RoomMindTemperatureSensor(_RoomMindBaseSensor):
    """Sensor exposing the fused room temperature in °C."""

    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
    _attr_suggested_display_precision = 1
    _data_key = "current_temp"

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator, area_id, "temperature", "Temperature")


class RoomMindHumiditySensor(_RoomMindBaseSensor):
    """Sensor exposing the fused room humidity in %."""

    _attr_device_class = SensorDeviceClass.HUMIDITY
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = PERCENTAGE
    _attr_suggested_display_precision = 1
    _data_key = "current_humidity"

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator, area_id, "humidity", "Humidity")


class RoomMindDewPointSensor(_RoomMindBaseSensor):
    """Sensor exposing the derived Magnus-Tetens dew point in °C."""

    _attr_device_class = SensorDeviceClass.TEMPERATURE
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = UnitOfTemperature.CELSIUS
    _attr_suggested_display_precision = 1
    _attr_icon = "mdi:water-thermometer"
    _data_key = "dew_point"

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator, area_id, "dew_point", "Dew Point")

    @property
    def native_value(self) -> float | None:
        """Compute dew point dynamically from current temperature and humidity."""
        room = (self.coordinator.data or {}).get("rooms", {}).get(self._area_id)
        if not room:
            return None
        temp = room.get("current_temp")
        hum = room.get("current_humidity")
        if (
            not isinstance(temp, int | float)
            or isinstance(temp, bool)
            or not isinstance(hum, int | float)
            or isinstance(hum, bool)
        ):
            return None
        return _compute_dew_point_c(float(temp), float(hum))


class RoomMindMoldRiskSensor(_RoomMindBaseSensor):
    """Sensor exposing the room mold risk level."""

    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = ["ok", "warning", "critical"]
    _attr_icon = "mdi:water-alert"
    _data_key = "mold_risk_level"

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator, area_id, "mold_risk", "Mold Risk")

    @property
    def native_value(self) -> str | None:
        """Return valid enum mold risk level."""
        val = super().native_value
        return str(val) if val in ("ok", "warning", "critical") else None
