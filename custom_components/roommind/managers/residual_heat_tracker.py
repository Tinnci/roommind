"""Residual heat transition tracking for RoomMind."""

from __future__ import annotations

import time
from dataclasses import dataclass

from ..const import MODE_HEATING
from ..control.residual_heat import compute_residual_heat


@dataclass(frozen=True)
class ResidualHeatSimulationState:
    """Value snapshot consumed by forward thermal simulations."""

    q_residual: float = 0.0
    heating_duration_minutes: float = 0.0
    last_power_fraction: float = 1.0


class ResidualHeatTracker:
    """Tracks heating on/off transitions and computes residual heat."""

    def __init__(self) -> None:
        self._off_since: dict[str, float] = {}
        self._off_power: dict[str, float] = {}
        self._on_since: dict[str, float] = {}

    def get_q_residual(self, area_id: str, system_type: str, previous_mode: str) -> float:
        """Compute residual heat from previous cycle state."""
        if previous_mode == MODE_HEATING:
            return 0.0
        return self.simulation_snapshot(area_id, system_type).q_residual

    def simulation_snapshot(self, area_id: str, system_type: str) -> ResidualHeatSimulationState:
        """Return immutable residual-heat inputs for a forward simulation."""
        if not system_type or area_id not in self._off_since:
            return ResidualHeatSimulationState()
        elapsed = (time.time() - self._off_since[area_id]) / 60.0
        heat_dur = (self._off_since[area_id] - self._on_since.get(area_id, self._off_since[area_id])) / 60.0
        last_pf = self._off_power.get(area_id, 1.0)
        return ResidualHeatSimulationState(
            q_residual=compute_residual_heat(elapsed, system_type, last_pf, heat_dur),
            heating_duration_minutes=heat_dur,
            last_power_fraction=last_pf,
        )

    def update(
        self, area_id: str, mode: str, power_fraction: float, previous_mode: str, q_residual: float = 0.0
    ) -> None:
        """Update heating transition state based on current mode."""
        if mode == MODE_HEATING:
            self._off_since.pop(area_id, None)
            self._off_power[area_id] = power_fraction
            if previous_mode != MODE_HEATING:
                self._on_since[area_id] = time.time()
        elif previous_mode == MODE_HEATING:
            self._off_since[area_id] = time.time()
        elif q_residual == 0.0 and area_id in self._off_since:
            self._off_since.pop(area_id, None)
            self._off_power.pop(area_id, None)
            self._on_since.pop(area_id, None)

    def remove_room(self, area_id: str) -> None:
        """Clean up state for a removed room."""
        self._off_since.pop(area_id, None)
        self._off_power.pop(area_id, None)
        self._on_since.pop(area_id, None)

    def clear_room(self, area_id: str) -> None:
        """Clear state for a room (thermal reset)."""
        self.remove_room(area_id)

    def clear_all(self) -> None:
        """Clear state for all rooms."""
        self._off_since.clear()
        self._off_power.clear()
        self._on_since.clear()
