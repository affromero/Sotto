# Changelog

## [0.24.0] - 2026-03-15

### Added
- Per-voice-track video generation: each voice track can generate its own independent video with matching timing
- Video segment range control and video preview in audio player for landing page
- Shared `resolveSegmentTiming` helper for voice-track-aware timing in all video workers
- `GET /video?summary=true` endpoint returns status of all video generations for a episode

### Changed
- VideoGeneration uses compound unique `@@unique([episodeId, voiceTrackId])` instead of `episodeId @unique`
- Video workers (classification, pipeline, composition) use voice-track-specific audio URL and segment timing
- UI resets video state and re-fetches on voice track switch
- Redesigned video storyboard with clean landing-page style and color-coded type badges

### Fixed
- Progress bar shimmer animation and broken visual thumbnail handling
- Avatar picker respects auto model config and duration limits
- LandingShowcaseConfig missing `videoSegmentStart`/`videoSegmentCount` fields
