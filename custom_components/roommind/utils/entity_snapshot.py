"""Detached entity observations shared by planning and actuation in one cycle."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Any

from homeassistant.core import HomeAssistant


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return freeze_mapping(value)
    if isinstance(value, list | tuple):
        return tuple(_freeze(item) for item in value)
    if isinstance(value, set | frozenset):
        return frozenset(_freeze(item) for item in value)
    return value


def freeze_mapping(value: Mapping[str, Any]) -> Mapping[str, Any]:
    """Copy nested observation or command values into an immutable snapshot."""
    return MappingProxyType({key: _freeze(item) for key, item in value.items()})


@dataclass(frozen=True, slots=True)
class EntitySnapshot:
    """State and capabilities captured before any service can change them."""

    state: str
    attributes: Mapping[str, Any]
    reported_at: datetime | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "attributes", freeze_mapping(self.attributes))


type EntitySnapshots = Mapping[str, EntitySnapshot | None]


def capture_entity_snapshots(hass: HomeAssistant, entity_ids: Iterable[str]) -> EntitySnapshots:
    """Capture each entity once, retaining missing observations explicitly."""
    snapshots: dict[str, EntitySnapshot | None] = {}
    for entity_id in dict.fromkeys(entity_ids):
        state = hass.states.get(entity_id)
        if state is None:
            snapshots[entity_id] = None
            continue
        reported_at = getattr(state, "last_reported", None)
        if "observed_at" in state.attributes:
            try:
                reported_at = datetime.fromisoformat(state.attributes["observed_at"])
            except TypeError, ValueError:
                reported_at = None
        if not isinstance(reported_at, datetime) or reported_at.tzinfo is None:
            reported_at = None
        snapshots[entity_id] = EntitySnapshot(state.state, state.attributes, reported_at)
    return MappingProxyType(snapshots)
