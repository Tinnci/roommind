"""Tests for the SSH deployment script contract."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_deploy_recreates_remote_component_directory_before_extracting():
    script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")

    rm_index = script.index('run_as_root rm -rf "$dest"')
    mkdir_index = script.index('run_as_root mkdir -p "$dest"', rm_index)
    extract_index = script.index("tar xzof - -C \"$dest\"")

    assert rm_index < mkdir_index < extract_index


def test_deploy_tar_stream_excludes_generated_files():
    script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")

    assert "--exclude='__pycache__'" in script
    assert "--exclude='*.pyc'" in script
    assert "--exclude='*.pyo'" in script
    assert "--exclude='.DS_Store'" in script
    assert "--exclude='*.map'" in script


def test_deploy_extract_does_not_preserve_local_archive_owner():
    script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")

    assert 'tar xzof - -C "$dest"' in script
    assert 'sudo -n tar xzof - -C "$dest"' in script


def test_deploy_uses_non_interactive_sudo():
    script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")

    assert 'sudo -n "$@"' in script
    assert "passwordless sudo is unavailable" in script
