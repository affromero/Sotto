# Changelog

## [0.18.0] - 2026-03-13

### Added
- **Video clip previews in test bench**: All VideoTestBench previews now render short looping MP4 clips instead of static still frames, fixing blank previews for animated compositions (DATA_CHART, MAP_OVERLAY)
- **Remotion `/clip` endpoint**: New sidecar route renders short MP4 clips via `renderMedia` with CRF 28 and concurrency limiter (max 3 simultaneous renders)
- **Video generation in model test panel**: Model tester generates real videos via provider APIs

### Changed
- Stock footage preview now uses the actual Pexels video URL instead of the thumbnail image
- Removed frame strip / historical crossfade preview from map section (redundant — video clips show the full animation)

## [0.17.0] - 2026-03-13

### Added
- **Expanded admin model tester**: Test page now covers 7 provider categories — AI, TTS, STT, Image, Video, Avatar, and Music — with image preview for image/avatar tests and key validation for all providers
- **Avatar daily limits**: Independent `dailyAvatarLimit` / `dailyAvatarLimitPro` fields in AutoModelConfig, decoupled from video limits
- **Historical map enrichment**: Place enrichment searches David Rumsey Map Collection for historical maps; MapSlide composition crossfades between historical and modern views
- **Remotion-rendered video previews**: Video test bench renders still frames via Remotion sidecar for visual verification

### Fixed
- Avatar generation gate now uses avatar-specific daily limits instead of falling back to video limits
- Maps submodule updated to initial release with place resolver and map components

## [0.16.2] - 2026-03-13

### Added
- **Video pipeline test bench**: Admin page at `/admin/video-tests` for testing pipeline components in isolation — visual classifier, place resolver, map image generation, AI illustration, and stock footage search

## [0.16.0] - 2026-03-13

### Added
- **Avatar lip-sync pipeline**: VEED Fabric 1.0 + Kling Avatar v2 Pro via Fal, with avatar image registry, generation worker, and settings tester
- **Tri-state admin auto-models**: Unified model editor with off/enabled/default toggles replaces separate dropdowns + checkboxes
- **Daily quota counters**: Video, avatar, and music toolbar buttons show remaining daily quota
- **Runway browser recording**: Replaced @livekit/rtc-node with Playwright headless browser recording for Runway sessions
- **Worker queue allowlists**: Support filtering which queues a worker instance processes, with core preset overrides
- **ElevenLabs voice quality**: Sustained emotional delivery + per-provider inline audio tag conversion
- **Toolbar loading states**: Loading glow animation + in-place avatar progress + done flash feedback

### Fixed
- **Redis connection leaks**: Close singletons on shutdown, replace KEYS with SCAN, lazy-load BullMQ queues, reduce per-worker connections
- **Music settings not persisting**: Added missing music fields to auto-models Zod schema
- **Avatar route Redis leak**: Replaced per-request createRedisConnection with cache singleton
- **Runway silent audio**: Added anti-throttling flags + await TrackSubscribed before audio loop
- **Auto voice flow stability**: Stabilized automatic voice selection flows

### Changed
- Bumped pricetoken to 0.13.3 — maps avatar model IDs to pricetoken IDs instead of hardcoded prices
- Admin auto-models page reduced from ~14 sections to 7 unified modality sections

## [0.15.1] - 2026-03-12

### Added
- Verification badge on script preview links to the open verification standard doc

### Fixed
- Script review page now shows the full interactive editor (edit/delete/comment/flag per turn) when returning to a SCRIPT_READY podcast, instead of the read-only teleprompter view; voice/TTS provider selections are preserved through approval
- Action icon tooltips added to Edit, Delete, and Comment buttons in the script editor for discoverability

## [0.15.0] - 2026-03-12

### Added
- One-shot discovery UX: agent now infers all podcast parameters (depth, audience, level, tone, focus, verification mode) from the first user message and shows them pre-selected in a compact params card — one click to generate instead of 5–7 sequential questions
- `DiscoveryParamsCard` component: inline chip-group rows for adjusting inferred params locally without triggering a new API call
- `updateMetadata` on `useDiscovery` hook: lets the UI patch individual params without a round-trip

### Changed
- PgBouncer connection pooling added to production infrastructure; worker profiles split into dedicated queues for better resource isolation

## [0.14.2] - 2026-03-11

### Added
- Inworld TTS 1.5 Max/Mini models via Replicate provider
- Avatar lip sync can now use voice track as audio source

### Fixed
- Landing page hero streamed in after "Three steps" section due to async Server Component
- Voice track naming preserves duplicate provider names with hover tooltip
- Avatar price estimate recalculates when individual segments are toggled

## [0.14.0] - 2026-03-11

### Added
- **Background music**: Multi-provider music generation for podcasts with Suno BYOK support, dynamic model picker, and multi-generation selection with pricing
- **Launch Video pipeline**: 7-step orchestration UI with SFX, overlays, subtitles, avatar PiP, action timing log, and avatar interceptor for instant recording
- **Progressive avatar playback**: Runway chunks uploaded to R2 during recording with streaming indicator and chunk preview in player
- **Per-scene composition**: Professional recording workflow with per-scene TTS picker and voice comparison baked into creation flow
- **Pro daily generation limits**: Configurable daily limits for Pro users with billing integration, usage banners, and counter UI
- **Unified Remotion video**: Consolidated video rendering on Remotion React with motion effects library, parameterized `/render` route, `/probe` endpoint, and deprecated `/stitch`
- **Shared TTS generation module**: Extracted reusable TTS generation core (`lib/tts-generation.ts`) with unit tests
- **Demo Studio enhancements**: Timing step with per-segment speed controls, dark mode inputs, AI/TTS selectors, voice comparison in creation flow

### Changed
- Voice tracks simplified to per-speaker provider/voice dropdowns
- Feed cards redesigned: removed hero section, uniform card sizes, badges moved to bottom meta row, compact gradient covers
- Landing page: replaced Features/Voices with Create link, removed hover jump

### Fixed
- TTS model resolution for BYOK users — per-voice model stored on VoiceTrackVoice, correct provider/model priority in voice track creation, ElevenLabs 404 fallback
- Player scroll lock removed — guarded `scrollIntoView` with `isScrollable` check and removed page-level scroll hijack
- Showcase crash prevention — all async callbacks wrapped in try/catch
- Runway avatar fixes — real preset thumbnails, correct pricing lookup, 400 treated as non-retryable
- Feed card title overlap and badge layout fixes
- Video dismiss now deletes failed generation from DB
- Suno provider switched to sunoapi.org with correct `callBackUrl` field

## [0.13.0] - 2026-03-10

### Added
- **Demo Video Studio**: Evolved the admin Showcase Builder into a full 7-step demo video creation workflow — create AI-narrated product videos with custom visuals, voices, and avatars from `/admin/showcase`
- **Demo script generation**: New `ADMIN` podcast source and demo-specific prompt template that produces self-referential Sotto product scripts with visual-oriented narration and no citation requirements
- **Script review panel**: Inline script editing, approval, and regeneration directly within the builder workflow
- **Visual pipeline editor**: Per-segment visual classification, prompt editing, model selection, transition configuration, and cost estimation
- **Avatar assignment panel**: Per-speaker avatar selection from HeyGen/Runway with position controls, mask shape selector, and live position preview
- **Generate-all orchestrator**: Non-blocking state-machine API endpoint that advances the pipeline (script → audio → video) with a single action
- **Preview & publish panel**: Video/audio player with segment visual timeline, visibility controls (public/unlisted/private), and link copy/download actions

### Changed
- Showcase Builder page renamed to "Demo Video Studio" to reflect expanded capabilities

### Fixed
- Podcast player UI modernized with glassmorphism and micro-interactions
- Lottie dependency replaced with lightweight CSS waveform animations
- Discovery page shows actionable error message on 429 rate limit
- Deploy pre-build prune prevents disk exhaustion during deploys

## [0.12.0] - 2026-03-10

### Added
- **Mobile app**: Full iOS feature parity — player with MiniPlayer, comments, activity feed, search with advanced filters, collections, profile editing, settings, analytics, voice marketplace, billing, referrals, script editing, draft resumption, voice clone management, onboarding, and save/share/fork flows
- **Mobile design system**: Cozy Evening dark mode, Ionicons, entrance animations, press feedback, skeleton loading, shadows, gradients, and animated pressable components
- **Showcase verification mode**: Admin-only `verificationMode: 'showcase'` for curated demo podcasts — uses standard script verification but skips reference validation, pausing at SCRIPT_READY for manual review

### Changed
- Landing page overhauled to lead with core capabilities and reflect all podcast formats

### Fixed
- Mobile Bearer token auth via `authenticateRequest()`
- Hero reverted to CSS bar waveform, fork icon fixed, dashboard enhancements

## [0.11.0] - 2026-03-10

### Added
- **Frontend overhaul**: Complete visual upgrade across all pages — expressive easing curves (expo, back, spring), multi-layer shadows, glassmorphism tokens, fluid `clamp()` typography, and gradient tokens
- **Scroll storytelling**: Global `[data-reveal]` scroll animation system with `useScrollReveal` hook and `ScrollReveal` wrapper component — staggered reveals on landing, dashboard, and feed pages
- **Hero transformation**: Animated gradient blobs, Lottie waveform visualization, glassmorphism badge, and fluid hero typography on the landing page
- **Lottie animations**: `LottieAnimation` component with reduced-motion support; branded loader in GenerationProgress orb, waveform visualization in MiniPlayer, and hero waveform
- **Dark mode "cozy evening"**: Warm amber ambient gradient, glass effects on Sidebar/TopBar/MiniPlayer/AudioPlayer, amber selection color, warm-tinted shadows
- **Provider showcase**: 5 marquee tracks (Voice, Intelligence, Images, Video, Avatars) with all supported providers, moved higher on landing page
- **Video provider badge**: ProviderBadge overlay component for showcase videos with TTS provider/model pass-through to Remotion

### Changed
- Card hover lifts with `translateY(-6px)` + `shadow-xl`, button press scales to `0.98`, modal enters with scale+slide, toast uses `springPop` animation
- Dashboard stat cards lift on hover with multi-layer shadows and use `tabular-nums` for numeric alignment
- Feed skeleton loading uses shimmer (moving gradient) instead of pulse, filter pills use spring easing
- Audio player progress bar uses warm gradient fill with amber glow on thumb hover
- BYOK provider pills expanded with Google and Together AI

## [0.10.0] - 2026-03-09

### Added
- **Admin Showcase Builder**: Multi-provider TTS podcast builder at `/admin/showcase` — assign different TTS providers per segment, preview provider boundaries, generate mixed-provider audio, and trigger video with transitions at provider change points
- 7 avatar mask shapes with owner-facing shape picker
- Runway video pricing via pricetoken 0.11.1

### Fixed
- Video tab now appears first in player view toggle
- Pinned Prisma to ~6.19.x to prevent breaking v7 upgrade

### Changed
- Audio generation worker supports segment-level provider overrides via `getPlatformTtsKey` helper

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
