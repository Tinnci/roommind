"""Night-mode accessory controls for lights, displays and beepers."""

from __future__ import annotations

import inspect
import logging
from typing import Any

from homeassistant.core import HomeAssistant

from ..const import make_roommind_context

_LOGGER = logging.getLogger(__name__)

_NIGHT_SELECT_FALLBACKS = ("off", "mute", "muted", "silent", "quiet", "sleep", "night", "dark")


class NightModeManager:
    """Apply reversible night-mode commands to auxiliary device entities."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._previous_values: dict[str, Any] = {}
        self._last_targets: dict[tuple[str, str], Any] = {}

    async def async_apply(self, area_id: str, room: dict, *, active: bool) -> list[dict[str, Any]]:
        """Apply or restore configured night-mode accessory controls."""
        statuses: list[dict[str, Any]] = []
        for config in room.get("night_controls", []) or []:
            if not config.get("enabled", True):
                continue
            entity_id = str(config.get("entity_id") or "")
            if not entity_id:
                continue
            status = await self._apply_one(area_id, config, active=active)
            statuses.append(status)
        return statuses

    async def _apply_one(self, area_id: str, config: dict[str, Any], *, active: bool) -> dict[str, Any]:
        entity_id = str(config.get("entity_id") or "")
        domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
        state = self.hass.states.get(entity_id)
        status: dict[str, Any] = {
            "entity_id": entity_id,
            "role": config.get("role", "other"),
            "active": active,
            "outcome": "skipped",
            "skip_reason": "",
            "target_value": None,
            "previous_value": self._previous_values.get(entity_id),
            "restore_after_night": bool(config.get("restore_after_night", True)),
            "last_service": None,
        }
        if state is None:
            status.update({"outcome": "unavailable", "skip_reason": "entity_unavailable"})
            return status

        target = self._target_value(config, state, active=active)
        status["target_value"] = target
        if target is None:
            status.update({"outcome": "skipped", "skip_reason": "no_target_value"})
            return status

        if active and entity_id not in self._previous_values:
            self._previous_values[entity_id] = self._state_value(domain, state)
            status["previous_value"] = self._previous_values[entity_id]

        try:
            result = await self._call_target(area_id, entity_id, domain, state.attributes, target)
        except Exception:  # noqa: BLE001
            _LOGGER.warning("Room '%s': night-mode command failed for '%s'", area_id, entity_id, exc_info=True)
            status.update({"outcome": "failed", "skip_reason": "service_error"})
            return status

        status.update(result)
        if not active and status["outcome"] in {"applied", "already", "restored"}:
            self._previous_values.pop(entity_id, None)
        return status

    def _target_value(self, config: dict[str, Any], state: Any, *, active: bool) -> Any:
        entity_id = str(config.get("entity_id") or "")
        domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
        if active:
            if "night_value" in config and config.get("night_value") not in (None, ""):
                return config.get("night_value")
            if domain in {"light", "switch"}:
                return "off"
            if domain in {"number", "input_number"}:
                return 0
            if domain in {"select", "input_select"}:
                return self._select_fallback(state.attributes)
            return None

        if config.get("day_value") not in (None, ""):
            return config.get("day_value")
        if not config.get("restore_after_night", True):
            return None
        return self._previous_values.get(entity_id)

    @staticmethod
    def _select_fallback(attrs: dict[str, Any]) -> str | None:
        options = [str(item) for item in attrs.get("options") or []]
        lowered = {option.lower(): option for option in options}
        for candidate in _NIGHT_SELECT_FALLBACKS:
            if candidate in lowered:
                return lowered[candidate]
        return options[0] if options else None

    @staticmethod
    def _state_value(domain: str, state: Any) -> Any:
        if domain in {"light", "switch", "select", "input_select"}:
            return state.state
        if domain in {"number", "input_number"}:
            return state.state
        return state.state

    async def _call_target(
        self,
        area_id: str,
        entity_id: str,
        domain: str,
        attrs: dict[str, Any],
        target: Any,
    ) -> dict[str, Any]:
        if domain in {"light", "switch"}:
            target_state = str(target).lower()
            if target_state not in {"on", "off"}:
                return {"outcome": "skipped", "skip_reason": "invalid_target_state", "last_service": None}
            current = self.hass.states.get(entity_id)
            if current is not None and current.state == target_state:
                return {"outcome": "already", "last_service": None}
            service = "turn_on" if target_state == "on" else "turn_off"
            called = await self._call(area_id, domain, service, {"entity_id": entity_id})
            return {
                "outcome": "applied" if called else "already",
                "last_service": f"{domain}.{service}" if called else None,
            }

        if domain in {"select", "input_select"}:
            option = str(target)
            options = [str(item) for item in attrs.get("options") or []]
            if options and option not in options:
                return {"outcome": "skipped", "skip_reason": "invalid_option", "last_service": None}
            current = self.hass.states.get(entity_id)
            if current is not None and current.state == option:
                return {"outcome": "already", "last_service": None}
            called = await self._call(area_id, domain, "select_option", {"entity_id": entity_id, "option": option})
            return {
                "outcome": "applied" if called else "already",
                "last_service": f"{domain}.select_option" if called else None,
            }

        if domain in {"number", "input_number"}:
            try:
                value = float(target)
            except (TypeError, ValueError):
                return {"outcome": "skipped", "skip_reason": "invalid_number", "last_service": None}
            current = self.hass.states.get(entity_id)
            try:
                current_value = float(current.state) if current is not None else None
            except (TypeError, ValueError):
                current_value = None
            if current_value is not None and abs(current_value - value) < 1e-6:
                return {"outcome": "already", "last_service": None}
            called = await self._call(area_id, domain, "set_value", {"entity_id": entity_id, "value": value})
            return {
                "outcome": "applied" if called else "already",
                "last_service": f"{domain}.set_value" if called else None,
            }

        return {"outcome": "unsupported", "skip_reason": "unsupported_domain", "last_service": None}

    async def _call(self, area_id: str, domain: str, service: str, data: dict[str, Any]) -> bool:
        signature = (domain, service, tuple(sorted(data.items())))
        cache_key = (str(data.get("entity_id", "")), f"{domain}.{service}")
        if self._last_targets.get(cache_key) == signature:
            return False
        result = self.hass.services.async_call(
            domain,
            service,
            data,
            blocking=True,
            context=make_roommind_context(),
        )
        if inspect.isawaitable(result):
            await result
        self._last_targets[cache_key] = signature
        _LOGGER.debug("Room '%s': night mode %s.%s %s", area_id, domain, service, data)
        return True
