"""Climate command execution boundary for RoomMind."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

from ..const import TargetTemps

if TYPE_CHECKING:
    from .mpc_controller import AppliedCommandReport

_SENTINEL: object = object()


class ClimateCommandExecutor:
    """Executes climate service commands for a controller intent."""

    def __init__(self, controller: Any) -> None:
        self._controller = controller

    async def async_apply(
        self,
        mode: str,
        targets: TargetTemps | float | None = None,
        power_fraction: float = 1.0,
        current_temp: float | None = None,
        exclude_eids: set[str] | None = None,
        *,
        target_temp: float | None | object = _SENTINEL,
        heating_boost_target: float | None = None,
        ac_heating_boost_target: float | None = None,
        cooling_boost_target: float | None = None,
        heat_source_plan: Any | None = None,
        compressor_forced_on: set[str] | None = None,
        compressor_forced_off: set[str] | None = None,
    ) -> AppliedCommandReport:
        """Apply a controller intent through the controller's command executor seam."""
        kwargs: dict[str, Any] = {
            "power_fraction": power_fraction,
            "current_temp": current_temp,
            "exclude_eids": exclude_eids,
            "heating_boost_target": heating_boost_target,
            "ac_heating_boost_target": ac_heating_boost_target,
            "cooling_boost_target": cooling_boost_target,
            "heat_source_plan": heat_source_plan,
            "compressor_forced_on": compressor_forced_on,
            "compressor_forced_off": compressor_forced_off,
        }
        if target_temp is not _SENTINEL:
            kwargs["target_temp"] = target_temp
        return cast(
            "AppliedCommandReport",
            await self._controller._async_execute_apply_request(
                mode,
                targets,
                **kwargs,
            ),
        )
