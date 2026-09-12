"""Capture Home Assistant signals for pure HVAC output interpretation."""

from __future__ import annotations

from collections.abc import Mapping
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


def _is_recent(reported_at: datetime | None, now: datetime) -> bool:
    """Reject unknown, naive, future and expired observation timestamps."""
    return (
        reported_at is not None
        and reported_at.tzinfo is not None
        and 0 <= (now - reported_at).total_seconds() <= MAX_SENSOR_STALENESS
    )


def _has_fresh_report(attrs: Mapping[str, Any], key: str, now: datetime) -> bool:
    """Prefer a driver's field timestamp over unrelated HA state publications."""
    if key not in attrs:
        return True
    reported_at = attrs[key]
    if isinstance(reported_at, str):
        reported_at = dt_util.parse_datetime(reported_at)
    return _is_recent(reported_at if isinstance(reported_at, datetime) else None, now)


class HVACOutputObserver:
    """Read device feedback without consulting requested or cached commands."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    def read_climate(self, entity_id: str) -> ClimateObservation:
        """Detach the feedback fields needed to interpret one climate device."""
        state = self.hass.states.get(entity_id)
        attrs = state.attributes if state is not None else {}
        now = dt_util.utcnow()
        registry = self.hass.data.get(er.DATA_REGISTRY)
        entry = registry.async_get(entity_id) if registry is not None else None
        action_is_estimated = attrs.get("hvac_action_is_estimated")
        if not isinstance(action_is_estimated, bool):
            # Older TCL releases derive action from temperature versus target.
            # Updated drivers declare provenance explicitly instead.
            action_is_estimated = entry is not None and entry.platform == "tcl_udp_ac"
        return ClimateObservation(
            entity_id=entity_id,
            hvac_mode=(
                state.state if state is not None and _has_fresh_report(attrs, "hvac_mode_observed_at", now) else None
            ),
            hvac_action=attrs.get("hvac_action") if _has_fresh_report(attrs, "hvac_action_observed_at", now) else None,
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
        now = dt_util.utcnow()
        if "observed_at" in state.attributes:
            if not _has_fresh_report(state.attributes, "observed_at", now):
                return None
        else:
            for key in ("last_reported", "last_updated", "last_changed"):
                reported_at = getattr(state, key, None)
                if isinstance(reported_at, datetime):
                    if not _is_recent(reported_at, now):
                        return None
                    break
        return power_in_watts(state.state, state.attributes.get("unit_of_measurement"))
