# Changelog

## [0.9.0] - 2026-03-09

### Added
- **AI video transitions**: Opt-in AI-generated video transitions between segments using first/last frame video generation (FLF2V). Claude Haiku recommends which boundaries benefit from transitions; users toggle per-boundary in the storyboard editor
- **Transition pipeline editor**: TransitionConnector UI between segment cards with model selection, FLF2V compatibility warnings, per-transition cost estimates, and "AI recommended" badges
- **Transition generation worker**: New `transition-generation` queue generates FLF2V transition videos, uploads to R2, and gates the pipeline between visuals and avatars
- **Remotion transition overlays**: TransitionOverlay component renders transition videos at segment boundaries with 6-frame opacity fades, replacing the 0.27s crossfade with 1s cinematic blends
- **Runway avatar provider**: Full Runway integration as an alternative avatar provider — Playwright session recorder, REST client, audio chunking for sessions > 280s, AvatarPip mask for non-transparent overlays, and AvatarPicker UI for provider selection
- **Zero-downtime deployments**: Blue-green deploy strategy with health checks and automatic rollback
- **Admin short durations**: Admin controls for short-duration podcasts and marketing podcast templates

### Changed
- Video pipeline now progresses through `GENERATING_TRANSITIONS` stage between visuals and avatars
- `TRANSITION_FRAMES` increased from 8 to 30 (0.27s → 1s at 30fps)
- Pipeline version bumped to v3 with transitions array
- VideoProgress UI shows transition generation stage with progress tracking

## [0.8.2] - 2026-03-09

### Added
- **Voice track audio config**: "Add Voice Track" form now embeds the full AudioConfigPanel — users can select TTS provider, model, and custom voices instead of the system silently auto-picking

## [0.8.0] - 2026-03-09

### Added
- **Invitation links**: Admins can generate single-use, 24h-expiry invite links that auto-approve the recipient on the waitlist
- **Public invite page**: `/invite/[code]` validates and redeems invitation codes — users enter their email, then sign in with Google/Apple
- **Admin invitations UI**: Generate, copy, enable/disable invitation links from the waitlist admin page
- **Invitation API**: `POST/GET/PATCH /api/admin/invitations` for admin CRUD, `POST /api/invite/redeem` for public redemption

### Fixed
- Canonical URLs and OpenGraph metadata added to profile and collections pages

## [0.7.0] - 2026-03-09

### Added
- **Multi-visual segments**: Voice segments can now cycle through multiple visual types (e.g., TEXT_CARD 0-10s → MAP_OVERLAY 10-22s → AI_ILLUSTRATION 22-30s) instead of being locked to a single visual
- **Proactive map insertion**: AI classifier detects geographic mentions in speaker text and automatically inserts MAP_OVERLAY sub-visuals
- **News ingestion pipeline**: New worker-based pipeline ingests articles from ~26 RSS feeds into the database on a 30-minute schedule
- **Public news API**: `/api/news` endpoint with pagination for browsing ingested articles

### Fixed
- MiniMax video duration now snaps to valid values (6s or 10s)

## [0.6.1] - 2026-03-08

### Added
- **Verification stage messaging**: Bold, confident progress messages during fact-check stages with verification badge
- **Landing trust strip**: Trust strip section between pillars and demo on the landing page
- **Pipeline failure owner tracking**: Admin Telegram alerts and in-app notifications now show the podcast owner for attribution

## [0.6.0] - 2026-03-08

### Added
- **Animated video charts**: DataChart segments now animate over the segment duration — bars grow from zero, lines reveal point-by-point, pie charts sweep 0°→360°
- **Descriptive chart labels**: Charts render axis labels (`xAxisLabel`, `yAxisLabel`), legends for multi-series data, and pie slices with name + percentage
- **Smarter chart metadata**: Visual classifier now instructs the AI to generate descriptive titles, axis labels with units, and meaningful data key names

### Fixed
- Avatar toggle button now visible even when avatars are hidden
- Fixed `label`→`name` key mismatch in visual classifier DATA_CHART metadata schema

## [0.5.0] - 2026-03-08

### Added
- **Pexels attribution**: Stock footage segments now display photographer credits in both the rendered video (overlay) and web player (subtitle area)
- **Copyright claim system**: Users can file copyright claims against podcast visuals via `POST /api/podcasts/[id]/copyright-claim`
- **Admin copyright actions**: Admins can replace infringing assets (auto-regenerates as AI illustration) or delist entire podcasts from the moderation dashboard
- **Creator counter-notice**: Podcast creators can dispute copyright claims, resetting them to admin review
- `Podcast.isDelisted` field for copyright-based delisting
- `ASSET_REPLACED` and `DELISTED` report resolution statuses

### Fixed
- Video editor "Output format" label renamed to "Generate as" for clarity
- Video pipeline model aliases and non-retryable error handling improved
- Edit-on-fail UI for video generation errors

### Changed
- `Report` model extended with copyright-specific fields (claimantEmail, claimantName, evidenceUrl, segmentVisualId, counterNotice)
- `StockVideoResult` now captures photographer name, URL, Pexels video ID, and video page URL
