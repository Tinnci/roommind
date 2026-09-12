"""Night accessory plans, bounded retries, and separate dispatch evidence."""

from __future__ import annotations

import inspect
import logging
import math
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from homeassistant.core import HomeAssistant

from ..const import make_roommind_context
from ..control.actuation import ActuationLedger, DeviceActuationResult, DispatchStatus
from ..utils.entity_snapshot import EntitySnapshot, EntitySnapshots, capture_entity_snapshots

_LOGGER = logging.getLogger(__name__)
_NIGHT_SELECT_FALLBACKS = ("off", "mute", "muted", "silent", "quiet", "sleep", "night", "dark")
_RETRY_SECONDS = 120.0
_MAX_RETRY_SECONDS = 900.0


@dataclass(frozen=True, slots=True)
class AccessoryCommand:
    """A dispatched target awaiting later device evidence or a bounded retry."""

    target: str | float
    observed_value: str
    observed_at: datetime | None
    result: DeviceActuationResult
    retry_at: float
    attempts: int


class NightModeManager:
    """Apply quiet settings before climate work and restore observed day values."""

    def __init__(self, hass: HomeAssistant, *, actuation_ledger: ActuationLedger | None = None) -> None:
        self.hass = hass
        self._previous_values: dict[str, str] = {}
        self._pending: dict[str, AccessoryCommand] = {}
        self._ledger = actuation_ledger if actuation_ledger is not None else ActuationLedger()

    async def async_apply(
        self, area_id: str, room: dict, *, active: bool, observations: EntitySnapshots | None = None
    ) -> list[dict[str, Any]]:
        """Submit accessories using observations captured before any room actuation."""
        configs = [
            config
            for config in room.get("night_controls", []) or []
            if config.get("enabled", True) and config.get("entity_id")
        ]
        if observations is None:
            observations = capture_entity_snapshots(self.hass, (config["entity_id"] for config in configs))
        # Mute sound first: even a display command can otherwise cause a beep.
        if active:
            configs.sort(key=lambda config: config.get("role") not in {"beeper", "sound"})
        statuses = []
        for config in configs:
            statuses.append(
                await self._apply_one(area_id, config, observations.get(config["entity_id"]), active=active)
            )
        return statuses

    async def _apply_one(
        self, area_id: str, config: dict[str, Any], state: EntitySnapshot | None, *, active: bool
    ) -> dict[str, Any]:
        entity_id = str(config["entity_id"])
        domain = entity_id.partition(".")[0]
        status: dict[str, Any] = {
            "entity_id": entity_id,
            "role": config.get("role", "other"),
            "active": active,
            "outcome": "skipped",
            "skip_reason": "",
            "target_value": None,
            "observed_value": state.state if state else None,
            "previous_value": self._previous_values.get(entity_id),
            "restore_after_night": bool(config.get("restore_after_night", True)),
            "last_service": None,
            "dispatch": "skipped",
            "acceptance": "unknown",
            "application": "unknown",
            "context_id": None,
        }
        if state is None or state.state in {"unknown", "unavailable"}:
            status.update(outcome="unavailable", skip_reason="entity_unavailable")
            return status

        target = self._target_value(config, state, active=active)
        status["target_value"] = target
        if target is None:
            if not active:
                self._pending.pop(entity_id, None)
                if not config.get("restore_after_night", True):
                    self._previous_values.pop(entity_id, None)
            status["skip_reason"] = "no_target_value"
            return status

        try:
            service, payload, target = self._prepare_command(domain, target, state.attributes)
        except ValueError as err:
            reason = str(err)
            status.update(outcome="unsupported" if reason == "unsupported_domain" else "skipped", skip_reason=reason)
            return status
        status["target_value"] = target
        if active and config.get("restore_after_night", True) and not state.attributes.get("assumed_state"):
            self._previous_values.setdefault(entity_id, state.state)
            status["previous_value"] = self._previous_values[entity_id]

        previous_command = self._pending.get(entity_id)
        pending = previous_command if previous_command is not None and previous_command.target == target else None
        matches = self._matches(state.state, target)
        restore_over_pending = (
            not active
            and previous_command is not None
            and pending is None
            and previous_command.result.dispatch is DispatchStatus.SENT
        )
        evidence = self._ledger.get(pending.result.context_id) if pending else None
        fresh_restore_report = bool(
            pending and state.reported_at and pending.observed_at and state.reported_at > pending.observed_at
        )
        restore_awaits_report = (
            not active
            and pending is not None
            and pending.observed_value == state.state
            and pending.result.dispatch is DispatchStatus.SENT
            and not fresh_restore_report
            and (evidence is None or evidence.application != "confirmed")
        )
        if matches and not restore_over_pending and not restore_awaits_report:
            # Optimistic state may deduplicate writes, but is not physical evidence.
            status["outcome"] = "unverified" if state.attributes.get("assumed_state") else "observed"
            if not state.attributes.get("assumed_state"):
                self._pending.pop(entity_id, None)
                if not active:
                    self._previous_values.pop(entity_id, None)
            self._add_evidence(status, pending)
            return status

        same_request = pending is not None and pending.target == target and pending.observed_value == state.state
        now = time.monotonic()
        if same_request and pending is not None and now < pending.retry_at:
            status.update(
                outcome="failed" if pending.result.dispatch is DispatchStatus.FAILED else "pending",
                skip_reason="retry_backoff"
                if pending.result.dispatch is DispatchStatus.FAILED
                else "awaiting_feedback",
                retry_after_seconds=round(pending.retry_at - now),
            )
            self._add_evidence(status, pending)
            return status

        desired = {"entity_id": entity_id, **payload}
        context = make_roommind_context()
        dispatch = DispatchStatus.SENT
        diagnostic = None
        try:
            result = self.hass.services.async_call(domain, service, dict(desired), blocking=True, context=context)
            if inspect.isawaitable(result):
                await result
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Room '%s': night-mode command failed for '%s'", area_id, entity_id, exc_info=True)
            dispatch = DispatchStatus.FAILED
            diagnostic = str(err)
        operation = DeviceActuationResult(entity_id, dispatch, f"{domain}.{service}", desired, diagnostic, context.id)
        self._ledger.record_dispatch(operation)
        attempts = min(pending.attempts + 1, 4) if same_request and pending is not None else 1
        pending = AccessoryCommand(
            target=target,
            observed_value=state.state,
            observed_at=state.reported_at,
            result=operation,
            retry_at=time.monotonic() + min(_RETRY_SECONDS * 2 ** (attempts - 1), _MAX_RETRY_SECONDS),
            attempts=attempts,
        )
        self._pending[entity_id] = pending
        status.update(outcome=dispatch.value, skip_reason="service_error" if diagnostic else "")
        self._add_evidence(status, pending)
        return status

    def _add_evidence(self, status: dict[str, Any], pending: AccessoryCommand | None) -> None:
        if pending is None:
            return
        result = pending.result
        status.update(dispatch=result.dispatch.value, context_id=result.context_id, last_service=result.service)
        evidence = self._ledger.get(result.context_id)
        if evidence is not None:
            status.update(acceptance=evidence.acceptance.value, application=evidence.application.value)

    def _target_value(self, config: dict[str, Any], state: EntitySnapshot, *, active: bool) -> Any:
        entity_id = str(config["entity_id"])
        domain = entity_id.partition(".")[0]
        if active:
            if config.get("night_value") not in (None, ""):
                return config["night_value"]
            if domain in {"light", "switch"}:
                return "off"
            if domain in {"number", "input_number"}:
                return 0
            if domain in {"select", "input_select"}:
                options = {str(option).lower(): str(option) for option in state.attributes.get("options") or ()}
                return next((options[value] for value in _NIGHT_SELECT_FALLBACKS if value in options), None)
            return None
        if config.get("day_value") not in (None, ""):
            return config["day_value"]
        return self._previous_values.get(entity_id) if config.get("restore_after_night", True) else None

    @staticmethod
    def _matches(current: str, target: str | float) -> bool:
        if isinstance(target, float):
            try:
                return abs(float(current) - target) < 1e-6
            except ValueError:
                return False
        return current == target

    @staticmethod
    def _prepare_command(domain: str, target: Any, attrs: Mapping[str, Any]) -> tuple[str, dict[str, Any], str | float]:
        if domain in {"light", "switch"}:
            value = ("on" if target else "off") if isinstance(target, bool) else str(target).lower()
            if value not in {"on", "off"}:
                raise ValueError("invalid_target_state")
            return ("turn_on" if value == "on" else "turn_off"), {}, value
        if domain in {"select", "input_select"}:
            option = str(target)
            if option not in (attrs.get("options") or ()):
                raise ValueError("invalid_option")
            return "select_option", {"option": option}, option
        if domain in {"number", "input_number"}:
            try:
                number = float(target)
            except TypeError, ValueError:
                raise ValueError("invalid_number") from None
            if not math.isfinite(number) or not float(attrs.get("min", -math.inf)) <= number <= float(
                attrs.get("max", math.inf)
            ):
                raise ValueError("invalid_number")
            return "set_value", {"value": number}, number
        raise ValueError("unsupported_domain")
