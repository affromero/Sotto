# Changelog

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
