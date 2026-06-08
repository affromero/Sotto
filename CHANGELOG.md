# Changelog

## [0.30.0] - 2026-03-22

### Added
- Landing page overhaul: 9 chapters consolidated to 5 for a visual-first experience
- Hero chapter split grid with playable AudioClipPlayer demo and CSS waveform fallback
- Compact feature bullet list in JourneyChapter replacing 9 NetworkChapter cards
- Merged Trust + Identity chapters with inline verified badges for voice cloning and avatars
- FAQ accordion (5 curated items) absorbed into ConvertChapter with PoweredByProviders in footer
- Real-time SSE notifications via Redis pub/sub for pipeline events
- Toast notifications with action buttons for generation progress
- Complete notification icon coverage with click-through navigation
- LLM-generated showcase content from topic name

### Fixed
- ShowcaseChapter header invisible due to data-reveal on dynamically rendered client component
- showcase-generator type errors: AIResponse.content, destructured segments, CURATED_SEGMENTS reference
- Voice track loading state persistence across tab switches
- Architecture detection at build time for correct native bindings
- Dockerfile feed workspace import path

### Changed
- ShowcaseChapter now dark full-bleed, returns null when no showcase data (no fallback mock)
- Removed LandingShell click ripple effect (decorative, no narrative purpose)
- Deleted BotChapter, NetworkChapter, IdentityChapter, FaqChapter (8 files, -1,800 lines)

## [0.29.0] - 2026-03-21

### Added
- Visual showcase system: generate animated clips for all 11 visual types from curated sample data
- Persistent showcase sets with names, active toggle, and random rotation on landing page
- Per-item regeneration: re-render individual visual types without regenerating the entire set
- Hybrid carousel on landing page: featured video + thumbnail rail with auto-advance
- Standalone feed package: core ranking signals, scoring, diversity, and social proof
- Design system tokens: surface-nested, surface-sunken, state layers, consolidated spacing
- Public `GET /api/showcase` endpoint for landing page consumption

### Fixed
- FLUX 2 Pro fal endpoint corrected (`fal-ai/flux-2-pro`)
- DataChart Y-axis now fixed with stable ticks (no more flickering during animation)
- Diagram component uses SVG data URI instead of `dangerouslySetInnerHTML` (renders in headless Chrome)
- Quote component uses SVG quotation mark (font glyph rendered as broken commas)
- Remotion Dockerfile installs Linux ARM64 native bindings for rspack and compositor
- Cache-busting timestamps on showcase R2 keys to prevent CDN stale content
- 83 hardcoded border-radius values migrated to design tokens
- 8 ghost CSS tokens that silently resolved to nothing

### Changed
- Showcase carousel descriptions explain source context (how each visual was generated from the source)
- Showcase header uses set name dynamically ("From a podcast about Fusion Energy")
- New showcase sets are automatically active (deactivates previous)
- Consolidated `var(--space-N)` to semantic spacing tokens

## [0.28.0] - 2026-03-21

### Added
- Rich content extraction: tables, figures, and key statistics preserved from HTML and PDF sources
- PDF figure extraction via pdfjs-dist with embedded image capture
- `SOURCE_FIGURE` visual type: renders actual source figures in video with attribution overlay
- Per-section video preview: users can preview individual segments before final render
- Preview API (`POST/GET /api/podcasts/[id]/video/preview`) with Zod validation and ownership auth
- Segment preview worker renders per-segment MP4 via sidecar `/clip` with audio
- Per-segment feedback and selective regeneration via PATCH endpoint
- FFmpeg concat optimization: skip full Remotion re-render when all segments have full-quality previews
- Discovery-sourced figure extraction from verified reference URLs with attribution
- Per-podcast cost breakdown (text/audio/video/avatar) on player page and billing page
- Admin per-user cost oversight dashboard
- Storage inspector with 4-bucket cost breakdown
- Hume Octave v2 as default TTS model
- Daily TTS provider health monitor cron
- Per-direction speed/volume optimization for TTS provider configs

### Fixed
- All 15 pre-existing TypeScript errors resolved (avatar provider types, glob API, unused vars, Prisma casts)
- All 31 pre-existing test failures resolved across 9 test files
- SSRF protection for SOURCE_FIGURE URLs (safeFetch + https-only)
- SOURCE_FIGURE fallback re-queues AI_ILLUSTRATION job instead of stranding visuals
- Base64 data URIs filtered from classifier prompt to prevent token explosion
- HTML table row duplication from double-matching selectors
- Audio offset in previews uses composition fps instead of hardcoded 30
- Cross-correlation segment timing wrapped in try/catch for test fallback
- Avatar timing crossfade drift compensation

### Changed
- Visual classifier receives structured source data (tables, figures, stats) for accurate DATA_CHART/DATA_TABLE rendering
- Script generator `formatSourceBlock()` appends real data so AI gets exact values
- Both classification workers load Discovery.sourceMetadata and merge user + discovery figures
- Sidecar `/clip` route accepts `audioUrl`, `audioStartTime`, and `quality` params
- `SegmentStill` composition supports optional audio rendering
- Replicate added as avatar provider across all type definitions

## [0.27.0] - 2026-03-17

### Added
- Storyboard persistence — save video pipeline as DRAFT VideoGeneration with re-classify option
- DRAFT status for VideoStatus enum enabling storyboard save/resume workflow
- `@remotion/transitions` with fade crossfade fallback between LaunchVideo scenes (replaces hard cuts)
- GPT-5.4 model family support, pricetoken updated to 0.13.8

### Changed
- Remotion render pipeline: parallel frame rendering via `concurrency` + `enableMultiProcessOnLinux`
- Removed single-render mutex — concurrent renders now allowed (BullMQ controls load)
- `/clip` endpoint streams MP4 output instead of buffering in memory

### Removed
- Legacy `/stitch` FFmpeg pipeline (845 lines) — fully superseded by Remotion LaunchVideo composition
- Unused `SceneTransition` effect component — replaced by `@remotion/transitions`

## [0.26.0] - 2026-03-17

### Added
- Consent-based avatar image system — verified users upload their own portrait with explicit consent acknowledgment, admin kill switches for uploads and AI generation, shareable toggle per image, and avatar image sharing between users (request/approve/deny/revoke flow)
- Identity chapter on landing page — "Your Face. Your Voice. Your Podcast." section highlighting verified voice cloning + avatar images with pipeline loop visualization (Chat → Script → Your Voice → Your Face → Publish)
- Admin avatar controls in plan features panel — toggles for user uploads and AI generation, both with admin bypass

### Fixed
- Avatar generation no longer restricted by podcast duration limit

### Changed
- Avatar AI generation restricted to admin-only (was available to all users)
- Upload API requires verification + consent acknowledgment (was unrestricted)
- Plan features admin page renamed from "Voice Features" to "Plan Features" to reflect broader scope

## [0.25.4] - 2026-03-16

### Added
- Avatar Image Manager in user settings — upload, generate from prompt, and delete portrait images for lip-sync models (10-image limit, anchored at `/settings#avatar-images`)
- Lip-Sync section in admin video-tests page — ported from user settings, follows SectionShell pattern with full audio generation, image input, model selection, and video polling
- Image-required model labels in AvatarPicker — VEED and Kling models show "This model uses your uploaded portrait image" note, empty state links to settings
- Right-click to set default model in admin auto-models panel
- LocalStorage cache (15min TTL) for lip-sync admin test bench state

### Fixed
- Avatar model dropdown in LipSyncTester now uses API pricing as source of truth instead of hardcoded fallback
- Avatar models passed as server-side props instead of redundant client API fetch
- `provider:` prefix stripped from `proIncludedAvatarModels` before registry matching
- Data URL audio uploaded to R2 before sending to Fal (was failing with raw base64)

### Changed
- `/api/avatar-test` POST and GET now require ADMIN role (returns 403 for non-admins)
- LipSyncTester removed from user settings — replaced by AvatarImageManager gallery

## [0.25.0] - 2026-03-16

### Added
- Orphan pipeline reaper — draft-cleanup worker detects podcasts stuck in active pipeline states for >2 hours and marks them FAILED with user-friendly retry message
- Per-user monthly budget enforcement — `spentMonthCents` / `budgetMonthCents` fields on User model, inline spend tracking in usage-logger, generation gate blocks when budget exceeded with automatic monthly reset

### Fixed
- Double-stitch race condition — audio-generation worker now uses CAS (compare-and-swap) `updateMany` and stable BullMQ jobIds (`stitch-{podcastId}`) so concurrent segment completions can't create duplicate PodcastVersion records
- TOCTOU on `/generate` endpoint — all status transitions (fresh start, resume, import) use CAS `updateMany` to prevent concurrent requests from double-queuing pipeline jobs
- `markPodcastFailed` race — uses CAS on current status so concurrent workers can't double-mark a podcast as FAILED
- Stable jobIds across entire pipeline (`extract-`, `script-`, `verify-`, `validate-`, `audio-`, `stitch-`, `import-`) replacing `Date.now()`-based IDs, enabling BullMQ deduplication

## [0.23.2] - 2026-03-15

### Fixed
- Video pipeline editor timeout on large podcasts — moved LLM classification to async BullMQ worker with Redis result store, replacing synchronous API call that was killed by Cloudflare's 100s origin timeout
- Redis eviction policy corrected from `volatile-lru` to `noeviction` to prevent BullMQ job loss under memory pressure

## [0.23.0] - 2026-03-15

### Added
- Hera AI motion graphics integration — optional provider for programmatic visual types (charts, quotes, timelines, comparisons, diagrams, text cards) with admin per-tier control and automatic Remotion fallback on failure
- Motion Graphics section in admin auto-models panel with per-tier (Free/Pro) provider selects
- Hera added to landing page Video provider marquee

### Fixed
- Landing player now resolves voice names from PodcastVoice records instead of showing speaker roles

## [0.22.0] - 2026-03-15

### Added
- Cross-page view transitions via Next.js experimental API — TopBar and MiniPlayer persist across route changes
- Trending podcast carousel with auto-advance (6s), scroll-snap, dot indicators, keyboard navigation, and full ARIA support
- Ambient player glow on MiniPlayer that activates during playback
- Interactive transcript hover: speaker-colored left border, timestamp tooltip via CSS `::after`
- Infinite scroll on feed — replaces Load More button with IntersectionObserver sentinel
- Landing page mobile menu — burger button now opens an animated dropdown (was non-functional)
- CommandPalette exit animation (slideOut + fadeOut before unmount)
- Profile page entrance animation, avatar hover glow, and scale effect
- Auth page entrance animation, provider button press states, email focus ring, and loading spinner

### Fixed
- Landing player now shows voice names instead of speaker roles in the original track label
- Video pipeline classification now uses the user's preferred AI model instead of hardcoded default

### Changed
- Global reduced-motion safety net: all animations, transitions, and scroll behavior disabled for motion-sensitive users
- Feed tab switching now animates content on panel mount
- Podcast page action buttons (Like/Save/Fork) have press feedback and pop animation on active state
- Podcast status sections (processing/failed/script-ready) animate in instead of appearing instantly
- Progressive enhancement: `@supports (animation-timeline: view())` for scroll-driven animations in Chromium, falls back to IntersectionObserver in Firefox/Safari

## [0.21.10] - 2026-03-15

### Added
- Landing page audio player now shows the TTS provider name (e.g. "Will + Aria [ElevenLabs]") instead of generic "Original" label
- Track switching continues playback from the same position instead of stopping

## [0.21.9] - 2026-03-15

### Fixed
- Landing page showcase no longer reverts to hardcoded fallback after deploys or transient DB errors — page now uses `force-dynamic` rendering and logs all showcase fetch failures

### Changed
- Landing page CSS polish: deduplicated `.overline` styles, tamed hover lift, added press feedback and focus-visible states, ambient warm glow animation, text-wrap balance

## [0.21.8] - 2026-03-15

### Fixed
- Worker `core` preset now uses a denylist (`EXPERIMENTAL_WORKERS`) instead of an allowlist (`CORE_WORKERS`) — new production workers run by default, fixing 27 stuck `voice-track-audio` jobs and unblocking `visual-generation`, `transition-generation`, and `video-composition` on heavy containers

## [0.21.7] - 2026-03-15

### Changed
- Removed duplicated embed player from hero section — audio experience now lives solely in the journey chapter

## [0.21.6] - 2026-03-15

### Fixed
- Landing page now re-renders immediately after admin saves or resets showcase config (added `revalidatePath('/')` to all admin showcase API routes)
- Landing page falls back to hardcoded content when showcase podcast is missing discovery chat or script data, preventing half-populated chapters
- Resolved all pre-existing test failures across web and mobile test suites

### Added
- iOS CI workflow with Maestro E2E tests on self-hosted macOS runner
- 15 Maestro flows for thorough mobile E2E coverage
- testIDs on comment, draft, voice, and pill mobile components

## [0.21.4] - 2026-03-15

### Added
- Interactive landing page showcase — all chapter content (chat, script, audio, video, bot mocks) driven from a single admin-configurable podcast
- ScriptEditorMock component with real citation hover tooltips via CitationMarker
- AudioClipPlayer with HTML5 audio playback, progress bar, and voice track switcher (swap TTS provider/model on the spot)
- VideoClipPlayer for ShowcaseChapter video clip playback
- Admin panel at /admin/landing — podcast picker, script/audio/video clip range controls, bot overrides
- Bootstrap Showcase button — creates a CRISPR podcast as @sotto and kicks off the generation pipeline
- Reset to Defaults button — instantly reverts landing page to hardcoded content
- LandingShowcase singleton Prisma model for admin config

### Fixed
- Quiz generation worker using response.text instead of response.content
- Briefing voice assignment using wrong ID field
- SettingsForm test missing briefing and quiz props

## [0.21.3] - 2026-03-14

### Added
- Quiz stats badge on podcast page showing completion rate and score
- Daily Briefings and Comprehension Quizzes sections on landing page

## [0.21.2] - 2026-03-14

### Added
- Daily briefings: schema, scheduler, config, prompt, settings UI, API endpoints, and BRIEFING_READY notification (Phases 1-6)
- Post-listen quizzes: schema, quiz generation worker, pipeline triggers, API routes, and PostListenQuiz UI component (Phases 1-3)
- "Limited Sources" badge on feed cards and podcast detail page for podcasts with insufficient verified references
- Minimum reference count gate in reference-validation worker — enforces per-depth minimums (10 deep_dive, 5 standard, 3 eli5)

### Changed
- Insufficient references now pause at SCRIPT_READY instead of failing — users can add source URLs, explore a different angle, accept as-is, or delete
- Notification data includes `insufficientRefs`, `verified`, and `required` counts for frontend display

### Fixed
- Podcasts with zero verified references no longer silently reach READY status

## [0.21.1] - 2026-03-14

### Added
- Content-aware video scene splitting — monologue podcasts now produce one sub-visual per distinct idea with no upper cap, instead of being capped at 2-4

### Fixed
- ElevenLabs eleven_v3 rejecting `previous_request_ids` — skip all continuity params for that model
- Video classifier text truncation removed — full segment text now sent for accurate visual classification
- Duration fallback uses `estimateDurationFromText()` instead of hardcoded 5s when DB duration is null

## [0.21.0] - 2026-03-14

### Added
- Waveform generation worker for audio visualization peak extraction
- Provider-agnostic TTS chunk continuity via `continuityIds` and `getLastContinuityId()` on TtsProvider interface
- ElevenLabs request stitching (`previous_request_ids`) for eleven_v3 model
- Hume AI cross-chunk continuity via `previous_generation_id`
- `modelsWithoutTextContext` registry field to declare model-level text context restrictions
- TTS continuity reference documentation (`CONTINUITY.md`)

### Fixed
- ElevenLabs eleven_v3 returning 400 error when chunked text sent `previous_text`/`next_text` (production blocker)

### Changed
- Hardened all 28 Maestro E2E flows with testIDs, scrollUntilVisible, terminal assertions, and screenshots

## [0.20.0] - 2026-03-14

### Added
- Premium frontend polish: unified design token system with `--color-text`, `--text-heading-sm`, `--color-rose/pink` tokens fixing 32 broken references
- Sidebar slide animation with opacity-animated overlay (replaces display:none toggle)
- Upgraded empty states across 7 components with 48px Lucide icons, titles, CTAs, and fadeIn animation
- Lucide X icons for Modal and Toast close buttons with 44px touch targets
- Button hover parity: secondary, ghost, and danger variants now have lift + press micro-interactions
- Branded onboarding saving state with SottoSpinner
- Morphing gradient blob orb for GenerationProgress
- E2E test infrastructure: Maestro flows with LLMock, state isolation, smoke tags, error-state coverage

### Fixed
- Long TTS text chunking to respect provider character limits
- InterruptChatPanel textarea disabled state and incorporating spinner

### Changed
- 270+ hardcoded hex colors replaced with design tokens across 30+ CSS files (dark mode works automatically)
- Skeleton shimmer animations unified to gradient-sweep pattern
- Discovery and inspire prompts made less sycophantic
- Inspire Me performance: deduplicated provider resolution, increased cache TTL to 30min

## [0.19.0] - 2026-03-14

### Added
- Globe-to-location zoom animation for MAP_OVERLAY video visuals
- Full E2E API test coverage: 114 test cases across 17 spec files covering all non-admin routes
- `authedRequest` Playwright fixture for fast API-level testing without browser overhead
- Incorporate llmock fixture for Q&A incorporation tests

### Fixed
- Kling Avatar v2 Pro lip-sync: send explicit `prompt` param and fix pattern validation
- Vintage map preset: add labels and sepia filter in video composition
- Video test bench: blank MAP_OVERLAY clips, missing controls, stock footage error
