"""Tests for local Markdown references."""

from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import unquote

REPO_ROOT = Path(__file__).resolve().parents[1]
MARKDOWN_LINK_RE = re.compile(r"!?\[[^\]]*]\(([^)]+)\)")
HEADING_RE = re.compile(r"^(#+)\s+(.+?)\s*#*$")
EXTERNAL_PREFIXES = ("http://", "https://", "mailto:")
IGNORED_DIRS = {".git", ".venv", ".venv313", "dist", "node_modules"}


def _markdown_files() -> list[Path]:
    files: set[Path] = set()
    for root, dirs, filenames in REPO_ROOT.walk():
        dirs[:] = [dirname for dirname in dirs if dirname not in IGNORED_DIRS]
        files.update(root / filename for filename in filenames if filename.endswith(".md"))
    return sorted(files)


def _normalize_target(raw_target: str) -> str:
    target = raw_target.strip()
    if target.startswith("<") and target.endswith(">"):
        target = target[1:-1]
    else:
        target = target.split()[0]
    return unquote(target)


def _github_heading_slug(heading: str) -> str:
    slug = heading.strip().lower()
    slug = re.sub(r"`([^`]+)`", r"\1", slug)
    slug = re.sub(r"<[^>]+>", "", slug)
    slug = re.sub(r"[^\w\- ]", "", slug)
    slug = re.sub(r"\s+", "-", slug)
    return slug


def _markdown_anchors(markdown_path: Path) -> set[str]:
    anchors: set[str] = set()
    seen: dict[str, int] = {}
    for line in markdown_path.read_text(encoding="utf-8").splitlines():
        match = HEADING_RE.match(line)
        if not match:
            continue

        slug = _github_heading_slug(match.group(2))
        suffix = seen.get(slug, 0)
        seen[slug] = suffix + 1
        anchors.add(slug if suffix == 0 else f"{slug}-{suffix}")
    return anchors


def test_markdown_local_links_point_to_existing_paths():
    broken: list[str] = []
    anchors_by_path = {markdown_path.resolve(): _markdown_anchors(markdown_path) for markdown_path in _markdown_files()}

    for markdown_path in _markdown_files():
        text = markdown_path.read_text(encoding="utf-8")
        for match in MARKDOWN_LINK_RE.finditer(text):
            target = _normalize_target(match.group(1))
            if not target or target.startswith(EXTERNAL_PREFIXES):
                continue

            path_part, _, anchor = target.partition("#")

            referenced_path = (markdown_path.parent / path_part).resolve() if path_part else markdown_path.resolve()
            if not referenced_path.exists():
                relative_markdown = markdown_path.relative_to(REPO_ROOT)
                broken.append(f"{relative_markdown}: {target}")
                continue

            if anchor and referenced_path.suffix == ".md" and anchor not in anchors_by_path.get(referenced_path, set()):
                relative_markdown = markdown_path.relative_to(REPO_ROOT)
                broken.append(f"{relative_markdown}: {target}")

    assert broken == []
