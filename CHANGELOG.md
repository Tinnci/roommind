# Changelog

## 1.7.21 - 2026-08-28

### Fixed

- Align the bug-report version placeholder with release metadata so the release packaging gate succeeds.

## 1.7.20 - 2026-08-28

### Fixed

- Keep the runtime and manifest versions synchronized so a fresh installation does not raise a false restart-required repair.

## 1.7.19 - 2026-08-28

### Fixed

- Updated the development lockfile to patched pip 26.2.1 so release dependency auditing can complete.

## 1.7.18 - 2026-08-28

### Added

- Added explicit actuation evidence that distinguishes dispatch, acceptance, application, and confirmation outcomes.
- Added TCL command-result correlation through Home Assistant context IDs, including evidence that arrives before dispatch bookkeeping.

### Changed

- Freeze each room's primary sensor and climate-device observations before any room actuation begins.
- Serialize RoomMind storage mutations with immutable persistence snapshots.

### Fixed

- Prevent failed or unsupported service operations from being reported as active climate devices.

## 1.7.17 - 2026-08-11

### Fixed

- Resolved a high-severity Dependabot advisory by overriding the dev-only transitive `cryptography` dependency to 50.0.0.
- Upgraded GitHub Actions to current Node 24 runtimes and removed the Node.js 20 deprecation warning.

## 1.7.16 - 2026-07-07

### Added

- Added ground-truth observation storage and thermal analysis support for analytics and diagnostics.
- Added expanded room sensor and airflow setup controls in the room detail UI.
- Added release workflow support for packaging from version tags.

### Changed

- Improved the RoomMind UI hierarchy, configuration hub, and room detail layout.
- Clarified the temperature override apply flow with dedicated frontend copy and controls.

### Fixed

- Fixed configuration card text overflow in compact layouts.
- Hardened SSH deployment so remote command failures stop the script and password-auth deployments can use `SSHPASS`.
- Hardened release packaging and validation around version consistency, cache exclusion, and frontend regression coverage.

## 1.7.6 - 2026-06-17

### Added

- Added airflow command confidence tracking for assumed, observed, conflicting, and stale command states.
- Added room-detail preview coverage for airflow command conflicts.
- Added runtime notification translations outside Home Assistant's strict translation schema.

### Changed

- Updated the development and CI validation baseline to Home Assistant 2026.6 and Python 3.14.
- Stabilized CI with manual and scheduled runs, tighter workflow permissions, timeouts, concurrency, and consistent uv/Bun usage.
- Updated Dependabot scheduling, labels, and Python lockfile metadata.
- Updated the documented minimum Home Assistant version to 2026.6.

### Fixed

- Fixed hassfest translation validation by removing runtime-only notification text from HA translation files.
- Fixed HACS validation by aligning repository metadata and release checks.
- Reduced Dependabot alerts by updating the HA test baseline and lockfile dependencies.
