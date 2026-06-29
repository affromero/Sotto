# Changelog

## [0.1.0] - 2026-06-29

### Added

- Initial self-hosted Sotto release for private language practice, course generation, class sessions, and installable web/desktop distribution.
- Desktop host release pipeline for macOS, Windows, and Linux installers with versioned, commit-hash, and latest download channels.
- Native iPad learning experience with course workspace panels, class resume support, and shared loading states.
- Release diagnostics and support tooling for version metadata, download smoke checks, log collection, and issue reports.

### Fixed

- Class resume no longer regenerates a whole class when presentation material is missing; it now waits only for active generation or audio work and otherwise reports the missing material explicitly.
- Download and version metadata now use the canonical SemVer release tag `v0.1.0`.
- Web and iPad loading marks now use the shared Sotto circle mark.
