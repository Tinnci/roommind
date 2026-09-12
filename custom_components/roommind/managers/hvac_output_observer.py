"""Capture Home Assistant signals for pure HVAC output interpretation."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from ..const import MAX_SENSOR_STALENESS
from ..control.hvac_observation import (
    ClimateObservation,
    HVACOutputObservation,
    estimate_hvac_output,
    power_in_watts,
)


class HVACOutputObserver:
    """Read device feedback without consulting requested or cached commands."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    def read_climate(self, entity_id: str) -> ClimateObservation:
        """Detach the feedback fields needed to interpret one climate device."""
        state = self.hass.states.get(entity_id)
        attrs = state.attributes if state is not None else {}
        registry = self.hass.data.get(er.DATA_REGISTRY)
        entry = registry.async_get(entity_id) if registry is not None else None
        action_is_estimated = attrs.get("hvac_action_is_estimated")
        if not isinstance(action_is_estimated, bool):
            # Older TCL releases derive action from temperature versus target.
            # Updated drivers declare provenance explicitly instead.
            action_is_estimated = entry is not None and entry.platform == "tcl_udp_ac"
        return ClimateObservation(
            entity_id=entity_id,
            hvac_mode=state.state if state is not None else None,
            hvac_action=attrs.get("hvac_action"),
            assumed_state=bool(attrs.get("assumed_state", False)),
            hvac_action_is_estimated=action_is_estimated,
        )

    def observe(
        self,
        device: dict[str, Any],
        *,
        hvac_action: str | None,
        fan_q: float,
        temp_slope_c_per_h: float | None = None,
    ) -> HVACOutputObservation:
        """Capture electrical power and estimate output from available signals.

        The optional temperature slope is retained for existing callers. Net
        room drift includes solar gain, ventilation and thermal lag, so it
        cannot measure an inverter's compressor stage.
        """
        return estimate_hvac_output(
            device,
            hvac_action=hvac_action,
            fan_q=fan_q,
            power_w=self._read_power(device.get("power_sensor_entity")),
        )

    def _read_power(self, entity_id: str | None) -> float | None:
        if not entity_id:
            return None
        state = self.hass.states.get(entity_id)
        if state is None:
            return None
        for key in ("last_reported", "last_updated", "last_changed"):
            reported_at = getattr(state, key, None)
            if isinstance(reported_at, datetime):
                if (
                    reported_at.tzinfo is None
                    or (dt_util.utcnow() - reported_at).total_seconds() > MAX_SENSOR_STALENESS
                ):
                    return None
                break
        return power_in_watts(state.state, state.attributes.get("unit_of_measurement"))
