"""Pure builders for user-facing notification payloads."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

TranslateFn = Callable[..., str]


@dataclass(frozen=True)
class NotificationPayload:
    """Translated notification fields ready for a sender adapter."""

    title: str
    message: str
    tag_suffix: str


def build_mold_risk_payload(
    translate: TranslateFn,
    *,
    area_name: str,
    humidity: float,
    surface_rh: float,
) -> NotificationPayload:
    """Build a mold risk notification payload."""
    return NotificationPayload(
        title=translate("notifications.mold_risk.title"),
        message=translate(
            "notifications.mold_risk.message",
            area_name=area_name,
            humidity=f"{humidity:.0f}",
            surface_rh=f"{surface_rh:.0f}",
        ),
        tag_suffix="risk",
    )


def build_mold_prevention_payload(
    translate: TranslateFn,
    *,
    area_name: str,
    delta: float,
    unit: str,
) -> NotificationPayload:
    """Build a mold prevention notification payload."""
    return NotificationPayload(
        title=translate("notifications.mold_prevention.title"),
        message=translate(
            "notifications.mold_prevention.message",
            area_name=area_name,
            delta=f"{delta:.0f}",
            unit=unit,
        ),
        tag_suffix="prevention",
    )


def build_outdoor_unavailable_payload(
    translate: TranslateFn,
    *,
    sensor_id: str,
    weather_entity: str,
) -> NotificationPayload:
    """Build an outdoor-temperature unavailable notification payload."""
    return NotificationPayload(
        title=translate("notifications.outdoor_unavailable.title"),
        message=translate(
            "notifications.outdoor_unavailable.message",
            sensor_id=sensor_id,
            weather_entity=weather_entity,
        ),
        tag_suffix="outdoor_unavailable",
    )
