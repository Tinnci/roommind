"""Semantic results for applying device actuation plans."""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Any, Self


class DispatchStatus(StrEnum):
    """Describe what happened while dispatching a device operation."""

    SKIPPED = "skipped"
    SENT = "sent"
    UNSUPPORTED = "unsupported"
    FAILED = "failed"


class AcceptanceStatus(StrEnum):
    """Describe whether a device transport accepted an operation."""

    UNKNOWN = "unknown"
    ACCEPTED = "accepted"
    NOT_SENT = "not_sent"


class ApplicationStatus(StrEnum):
    """Describe evidence that a device applied an operation."""

    UNKNOWN = "unknown"
    PENDING = "pending"
    CONFIRMED = "confirmed"
    NOT_CONFIRMED = "not_confirmed"


@dataclass(frozen=True, slots=True)
class DeviceActuationResult:
    """Immediate evidence produced while applying one device operation."""

    entity_id: str
    dispatch: DispatchStatus
    service: str
    desired: dict[str, Any]
    diagnostic: str | None = None
    context_id: str | None = None

    @property
    def effective(self) -> bool:
        """Return whether the desired operation was already true or dispatched."""
        return self.dispatch in (DispatchStatus.SKIPPED, DispatchStatus.SENT)

    @classmethod
    def combine(cls, entity_id: str, results: tuple[Self, ...]) -> Self:
        """Summarize the operations required for one desired device state."""
        if not results:
            return cls(
                entity_id=entity_id,
                dispatch=DispatchStatus.UNSUPPORTED,
                service="",
                desired={},
                diagnostic="no device operation was produced",
            )
        failed = next((result for result in results if result.dispatch is DispatchStatus.FAILED), None)
        if failed is not None:
            return failed
        unsupported = next(
            (result for result in results if result.dispatch is DispatchStatus.UNSUPPORTED),
            None,
        )
        if unsupported is not None:
            return unsupported
        dispatch = (
            DispatchStatus.SENT
            if any(result.dispatch is DispatchStatus.SENT for result in results)
            else DispatchStatus.SKIPPED
        )
        return cls(
            entity_id=entity_id,
            dispatch=dispatch,
            service="+".join(result.service for result in results if result.service),
            desired={key: value for result in results for key, value in result.desired.items()},
            context_id=next(
                (result.context_id for result in reversed(results) if result.context_id),
                None,
            ),
        )


@dataclass(frozen=True, slots=True)
class ActuationEvidence:
    """Dispatch and device evidence for one correlated operation."""

    result: DeviceActuationResult
    acceptance: AcceptanceStatus
    application: ApplicationStatus
    transport_outcome: str = "unknown"


class ActuationLedger:
    """Reconcile immediate dispatch with asynchronous device evidence."""

    def __init__(self, *, max_entries: int = 256) -> None:
        self._max_entries = max(1, max_entries)
        self._evidence: dict[str, ActuationEvidence] = {}
        self._early_events: dict[str, dict[str, Any]] = {}

    def record_dispatch(self, result: DeviceActuationResult) -> ActuationEvidence:
        """Record dispatch, consuming an event that may have arrived first."""
        if result.dispatch is DispatchStatus.SKIPPED:
            application = ApplicationStatus.CONFIRMED
        elif result.dispatch is DispatchStatus.SENT:
            application = ApplicationStatus.PENDING
        else:
            application = ApplicationStatus.UNKNOWN
        evidence = ActuationEvidence(
            result=result,
            acceptance=AcceptanceStatus.UNKNOWN,
            application=application,
        )
        context_id = result.context_id
        if context_id:
            self._evidence[context_id] = evidence
            event = self._early_events.pop(context_id, None)
            if event is not None:
                evidence = self._apply_tcl_event(evidence, event)
                self._evidence[context_id] = evidence
            self._trim()
        return evidence

    def record_tcl_event(self, event: dict[str, Any]) -> ActuationEvidence | None:
        """Merge a TCL command-result event by its HA context identifier."""
        context_id = event.get("context_id")
        if not isinstance(context_id, str) or not context_id:
            return None
        evidence = self._evidence.get(context_id)
        if evidence is None:
            self._early_events[context_id] = dict(event)
            self._trim()
            return None
        evidence = self._apply_tcl_event(evidence, event)
        self._evidence[context_id] = evidence
        return evidence

    def snapshot(self) -> tuple[ActuationEvidence, ...]:
        """Return an immutable ordered evidence snapshot."""
        return tuple(self._evidence.values())

    @staticmethod
    def _apply_tcl_event(
        evidence: ActuationEvidence,
        event: dict[str, Any],
    ) -> ActuationEvidence:
        transport_outcome = str(event.get("transport_outcome") or "unknown")
        acceptance = (
            AcceptanceStatus.ACCEPTED
            if transport_outcome.startswith("accepted_by_")
            else AcceptanceStatus.NOT_SENT
            if transport_outcome == "not_sent"
            else AcceptanceStatus.UNKNOWN
        )
        outcome = event.get("outcome")
        application = (
            ApplicationStatus.CONFIRMED
            if outcome == "applied"
            else ApplicationStatus.NOT_CONFIRMED
            if outcome == "not_confirmed"
            else evidence.application
        )
        return replace(
            evidence,
            acceptance=acceptance,
            application=application,
            transport_outcome=transport_outcome,
        )

    def _trim(self) -> None:
        while len(self._evidence) > self._max_entries:
            self._evidence.pop(next(iter(self._evidence)))
        while len(self._early_events) > self._max_entries:
            self._early_events.pop(next(iter(self._early_events)))
