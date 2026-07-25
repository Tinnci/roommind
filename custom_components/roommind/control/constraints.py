"""Post-controller climate constraints for RoomMind.

The MPC controller proposes an intent. Room-level safety and lifecycle
constraints can then reduce that intent to a commandable state.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from ..const import MODE_COOLING, MODE_HEATING, MODE_IDLE


class CompressorConstraintManager(Protocol):
    """Compressor group state needed by the reducer."""

    def get_group_for_entity(self, entity_id: str) -> object | None:
        """Return the compressor group for a climate entity, if any."""

    def check_can_activate(self, entity_id: str) -> bool:
        """Return whether the entity can start without violating group timing."""

    def get_enforced_action(self, entity_id: str) -> str | None:
        """Return an enforced group action, if the group is locked."""

    def check_must_stay_active(self, entity_id: str) -> bool:
        """Return whether min-run requires the entity to stay active."""


@dataclass(frozen=True)
class ConstraintInput:
    """Inputs needed to reduce a controller intent."""

    mode: str
    power_fraction: float
    force_off: bool = False
    window_open: bool = False
    rapid_recovery_mode: str | None = None
    rapid_recovery_active: bool = False
    all_device_eids: tuple[str, ...] = ()
    compressor_forced_on: frozenset[str] = field(default_factory=frozenset)
    compressor_forced_off: frozenset[str] = field(default_factory=frozenset)


@dataclass(frozen=True)
class ConstraintResult:
    """Reduced climate intent plus constraint side effects."""

    mode: str
    power_fraction: float
    rapid_recovery_active: bool
    compressor_forced_on: frozenset[str]
    compressor_forced_off: frozenset[str]


class ConstraintReducer:
    """Apply room constraints in a deterministic order."""

    def compressor_constraints(
        self,
        *,
        manager: CompressorConstraintManager,
        all_device_eids: tuple[str, ...],
        mode: str,
        climate_active: bool,
        window_open: bool,
        force_off: bool,
    ) -> tuple[frozenset[str], frozenset[str]]:
        """Compute compressor forced-on/off sets before reducing the intent."""
        forced_on: set[str] = set()
        forced_off: set[str] = set()

        if not all_device_eids or not climate_active or window_open or force_off:
            return frozenset(), frozenset()

        for entity_id in all_device_eids:
            if manager.get_group_for_entity(entity_id) is None:
                continue

            if mode == MODE_IDLE:
                if manager.check_must_stay_active(entity_id):
                    forced_on.add(entity_id)
                continue

            if not manager.check_can_activate(entity_id):
                forced_off.add(entity_id)
                continue

            enforced = manager.get_enforced_action(entity_id)
            if enforced is not None and enforced != "idle" and self._conflicts_with_mode(mode, enforced):
                forced_off.add(entity_id)

        return frozenset(forced_on), frozenset(forced_off)

    def reduce(self, constraints: ConstraintInput) -> ConstraintResult:
        """Reduce a controller intent after force-off/window/recovery/compressor constraints."""
        mode = constraints.mode
        power_fraction = constraints.power_fraction
        rapid_recovery_active = constraints.rapid_recovery_active
        compressor_forced_on = constraints.compressor_forced_on
        compressor_forced_off = constraints.compressor_forced_off

        if constraints.rapid_recovery_mode:
            mode = constraints.rapid_recovery_mode
            power_fraction = 1.0
            rapid_recovery_active = True

        if constraints.force_off:
            mode = MODE_IDLE
            power_fraction = 0.0
            rapid_recovery_active = False

        if constraints.window_open:
            mode = MODE_IDLE
            power_fraction = 0.0
            rapid_recovery_active = False

        all_device_eids = set(constraints.all_device_eids)
        if compressor_forced_off and all_device_eids and compressor_forced_off >= all_device_eids:
            mode = MODE_IDLE
            power_fraction = 0.0
            rapid_recovery_active = False
            compressor_forced_off = frozenset()

        return ConstraintResult(
            mode=mode,
            power_fraction=power_fraction,
            rapid_recovery_active=rapid_recovery_active,
            compressor_forced_on=compressor_forced_on,
            compressor_forced_off=compressor_forced_off,
        )

    def _conflicts_with_mode(self, mode: str, enforced_action: str) -> bool:
        return (mode == MODE_HEATING and enforced_action == "cool") or (
            mode == MODE_COOLING and enforced_action == "heat"
        )
