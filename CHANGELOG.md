# Changelog

## [0.4.0] - 2026-03-07

### Added
- `@sotto/maps` package — rich historical map visuals with 6 presets (vintage, satellite, cinematic, parchment, dark, terrain)
- Place resolver pipeline — WHG, GeoNames, and Pleiades gazetteers with in-memory LRU cache
- OpenHistoricalMap vector tile overlay with year filtering via decimal-date properties
- Antique maps panel — David Rumsey Map Collection search with thumbnails and attribution
- maps.sotto.fm playground — search historical places, time slider, preset picker, globe view with fly-in
- MAP_OVERLAY visual type — full video pipeline integration (classifier, generation, Remotion MapSlide)
- Place extraction during script generation — geographic locations auto-detected for map visuals
- Post-generation video editor with selective segment regeneration (PATCH endpoint + storyboard UI)
- Daily video generation cap — free: 1/day, pro: 2/day with quota display in UI

### Fixed
- OHM year filter uses numeric `start_decdate`/`end_decdate` instead of broken string comparison
- Historical searches zoom out to z6 for empire-level boundary visibility
- Time slider range includes the searched year instead of clamping to historicalContext
- Modern map labels auto-hidden for historical views with toggle button
- OHM borders made significantly more visible with glow layer and bold colored lines
- Structured logging for all place resolution failures (per-gazetteer errors, config issues, total failures)

### Changed
- Replaced broken Allmaps IIIF overlay with David Rumsey search API (Allmaps bbox search returned global results regardless of coordinates)
- Maps app uses port 3002 (3001 used by PriceToken on prod)

## [0.3.0] - 2026-03-07

### Added
- Multi-provider video — FAL and MiniMax video provider registry with admin-configurable free/pro tiers
- Avatar overlays — HeyGen lip-sync avatars with draggable positioning, chromakey, and Remotion MP4 export
- Avatar provider registry — pluggable avatar backends (HeyGen first) with cost estimation
- Client-side Remotion Player — decoupled video from audio with cross-fade transitions and Ken Burns presets
- Storyboard editor — replaced ReactFlow node graph with vertical storyboard card list
- Tweet-to-podcast video models — video model selection and cheapest-cost qualifier in tweet pipeline
- Admin panel for video/avatar/image tiers — separate free and pro model configuration per provider

### Fixed
- Video duration capped to model's maxDuration
- Stock footage fallback to AI illustration when search fails
- Remotion entry point resolution (registerRoot, cwd-based paths)
- Video worker status alignment with Remotion sidecar responses
- Stale avatar detection and cleanup

### Changed
- Image/video model resolution uses `fetchAllVideoModels` for live catalog
- Video export gated behind `ENABLE_VIDEO_EXPORT` flag

## [0.2.9] - 2026-03-07

### Added
- Dynamic FAL model pricing — image and video model catalog now fetched live from PriceToken API with 5-minute cache and static SDK fallback
- Filmstrip progress UI — replaces chip grid with live visual previews during video generation
- Video pipeline resume — failed video generations resume from last checkpoint instead of restarting

### Fixed
- Video pipeline error handling — catch and surface descriptive errors instead of silent failures
- Video GET response now includes segment order and visual mode

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
