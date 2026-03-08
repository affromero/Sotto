# Changelog

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
