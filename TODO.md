# Sotto — Implementation Status

> Last updated: 2026-02-08 — **COMPLETE (186/186)**

## Legend
- [x] Implemented (real code, not a stub)
- [ ] Not started

---

## 1. Project Configuration

- [x] `package.json` — dependencies, scripts
- [x] `tsconfig.json` — TypeScript config
- [x] `next.config.js` — CSP headers, image domains, standalone output
- [x] `eslint.config.mjs` — flat config (eslint-config-next v16)
- [x] `vitest.config.ts` — test runner (vitest 4.x)
- [x] `docker-compose.yml` — PostgreSQL 16 + Redis 7
- [x] `.env.example` — all env vars documented
- [x] `.gitignore`
- [x] `.prettierrc`
- [x] `scripts/setup.sh` — auto-setup script
- [x] `public/manifest.json` — PWA manifest
- [x] `Dockerfile` — multi-stage production web container (Node 20 Alpine)
- [x] `Dockerfile.workers` — production workers container with FFmpeg
- [x] `docker-compose.prod.yml` — production compose (postgres, redis, web, workers)
- [x] `.dockerignore` — Docker build exclusions
- [x] `.github/workflows/ci.yml` — CI/CD pipeline (lint, typecheck, test, build)
- [x] `public/sw.js` — PWA service worker (offline + push notifications, 414 lines)

## 2. Database (Prisma)

- [x] `prisma/schema.prisma` — full schema (20+ models, all enums)
- [x] `prisma/seed.ts` — 12 default tags
- [x] `prisma/CLAUDE.md` — documentation
- [x] `npm install` + `npx prisma generate` verified
- [x] `npx prisma db push` verified against a real database (23 tables created)

## 3. Core Libraries (`src/lib/`)

- [x] `prisma.ts` — Prisma singleton client (build-safe, lazy validation)
- [x] `redis.ts` — Redis connection, cache helpers, rate limiting
- [x] `queue.ts` — BullMQ 7 queue types with typed payloads
- [x] `auth.ts` — NextAuth v5 config (Google, GitHub providers)
- [x] `claude.ts` — Anthropic client (streaming + non-streaming)
- [x] `elevenlabs.ts` — TTS generation client
- [x] `stripe.ts` — Stripe client, tier limits, checkout/portal
- [x] `r2.ts` — Cloudflare R2 S3 storage
- [x] `discovery-agent.ts` — Discovery chat system prompt, chip/metadata parsing
- [x] `script-generator.ts` — 2-voice podcast script generation
- [x] `audio-stitcher.ts` — FFmpeg concatenation + loudnorm
- [x] `content-parser.ts` — URL/PDF content extraction
- [x] `recommendations.ts` — similar podcast search
- [x] `push-notifications.ts` — Web Push API
- [x] `subscription.ts` — tier management, usage tracking
- [x] `notifications.ts` — in-app notification helpers
- [x] `validations.ts` — Zod schemas (discovery, podcast, interaction, profile, feed)
- [x] `logger.ts` — structured logger
- [x] `CLAUDE.md` — documentation

## 4. Workers (`src/workers/`)

- [x] `index.ts` — orchestrator (7 workers, graceful shutdown)
- [x] `content-extraction.worker.ts`
- [x] `script-generation.worker.ts`
- [x] `audio-generation.worker.ts`
- [x] `audio-stitching.worker.ts`
- [x] `interaction.worker.ts`
- [x] `segment-regeneration.worker.ts`
- [x] `notification.worker.ts`
- [x] `CLAUDE.md` — documentation

## 5. Types (`src/types/`)

- [x] `podcast.ts` — PodcastSummary, PodcastDetail, SegmentData, CreatePodcastRequest
- [x] `player.ts` — PlayerState, PlayerControls
- [x] `interaction.ts` — InteractionRequest, InteractionResponse, ResolutionChoice
- [x] `feed.ts` — FeedResponse, FeedSort, FeedFilters
- [x] `discovery.ts` — DiscoveryMessage, DiscoveryMetadata, DiscoveryState
- [x] `notification.ts` — NotificationData, PushSubscriptionData
- [x] `CLAUDE.md` — documentation

## 6. Design System (`src/styles/`)

- [x] `globals.css` — full design tokens (colors, typography, spacing, animations)
- [x] `CLAUDE.md` — documentation

## 7. UI Components (`src/components/ui/`)

- [x] `Button.tsx` + `.module.css` — 4 variants, 3 sizes, loading state
- [x] `Input.tsx` + `.module.css` — label, error, helper text, forwardRef
- [x] `Card.tsx` + `.module.css` — 3 variants, padding options, clickable
- [x] `Chip.tsx` + `.module.css` — tappable suggestion chips
- [x] `Badge.tsx` + `.module.css` — status badges including "soon" variant
- [x] `Toast.tsx` + `.module.css` — auto-dismiss notifications
- [x] `Modal.tsx` + `.module.css` — overlay, escape-to-close
- [x] `Spinner.tsx` + `.module.css` — standalone loading spinner

## 8. Player Components (`src/components/player/`)

- [x] `PlaybackControls.tsx` + `.module.css` — skip/play/pause/speed/volume
- [x] `AudioPlayer.tsx` + `.module.css` — full player with progress bar
- [x] `MiniPlayer.tsx` + `.module.css` — persistent bottom bar
- [x] `Waveform.tsx` + `.module.css` — amplitude visualization bars
- [x] `InterruptButton.tsx` + `.module.css` — "Ask a Question" with glow
- [x] `TranscriptPanel.tsx` + `.module.css` — speaker-labeled transcript

## 9. Layout Components (`src/components/layout/`)

- [x] `TopBar.tsx` + `.module.css` — sticky header, logo, nav links
- [x] `Footer.tsx` + `.module.css` — brand section + link columns
- [x] `Sidebar.tsx` + `.module.css` — dashboard sidebar navigation
- [x] `MobileNav.tsx` + `.module.css` — bottom tab navigation

## 10. Discovery Components (`src/components/discovery/`)

- [x] `DiscoveryChat.tsx` + `.module.css` — main discovery chat interface (330+ lines)
- [x] `SuggestionChips.tsx` + `.module.css` — horizontal scrollable chip row
- [x] `RecommendationCard.tsx` + `.module.css` — recommended podcast card
- [x] `CreatorSuggestion.tsx` + `.module.css` — suggested creator to follow

## 11. Chat Components (`src/components/chat/`)

- [x] `ChatContainer.tsx` + `.module.css` — chat wrapper with scroll
- [x] `ChatMessage.tsx` + `.module.css` — message bubble (user/assistant)
- [x] `ChatChips.tsx` + `.module.css` — inline chip grid
- [x] `ResolutionPrompt.tsx` + `.module.css` — "Was that helpful?" prompt

## 12. Create Components (`src/components/create/`)

- [x] `GenerationProgress.tsx` + `.module.css` — step-by-step progress indicator
- [x] `ScriptPreview.tsx` + `.module.css` — preview generated script turns

## 13. Feed Components (`src/components/feed/`)

- [x] `PodcastCard.tsx` + `.module.css` — podcast card for feed grid
- [x] `FeedGrid.tsx` + `.module.css` — responsive grid layout
- [x] `TagFilter.tsx` + `.module.css` — horizontal tag filter bar
- [x] `SearchBar.tsx` + `.module.css` — search input with icon
- [x] `TrendingSection.tsx` + `.module.css` — horizontal trending carousel

## 14. Profile Components (`src/components/profile/`)

- [x] `ProfileHeader.tsx` + `.module.css` — avatar, bio, stats, follow
- [x] `PodcastList.tsx` + `.module.css` — vertical podcast list
- [x] `FollowButton.tsx` + `.module.css` — follow/unfollow toggle
- [x] `FollowerCount.tsx` + `.module.css` — clickable follower count

## 15. Pricing Components (`src/components/pricing/`)

- [x] `PricingCard.tsx` + `.module.css` — single tier card
- [x] `FeatureList.tsx` + `.module.css` — feature checklist
- [x] `TierComparison.tsx` + `.module.css` — full comparison table

## 16. Notification Components (`src/components/notifications/`)

- [x] `NotificationBell.tsx` + `.module.css` — bell icon with badge
- [x] `NotificationList.tsx` + `.module.css` — notification dropdown
- [x] `PushPrompt.tsx` + `.module.css` — enable push banner

## 17. Providers (`src/components/providers/`)

- [x] `AudioPlayerProvider.tsx` — React context for audio player
- [x] `SessionProvider.tsx` — NextAuth session provider wrapper
- [x] `NotificationProvider.tsx` — notification context provider

## 18. Hooks (`src/lib/hooks/`)

- [x] `useAudioPlayer.ts` — HTML5 Audio playback controls
- [x] `useAuth.ts` — NextAuth session convenience hook
- [x] `usePodcast.ts` — podcast fetching, like/save/fork actions
- [x] `useDiscovery.ts` — discovery chat SSE streaming
- [x] `useNotifications.ts` — notification fetching + polling

## 19. Pages (`src/app/`)

- [x] `layout.tsx` — root layout (fonts, metadata, PWA)
- [x] `page.tsx` + `.module.css` — landing page (hero, how it works, pricing)
- [x] `auth/login/page.tsx` + `.module.css` — OAuth login page
- [x] `auth/signup/page.tsx` — signup page
- [x] `feedback/page.tsx` + `.module.css` — professional feedback page
- [x] `feedback/FeedbackForm.tsx` + `.module.css` — feedback form component
- [x] `(dashboard)/layout.tsx` — dashboard layout with Sidebar + auth check
- [x] `(dashboard)/dashboard/page.tsx` + `.module.css` — my podcasts, usage stats (181 lines)
- [x] `(dashboard)/settings/page.tsx` + `.module.css` — profile & preferences
- [x] `(dashboard)/billing/page.tsx` + `.module.css` — subscription management (186 lines)
- [x] `create/page.tsx` + `.module.css` — chat-based podcast creation (106 lines)
- [x] `podcast/[podcastId]/page.tsx` + `.module.css` — podcast player (137 lines)
- [x] `feed/page.tsx` + `.module.css` — public podcast feed (121 lines)
- [x] `profile/[userId]/page.tsx` + `.module.css` — user profile (127 lines)
- [x] `pricing/page.tsx` + `.module.css` — pricing tiers (83 lines)

## 20. API Routes (`src/app/api/`)

- [x] `auth/[...nextauth]/route.ts` — NextAuth v5 handlers
- [x] `discovery/route.ts` — SSE streaming discovery chat
- [x] `feed/route.ts` — public feed with search/filter/sort
- [x] `feedback/route.ts` — POST create + GET list feedback
- [x] `podcasts/route.ts` — GET list + POST create podcasts
- [x] `podcasts/[podcastId]/route.ts` — GET/PATCH/DELETE single podcast
- [x] `podcasts/[podcastId]/generate/route.ts` — trigger generation
- [x] `podcasts/[podcastId]/interact/route.ts` — submit question
- [x] `podcasts/[podcastId]/like/route.ts` — like/unlike
- [x] `podcasts/[podcastId]/save/route.ts` — save/unsave
- [x] `podcasts/[podcastId]/fork/route.ts` — fork podcast
- [x] `users/[userId]/route.ts` — user profile
- [x] `users/[userId]/follow/route.ts` — follow/unfollow
- [x] `notifications/route.ts` — list notifications
- [x] `notifications/[notificationId]/route.ts` — mark read
- [x] `notifications/mark-all-read/route.ts` — mark all read
- [x] `recommendations/route.ts` — similar podcast search
- [x] `tags/route.ts` — list tags
- [x] `billing/checkout/route.ts` — Stripe checkout session
- [x] `billing/portal/route.ts` — Stripe customer portal
- [x] `webhooks/stripe/route.ts` — Stripe webhook handler

## 21. Middleware

- [x] `src/middleware.ts` — auth middleware (protect dashboard/create/settings/billing)

## 22. Documentation (`docs/`)

- [x] `00-plan.md` — master plan (market analysis, user flows, architecture, pricing)
- [x] `11-unit-economics.md` — cost per user, bootstrapping budget, revenue projections
- [x] `12-provider-pricing.md` — LLM, TTS, voice agent provider comparisons
- [x] `13-hosting-infrastructure.md` — self-hosting guide (Hetzner VPS, Docker, Caddy)
- [x] `CLAUDE.md` — docs index
- [x] `01-product-vision.md` — problem, solution, 3 target user segments, 3 personas, value proposition (310 lines)
- [x] `02-market-analysis.md` — TAM/SAM/SOM, 5 competitor deep dives, competitive moat, pricing benchmarks (339 lines)
- [x] `03-technical-architecture.md` — system design, data flow, worker pipeline, scaling considerations (744 lines)
- [x] `04-design-system.md` — "Warm Intimacy" philosophy, color tokens, typography, spacing, component patterns (627 lines)
- [x] `05-ui-mockups.md` — 10 page layouts with ASCII diagrams, component hierarchy, empty/loading states (1011 lines)
- [x] `06-authentication-setup.md` — NextAuth v5 guide, OAuth setup, Apple Sign In, middleware (630 lines)
- [x] `07-stripe-billing.md` — Stripe products, 5 webhook events, subscription lifecycle, testing guide (811 lines)
- [x] `08-ai-prompts.md` — all system prompts with full text, rationale, output formats, cost tracking (544 lines)
- [x] `09-discovery-chat-flow.md` — 6-state machine, chip generation, metadata extraction, full example session (630 lines)
- [x] `10-mobile-strategy.md` — PWA implementation, push notifications, React Native roadmap, performance budgets (723 lines)

## 23. CLAUDE.md Files

- [x] `/CLAUDE.md` — root project guide
- [x] `prisma/CLAUDE.md` — schema reference
- [x] `docs/CLAUDE.md` — docs index
- [x] `src/lib/CLAUDE.md` — lib file index
- [x] `src/workers/CLAUDE.md` — worker pipeline reference
- [x] `src/components/CLAUDE.md` — component patterns
- [x] `src/app/CLAUDE.md` — pages + API routes index
- [x] `src/types/CLAUDE.md` — type definitions reference
- [x] `src/styles/CLAUDE.md` — design tokens reference

## 24. Tests

- [x] `tests/setup/index.ts` — vitest setup
- [x] `tests/lib/validations.test.ts` — 54 tests (Zod schema validation)
- [x] `tests/lib/stripe.test.ts` — 24 tests (Stripe integration)
- [x] `tests/components/Button.test.tsx` — 22 tests
- [x] `tests/components/Card.test.tsx` — 16 tests
- [x] `tests/components/Chip.test.tsx` — 13 tests
- [x] `tests/components/Badge.test.tsx` — 11 tests
- [x] `tests/components/Spinner.test.tsx` — 11 tests
- [x] `tests/hooks/useAudioPlayer.test.ts` — 28 tests
- [x] `tests/api/feed.test.ts` — 22 tests (pagination, search, tag filter, sort)
- [x] `tests/api/tags.test.ts` — 8 tests (list, shape, empty)
- [x] `tests/api/feedback.test.ts` — 27 tests (POST validation, GET list, optional fields)
- [x] `tests/workers/audio-generation.test.ts` — 28 tests (voice diversity, R2 upload, stitching queue)
- [x] `tests/workers/notification.test.ts` — 24 tests (in-app + push, error propagation)

## 25. Build & Quality

- [x] `npx tsc --noEmit` — 0 TypeScript errors
- [x] `npm run lint` — 0 errors (10 warnings)
- [x] `npm run test` — 288 tests passing (13 test files)
- [x] `npm run build` — production build succeeds (33 routes)

---

## Summary

| Category | Done | Total |
|----------|------|-------|
| Config | 16 | 16 |
| Database | 5 | 5 |
| Core Libs | 19 | 19 |
| Workers | 9 | 9 |
| Types | 7 | 7 |
| UI Components | 8 | 8 |
| Player Components | 6 | 6 |
| Layout Components | 4 | 4 |
| Discovery Components | 4 | 4 |
| Chat Components | 4 | 4 |
| Create Components | 2 | 2 |
| Feed Components | 5 | 5 |
| Profile Components | 4 | 4 |
| Pricing Components | 3 | 3 |
| Notification Components | 3 | 3 |
| Providers | 3 | 3 |
| Hooks | 5 | 5 |
| Pages | 15 | 15 |
| API Routes | 21 | 21 |
| Middleware | 1 | 1 |
| Docs | 15 | 15 |
| CLAUDE.md | 9 | 9 |
| Tests | 14 | 14 |
| Build & Quality | 4 | 4 |
| **Total** | **186** | **186** |

**All items complete. 186/186 (100%).**
