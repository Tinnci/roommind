# HA ecosystem release audit / Home Assistant 生态发布审计

Date / 日期：2026-09-13. Scope: release preparation and local verification.

## Inventory / 仓库盘点

The GitHub inventory returned all **225** repositories owned by Tinnci. Name,
description, installed-component metadata and workspace ownership identified the
following **14** related repositories, including one adjacent desktop app. Unrelated
private repositories and household credentials are not reproduced here.

| Repository | Role and latest release | Observed CI before this iteration | Decision |
|---|---|---|---|
| `Tinnci/roommind` | Room controller, `v1.7.21` | Latest CI passed; earlier runs failed | Prepare `1.8.0` |
| `Tinnci/ha-tcl-udp-ac` | AC integration, `v0.10.0` | Test/Validate passed; full Ruff failed | Prepare `0.11.0` |
| `Tinnci/zm1` | M1/zM1 integration, `v0.2.1` | Latest CI passed; release still used unittest | Prepare `0.3.0` |
| `Tinnci/hass-edge-tts` | TTS integration, `v0.8.3` | HACS failed on license identification | Prepare automatic minor release `0.9.0` |
| `Tinnci/llm-gateway` | Conversation integration, `v0.3.48` | Validate passed with permissive Hassfest/brand settings | Prepare automatic minor release `0.4.0` |
| `Tinnci/doubao-asr-for-ha` | Wyoming server/add-on, `v0.1.8` | CI passed | Prepare automatic patch release `0.1.9` |
| `Tinnci/phosh-ha-status` | Satellite and native Phosh plugin, `v0.1.16` | Latest Python/native CI passed | Native release follows Phase 7 target-device verification |
| `Tinnci/pmos-docker` | OS/kernel build tooling | Latest scheduled HAOS validation passed | Retain APK/image-specific workflow |
| `Tinnci/ha_xiaomi_home` | Fork with entity-ID fix, no own Release | Latest manually run Tests passed | Hold a separate fork release until entity-registry migration is verified |
| `Tinnci/tianqi` | Weather integration fork, no own Release | No Actions history/workflows | No new fork release prepared |
| `Tinnci/versatile_thermostat` | Thermostat integration fork, no own Release | No Actions history/workflows | No new fork release prepared |
| `Tinnci/tcl_udp_ac` | Home Assistant Brands fork | Separate brand repository, not the AC runtime | Preserve established TCL artwork; use `ha-tcl-udp-ac` for code |
| `Tinnci/kukui-screen-bridge` | Retired bridge, `v0.1.0` | No Actions history/workflows | Superseded by `phosh-ha-status`; no parallel release |
| `Tinnci/yeelight_libra` | Swift macOS LAN lighting app | Latest CI passed | Adjacent ecosystem app; not a HACS integration |

The phase does not assign HA integration manifests or HACS ZIPs to native desktop,
kernel, add-on or retired projects. Their runtime ownership remains separate.

Xiaomi Home carries the local `e83308da` entity-ID correction under the upstream
`v0.4.7` version. It needs a separate migration review before claiming a fork release
is ready. Tianqi and Versatile Thermostat heads retain upstream commit histories and
versions, so they are inventoried without creating duplicate release lines.

## Household evidence / 实机证据

Read-only SSH inspection found Home Assistant **2026.6.3** in the running container.
Canonical component directories and configured domains were compared with local
Git-tracked source files by byte equality, without introducing content hashes.
Version equality alone did not identify a source revision.

| Component | Installed version | Difference from source at audit start |
|---|---|---|
| RoomMind | `1.7.21` | 7 tracked files differed; field freshness/storage work pending installation |
| zM1 | `0.2.1` | 8 files differed, including UDP, per-field observations and publication |
| TCL AC | `0.10.0` | 3 files differed, including entity publication and measurement statistics |
| Edge TTS | `0.8.3` | All 13 tracked component files matched `63f85ea`; privacy diagnostics were unreleased |
| LLM Gateway | `0.3.48` | 24 files differed and `earcons.py` was missing; installed source is not current main |
| Doubao ASR | image `v0.1.8-privacy1` | Python source matched `6e2bc88`; transcript-log redaction was unreleased |

Installed upstream components also included Xiaomi Home `v0.4.7`, Tianqi `0.0.0`,
Versatile Thermostat `10.0.1`, HACS `2.0.5` and an unused TCL Home integration.
A custom Wyoming `2026.6.3.1` continuation patch belongs to the Phosh/voice work,
not a new standalone HACS distribution.

Historical backup directories with repeated manifest domains were present beneath
`custom_components`. They were excluded from canonical version counts. Future
deployment backups belong outside that discovery directory, as the TCL guidance
already requires. This audit did not migrate household files.

以上是文件、配置与运行容器的观测；不把目录中的版本号当作加载版本或设备运行结果。
本轮没有重启 Home Assistant、播放音频或下发家庭设备指令。后续部署仍需观察新进程
实际加载情况、设备反馈时间及同负载下的闪存写入。

## Concrete repairs / 本轮修复

- **Source identity:** TCL and zM1 manual release workflows previously packaged
  the default branch while labelling it with the entered tag. They now resolve
  an existing stable SemVer tag and use it for every verification and build job.
  RoomMind passes manual input as environment data and validates it before checkout.
- **HACS revision:** the official action reads `REPOSITORY_REF`; setting
  `GITHUB_REF` alone does not select its API reads. All changed integration
  workflows supply the revision explicitly and disable PR comments.
- **Archives:** zM1 previously wrapped its files in `custom_components/zm1` despite
  `zip_release: true`. TCL now uses a fixed `tcl_udp_ac.zip` with the same direct
  installation layout. Edge TTS and Gateway ZIP exclusions now cover root-level
  caches and Finder metadata. Tests build and inspect the real archives.
- **Verification:** zM1 releases use pytest, not a unittest run that misses pytest
  functions. TCL uses a locked uv environment and full repository Ruff rules; its
  failing boolean assertion and two missing lifecycle docstrings are corrected.
- **Automatic releases:** Edge TTS, Gateway and ASR reuse their CI before version
  mutation and tag publication. Commit/tag pushes are atomic and refuse a moved
  main branch. Gateway rebuilds its frontend from source during release using
  Bun/tsgo. ASR images use Python 3.13 and uv 0.12.5.
- **Metadata:** RoomMind points users to this fork's HACS entry and issue tracker
  while crediting upstream. Integration archives select explicit HACS filenames.
  English/Chinese translation keys match; RoomMind and TCL retain additional
  supported languages. TCL's minimum HA version matches the verified 2026.6.3 host.
  GitHub reported an invalid upstream owner in RoomMind's `CODEOWNERS`; review
  ownership now belongs to `Tinnci`, with upstream attribution kept in the README
  and integration manifest.
- **Brands:** Edge TTS includes unchanged official Brands assets. Gateway includes
  original SVG/PNG assets and enables normal brand validation. Current official
  Hassfest accepts the nested earcon manifest, so Gateway no longer deletes it or
  treats Hassfest failures as acceptable.

The prior failures can be inspected in
[TCL Ruff](https://github.com/Tinnci/ha-tcl-udp-ac/actions/runs/34689763479),
[Edge TTS validation](https://github.com/Tinnci/hass-edge-tts/actions/runs/33585514346),
and the successful earlier
[RoomMind CI](https://github.com/Tinnci/roommind/actions/runs/34697539045).

## Shared workflow decision / 复用方式

TCL, zM1 and the three voice repositories reuse their own verification workflows
through `workflow_call`. RoomMind retains its existing single release job with
the same backend, frontend and integration checks as CI.
This keeps release checks aligned with normal CI without adding a central build
repository, remote shared-action dependency, cross-repository credentials or a
new release database. The common rules are locked uv dependencies, Bun/tsgo where
needed, ordinary tests, explicit source selection and an installable artifact.

HA-native tests, TCL's stub-based tests, ASR's multi-architecture container and
Phosh's native build have different dependency and hardware needs. A single
universal workflow would hide those differences. Share these small workflow
patterns while each owner retains its tests, packaging and release history.

## Qualification scope / 验证范围

All six repositories passed their full Python suite and Ruff checks. The two
frontend workspaces passed Bun tests, tsgo checks and production builds. Counts
below exclude subtests and repeated verification runs.

| Repository | Python tests | Bun tests | Additional local verification |
|---|---:|---:|---|
| RoomMind | 2,315 | 75 | 93.81% coverage, mypy, ESLint, Prettier, HACS ZIP |
| TCL AC | 286 | — | Native unittest suite (283 tests), compileall, HACS ZIP |
| zM1 | 59 | — | HACS ZIP; existing formatting drift corrected |
| Edge TTS | 36 | — | Actual workflow ZIP command and version alignment |
| LLM Gateway | 383 + 3 earcon-tool tests | 24 | Actual workflow ZIP command and version alignment |
| Doubao ASR | 33 | — | Docker build, offline module imports and CLI help |

Ruff formatting, lockfile checks and Actionlint passed for all six repositories.
The five locally built integration archives are in RoomMind's ignored `dist/`
directory. Edge TTS and Gateway keep their current versions in these preparation
archives; the automatic release workflow will rebuild them after its version bump.

The current official Hassfest image validated all five local integrations with
**zero invalid integrations**. Local archives, translations and version metadata
are verified separately from GitHub repository eligibility.

The official HACS `hacsjson`, `integration_manifest` and `brands` validators also
passed against all five local candidate trees, using a read-only file provider
instead of GitHub transport. No validator rules were changed. This checks the
new Gateway icon locally while preserving the distinction from repository-level
checks against a published Git revision.

Official HACS Action checks were also run against the then-published Git revisions:
RoomMind, TCL and zM1 passed all 9 checks; Edge TTS passed 8 custom-repository checks.
Gateway passed the same non-brand checks but the remote revision lacked its new
local icon. The next push must rerun its enabled brand check against the new tree.
An unpushed local commit cannot be read by GitHub's API; an old green run is not
evidence for a new release.

Edge TTS and Gateway retain their existing PolyForm Noncommercial license and
upstream notices. GitHub labels that license `NOASSERTION`. Their custom-repository
validation explicitly omits only default-index license eligibility. This does not
claim default HACS catalogue inclusion or change the license.

本轮完成本地发布准备，不创建或推送标签、不发布 GitHub Release、不部署家庭组件。
官方仓库级校验的版本与本地验证对象分别记录，避免把旧的绿色 CI 当作本次提交的结论。

## Per-repository release instructions / 各仓库发布说明

- [RoomMind](releasing.md)
- [TCL AC](https://github.com/Tinnci/ha-tcl-udp-ac/blob/main/docs/releasing.md)
- [zM1](https://github.com/Tinnci/zm1/blob/main/docs/releasing.md)
- [Edge TTS](https://github.com/Tinnci/hass-edge-tts/blob/main/docs/releasing.md)
- [LLM Gateway](https://github.com/Tinnci/llm-gateway/blob/main/docs/releasing.md)
- [Doubao ASR](https://github.com/Tinnci/doubao-asr-for-ha/blob/main/docs/releasing.md)

Keep the automatic-release projects' versions unchanged in the preparation
commit. Their supported workflow updates project, manifest/add-on and lockfile
versions together when the actual release is requested.
