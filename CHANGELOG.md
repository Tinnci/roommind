# Changelog

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
