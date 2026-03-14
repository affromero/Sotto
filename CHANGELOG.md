# Changelog

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
