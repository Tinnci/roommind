# Releasing RoomMind / 发布 RoomMind

The prepared integration version is **1.8.0**. Update `manifest.json`, `const.py`,
`pyproject.toml`, the root package in `uv.lock`, the changelog and bug-report
placeholder together. Frontend package metadata belongs to its private build
workspace; the installed panel cache version comes from the integration.

```sh
uv sync --locked --group dev
uv run pytest
uv run ruff check
uv run mypy custom_components/roommind
cd frontend
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
bun run lint
bun run format:check
cd ..
uv run python scripts/build_release_package.py --output dist/roommind.zip --tag v1.8.0
```

The HACS asset is `roommind.zip`, with `manifest.json` and the built frontend
at the ZIP root. Do not wrap it in another component directory. HACS and manual
installation use the same archive. The package regression suite tests this layout,
version mismatches and missing bundles; the full CI coverage requirement remains 90%.

After the reviewed commit is on GitHub, push its matching `vX.Y.Z` tag or rerun
**Release** with an existing `tag_name`. Manual input is passed as environment
data, checked as stable SemVer, and resolved explicitly under `refs/tags/`.
The workflow verifies, builds and uploads that tag. HACS uses `REPOSITORY_REF`
to inspect the same revision, since changing `GITHUB_REF` alone does not select
its API reads. Release creation requires an existing tag.

The release workflow obtains notes from the matching changelog section. The
maintained repository owns its support links and HACS custom entry; upstream
attribution and licensing remain in place.

发布准备与实机验收分别记录：源码归档和本地测试不能证明设备已收到命令或已执行。
部署后仍需按实体的真实观测时间确认反馈。跨仓库版本、CI 历史及本轮验证范围见
[生态发布审计](ecosystem-release-audit.md)。
