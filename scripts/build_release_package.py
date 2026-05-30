"""Build the RoomMind release package."""

from __future__ import annotations

import argparse
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
    frontend_bundle = component_dir / "frontend" / "roommind-panel.js"
    if not manifest_path.is_file():
        raise ReleasePackageError(f"Missing manifest: {manifest_path}")
    if not frontend_bundle.is_file():
        raise ReleasePackageError(f"Missing frontend bundle: {frontend_bundle}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    version = str(manifest.get("version", ""))
    if not version:
        raise ReleasePackageError("manifest.json is missing version")

    if tag:
        expected = tag.removeprefix("v")
        if version != expected:
            raise ReleasePackageError(f"manifest version {version} does not match tag {tag}")


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
