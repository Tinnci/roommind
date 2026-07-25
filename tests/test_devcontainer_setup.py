"""Tests for the devcontainer setup script contract."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_devcontainer_setup_derives_workspace_from_script_location():
    script = (REPO_ROOT / ".devcontainer/setup.sh").read_text(encoding="utf-8")

    assert 'WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"' in script
    assert 'WORKSPACE="/workspaces/roommind"' not in script


def test_devcontainer_helper_scripts_use_resolved_workspace():
    script = (REPO_ROOT / ".devcontainer/setup.sh").read_text(encoding="utf-8")

    assert 'WORKSPACE="${WORKSPACE}"' in script
    assert 'cd "${WORKSPACE}"' in script
    assert "cd /workspaces/roommind" not in script
