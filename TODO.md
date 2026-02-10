# Sotto — Implementation Status

> Last updated: 2026-02-10 — **277 items (277 complete + 0 remaining)**

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
- [x] `queue.ts` — BullMQ 11 queue types with typed payloads
- [x] `auth.ts` — NextAuth v5 config (Google, GitHub, Twitter providers)
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
- [x] `validations.ts` — Zod schemas (discovery, podcast, interaction, profile, feed, twitter)
- [x] `logger.ts` — structured logger
- [x] `twitter.ts` — Twitter API v2 client (mentions, tweets, replies, OAuth 1.0a)
- [x] `tweet-parser.ts` — Claude-based tweet intent extraction
- [x] `CLAUDE.md` — documentation

## 4. Workers (`src/workers/`)

- [x] `index.ts` — orchestrator (11 workers, graceful shutdown)
- [x] `content-extraction.worker.ts`
- [x] `script-generation.worker.ts`
- [x] `audio-generation.worker.ts`
- [x] `audio-stitching.worker.ts`
- [x] `interaction.worker.ts`
- [x] `segment-regeneration.worker.ts`
- [x] `notification.worker.ts`
- [x] `twitter-mentions.worker.ts` — poll @sottofm mentions, parse intent, create podcast
- [x] `twitter-reply.worker.ts` — reply to tweet when podcast is ready
- [x] `CLAUDE.md` — documentation

## 5. Types (`src/types/`)

- [x] `podcast.ts` — PodcastSummary, PodcastDetail, SegmentData, CreatePodcastRequest
- [x] `player.ts` — PlayerState, PlayerControls
- [x] `interaction.ts` — InteractionRequest, InteractionResponse, ResolutionChoice
- [x] `feed.ts` — FeedResponse, FeedSort, FeedFilters
- [x] `discovery.ts` — DiscoveryMessage, DiscoveryMetadata, DiscoveryState
- [x] `notification.ts` — NotificationData, PushSubscriptionData
- [x] `twitter.ts` — TweetParseResult, TwitterTweet, TwitterMention, TwitterSettingsData, TweetMentionData
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

## 16b. Settings Components (`src/components/settings/`)

- [x] `VoicePreferenceSelector.tsx` + `.module.css` — voice preference dropdowns for Twitter integration

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
- [x] `users/me/twitter/route.ts` — Twitter settings API (GET/PATCH/DELETE)

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
- [x] `tests/lib/tweet-parser.test.ts` — 13 tests (intent extraction, JSON parsing, error handling)
- [x] `tests/workers/twitter-mentions.test.ts` — 11 tests (polling, dedup, user lookup, pipeline kick-off)
- [x] `tests/workers/twitter-reply.test.ts` — 14 tests (reply composition, 280-char limit, failure handling)
- [x] `tests/api/twitter-settings.test.ts` — 15 tests (GET/PATCH/DELETE, validation, disconnect)
- [x] `tests/lib/twitter-validations.test.ts` — 24 tests (twitterSettingsSchema, updated createPodcastSchema)

## 25. Build & Quality

- [x] `npx tsc --noEmit` — 0 TypeScript errors
- [x] `npm run lint` — 0 errors (11 warnings)
- [x] `npm run test` — 365 tests passing (18 test files)
- [x] `npm run build` — production build succeeds (33 routes)

---

## Summary

| Category                | Done    | Total   |
| ----------------------- | ------- | ------- |
| Config                  | 16      | 16      |
| Database                | 5       | 5       |
| Core Libs               | 21      | 21      |
| Workers                 | 11      | 11      |
| Types                   | 8       | 8       |
| UI Components           | 8       | 8       |
| Player Components       | 6       | 6       |
| Layout Components       | 4       | 4       |
| Discovery Components    | 4       | 4       |
| Chat Components         | 4       | 4       |
| Create Components       | 2       | 2       |
| Feed Components         | 5       | 5       |
| Profile Components      | 4       | 4       |
| Pricing Components      | 3       | 3       |
| Notification Components | 3       | 3       |
| Settings Components     | 1       | 1       |
| Providers               | 3       | 3       |
| Hooks                   | 5       | 5       |
| Pages                   | 15      | 15      |
| API Routes              | 22      | 22      |
| Middleware              | 1       | 1       |
| Docs                    | 15      | 15      |
| CLAUDE.md               | 9       | 9       |
| Tests (existing)        | 19      | 19      |
| Tests (backlog)         | 0       | 63      |
| Build & Quality         | 4       | 4       |
| Completed Work          | 12      | 12      |
| **Total**               | **214** | **277** |

## 26. Completed Work

- [x] **Wire OAuth buttons** — `src/app/auth/AuthButtons.tsx` shared client component with `signIn()` calls for Google/GitHub
- [x] **Edit podcast page** — `src/app/podcast/[podcastId]/edit/` with EditPodcastForm (title, topic, visibility)
- [x] **Fork confirmation modal** — Modal component with confirm/cancel before forking
- [x] **Integration tests** — `tests/integration/generation-pipeline.test.ts` and `auth-flow.test.ts`
- [x] **Mobile responsiveness audit** — 320px breakpoints for player, teleprompter, discovery chat
- [x] **Error recovery paths** — FAILED status retry in generate API, retry button in player view, dashboard hint
- [x] **Citation/reference UI polish** — VerificationBadge, expandable 4-layer details per reference
- [x] **Team management** — Full CRUD: create team, invite members, accept/revoke invites, remove members
- [x] **API access tier** — ApiKey model, `sk_sotto_` keys with SHA-256, Bearer token auth on podcast routes
- [x] **Analytics dashboard** — Period selector, stat cards, CSS-only BarChart + TimeSeriesChart
- [x] **Advanced discovery filters** — FilterPanel with depth, audience, tone, duration range, date range
- [x] **Twitter @sottofm integration** — Tweet-to-podcast pipeline (mention polling, intent parsing, reply posting, settings UI, OAuth)

## 27. Test Backlog

Comprehensive tests to add for full coverage across the app.

### API Route Tests

- [x] `tests/api/discovery.test.ts` — SSE streaming discovery chat (auth, message validation, streaming response format)
- [x] `tests/api/podcasts-crud.test.ts` — podcast list, create, get, update, delete (auth, ownership, validation)
- [x] `tests/api/podcasts-generate.test.ts` — trigger generation (status checks, tier limits, duplicate prevention)
- [x] `tests/api/podcasts-interact.test.ts` — submit interaction (timestamp validation, question length, podcast status checks)
- [x] `tests/api/podcasts-fork.test.ts` — fork podcast (auth, source podcast validation, visibility rules)
- [x] `tests/api/podcasts-like.test.ts` — like/unlike (toggle behavior, auth, duplicate handling)
- [x] `tests/api/podcasts-save.test.ts` — save/unsave (toggle behavior, auth, duplicate handling)
- [x] `tests/api/podcasts-export.test.ts` — PDF export trigger + status check (auth, podcast ownership)
- [x] `tests/api/users-profile.test.ts` — user profile endpoint (public access, includes podcasts/follows)
- [x] `tests/api/users-follow.test.ts` — follow/unfollow (auth, self-follow prevention, toggle behavior)
- [x] `tests/api/users-me.test.ts` — current user GET/PATCH (auth, validation, profile update)
- [x] `tests/api/notifications.test.ts` — list + mark read + mark all read (auth, pagination, ownership)
- [x] `tests/api/recommendations.test.ts` — similar podcast search (auth, query validation, result format)
- [x] `tests/api/billing-checkout.test.ts` — Stripe checkout session creation (tier validation, auth)
- [x] `tests/api/billing-portal.test.ts` — Stripe customer portal (auth, customer validation)
- [x] `tests/api/billing-subscription.test.ts` — subscription details endpoint (auth, tier data)
- [x] `tests/api/billing-usage.test.ts` — usage tracking endpoint (auth, period filtering)
- [x] `tests/api/keys.test.ts` — API key CRUD (create, list, revoke, auth, tier limits)
- [x] `tests/api/teams.test.ts` — team CRUD + invite flow (create, update, delete, membership)
- [x] `tests/api/voices.test.ts` — voice clone + preview (auth, file upload, tier limits)
- [x] `tests/api/webhooks-stripe.test.ts` — Stripe webhook handler (signature verification, event types)

### Worker Tests

- [x] `tests/workers/content-extraction.test.ts` — URL/PDF extraction (URL parsing, content limits, pipeline chaining)
- [x] `tests/workers/script-generation.test.ts` — script generation (Claude prompt, reference extraction, segment creation)
- [x] `tests/workers/reference-validation.test.ts` — 4-layer verification (URL HEAD, CrossRef, OpenAlex, AI fallback)
- [x] `tests/workers/audio-stitching.test.ts` — FFmpeg concat (segment ordering, normalization, R2 upload, Twitter reply trigger)
- [x] `tests/workers/interaction.test.ts` — Q&A processing (Claude context, timestamp lookup, resolution flow)
- [x] `tests/workers/segment-regeneration.test.ts` — segment insertion (reordering, TTS, re-stitch trigger)
- [x] `tests/workers/pdf-generation.test.ts` — PDF creation (pdfmake, R2 upload, URL update)

### Lib Tests

- [x] `tests/lib/claude.test.ts` — Claude client (streaming, non-streaming, error handling, retries)
- [x] `tests/lib/elevenlabs.test.ts` — ElevenLabs TTS (voice selection, voice pool diversity, generation, cloning)
- [x] `tests/lib/r2.test.ts` — R2 storage (upload, download, presign, delete, error handling)
- [x] `tests/lib/redis.test.ts` — Redis client (cache helpers, rate limiting, connection management)
- [x] `tests/lib/discovery-agent.test.ts` — discovery chat (system prompt, chip parsing, metadata extraction)
- [x] `tests/lib/script-generator.test.ts` — script generation (prompt construction, citation parsing, voice assignment)
- [x] `tests/lib/reference-validator.test.ts` — reference verification (URL HEAD, CrossRef, OpenAlex, AI, status transitions)
- [x] `tests/lib/script-updater.test.ts` — citation cleanup (renumbering after removal, segment text updates)
- [x] `tests/lib/audio-stitcher.test.ts` — FFmpeg stitching (concat, normalization, error handling)
- [x] `tests/lib/content-parser.test.ts` — content extraction (URL fetch, PDF parsing, length limits)
- [x] `tests/lib/recommendations.test.ts` — similar podcast search (full-text query, ranking, dedup)
- [x] `tests/lib/push-notifications.test.ts` — Web Push (send, expired subscription cleanup, payload format)
- [x] `tests/lib/subscription.test.ts` — tier management (limits per tier, usage increment, canCreate logic)
- [x] `tests/lib/notifications.test.ts` — in-app notifications (create, types, user targeting)
- [x] `tests/lib/api-keys.test.ts` — API key lifecycle (generate, hash, validate, revoke, prefix matching)
- [x] `tests/lib/pdf-generator.test.ts` — PDF generation (pdfmake doc definition, references, formatting)
- [x] `tests/lib/twitter.test.ts` — Twitter API client (getMentions, getTweet, replyToTweet, OAuth sig, rate limits)
- [x] `tests/lib/citation-parser.test.ts` — citation parsing (`[N]` markers → React components, edge cases)

### Component Tests

- [x] `tests/components/Input.test.tsx` — Input component (label, error, helper text, forwardRef, variants)
- [x] `tests/components/Modal.test.tsx` — Modal (open/close, escape key, overlay click, focus trap)
- [x] `tests/components/Toast.test.tsx` — Toast (auto-dismiss, variants, animation, stacking)
- [x] `tests/components/AudioPlayer.test.tsx` — full player (play/pause, progress, speed, volume)
- [x] `tests/components/MiniPlayer.test.tsx` — persistent player (minimize, expand, track info)
- [x] `tests/components/InterruptButton.test.tsx` — ask question button (glow animation, disabled states)
- [x] `tests/components/TranscriptPanel.test.tsx` — transcript (speaker labels, auto-scroll, timestamp sync)
- [x] `tests/components/DiscoveryChat.test.tsx` — discovery chat (message flow, chip selection, metadata)
- [x] `tests/components/PodcastCard.test.tsx` — feed card (image, title, creator, like/save, click)
- [x] `tests/components/FeedGrid.test.tsx` — responsive grid (layout, pagination, loading states)
- [x] `tests/components/Sidebar.test.tsx` — sidebar navigation (active state, collapse, mobile)
- [x] `tests/components/VoicePreferenceSelector.test.tsx` — voice dropdown (loading, selection, auto-assign)

### Hook Tests

- [x] `tests/hooks/usePodcast.test.ts` — podcast fetching (like/save/fork actions, loading states, errors)
- [x] `tests/hooks/useDiscovery.test.ts` — discovery SSE streaming (connection, messages, metadata)
- [x] `tests/hooks/useNotifications.test.ts` — notification polling (fetch, mark read, badge count)
- [x] `tests/hooks/useAuth.test.ts` — auth convenience hook (session data, loading, redirect)

**277/277 items complete. All tests written and passing.**

---

## 28. Voice Marketplace (Future)

- [ ] Revenue sharing — voice owners earn credits/money when others use their voice (Stripe Connect)
- [ ] Voice discovery page — browse/search public requestable voices by genre, accent, gender
- [ ] Voice ratings/reviews — users rate shared voices after using them
- [ ] Voice usage analytics — dashboard showing how many times each voice was used, by whom
- [ ] Allowlist entry cap — limit to 50 entries per voice to prevent abuse
- [ ] Follower-only filter — voice owner can restrict allowlist to followers only
- [ ] Script review before audio generation — manual review step at REVIEWING_SCRIPT status (if revisited should be redesigned from scratch)
- [ ] Voice clone moderation queue — admin approval before new voices go live
- [ ] Dedicated voice types file — `src/types/voice.ts` consolidating inline types from VoiceManager/VoicePicker
