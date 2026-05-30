"""Tests for release package creation."""

from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

import pytest

from scripts.build_release_package import ReleasePackageError, build_release_package


def _write_component(tmp_path: Path, *, version: str = "1.2.3") -> Path:
    component = tmp_path / "custom_components" / "roommind"
    component.mkdir(parents=True)
    (component / "manifest.json").write_text(
        json.dumps({"domain": "roommind", "version": version}),
        encoding="utf-8",
    )
    (component / "const.py").write_text('VERSION = "1.2.3"\n', encoding="utf-8")
    (component / "frontend").mkdir()
    (component / "frontend" / "roommind-panel.js").write_text("console.log('ok');\n", encoding="utf-8")
    (component / "__pycache__").mkdir()
    (component / "__pycache__" / "ignored.pyc").write_bytes(b"pyc")
    return component


def test_release_package_contains_component_root_and_excludes_caches(tmp_path: Path):
    component = _write_component(tmp_path)
    output = tmp_path / "dist" / "roommind.zip"

    build_release_package(component_dir=component, output_path=output, tag="v1.2.3")

    with zipfile.ZipFile(output) as archive:
        names = set(archive.namelist())

    assert "manifest.json" in names
    assert "frontend/roommind-panel.js" in names
    assert "__pycache__/ignored.pyc" not in names
    assert not any(name.startswith("roommind/") for name in names)


def test_release_package_rejects_version_mismatch(tmp_path: Path):
    component = _write_component(tmp_path, version="1.2.3")

    with pytest.raises(ReleasePackageError, match="does not match tag"):
        build_release_package(component_dir=component, output_path=tmp_path / "roommind.zip", tag="v1.2.4")


def test_release_package_is_reproducible(tmp_path: Path):
    component = _write_component(tmp_path)
    first = tmp_path / "first.zip"
    second = tmp_path / "second.zip"

    build_release_package(component_dir=component, output_path=first, tag="v1.2.3")
    build_release_package(component_dir=component, output_path=second, tag="v1.2.3")

    assert hashlib.sha256(first.read_bytes()).digest() == hashlib.sha256(second.read_bytes()).digest()
