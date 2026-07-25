"""Tests for repository toolchain entry points."""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_FRONTEND_SCRIPT_TOKENS = {"npm", "npx", "pnpm", "yarn", "node", "tsc"}


def test_frontend_package_scripts_use_bun_and_tsgo():
    package_json = json.loads((REPO_ROOT / "frontend/package.json").read_text(encoding="utf-8"))
    scripts = package_json["scripts"]

    assert "tsgo" in scripts["typecheck"]
    assert "tsconfig.test.json" in scripts["typecheck"]
    assert "tsconfig.tools.json" in scripts["typecheck"]
    assert "tsconfig.test.json" in scripts["format"]
    assert "tsconfig.test.json" in scripts["format:check"]
    assert "tsconfig.tools.json" in scripts["format"]
    assert "tsconfig.tools.json" in scripts["format:check"]
    for name, command in scripts.items():
        tokens = command.replace("&&", " ").split()
        forbidden = FORBIDDEN_FRONTEND_SCRIPT_TOKENS.intersection(tokens)
        assert forbidden == set(), f"{name} uses forbidden frontend toolchain token(s): {sorted(forbidden)}"


def test_frontend_tooling_tsconfig_covers_scripts_and_vite_config():
    tsconfig = json.loads((REPO_ROOT / "frontend/tsconfig.tools.json").read_text(encoding="utf-8"))

    assert tsconfig["compilerOptions"]["types"] == ["bun"]
    assert sorted(tsconfig["include"]) == ["scripts/**/*.ts", "vite.config.ts"]


def test_frontend_test_tsconfig_covers_tests_with_bun_types():
    tsconfig = json.loads((REPO_ROOT / "frontend/tsconfig.test.json").read_text(encoding="utf-8"))

    assert tsconfig["extends"] == "./tsconfig.json"
    assert tsconfig["compilerOptions"]["types"] == ["bun"]
    assert tsconfig["include"] == ["src/**/*.test.ts"]
    assert tsconfig["exclude"] == []


def test_vscode_test_tasks_use_uv():
    tasks_json = json.loads((REPO_ROOT / ".vscode/tasks.json").read_text(encoding="utf-8"))

    for task in tasks_json["tasks"]:
        if task.get("group") != "test":
            continue

        assert task["command"] == "uv"
        assert task["args"][:2] == ["run", "pytest"]


def test_pull_request_template_lists_full_frontend_gate():
    template = (REPO_ROOT / ".github/PULL_REQUEST_TEMPLATE.md").read_text(encoding="utf-8")

    assert "bun run test && bun run typecheck && bun run lint && bun run format:check && bun run build" in template
