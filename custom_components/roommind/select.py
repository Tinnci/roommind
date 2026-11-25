"""Select platform for RoomMind."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CLIMATE_MODE_AUTO, CLIMATE_MODES, DOMAIN
from .coordinator import EntityPlatform, RoomMindCoordinator, has_climate_control_devices
from .utils.device_info import room_device_info
from .utils.entity_translation import room_translation_placeholders


def create_room_selects(
    coordinator: RoomMindCoordinator,
    area_id: str,
) -> list[SelectEntity]:
    """Create select entities for a room."""
    return [RoomMindClimateModeSelect(coordinator, area_id)]


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up RoomMind select entities from a config entry."""
    coordinator: RoomMindCoordinator = hass.data[DOMAIN][entry.entry_id]
    store = hass.data[DOMAIN]["store"]
    rooms = store.get_rooms()
    controlled_area_ids = [area_id for area_id, room in rooms.items() if has_climate_control_devices(room)]
    coordinator.register_entity_platform(
        EntityPlatform.CLIMATE_MODE_SELECT,
        async_add_entities,
        create_room_selects,
        controlled_area_ids,
    )
    entities: list[SelectEntity] = []
    for area_id in controlled_area_ids:
        entities.extend(create_room_selects(coordinator, area_id))
    if entities:
        async_add_entities(entities)


class RoomMindClimateModeSelect(CoordinatorEntity, SelectEntity):
    """Native Home Assistant selector for a room's RoomMind HVAC operating mode."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:hvac"
    _attr_options = list(CLIMATE_MODES)

    def __init__(self, coordinator: RoomMindCoordinator, area_id: str) -> None:
        super().__init__(coordinator)
        self._area_id = area_id
        self._attr_unique_id = f"{DOMAIN}_{area_id}_climate_mode"
        self._attr_translation_key = "climate_mode"
        self._attr_translation_placeholders = room_translation_placeholders(coordinator, area_id)
        self._attr_device_info = room_device_info(coordinator, area_id)
        self.entity_id = f"select.{DOMAIN}_{area_id}_climate_mode"

    @property
    def current_option(self) -> str | None:
        """Return the active climate mode configured for the room."""
        store = self.coordinator.hass.data[DOMAIN]["store"]
        room = store.get_room(self._area_id)
        if room is None:
            return None
        mode = str(room.get("climate_mode", CLIMATE_MODE_AUTO))
        return mode if mode in CLIMATE_MODES else CLIMATE_MODE_AUTO

    async def async_select_option(self, option: str) -> None:
        """Update the room's climate mode and trigger an immediate control refresh."""
        if option not in CLIMATE_MODES:
            raise ServiceValidationError(f"Unsupported climate mode: {option}")
        store = self.coordinator.hass.data[DOMAIN]["store"]
        await store.async_update_room(self._area_id, {"climate_mode": option})
        await self.coordinator.async_request_refresh()
