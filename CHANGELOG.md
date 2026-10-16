# Changelog

## [0.2.0] - 2026-10-16

This release expands class teaching, recovery, and native learning. Desktop installers remain unsigned. iOS 1.1.1 (20) follows its separate App Store submission process; this GitHub release does not publish an iOS IPA or terminal-client binaries.

### Added

- Newly prepared classes teach the topic before assessment with explanations, worked examples, common mistakes, and guided practice. Questions use the accepted lesson, and imported vocabulary targets new or missed words grounded in the course material. ([#230](https://github.com/affromero/Sotto/pull/230), closes [#224](https://github.com/affromero/Sotto/issues/224) and [#229](https://github.com/affromero/Sotto/issues/229))
- New course uploads retain originals separately from editable notes. Long documents retain their extracted text, and generation samples named passages across the retained documents. ([#217](https://github.com/affromero/Sotto/pull/217), [#230](https://github.com/affromero/Sotto/pull/230))
- Failed grammar, reading, and listening sections can generate fresh questions about missed concepts while preserving the rest of the class. ([#226](https://github.com/affromero/Sotto/pull/226), closes [#223](https://github.com/affromero/Sotto/issues/223))
- Native Pencil homework supports reviewing interpreted marks before updating answers or writing drafts, with retained ink and explicit consent. ([#104](https://github.com/affromero/Sotto/pull/104), [#215](https://github.com/affromero/Sotto/pull/215), [#225](https://github.com/affromero/Sotto/pull/225))
- Speech options include Fish Audio and explicit local Piper speech and Whisper Small transcription. Admin defaults and local recovery controls use the selected provider. ([#218](https://github.com/affromero/Sotto/pull/218), [#193](https://github.com/affromero/Sotto/pull/193), [#195](https://github.com/affromero/Sotto/pull/195), [#232](https://github.com/affromero/Sotto/pull/232))
- Administrators can change Local and OpenAI-compatible endpoints, models, and credentials from Settings after onboarding. ([#144](https://github.com/affromero/Sotto/pull/144), closes [#143](https://github.com/affromero/Sotto/issues/143), reported by @srsatt) Thanks @srsatt.

### Fixed

- Desktop release assets retain all three platform manifests and valid installer references. Update notices compare stable versions numerically, and default desktop links follow the app version. ([#246](https://github.com/affromero/Sotto/pull/246))
- Class notes follow one reading order, and native light, dark, and larger-text layouts keep practice actions, settings, pairing forms, and white workbook paper readable. ([#222](https://github.com/affromero/Sotto/pull/222), [#238](https://github.com/affromero/Sotto/pull/238), closes [#221](https://github.com/affromero/Sotto/issues/221) and [#237](https://github.com/affromero/Sotto/issues/237))
- Practice distinguishes preparing, resumable, failed, and cancelled attempts, retaining server progress when the practice screen closes. ([#241](https://github.com/affromero/Sotto/pull/241), closes [#240](https://github.com/affromero/Sotto/issues/240))
- Listening supports seeking, replaying individual turns, and replaying one speaker. Closing an idle native Live screen releases only audio resources that it acquired. ([#230](https://github.com/affromero/Sotto/pull/230), [#242](https://github.com/affromero/Sotto/pull/242), closes [#239](https://github.com/affromero/Sotto/issues/239))
- Introduction repairs keep example references attached to the corrected material. ([#212](https://github.com/affromero/Sotto/pull/212), closes [#211](https://github.com/affromero/Sotto/issues/211), reported by @hardyyb2) Thanks @hardyyb2.
- Teaching reviews retain passage evidence, speaker attribution, and approved material during bounded correction. Reading vocabulary credit follows assessed passage evidence. ([#163](https://github.com/affromero/Sotto/pull/163), [#174](https://github.com/affromero/Sotto/pull/174), [#198](https://github.com/affromero/Sotto/pull/198), [#204](https://github.com/affromero/Sotto/pull/204), [#206](https://github.com/affromero/Sotto/pull/206))
- Class preparation and full practice keep durable failure outcomes and recovery state. Audio completion shares database-write admission without repeating completed speech generation. ([#120](https://github.com/affromero/Sotto/pull/120), [#148](https://github.com/affromero/Sotto/pull/148), [#178](https://github.com/affromero/Sotto/pull/178), [#228](https://github.com/affromero/Sotto/pull/228))
- Standalone web images retain the storage package required by their native lock dependency. Test arguments reach the web workspace, and offline speech qualification uses reproducible input while keeping the complete reference-sentence check. ([#235](https://github.com/affromero/Sotto/pull/235), [#236](https://github.com/affromero/Sotto/pull/236))

### Changed

- Source checks run in parallel, native checks select the affected surface, and production artifacts include digest-bound image measurements and runtime evidence. Guarded deployment preserves existing provider activation only with an explicit compatibility review. ([#219](https://github.com/affromero/Sotto/pull/219), [#234](https://github.com/affromero/Sotto/pull/234))
- Runtime images and CI use Node.js 24. Provider authority, dependency updates, and secret-scanning checks include the current reviewed fixes. ([#122](https://github.com/affromero/Sotto/pull/122), [#207](https://github.com/affromero/Sotto/pull/207), [#232](https://github.com/affromero/Sotto/pull/232), [#244](https://github.com/affromero/Sotto/pull/244))

### Upgrading

- Legacy course attachments saved only as filenames have no retained source text. Re-upload those files before preparing a class that uses them. Original-file retention applies to new uploads. ([#217](https://github.com/affromero/Sotto/pull/217), [#230](https://github.com/affromero/Sotto/pull/230))
- Back up PostgreSQL, retained uploads, and configuration before upgrading from 0.1.0. Use the supported self-host update flow so migrations, Sidedoor access conversion, and finalization run in the required order. Hosted blue-green deployments need a separate migration procedure when schema hashes differ. ([#148](https://github.com/affromero/Sotto/pull/148), [#217](https://github.com/affromero/Sotto/pull/217), [deployment guide](https://github.com/affromero/Sotto/blob/main/docs/03-self-host-deployment.md))
- Pin self-hosted web and worker images to the same verified source revision. The GitHub tag does not add SemVer image aliases; check the successful OSS publication for that revision. ([release guide](https://github.com/affromero/Sotto/blob/main/docs/releases.md))

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
