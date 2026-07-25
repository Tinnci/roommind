"""Tests for the global settings contract."""

from __future__ import annotations

import pytest

from custom_components.roommind.settings_config import (
    SETTINGS_FIELDS,
    SETTINGS_SCHEMA,
    SettingsValidationError,
    validate_settings_changes,
)


def test_settings_fields_are_derived_from_schema():
    assert {marker.schema for marker in SETTINGS_SCHEMA} == set(SETTINGS_FIELDS)


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
