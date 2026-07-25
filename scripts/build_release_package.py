"""Build the RoomMind release package."""

from __future__ import annotations

import argparse
import ast
import json
import stat
import sys
import zipfile
from pathlib import Path

ZIP_TIMESTAMP = (2024, 1, 1, 0, 0, 0)


class ReleasePackageError(RuntimeError):
    """Raised when release package validation fails."""


def build_release_package(*, component_dir: Path, output_path: Path, tag: str | None = None) -> Path:
    """Create a deterministic HACS-compatible zip from the integration directory."""
    component_dir = component_dir.resolve()
    output_path = output_path.resolve()
    _validate_component(component_dir, tag)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        output_path.unlink()

    files = sorted(path for path in component_dir.rglob("*") if path.is_file() and not _is_excluded(path))
    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in files:
            relative = path.relative_to(component_dir).as_posix()
            info = zipfile.ZipInfo(relative, date_time=ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IMODE(path.stat().st_mode) & 0o755) << 16
            archive.writestr(info, path.read_bytes())

    return output_path


def _validate_component(component_dir: Path, tag: str | None) -> None:
    manifest_path = component_dir / "manifest.json"
    const_path = component_dir / "const.py"
    frontend_bundle = component_dir / "frontend" / "roommind-panel.js"
    if not manifest_path.is_file():
        raise ReleasePackageError(f"Missing manifest: {manifest_path}")
    if not const_path.is_file():
        raise ReleasePackageError(f"Missing constants file: {const_path}")
    if not frontend_bundle.is_file():
        raise ReleasePackageError(f"Missing frontend bundle: {frontend_bundle}")
    if frontend_bundle.stat().st_size == 0:
        raise ReleasePackageError(f"Frontend bundle is empty: {frontend_bundle}")

    version = _read_manifest_version(manifest_path)

    const_version = _read_const_version(const_path)
    if version != const_version:
        raise ReleasePackageError(f"manifest version {version} does not match const.py VERSION {const_version}")

    if tag:
        expected = tag.removeprefix("v")
        if version != expected:
            raise ReleasePackageError(f"manifest version {version} does not match tag {tag}")


def _read_const_version(const_path: Path) -> str:
    try:
        module = ast.parse(const_path.read_text(encoding="utf-8"), filename=str(const_path))
    except SyntaxError as err:
        raise ReleasePackageError(f"Invalid const.py syntax: {err}") from err
    for node in module.body:
        if (
            isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "VERSION" for target in node.targets)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        ):
            return node.value.value
    raise ReleasePackageError("const.py is missing string VERSION")


def _read_manifest_version(manifest_path: Path) -> str:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise ReleasePackageError(f"Invalid manifest JSON: {err}") from err

    if not isinstance(manifest, dict):
        raise ReleasePackageError("manifest.json must contain an object")

    version = manifest.get("version")
    if not isinstance(version, str) or not version:
        raise ReleasePackageError("manifest.json is missing string version")
    return version


def _is_excluded(path: Path) -> bool:
    parts = set(path.parts)
    return (
        "__pycache__" in parts
        or path.suffix in {".pyc", ".pyo"}
        or path.name in {".DS_Store"}
        or path.name.endswith(".map")
    )


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--component-dir", type=Path, default=Path("custom_components/roommind"))
    parser.add_argument("--output", type=Path, default=Path("dist/roommind.zip"))
    parser.add_argument("--tag", default=None)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    try:
        output = build_release_package(component_dir=args.component_dir, output_path=args.output, tag=args.tag)
    except ReleasePackageError as err:
        print(f"release package error: {err}", file=sys.stderr)
        return 1
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
