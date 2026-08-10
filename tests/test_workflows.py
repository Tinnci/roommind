"""Tests for GitHub Actions workflow shell contracts."""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_mutation_workflow_grep_counts_have_single_zero_fallback():
    workflow = (REPO_ROOT / ".github/workflows/mutation.yml").read_text(encoding="utf-8")

    assert 'grep -c "survived" /tmp/mutmut-survived.txt 2>/dev/null || echo "0"' not in workflow
    assert 'grep -c "timeout" /tmp/mutmut-all.txt 2>/dev/null || echo "0"' not in workflow
    assert 'grep -c "no tests" /tmp/mutmut-all.txt 2>/dev/null || echo "0"' not in workflow
    assert "SURVIVED=${SURVIVED:-0}" in workflow
    assert "TIMEOUT=${TIMEOUT:-0}" in workflow
    assert "NO_TESTS=${NO_TESTS:-0}" in workflow


def test_issue_reopen_workflow_does_not_act_on_pull_requests():
    workflow = (REPO_ROOT / ".github/workflows/issue-reopen.yml").read_text(encoding="utf-8")

    assert (
        "github.event_name == 'issues' && github.event.action == 'closed' && !github.event.issue.pull_request"
        in workflow
    )
    assert (
        "github.event_name == 'issue_comment' && !github.event.issue.pull_request && contains(github.event.comment.body, '/reopen')"
        in workflow
    )


def test_stale_issues_workflow_does_not_act_on_pull_requests():
    workflow = (REPO_ROOT / ".github/workflows/stale-issues.yml").read_text(encoding="utf-8")

    assert "if (issue.pull_request) continue;" in workflow
    assert "github.event_name == 'issue_comment' && !github.event.issue.pull_request" in workflow


def test_stale_issues_workflow_paginates_waiting_issues():
    workflow = (REPO_ROOT / ".github/workflows/stale-issues.yml").read_text(encoding="utf-8")

    assert "github.paginate(github.rest.issues.listForRepo" in workflow
    assert "for (const issue of waitingIssues)" in workflow
    assert "waitingIssues.data" not in workflow


def test_workflow_action_refs_are_pinned():
    for workflow_path in (REPO_ROOT / ".github/workflows").glob("*.yml"):
        workflow = workflow_path.read_text(encoding="utf-8")

        for line in workflow.splitlines():
            match = re.match(r"\s*uses:\s+(?P<action>[^@\s]+)@(?P<ref>.+)$", line)
            if not match:
                continue

            action, ref = match.group("action", "ref")
            if action == "home-assistant/actions/hassfest" and ref == "master":
                continue

            assert re.fullmatch(r"v?\d+(?:\.\d+)+", ref) or re.fullmatch(r"[0-9a-f]{40}", ref), (
                f"{workflow_path.name} uses mutable action ref {action}@{ref}"
            )


def test_build_workflows_pin_bun_and_git_default_branch():
    for filename in ("ci.yml", "release.yml", "mutation.yml"):
        workflow = (REPO_ROOT / ".github/workflows" / filename).read_text(encoding="utf-8")

        assert "GIT_CONFIG_KEY_0: init.defaultBranch" in workflow
        assert "GIT_CONFIG_VALUE_0: main" in workflow

    for filename in ("ci.yml", "release.yml"):
        workflow = (REPO_ROOT / ".github/workflows" / filename).read_text(encoding="utf-8")

        assert "bun-version: 1.3.14" in workflow
        assert "bun-version: latest" not in workflow
