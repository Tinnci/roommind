"""Master device and compressor group coordination for RoomMind."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from ..const import (
    DEFAULT_OUTDOOR_HEATING_MAX,
    MODE_HEATING,
    MODE_IDLE,
    make_roommind_context,
)
from ..utils.device_utils import room_contributes_to_group
from .compressor_group_manager import (
    CompressorGroupConfig,
    CompressorGroupManager,
    CompressorGroupState,
    resolve_master_action,
)

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)


class MasterDeviceManager:
    """Coordinates shared compressor masters, action scripts, and multi-zone wakeups."""

    def __init__(self, hass: HomeAssistant, compressor_manager: CompressorGroupManager) -> None:
        self.hass = hass
        self._compressor_manager = compressor_manager

    def collect_member_room_modes(
        self,
        members: list[str],
        room_states: dict[str, dict],
        rooms_config: dict[str, dict],
        settings: dict,
    ) -> list[str]:
        """Collect room modes for rooms containing group member devices."""
        if not settings.get("climate_control_active", True):
            return []
        member_set = set(members)
        modes: list[str] = []
        for area_id, room in rooms_config.items():
            if not room.get("climate_control_enabled", True) or room.get("is_outdoor", False):
                continue
            device_eids = {d.get("entity_id", "") for d in room.get("devices", [])}
            if not (device_eids & member_set):
                continue
            rs = room_states.get(area_id)
            if not rs:
                continue
            commanded = rs.get("commanded_mode", rs.get("mode", MODE_IDLE))
            if (
                commanded == MODE_HEATING
                and room.get("heat_source_orchestration", False)
                and not room_contributes_to_group(
                    room.get("devices", []),
                    member_set,
                    rs.get("active_heat_sources"),
                )
            ):
                continue
            modes.append(commanded)
        return modes

    def resolve_master_hvac_mode(self, master_entity: str, action: str) -> str | None:
        """Map action to supported hvac_mode for master entity. Returns None if unsupported."""
        state = self.hass.states.get(master_entity)
        if state is None or state.state in ("unavailable", "unknown"):
            return None
        supported = state.attributes.get("hvac_modes", [])
        if action == "idle":
            if "off" in supported:
                return "off"
            _LOGGER.warning(
                "Master '%s': 'off' not supported, cannot turn idle (available: %s)",
                master_entity,
                supported,
            )
            return None
        if action in supported:
            return action
        if "heat_cool" in supported:
            return "heat_cool"
        if "auto" in supported:
            return "auto"
        _LOGGER.warning(
            "Master '%s': mode '%s' not supported (available: %s)",
            master_entity,
            action,
            supported,
        )
        return None

    async def async_wake_member_zone(
        self,
        group: CompressorGroupConfig,
        room_states: dict[str, dict],
        rooms_config: dict[str, dict],
    ) -> None:
        """Pre-activate one fan_only-capable member zone for ducted multi-zone startup."""
        for eid in group.members:
            state = self.hass.states.get(eid)
            if state is not None and state.state not in ("off", "unavailable", "unknown"):
                return

        member_set = set(group.members)
        wake_eid: str | None = None

        for area_id, room in rooms_config.items():
            if not room.get("climate_control_enabled", True) or room.get("is_outdoor", False):
                continue
            rs = room_states.get(area_id)
            if not rs or rs.get("commanded_mode", rs.get("mode", MODE_IDLE)) == MODE_IDLE:
                continue
            for dev in room.get("devices", []):
                eid = dev.get("entity_id", "")
                if eid not in member_set:
                    continue
                zone_state = self.hass.states.get(eid)
                if zone_state and "fan_only" in (zone_state.attributes.get("hvac_modes") or []):
                    wake_eid = eid
                    break
            if wake_eid:
                break

        if not wake_eid:
            for eid in group.members:
                zone_state = self.hass.states.get(eid)
                if zone_state and "fan_only" in (zone_state.attributes.get("hvac_modes") or []):
                    wake_eid = eid
                    break

        if not wake_eid:
            _LOGGER.debug("Group '%s': no zone supports fan_only for pre-activation", group.name)
            return

        try:
            await self.hass.services.async_call(
                "climate",
                "set_hvac_mode",
                {"entity_id": wake_eid, "hvac_mode": "fan_only"},
                blocking=True,
                context=make_roommind_context(),
            )
            self._compressor_manager.update_member(wake_eid, True)
            _LOGGER.debug(
                "Master '%s' (group '%s'): pre-activated zone '%s' (fan_only)",
                group.master_entity,
                group.name,
                wake_eid,
            )
        except Exception:  # noqa: BLE001
            _LOGGER.warning(
                "Master '%s' (group '%s'): failed to pre-activate zone '%s'",
                group.master_entity,
                group.name,
                wake_eid,
                exc_info=True,
            )

    async def async_control_master_devices(
        self,
        room_states: dict[str, dict],
        rooms_config: dict[str, dict],
        settings: dict,
        *,
        outdoor_temp_effective: float | None,
    ) -> None:
        """Control master devices based on aggregate demand from member rooms."""
        if not settings.get("climate_control_active", True):
            return
        for gid, group in self._compressor_manager.get_groups().items():
            if not group.master_entity and not group.action_script and not group.enforce_uniform_mode:
                continue
            try:
                await self._async_process_group(
                    gid,
                    group,
                    room_states,
                    rooms_config,
                    settings,
                    outdoor_temp_effective=outdoor_temp_effective,
                )
            except Exception:  # noqa: BLE001
                _LOGGER.warning("Master device control failed for group '%s'", group.name, exc_info=True)

    async def _async_process_group(
        self,
        gid: str,
        group: CompressorGroupConfig,
        room_states: dict[str, dict],
        rooms_config: dict[str, dict],
        settings: dict,
        *,
        outdoor_temp_effective: float | None,
    ) -> None:
        has_master = bool(group.master_entity)
        master_state = None
        if has_master:
            master_state = self.hass.states.get(group.master_entity)
            if master_state is None or master_state.state in ("unavailable", "unknown"):
                _LOGGER.warning(
                    "Master '%s' (group '%s'): entity unavailable, skipping",
                    group.master_entity,
                    group.name,
                )
                return

        modes = self.collect_member_room_modes(group.members, room_states, rooms_config, settings)
        new_action = resolve_master_action(
            modes,
            group.conflict_resolution,
            outdoor_temp_effective,
            settings.get("outdoor_heating_max", DEFAULT_OUTDOOR_HEATING_MAX),
        )
        state = self._compressor_manager.get_state(gid)
        prev_action = state.master_action if state else None

        if has_master:
            if not self._compressor_manager.check_master_can_switch(gid, new_action):
                return
            resolved_mode = self.resolve_master_hvac_mode(group.master_entity, new_action)
            if resolved_mode is None:
                if new_action != "idle":
                    _LOGGER.warning(
                        "Master '%s' (group '%s'): cannot resolve mode for action '%s', skipping",
                        group.master_entity,
                        group.name,
                        new_action,
                    )
                return
            if master_state is not None and master_state.state == resolved_mode:
                self._compressor_manager.set_master_action(gid, new_action)
                if new_action != prev_action and group.action_script:
                    await self.call_action_script(group, state, new_action)
                return
            if new_action != "idle" and (prev_action is None or prev_action == "idle"):
                await self.async_wake_member_zone(group, room_states, rooms_config)
            try:
                await self.hass.services.async_call(
                    "climate",
                    "set_hvac_mode",
                    {"entity_id": group.master_entity, "hvac_mode": resolved_mode},
                    blocking=True,
                    context=make_roommind_context(),
                )
            except Exception:  # noqa: BLE001
                _LOGGER.warning(
                    "Master '%s' (group '%s'): failed to set hvac_mode '%s'",
                    group.master_entity,
                    group.name,
                    resolved_mode,
                    exc_info=True,
                )
                return

        if new_action != prev_action and group.action_script:
            await self.call_action_script(group, state, new_action)

        if new_action != prev_action:
            label = group.master_entity or group.action_script or f"group:{group.id}"
            _LOGGER.info("Master '%s' (group '%s'): %s -> %s", label, group.name, prev_action, new_action)
        self._compressor_manager.set_master_action(gid, new_action)

    async def call_action_script(
        self,
        group: CompressorGroupConfig,
        state: CompressorGroupState | None,
        new_action: str,
    ) -> None:
        """Call the group's action script with transition variables."""
        script_state = self.hass.states.get(group.action_script)
        if script_state is None:
            _LOGGER.warning("Master group '%s': action script '%s' not found", group.name, group.action_script)
            return
        try:
            await self.hass.services.async_call(
                "script",
                "turn_on",
                {
                    "entity_id": group.action_script,
                    "variables": {
                        "action": new_action,
                        "master_entity": group.master_entity,
                        "members": group.members,
                        "active_members": [eid for eid in group.members if state and eid in state.active_members],
                    },
                },
                blocking=False,
                context=make_roommind_context(),
            )
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Master group '%s': action script '%s' failed", group.name, group.action_script, exc_info=True)
