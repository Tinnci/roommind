"""Best-effort control of configured fan and climate airflow devices."""

from __future__ import annotations

import inspect
import logging
import time
from typing import Any

from homeassistant.core import HomeAssistant

from ..const import make_roommind_context
from ..utils.night_utils import is_night_mode_active
from .airflow_command_plan import (
    OUTCOME_BLOCKED_BY_MODE,
    AirflowCommandPlan,
    plan_climate_airflow,
    plan_fan_airflow,
)
from .environmental_factor_manager import (
    AIRFLOW_ROLE_VENTILATION,
    _fan_mode_to_q,
    _fan_preset_mode_to_q,
)

_LOGGER = logging.getLogger(__name__)

OUTCOME_FAILED = "failed"


class AirflowControlManager:
    """Apply MPC-selected airflow levels through HA fan/climate services."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._last_commands: dict[tuple[str, str], tuple[tuple[str, Any], ...]] = {}
        self._roommind_fan_only: set[str] = set()
        self._assumed_commands: dict[str, dict[str, Any]] = {}

    async def async_apply(
        self,
        area_id: str,
        room: dict,
        *,
        mode: str,
        level: float | None = None,
        mix_level: float | None = None,
        vent_level: float | None = None,
    ) -> list[dict[str, Any]]:
        """Apply normalized role-specific airflow levels to configured devices."""
        legacy_target = _clamp_level(level) if level is not None else None
        mix_target = _clamp_level(mix_level if mix_level is not None else (legacy_target or 0.0))
        vent_target = _clamp_level(vent_level if vent_level is not None else (legacy_target or 0.0))
        night_active = _is_night_context(room)
        rapid_recovery = bool(room.get("_rapid_recovery_active", False))
        night_cap = room.get("max_fan_level_night")
        capped_by_night = False
        if night_active and not rapid_recovery and night_cap is not None:
            capped_mix = min(mix_target, _clamp_level(float(night_cap)))
            capped_by_night = capped_mix < mix_target
            mix_target = capped_mix
        statuses: list[dict[str, Any]] = []
        for config in room.get("airflow_devices", []) or []:
            entity_id = config.get("entity_id", "")
            if not entity_id:
                continue
            role = config.get("role", "")
            target = vent_target if role == AIRFLOW_ROLE_VENTILATION else mix_target
            domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
            status = self._base_status(entity_id, domain, role, target)
            status["night_mode_active"] = night_active
            status["night_capped"] = capped_by_night and role != AIRFLOW_ROLE_VENTILATION
            if not config.get("controllable", False) or not config.get("control_enabled", False):
                status.update({"outcome": OUTCOME_BLOCKED_BY_MODE, "skip_reason": "control_disabled"})
                statuses.append(status)
                continue
            try:
                if domain == "fan":
                    status.update(await self._apply_fan(area_id, entity_id, config, target))
                elif domain == "climate":
                    status.update(await self._apply_climate(area_id, entity_id, config, target, mode, night_active))
                else:
                    status.update({"outcome": OUTCOME_BLOCKED_BY_MODE, "skip_reason": "unsupported_domain"})
            except Exception:  # noqa: BLE001
                _LOGGER.warning("Room '%s': airflow command failed for '%s'", area_id, entity_id, exc_info=True)
                status.update({"outcome": OUTCOME_FAILED, "skip_reason": "service_error"})
            status["roommind_fan_only"] = entity_id in self._roommind_fan_only
            status.update(self._assumed_status(entity_id, target, config))
            statuses.append(status)
        return statuses

    async def _apply_fan(self, area_id: str, entity_id: str, config: dict, level: float) -> dict[str, Any]:
        state = self.hass.states.get(entity_id)
        attrs = state.attributes if state else {}
        plan = plan_fan_airflow(entity_id=entity_id, config=config, attrs=attrs, level=level)
        return await self._execute_plan(area_id, entity_id, plan)

    async def _apply_climate(
        self,
        area_id: str,
        entity_id: str,
        config: dict,
        level: float,
        mode: str,
        night_active: bool = False,
    ) -> dict[str, Any]:
        state = self.hass.states.get(entity_id)
        attrs = state.attributes if state else {}
        current_hvac_mode = str(state.state) if state else ""
        plan = plan_climate_airflow(
            entity_id=entity_id,
            config=config,
            attrs=attrs,
            current_hvac_mode=current_hvac_mode,
            level=level,
            mode=mode,
            roommind_fan_only_owned=entity_id in self._roommind_fan_only,
            night_active=night_active,
        )
        return await self._execute_plan(area_id, entity_id, plan)

    async def _execute_plan(self, area_id: str, entity_id: str, plan: AirflowCommandPlan) -> dict[str, Any]:
        last_service = None
        for command in plan.commands:
            if await self._call(area_id, command.domain, command.service, command.data):
                last_service = command.service_name

        if plan.fan_only_ownership == "add":
            self._roommind_fan_only.add(entity_id)
        elif plan.fan_only_ownership == "discard":
            self._roommind_fan_only.discard(entity_id)

        if plan.assumed_level is not None:
            self._record_assumed_command(entity_id, plan.assumed_level)

        status: dict[str, Any] = {
            "outcome": plan.outcome,
            "last_service": last_service,
            "skipped_services": plan.skipped_services,
        }
        if plan.skip_reason:
            status["skip_reason"] = plan.skip_reason
        return status

    async def _call(self, area_id: str, domain: str, service: str, data: dict) -> bool:
        entity_id = data.get("entity_id", "")
        cache_key = (entity_id, service)
        signature = tuple(sorted(data.items()))
        if self._last_commands.get(cache_key) == signature:
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
        self._last_commands[cache_key] = signature
        _LOGGER.debug("Room '%s': airflow %s.%s %s", area_id, domain, service, data)
        return True

    def _base_status(self, entity_id: str, domain: str, role: str, level: float) -> dict[str, Any]:
        state = self.hass.states.get(entity_id)
        observed_q = None
        if state is not None:
            attrs = state.attributes
            if domain == "fan":
                observed_q = _fan_observed_q(str(state.state), attrs)
            elif domain == "climate":
                observed_q = _climate_observed_q(str(state.state), attrs)
        return {
            "entity_id": entity_id,
            "domain": domain,
            "role": role,
            "planned_level": level,
            "observed_q": observed_q,
            "outcome": OUTCOME_BLOCKED_BY_MODE,
            "skip_reason": "",
            "last_service": None,
            "roommind_fan_only": entity_id in self._roommind_fan_only,
            "skipped_services": [],
        }

    def _record_assumed_command(self, entity_id: str, level: float) -> None:
        self._assumed_commands[entity_id] = {"level": _clamp_level(level), "at": time.time()}

    def _assumed_status(self, entity_id: str, target: float, config: dict) -> dict[str, Any]:
        command = self._assumed_commands.get(entity_id)
        if not command:
            return {"assumed_state_confidence": "observed", "commanded_level": None, "commanded_at": None}
        ttl_raw = config.get("assumed_state_ttl", None)
        ttl = max(0.0, float(ttl_raw if ttl_raw is not None else (config.get("assumed_state_ttl_s") or 120)))
        age = time.time() - float(command["at"])
        if age > ttl:
            confidence = "stale"
        else:
            state = self.hass.states.get(entity_id)
            observed = None
            if state is not None:
                domain = entity_id.split(".", 1)[0] if "." in entity_id else ""
                observed = _fan_observed_q(str(state.state), state.attributes) if domain == "fan" else None
                if domain == "climate":
                    observed = _climate_observed_q(str(state.state), state.attributes)
            confidence = "observed" if observed is not None and abs(observed - target) <= 0.15 else "assumed"
        return {
            "assumed_state_confidence": confidence,
            "commanded_level": command["level"],
            "commanded_at": command["at"],
        }


def _clamp_level(level: float) -> float:
    return max(0.0, min(1.0, float(level)))


def _is_night_context(config: dict) -> bool:
    return is_night_mode_active(config)


def _fan_observed_q(state: str, attrs: dict[str, Any]) -> float:
    if state == "off":
        return 0.0
    percentage = attrs.get("percentage")
    preset_mode = attrs.get("preset_mode")
    preset_modes = [str(item) for item in attrs.get("preset_modes") or []]
    if percentage is not None:
        try:
            q = _clamp_level(float(percentage) / 100.0)
        except (TypeError, ValueError):
            return 1.0
        if q > 0.0 or not preset_mode:
            return q
        return _fan_preset_mode_to_q(preset_mode, preset_modes)
    if preset_mode:
        return _fan_preset_mode_to_q(preset_mode, preset_modes)
    return 1.0


def _climate_observed_q(state: str, attrs: dict[str, Any]) -> float:
    if state == "off":
        return 0.0
    fan_modes = [str(item) for item in attrs.get("fan_modes") or []]
    fan_mode = attrs.get("fan_mode")
    if fan_mode:
        return _fan_mode_to_q(str(fan_mode), fan_modes)
    return 1.0 if state == "fan_only" else 0.0
