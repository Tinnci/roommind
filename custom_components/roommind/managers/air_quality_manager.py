"""Room air quality from CO2/VOC/PM2.5 sensors, and automatic ventilation control."""

from __future__ import annotations

import logging
import math
from collections.abc import Set
from typing import TYPE_CHECKING

from homeassistant.core import CoreState
from homeassistant.helpers import entity_registry as er

from ..const import (
    AIR_QUALITY_CLEAR_FACTOR,
    MAX_SENSOR_STALENESS,
    VENTILATION_MIN_RUN_MINUTES,
    make_roommind_context,
)
from ..utils.sensor_utils import read_sensor_value

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

VENTILATION_MIN_RUN_S = VENTILATION_MIN_RUN_MINUTES * 60
VENTILATION_REPORT_GRACE_S = 60


def next_air_bad(
    previous: bool,
    value: float | None,
    threshold: float | None,
    *,
    clear_below: float | None = None,
) -> bool:
    """Hysteresis: bad from ``threshold`` on, good below ``clear_below`` or ``threshold * AIR_QUALITY_CLEAR_FACTOR``."""
    if threshold is None or threshold <= 0:
        return False
    if value is None:
        return previous
    if value >= threshold:
        return True
    clear_limit = threshold * AIR_QUALITY_CLEAR_FACTOR if clear_below is None else clear_below
    if value < clear_limit:
        return False
    return previous


def read_pm25_value(hass: HomeAssistant, room: dict, area_id: str) -> float | None:
    """Read and average valid PM2.5 readings from configured pm25_sensors / pm25_sensor."""
    sensors: list[str] = []
    for eid in room.get("pm25_sensors", []) or []:
        if isinstance(eid, str) and eid and eid not in sensors:
            sensors.append(eid)
    single = room.get("pm25_sensor")
    if isinstance(single, str) and single and single not in sensors:
        sensors.insert(0, single)
    if not sensors:
        return None
    readings: list[float] = []
    for eid in sensors:
        val = read_sensor_value(hass, eid, area_id, "PM2.5")
        if val is not None and math.isfinite(val) and val >= 0.0:
            readings.append(val)
    if not readings:
        return None
    return round(sum(readings) / len(readings), 1)


class AirQualityTracker:
    """Per room and sensor kind: tracks air quality with hysteresis across cycles."""

    def __init__(self) -> None:
        self._bad: dict[tuple[str, str], bool] = {}
        self._seen: dict[tuple[str, str], float] = {}

    def evaluate(
        self,
        area_id: str,
        kind: str,
        value: float | None,
        threshold: float | None,
        now: float,
        *,
        assume_bad: bool = False,
        clear_below: float | None = None,
    ) -> bool:
        key = (area_id, kind)
        if assume_bad and key not in self._seen:
            self._bad[key] = True
            self._seen[key] = now
        if value is not None:
            self._seen[key] = now
        elif now - self._seen.get(key, -math.inf) > MAX_SENSOR_STALENESS:
            self._bad.pop(key, None)
            return False
        bad = next_air_bad(self._bad.get(key, False), value, threshold, clear_below=clear_below)
        self._bad[key] = bad
        return bad

    def remove_room(self, area_id: str) -> None:
        for store in (self._bad, self._seen):
            for key in [k for k in store if k[0] == area_id]:
                del store[key]


class VentilationController:
    """Switches ventilation entities on for bad air and off once no longer needed."""

    def __init__(
        self,
        hass: HomeAssistant,
        label: str = "Ventilation",
        min_run_s: float = VENTILATION_MIN_RUN_S,
        min_off_s: float = 0,
    ) -> None:
        self.hass = hass
        self._label = label
        self._min_run_s = min_run_s
        self._min_off_s = min_off_s
        self._off_at: dict[str, float] = {}
        self._now = 0.0
        self._owned: dict[str, float] = {}
        self._declined: set[str] = set()
        self._last_state: dict[str, str | None] = {}
        self.dirty = False

    def load_state(self, data: dict) -> None:
        self._owned = {str(k): float(v) for k, v in (data or {}).items() if isinstance(v, int | float)}

    def get_state(self) -> dict[str, float]:
        return dict(self._owned)

    def is_running(self, entity_id: str) -> bool:
        return entity_id in self._owned

    async def async_reconcile(self, wanted: dict[str, bool], now: float, blocked: Set[str] = frozenset()) -> None:
        """Bring every ventilation entity in line with what rooms need."""
        self._now = now
        for entity_id, want in wanted.items():
            await self._async_reconcile_one(entity_id, want, now)
        for entity_id in blocked:
            state = self.hass.states.get(entity_id)
            self._last_state[entity_id] = state.state if state is not None else None
            if entity_id in self._owned:
                await self._async_switch_off_owned(entity_id)
        for entity_id in [e for e in self._owned if e not in wanted and e not in blocked]:
            await self._async_switch_off_owned(entity_id)
        kept = set(wanted) | set(blocked)
        self._declined &= kept
        self._last_state = {e: v for e, v in self._last_state.items() if e in kept}
        self._off_at = {e: t for e, t in self._off_at.items() if now - t < self._min_off_s}

    async def _async_switch_off_owned(self, entity_id: str) -> None:
        state = self.hass.states.get(entity_id)
        if state is None:
            if self._gone(entity_id):
                self._release(entity_id)
        elif state.state == "off":
            self._release(entity_id)
        elif state.state == "on" and await self._async_switch(entity_id, False):
            self._release(entity_id)

    async def _async_reconcile_one(self, entity_id: str, want: bool, now: float) -> None:
        if not want:
            self._declined.discard(entity_id)
        state = self.hass.states.get(entity_id)
        previous = self._last_state.get(entity_id)
        current = state.state if state is not None else None
        self._last_state[entity_id] = current

        async def switch(on: bool) -> bool:
            if await self._async_switch(entity_id, on):
                return True
            if previous is None:
                self._last_state.pop(entity_id, None)
            else:
                self._last_state[entity_id] = previous
            return False

        if state is None:
            if self._gone(entity_id):
                self._release(entity_id)
            return
        if current not in ("on", "off"):
            return
        since = self._owned.get(entity_id)
        if since is not None:
            if current == "off":
                if previous not in ("on", "off"):
                    if not want:
                        self._release(entity_id)
                    elif await switch(True):
                        self._owned[entity_id] = now
                        self.dirty = True
                elif now - since >= VENTILATION_REPORT_GRACE_S:
                    self._release(entity_id)
                    if want:
                        self._declined.add(entity_id)
                return
            if not want and now - since >= self._min_run_s and await switch(False):
                self._release(entity_id)
            return
        if not want or current != "off":
            return
        if previous == "on":
            self._declined.add(entity_id)
        if now - self._off_at.get(entity_id, -math.inf) < self._min_off_s:
            return
        if entity_id not in self._declined and await switch(True):
            self._owned[entity_id] = now
            self.dirty = True

    def _gone(self, entity_id: str) -> bool:
        if self.hass.state is not CoreState.running:
            return False
        return er.async_get(self.hass).async_get(entity_id) is None

    def _release(self, entity_id: str) -> None:
        if self._owned.pop(entity_id, None) is not None:
            self.dirty = True

    async def _async_switch(self, entity_id: str, on: bool) -> bool:
        domain = entity_id.split(".", 1)[0]
        try:
            await self.hass.services.async_call(
                domain,
                "turn_on" if on else "turn_off",
                {"entity_id": entity_id},
                blocking=True,
                context=make_roommind_context(),
            )
        except Exception:  # noqa: BLE001
            _LOGGER.warning(
                "%s '%s': switching %s failed", self._label, entity_id, "on" if on else "off", exc_info=True
            )
            return False
        self._last_state[entity_id] = "on" if on else "off"
        if not on and self._min_off_s:
            self._off_at[entity_id] = self._now
        return True
