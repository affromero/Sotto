# Changelog

## [0.2.3] - 2026-03-06

### Added
- Video tab — third tab alongside Transcript/Teleprompter when a podcast has a generated video
  - Muted video synced with audio player (drift correction > 0.3s)
  - Live subtitle overlay with speaker-colored badges and citation parsing
  - Visible to all users (not just owners)
- Admin Auto Models — Image/Video provider section for configuring default image model used in video generation

### Changed
- Extract `findActiveIndex` to shared `segment-utils.ts` (used by Teleprompter and VideoView)

## [0.2.0] - 2026-03-05

### Added
- Video generation pipeline — AI-powered video from any podcast (PRO/admin feature)
  - Visual classifier assigns illustration/stock-footage/chart/quote types per segment
  - Fal FLUX image generation and Pexels stock footage integration
  - Remotion sidecar for MP4 composition with Docker container
  - 3 new workers: visual-classification, visual-generation, video-composition
  - API routes with PRO/admin feature gating
  - Frontend UI: video tab, generation button, player, and progress tracking
- Require display name during email signup onboarding

### Changed
- Stream audio downloads to disk instead of buffering in memory (RAM efficiency)
- Stream data exports to R2 instead of buffering in memory
- Paginate feature computation to bound memory usage
- Skip QueueEvents for utility queues to reduce Redis connections
- Add Docker memory limits and Node.js heap cap
- Configure Prisma connection pool limits

### Fixed
- CI type errors from missing `pricetoken` dependency and stale Prisma client
- Flaky audio-stitching test caused by stale mock queue (missing `mockReset`)

## [0.1.42] - 2026-03-04

### Changed
- Replace hardcoded LLM pricing tables with `pricetoken` package — 36 models from static data + live API updates
- Replace HTML-scraping + LLM-extraction pricing pipeline with PriceTokenClient API call
- Separate "servable models" (9 registry) from "pricing-known models" (36 pricetoken) for type safety

### Fixed
- Discovery worker handling reasoning models that return 0 visible bytes
- OG image params not awaited, causing undefined podcastId
