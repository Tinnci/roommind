"""Tests for the SSH deployment script contract."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_deploy_recreates_remote_component_directory_before_extracting():
    script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")

    rm_index = script.index('run_as_root rm -rf "$dest"')
    mkdir_index = script.index('run_as_root mkdir -p "$dest"', rm_index)
    extract_index = script.index('tar xzof - -C "$dest"')

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


def test_failed_container_restart_fails_deployment(tmp_path):
    """Run the script with local transport doubles; no device is contacted."""
    shutil.copy(REPO_ROOT / "deploy.sh", tmp_path / "deploy.sh")
    (tmp_path / "frontend").mkdir()
    component = tmp_path / "custom_components" / "roommind"
    component.mkdir(parents=True)
    (component / "manifest.json").write_text("{}")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, script in {
        "bun": "#!/bin/sh\nexit 0\n",
        "docker": "#!/bin/sh\nexit 42\n",
        "ssh": '#!/bin/sh\nfor argument do remote_command=$argument; done\ncase "$remote_command" in *"docker restart homeassistant"*) sh -c "$remote_command"; exit $? ;; esac\ncat >/dev/null\n',
    }.items():
        executable = bin_dir / name
        executable.write_text(script)
        executable.chmod(0o755)
    (tmp_path / ".env").write_text(
        f"BUN_BIN='{bin_dir / 'bun'}'\nTCL_LOCAL_DIR='{tmp_path / 'absent'}'\n"
        f"ZM1_LOCAL_DIR='{tmp_path / 'absent'}'\nSSHPASS=''\nRESTART_HA=1\n"
    )
    result = subprocess.run(
        ["bash", str(tmp_path / "deploy.sh")],
        env={**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"},
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 42
    assert "==> Done!" not in result.stdout
