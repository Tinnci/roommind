"""Tests for the global settings contract."""

from __future__ import annotations

import pytest

from custom_components.roommind.settings_config import (
    DEFAULT_CONTROL_MODE,
    SETTINGS_FIELDS,
    SETTINGS_SCHEMA,
    SettingsValidationError,
    mpc_control_enabled,
    validate_settings_changes,
)


def test_settings_fields_are_derived_from_schema():
    assert {marker.schema for marker in SETTINGS_SCHEMA} == set(SETTINGS_FIELDS)


def test_mpc_control_policy_defaults_to_bangbang_and_honors_explicit_mode():
    assert DEFAULT_CONTROL_MODE == "bangbang"
    assert mpc_control_enabled({}) is False
    assert mpc_control_enabled({"control_mode": "mpc"}) is True
    assert mpc_control_enabled({"control_mode": "bangbang"}) is False


def test_duplicate_compressor_group_ids_are_rejected():
    with pytest.raises(SettingsValidationError, match="must be unique") as error:
        validate_settings_changes(
            {
                "compressor_groups": [
                    {"id": "shared", "members": ["climate.one"]},
                    {"id": "shared", "members": ["climate.two"]},
                ]
            }
        )

    assert error.value.code == "duplicate_group_id"


def test_empty_compressor_groups_are_valid():
    validate_settings_changes({"compressor_groups": []})
