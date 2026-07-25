"""Global settings input contract and cross-field validation."""

from __future__ import annotations

import voluptuous as vol

from .const import (
    CONFLICT_RESOLUTIONS,
    DEFAULT_COMPRESSOR_MIN_OFF_MINUTES,
    DEFAULT_COMPRESSOR_MIN_RUN_MINUTES,
    DEFAULT_CONFLICT_RESOLUTION,
)

_NOTIFICATION_TARGET_SCHEMA = {
    vol.Required("entity_id"): str,
    vol.Optional("person_entity", default=""): str,
    vol.Optional("notify_when", default="always"): vol.In(["always", "home_only"]),
}

SETTINGS_SCHEMA: dict[vol.Marker, object] = {
    vol.Optional("outdoor_temp_sensor"): str,
    vol.Optional("outdoor_humidity_sensor"): str,
    vol.Optional("outdoor_cooling_min"): vol.Coerce(float),
    vol.Optional("outdoor_heating_max"): vol.Coerce(float),
    vol.Optional("control_mode"): vol.In(["mpc", "bangbang"]),
    vol.Optional("optimizer_strategy"): vol.In(["greedy", "horizon_search"]),
    vol.Optional("comfort_weight"): vol.Coerce(float),
    vol.Optional("weather_entity"): str,
    vol.Optional("outdoor_unavailable_notify"): bool,
    vol.Optional("climate_control_active"): bool,
    vol.Optional("learning_disabled_rooms"): [str],
    vol.Optional("hidden_rooms"): [str],
    vol.Optional("prediction_enabled"): bool,
    vol.Optional("vacation_temp"): vol.Coerce(float),
    vol.Optional("vacation_until"): vol.Any(vol.Coerce(float), None),
    vol.Optional("presence_enabled"): bool,
    vol.Optional("presence_persons"): [str],
    vol.Optional("presence_away_action"): vol.In(["eco", "off"]),
    vol.Optional("presence_clears_override"): bool,
    vol.Optional("schedule_off_action"): vol.In(["eco", "off"]),
    vol.Optional("valve_protection_enabled"): bool,
    vol.Optional("valve_protection_interval_days"): vol.All(vol.Coerce(int), vol.Range(min=1, max=90)),
    vol.Optional("mold_detection_enabled"): bool,
    vol.Optional("mold_humidity_threshold"): vol.All(vol.Coerce(float), vol.Range(min=50, max=90)),
    vol.Optional("mold_sustained_minutes"): vol.All(vol.Coerce(int), vol.Range(min=5, max=120)),
    vol.Optional("mold_notification_cooldown"): vol.All(vol.Coerce(int), vol.Range(min=10, max=1440)),
    vol.Optional("mold_notifications_enabled"): bool,
    vol.Optional("mold_notification_targets"): [_NOTIFICATION_TARGET_SCHEMA],
    vol.Optional("mold_prevention_enabled"): bool,
    vol.Optional("mold_prevention_intensity"): vol.In(["light", "medium", "strong"]),
    vol.Optional("mold_prevention_notify_enabled"): bool,
    vol.Optional("mold_prevention_notify_targets"): [_NOTIFICATION_TARGET_SCHEMA],
    vol.Optional("room_order"): [str],
    vol.Optional("group_by_floor"): bool,
    vol.Optional("compressor_groups"): [
        {
            vol.Required("id"): str,
            vol.Required("name"): str,
            vol.Required("members"): vol.All([str], vol.Length(min=1)),
            vol.Optional("min_run_minutes", default=DEFAULT_COMPRESSOR_MIN_RUN_MINUTES): vol.All(
                vol.Coerce(int),
                vol.Range(min=1, max=60),
            ),
            vol.Optional("min_off_minutes", default=DEFAULT_COMPRESSOR_MIN_OFF_MINUTES): vol.All(
                vol.Coerce(int),
                vol.Range(min=1, max=30),
            ),
            vol.Optional("master_entity", default=""): str,
            vol.Optional("conflict_resolution", default=DEFAULT_CONFLICT_RESOLUTION): vol.In(CONFLICT_RESOLUTIONS),
            vol.Optional("action_script", default=""): str,
            vol.Optional("enforce_uniform_mode", default=False): bool,
        }
    ],
}
SETTINGS_FIELDS = tuple(marker.schema for marker in SETTINGS_SCHEMA)


class SettingsValidationError(ValueError):
    """A settings invariant violation with a stable transport error code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def validate_settings_changes(changes: dict) -> None:
    """Validate cross-field invariants after schema validation."""
    groups = changes.get("compressor_groups")
    if not groups:
        return

    group_ids = [group.get("id", "") for group in groups]
    if len(group_ids) != len(set(group_ids)):
        raise SettingsValidationError(
            "duplicate_group_id",
            "Compressor group IDs must be unique",
        )

    all_members: list[str] = []
    for group in groups:
        members = group.get("members", [])
        for entity_id in members:
            if not entity_id.startswith("climate."):
                raise SettingsValidationError(
                    "invalid_member",
                    f"Compressor group member '{entity_id}' is not a climate entity",
                )
        all_members.extend(members)

    if len(all_members) != len(set(all_members)):
        raise SettingsValidationError(
            "duplicate_member",
            "A climate entity cannot be in multiple compressor groups",
        )

    all_masters: list[str] = []
    for group in groups:
        master = group.get("master_entity", "")
        if master:
            if not master.startswith("climate."):
                raise SettingsValidationError(
                    "invalid_master_entity",
                    f"Master entity '{master}' must be a climate entity",
                )
            if master in group.get("members", []):
                raise SettingsValidationError(
                    "master_in_members",
                    f"Master entity '{master}' cannot also be a group member",
                )
            if master in all_members:
                raise SettingsValidationError(
                    "master_is_other_member",
                    f"Master entity '{master}' is a member of another group",
                )
            all_masters.append(master)

        script = group.get("action_script", "")
        if script and not script.startswith("script."):
            raise SettingsValidationError(
                "invalid_action_script",
                f"Action script '{script}' must be a script entity",
            )

    if len(all_masters) != len(set(all_masters)):
        raise SettingsValidationError(
            "duplicate_master",
            "A master entity cannot be assigned to multiple groups",
        )
