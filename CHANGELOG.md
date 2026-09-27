# Changelog

## [0.1.0] - 2026-09-27

Sotto's first official GitHub release includes work from our first external contributor, Anton Sannikov (@asannikov).

Desktop installers are unsigned. The iOS and terminal clients remain available in source; this release does not publish an App Store build or separate terminal-client binaries.

### Added

- Self-hosted language practice with CEFR courses, class sessions, and your own AI providers. ([#3](https://github.com/affromero/Sotto/pull/3))
- Desktop host installers for macOS, Windows, and Linux, with versioned and commit-pinned download channels. ([#61](https://github.com/affromero/Sotto/pull/61))
- Native iPad course workspaces, class resume support, and shared loading states. ([`632ad8ee`](https://github.com/affromero/Sotto/commit/632ad8ee), [`b6fc3352`](https://github.com/affromero/Sotto/commit/b6fc3352))
- Release diagnostics for version metadata, download checks, log collection, and issue reports. ([`fbb67b5e`](https://github.com/affromero/Sotto/commit/fbb67b5e))

### Fixed

- Setup honors the learner's selected AI provider and passes it to curriculum generation. Speech settings load before lesson generation, ElevenLabs output works on lower plans, and setup includes Russian as a native language. ([#96](https://github.com/affromero/Sotto/pull/96)) Thanks @asannikov.
- Local model generation retains the configured endpoint after setup and during episode generation. ([#100](https://github.com/affromero/Sotto/pull/100), closes [#97](https://github.com/affromero/Sotto/issues/97))
- Class resume reports missing presentation material instead of regenerating the whole class. Web and iPad use the shared Sotto loading mark. ([`b6fc3352`](https://github.com/affromero/Sotto/commit/b6fc3352))
- Household access supports local Admin setup, shared passwords, remembered passkeys, and resumed sessions. ([#87](https://github.com/affromero/Sotto/pull/87), [#91](https://github.com/affromero/Sotto/pull/91))
- Self-hosted installation and updates preserve configuration, verify matching image revisions, and reject unhealthy startup. ([#61](https://github.com/affromero/Sotto/pull/61))

### Changed

- Manual releases validate versions, changelog notes, tags, and CI at the release commit before publishing. ([#101](https://github.com/affromero/Sotto/pull/101), closes [#98](https://github.com/affromero/Sotto/issues/98))
- Updated application dependencies and build actions, including aligned React and React DOM versions. ([#95](https://github.com/affromero/Sotto/pull/95), [#94](https://github.com/affromero/Sotto/pull/94))
