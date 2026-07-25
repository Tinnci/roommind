"""Tests for release package creation."""

from __future__ import annotations

import hashlib
import json
import re
import tomllib
import zipfile
from pathlib import Path

import pytest

from scripts.build_release_package import ReleasePackageError, build_release_package

REPO_ROOT = Path(__file__).resolve().parents[1]


def _write_component(tmp_path: Path, *, version: str = "1.2.3", const_version: str = "1.2.3") -> Path:
    component = tmp_path / "custom_components" / "roommind"
    component.mkdir(parents=True)
    (component / "manifest.json").write_text(
        json.dumps({"domain": "roommind", "version": version}),
        encoding="utf-8",
    )
    (component / "const.py").write_text(f'VERSION = "{const_version}"\n', encoding="utf-8")
    (component / "frontend").mkdir()
    (component / "frontend" / "roommind-panel.js").write_text("console.log('ok');\n", encoding="utf-8")
    (component / "__pycache__").mkdir()
    (component / "__pycache__" / "ignored.pyc").write_bytes(b"pyc")
    (component / ".DS_Store").write_bytes(b"finder")
    (component / "frontend" / "roommind-panel.js.map").write_text("{}", encoding="utf-8")
    return component


def test_release_package_contains_component_root_and_excludes_generated_files(tmp_path: Path):
    component = _write_component(tmp_path)
    output = tmp_path / "dist" / "roommind.zip"

    build_release_package(component_dir=component, output_path=output, tag="v1.2.3")

    with zipfile.ZipFile(output) as archive:
        names = set(archive.namelist())

    assert "manifest.json" in names
    assert "frontend/roommind-panel.js" in names
    assert "__pycache__/ignored.pyc" not in names
    assert ".DS_Store" not in names
    assert "frontend/roommind-panel.js.map" not in names
    assert not any(name.startswith("roommind/") for name in names)


def test_release_package_rejects_version_mismatch(tmp_path: Path):
    component = _write_component(tmp_path, version="1.2.3")

    with pytest.raises(ReleasePackageError, match="does not match tag"):
        build_release_package(component_dir=component, output_path=tmp_path / "roommind.zip", tag="v1.2.4")


def test_release_package_rejects_manifest_const_version_mismatch(tmp_path: Path):
    component = _write_component(tmp_path, version="1.2.3", const_version="1.2.4")

    with pytest.raises(ReleasePackageError, match="manifest version 1.2.3 does not match const.py VERSION 1.2.4"):
        build_release_package(component_dir=component, output_path=tmp_path / "roommind.zip", tag="v1.2.3")


@pytest.mark.parametrize(
    ("manifest_text", "error"),
    [
        ("{", "Invalid manifest JSON"),
        ("[]", "manifest.json must contain an object"),
        (json.dumps({"domain": "roommind", "version": None}), "manifest.json is missing string version"),
        (json.dumps({"domain": "roommind", "version": 123}), "manifest.json is missing string version"),
    ],
)
def test_release_package_rejects_invalid_manifest_version(
    tmp_path: Path,
    manifest_text: str,
    error: str,
):
    component = _write_component(tmp_path)
    (component / "manifest.json").write_text(manifest_text, encoding="utf-8")

    with pytest.raises(ReleasePackageError, match=error):
        build_release_package(component_dir=component, output_path=tmp_path / "roommind.zip", tag="v1.2.3")


def test_release_package_rejects_invalid_const_syntax(tmp_path: Path):
    component = _write_component(tmp_path)
    (component / "const.py").write_text('VERSION = "1.2.3"\nif\n', encoding="utf-8")

    with pytest.raises(ReleasePackageError, match="Invalid const.py syntax"):
        build_release_package(component_dir=component, output_path=tmp_path / "roommind.zip", tag="v1.2.3")


def test_release_package_rejects_empty_frontend_bundle(tmp_path: Path):
    component = _write_component(tmp_path)
    (component / "frontend" / "roommind-panel.js").write_text("", encoding="utf-8")

    with pytest.raises(ReleasePackageError, match="Frontend bundle is empty"):
        build_release_package(component_dir=component, output_path=tmp_path / "roommind.zip", tag="v1.2.3")


def test_release_package_is_reproducible(tmp_path: Path):
    component = _write_component(tmp_path)
    first = tmp_path / "first.zip"
    second = tmp_path / "second.zip"

    build_release_package(component_dir=component, output_path=first, tag="v1.2.3")
    build_release_package(component_dir=component, output_path=second, tag="v1.2.3")

    assert hashlib.sha256(first.read_bytes()).digest() == hashlib.sha256(second.read_bytes()).digest()


def test_repository_release_metadata_is_aligned():
    manifest = json.loads((REPO_ROOT / "custom_components/roommind/manifest.json").read_text(encoding="utf-8"))
    const_text = (REPO_ROOT / "custom_components/roommind/const.py").read_text(encoding="utf-8")
    hacs = json.loads((REPO_ROOT / "hacs.json").read_text(encoding="utf-8"))
    issue_template = (REPO_ROOT / ".github/ISSUE_TEMPLATE/bug_report.yml").read_text(encoding="utf-8")
    pyproject = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))

    const_match = re.search(r'^VERSION = "([^"]+)"$', const_text, re.MULTILINE)
    homeassistant_requirement = next(
        dependency for dependency in pyproject["dependency-groups"]["dev"] if dependency.startswith("homeassistant==")
    )
    homeassistant_version = homeassistant_requirement.removeprefix("homeassistant==")

    assert const_match is not None
    assert manifest["version"] == const_match.group(1)
    assert hacs["homeassistant"] == homeassistant_version
    assert hacs["zip_release"] is True
    assert hacs["filename"] == "roommind.zip"
    assert f'placeholder: "{manifest["version"]}"' in issue_template
    assert f'placeholder: "{homeassistant_version}"' in issue_template


def test_dev_requirements_match_pyproject_dev_group():
    pyproject = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    requirements = {
        line.strip()
        for line in (REPO_ROOT / "requirements-dev.txt").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.startswith("#")
    }

    assert requirements == set(pyproject["dependency-groups"]["dev"])


def test_release_workflows_publish_the_hacs_filename():
    hacs = json.loads((REPO_ROOT / "hacs.json").read_text(encoding="utf-8"))
    filename = hacs["filename"]
    release_workflow = (REPO_ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")
    ci_workflow = (REPO_ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")

    assert f"uv run --locked python scripts/build_release_package.py --output dist/{filename}" in release_workflow
    assert f"path: dist/{filename}" in release_workflow
    assert f'gh release upload "$tag" dist/{filename}' in release_workflow
    assert f'gh release create "$tag" dist/{filename}' in release_workflow
    assert f"uv run --locked python scripts/build_release_package.py --output dist/{filename}" in ci_workflow


def test_release_workflow_runs_backend_gates_before_packaging():
    release_workflow = (REPO_ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")

    sync_index = release_workflow.index("uv sync --locked --group dev")
    pytest_index = release_workflow.index(
        "uv run pytest tests/ -v --cov=custom_components/roommind --cov-report=term --cov-fail-under=90"
    )
    ruff_index = release_workflow.index("uv run ruff check .")
    ruff_format_index = release_workflow.index("uv run ruff format --check custom_components/ tests/ scripts/")
    mypy_index = release_workflow.index("uv run mypy --explicit-package-bases custom_components/roommind")
    package_index = release_workflow.index("scripts/build_release_package.py")

    assert sync_index < pytest_index < ruff_index < ruff_format_index < mypy_index < package_index


def test_release_workflow_runs_hacs_and_hassfest_before_packaging():
    release_workflow = (REPO_ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")

    hacs_index = release_workflow.index("uses: hacs/action@main")
    hassfest_index = release_workflow.index("uses: home-assistant/actions/hassfest@master")
    package_index = release_workflow.index("scripts/build_release_package.py")

    assert "timeout-minutes: 30" in release_workflow
    assert hacs_index < hassfest_index < package_index


def test_release_workflow_validates_manual_tag_input_before_checkout():
    release_workflow = (REPO_ROOT / ".github/workflows/release.yml").read_text(encoding="utf-8")

    validation_index = release_workflow.index('case "$tag" in')
    output_index = release_workflow.index('echo "tag=$tag" >> "$GITHUB_OUTPUT"')
    checkout_index = release_workflow.index("actions/checkout@v6")

    assert "Release tag must start with v" in release_workflow
    assert "Release tag must not contain whitespace" in release_workflow
    assert validation_index < output_index < checkout_index
