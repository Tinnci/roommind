"""Estimate thermal coupling between adjacent rooms."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RoomCouplingObservation:
    """Learned adjacent-room coupling strength."""

    room_id: str
    adjacent_room_id: str
    k: float
    confidence: float


class RoomCouplingManager:
    """Small EWMA estimator for room graph coupling coefficients."""

    def __init__(self) -> None:
        self._links: dict[tuple[str, str], RoomCouplingObservation] = {}

    def update(
        self,
        *,
        room_id: str,
        adjacent_room_id: str,
        room_temp: float,
        adjacent_temp: float,
        room_slope_c_per_h: float,
        outdoor_temp: float,
        outdoor_alpha: float,
        gate: float,
    ) -> RoomCouplingObservation:
        """Update k from one observed room slope sample."""
        key = (room_id, adjacent_room_id)
        existing = self._links.get(key, RoomCouplingObservation(room_id, adjacent_room_id, 0.0, 0.0))
        temp_delta = adjacent_temp - room_temp
        if gate <= 0.0 or abs(temp_delta) < 0.5:
            return existing
        outdoor_term = outdoor_alpha * (outdoor_temp - room_temp)
        numerator = room_slope_c_per_h - outdoor_term
        sample = max(0.0, min(2.0, numerator / temp_delta))
        if sample == 0.0:
            return existing
        k = 0.8 * existing.k + 0.2 * sample if existing.confidence > 0 else sample
        confidence = min(1.0, existing.confidence + 0.05)
        observation = RoomCouplingObservation(room_id, adjacent_room_id, round(k, 4), round(confidence, 3))
        self._links[key] = observation
        return observation

    def coupling_terms_for(self, room_id: str, temperatures: dict[str, float], gate: float = 1.0) -> list[dict]:
        """Return RCModel coupling terms for a room."""
        terms = []
        for (source, adjacent), observation in self._links.items():
            if source == room_id and adjacent in temperatures and observation.confidence >= 0.7:
                terms.append({"temperature": temperatures[adjacent], "k": observation.k, "gate": gate})
        return terms
