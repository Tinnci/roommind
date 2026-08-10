"""Weather forecast manager for RoomMind."""

from __future__ import annotations

import logging
import math
from typing import Any

from homeassistant.core import HomeAssistant

from ..utils.temp_utils import ha_temp_to_celsius

_LOGGER = logging.getLogger(__name__)


class WeatherManager:
    """Manages weather forecast retrieval and conversion."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._outdoor_forecast: list[dict] = []

    @property
    def forecast(self) -> list[dict]:
        """Return the current outdoor forecast."""
        return self._outdoor_forecast

    async def async_read_forecast(self, settings: dict) -> list[dict]:
        """Read weather forecast from configured weather entity."""
        weather_entity = settings.get("weather_entity", "")
        if not weather_entity:
            self._outdoor_forecast = []
            return []

        # During startup or after entity changes, HA may know the configured
        # weather entity but still report it as unavailable. Calling
        # weather.get_forecasts in that state makes core log warnings and
        # returns no useful data. Skip until the entity is usable.
        entity_state = self.hass.states.get(weather_entity)
        if entity_state is None or entity_state.state in ("unavailable", "unknown"):
            _LOGGER.debug("Weather entity %s not available, skipping forecast read", weather_entity)
            self._outdoor_forecast = []
            return []

        # Modern approach: use weather.get_forecasts service (HA 2024.6+)
        try:
            response: object = await self.hass.services.async_call(
                "weather",
                "get_forecasts",
                {"entity_id": weather_entity, "type": "hourly"},
                blocking=True,
                return_response=True,
            )
            entity_data: object = response.get(weather_entity) if isinstance(response, dict) else None
            forecasts = self._normalize_forecast_entries(
                entity_data.get("forecast") if isinstance(entity_data, dict) else None
            )
            if forecasts:
                result = self._convert_forecast_temps(forecasts)
                self._outdoor_forecast = result
                return result
        except Exception:  # noqa: BLE001
            _LOGGER.debug(
                "weather.get_forecasts service call failed for %s, falling back to state attributes",
                weather_entity,
            )

        # Fallback: read deprecated state attribute (older HA versions)
        state = self.hass.states.get(weather_entity)
        if state is None:
            self._outdoor_forecast = []
            return []
        forecast = self._normalize_forecast_entries(state.attributes.get("forecast"))
        if forecast:
            result = self._convert_forecast_temps(forecast)
            self._outdoor_forecast = result
            return result
        self._outdoor_forecast = []
        return []

    @staticmethod
    def _normalize_forecast_entries(value: object) -> list[dict[str, Any]]:
        """Validate Home Assistant's untyped forecast payload at the boundary."""
        if not isinstance(value, list):
            return []
        return [dict(entry) for entry in value if isinstance(entry, dict)]

    def _convert_forecast_temps(self, forecasts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Convert forecast temperatures from HA units to Celsius."""
        result = []
        for f in forecasts:
            if "temperature" not in f:
                result.append(f)
                continue
            converted = dict(f)
            try:
                raw_temp = float(f["temperature"])
            except TypeError, ValueError:
                converted.pop("temperature", None)
                result.append(converted)
                continue
            if not math.isfinite(raw_temp):
                converted.pop("temperature", None)
                result.append(converted)
                continue
            converted["temperature"] = ha_temp_to_celsius(self.hass, raw_temp)
            result.append(converted)
        return result

    @staticmethod
    def extract_cloud_series(forecast: list[dict]) -> list[float | None] | None:
        """Extract cloud_coverage values from forecast entries.

        Returns None if no cloud data is available (clear-sky fallback).
        """
        if not forecast:
            return None
        series: list[float | None] = []
        for entry in forecast:
            cc = entry.get("cloud_coverage")
            if cc is None:
                series.append(None)
                continue
            try:
                value = float(cc)
            except TypeError, ValueError:
                series.append(None)
                continue
            series.append(value if math.isfinite(value) else None)
        return series if any(v is not None for v in series) else None
