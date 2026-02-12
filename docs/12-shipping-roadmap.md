# Shipping Roadmap — What's Missing Before Launch

**Date**: February 2026
**Status**: Code-complete, not ship-ready
**Goal**: Go from "it compiles" to "people are using it"

---

## The Honest Truth

Every feature in the pivot plan is implemented. The codebase has 16 workers, 50+ API routes, 30+ components, multi-provider TTS, BYOK encryption, fork/remix culture, audio import, version history, and a full social feed.

None of it has been tested with real users.

Code-complete is not ship-ready. This roadmap covers the gap between "the code exists" and "someone tweeted @sottofm and got a podcast back."

---

## Priority Tiers

### P0 — Cannot Launch Without These

Items that will cause immediate failures, data loss, or legal liability if missing.

### P1 — Launch Blockers (Week 1)

Items that create a broken experience for the first 10 users.

### P2 — First 100 Users

Items needed before any kind of public announcement or Product Hunt launch.

### P3 — Growth Prerequisites

Items needed before spending money on acquisition.

---

## P0: Cannot Launch Without These

### 1. Database Migration on Production

**Status**: Schema changes exist locally, not pushed to production.

The entire pivot added: `PodcastVersion`, `PodcastVersionSegment`, `UserTtsKey`, `BehavioralEvent`, `RecommendationLog`, `POWER` tier enum, `IMPORT` source enum, `IMPORTING`/`TRANSCRIBING` status enums, 8+ new Podcast fields, Voice Creator addon fields.

**Action**:

```bash
npx prisma db push    # Push schema to production PostgreSQL
npx prisma generate   # Regenerate client
```

**Risk**: If production has data, `db push` may fail on non-nullable fields without defaults. Audit each new field:

- `Podcast.currentVersion` — default 1 ✅
- `Podcast.forkCount` — default 0 ✅
- `Podcast.isHumanContent` — default false ✅
- `Podcast.ttsProvider` — nullable ✅
- `User.elevenLabsApiKey` — nullable ✅

**Estimate**: 30 minutes (including verification)

---

### 2. Missing Database Indexes

**Status**: 4 new frequently-queried fields lack indexes.

| Field                    | Used By                      | Impact Without Index               |
| ------------------------ | ---------------------------- | ---------------------------------- |
| `Podcast.forkCount`      | Feed "Most Forked" sort      | Full table scan on every feed load |
| `Podcast.isHumanContent` | Content-type badge filtering | Full scan on feed filter           |
| `Podcast.source`         | Import vs AI filtering       | Already indexed via status? Verify |
| `Podcast.ttsProvider`    | Admin cost analytics         | Slow admin queries (acceptable)    |

**Action**: Add to `prisma/schema.prisma`:

```prisma
@@index([forkCount])
@@index([source])
```

`isHumanContent` and `ttsProvider` can wait — they're only used in filtered queries that already hit other indexes first.

**Estimate**: 15 minutes

---

### 3. Stripe POWER Tier Product

**Status**: `TIER_LIMITS.POWER` exists in code. No Stripe product/price created.

The checkout route maps `env.STRIPE_PRICE_ID_*` to tiers. POWER tier has no price ID env var, so users literally cannot subscribe to it.

**Action**:

1. Create Stripe product "Sotto Power" ($9/mo, recurring)
2. Add `STRIPE_PRICE_ID_POWER` to `.env` and production environment
3. Add price-to-tier mapping in webhook handler
4. Test full subscribe → webhook → tier upgrade flow

**Estimate**: 1 hour

---

### 4. Legal Pages

**Status**: None exist. No Terms of Service, no Privacy Policy.

Users upload voice recordings, provide email/OAuth identity, create public content, and share podcasts. Without legal pages:

- Apple/Google reject PWA from app stores
- Stripe can freeze the account
- GDPR/CCPA violations from day 1

**Action**:

1. Create `/terms` and `/privacy` pages
2. Cover: user-generated content license, voice data handling, BYOK key storage, data retention, GDPR rights
3. Add consent checkbox on signup
4. Link from footer

**Estimate**: 4 hours (using a template + legal review)

---

### 5. Health Check: Register New Queues

**Status**: `/api/health` monitors 12 of 16 queues. Missing: `event-ingestion`, `feature-computation`, `data-export`, `audio-import`.

If the audio-import queue dies, imported podcasts silently hang at IMPORTING forever. Nobody gets alerted.

**Action**: Add 4 missing queue names to health check queue list.

**Estimate**: 15 minutes

---

## P1: Launch Blockers (Week 1)

### 6. Twitter @sottofm Bot Activation

**Status**: Code is complete and production-ready. Bot is not running.

The twitter-mentions worker polls every 60 seconds. The twitter-reply worker posts responses. Both are registered in the worker index. But:

- Twitter API credentials may not be configured in production env
- The bot has never processed a real mention end-to-end
- Rate limits haven't been tested under load
- Error recovery hasn't been verified (what happens when ElevenLabs is down mid-generation from a tweet?)

**Action**:

1. Verify all Twitter env vars are set in production:
   - `TWITTER_BEARER_TOKEN` (read access)
   - `TWITTER_API_KEY` / `TWITTER_API_SECRET` (OAuth 1.0a)
   - `TWITTER_ACCESS_TOKEN` / `TWITTER_ACCESS_SECRET` (@sottofm bot)
   - `TWITTER_SOTTO_USER_ID` (numeric ID)
2. Test end-to-end: tweet @sottofm → mention detected → podcast generated → reply posted
3. Test error paths: tweet with profanity, tweet from unlinked user (CTA), tweet when user has 0 credits
4. Monitor first 24 hours of live mentions

**Estimate**: 2 hours (setup) + 1 day (monitoring)

---

### 7. API Rate Limiting

**Status**: Only the password gate has rate limiting. All other endpoints are unprotected.

A single user (or bot) can:

- Hit `/api/podcasts` POST repeatedly (1 credit each, but if free tier has 3 credits, they burn through in seconds)
- Spam `/api/discovery` (streaming Claude calls at $0.003-0.006 each, no credit cost)
- Flood `/api/podcasts/import` with large files
- DDoS `/api/feed` (public, no auth)

**Action**:

1. Add rate limiting middleware using existing `checkRateLimit()` Redis helper:
   - `/api/discovery`: 30 req/min per user
   - `/api/podcasts` POST: 10 req/min per user
   - `/api/podcasts/import`: 5 req/min per user
   - `/api/feed`: 60 req/min per IP
   - `/api/podcasts/*/interact`: 20 req/min per user
2. Return 429 with `Retry-After` header

**Estimate**: 2 hours

---

### 8. Error Tracking (Sentry)

**Status**: Not configured. Errors go to stdout only.

In production, if a worker crashes at 3am, nobody knows until a user complains. The health check catches queue-level issues but not per-request errors.

**Action**:

1. `npm install @sentry/nextjs`
2. Configure `sentry.client.config.ts`, `sentry.server.config.ts`
3. Add `SENTRY_DSN` to production env
4. Wrap worker entry points with Sentry error capture
5. Set up Sentry alerts for error spikes

**Estimate**: 1 hour

---

### 9. End-to-End Smoke Test

**Status**: Zero automated tests. Zero manual test scripts.

The entire generation pipeline (discovery → script → verify → validate refs → TTS → stitch → notify) has never been tested end-to-end on production infrastructure.

**Action**:

1. Write a manual test script covering:
   - Create account → onboarding → create podcast → wait for READY → play
   - Import audio → wait for READY → verify transcript
   - Fork a podcast with remix note → verify attribution
   - Ask question during playback → incorporate → verify version history
   - Subscribe to Starter → verify credit balance
   - BYOK: store key → generate with user's key → verify API logs
   - Twitter: tweet @sottofm → verify reply
2. Run on staging environment
3. Fix whatever breaks

**Estimate**: 1 full day

---

### 10. Email: At Minimum, Transactional

**Status**: No email capability. Only push notifications + in-app.

Push notifications require the user to have granted permission AND be on a supported browser. For the first 10 users, most won't have push enabled. They'll generate a podcast and never know it's ready.

**Action** (minimum viable):

1. Add Resend or SendGrid (`npm install resend`)
2. Send email on: podcast ready, podcast failed, team invite
3. Add `EMAIL_FROM`, `RESEND_API_KEY` env vars
4. Template: simple text email with podcast link

**Estimate**: 3 hours

---

## P2: First 100 Users

### 11. Sitemap Generation

**Status**: `robots.txt` references `sitemap.xml` but it doesn't exist.

Google can't index public podcasts, profiles, or feed without a sitemap. This kills organic discovery.

**Action**: Create `src/app/sitemap.ts` (Next.js dynamic sitemap):

- Static pages: `/`, `/feed`, `/pricing`
- Dynamic: `/podcast/[id]` for all PUBLIC+READY podcasts
- Dynamic: `/profile/handle/[handle]` for all users with handles
- Regenerate daily

**Estimate**: 1 hour

---

### 12. PWA Icon Set

**Status**: Only 64x64 favicon. Android/iOS require larger icons.

Users who "Add to Home Screen" get a blurry or missing icon.

**Action**:

1. Generate icon set: 192x192, 512x512, apple-touch-icon (180x180)
2. Add maskable icon variant
3. Update `manifest.json` with full icon array

**Estimate**: 30 minutes (with existing logo)

---

### 13. Content Moderation Pipeline

**Status**: Handle profanity screening exists (LLM-based). No content moderation for podcasts.

A user could generate a podcast about harmful content. The script generator has safety prompts, but there's no post-generation review or flagging system.

**Action**:

1. Add content flags to script-verification worker (already does claim checking — add safety check)
2. Auto-flag podcasts with sensitive topics for admin review
3. Add "Report" button on podcast pages
4. Admin moderation queue already exists at `/admin/moderation` — wire up flagged content

**Estimate**: 4 hours

---

### 14. Monitoring Dashboard

**Status**: Health endpoint exists. No dashboard or alerting.

**Action**:

1. Set up UptimeRobot or Better Stack for `/api/health` polling (5 min intervals)
2. Alert on: health degraded, response time > 5s, 5xx error spike
3. Worker monitoring: alert when any queue has > 10 failed jobs

**Estimate**: 1 hour

---

### 15. STT_PROVIDER Environment Variable

**Status**: `stt.ts` uses OpenAI Whisper but `STT_PROVIDER` isn't in `.env.example`.

Import pipeline works but the provider isn't documented or configurable.

**Action**: Add `STT_PROVIDER=openai` to `.env.example` with comment.

**Estimate**: 5 minutes

---

## P3: Growth Prerequisites

### 16. Automated Test Suite

**Status**: DONE. 97 test files with 2196 tests passing (vitest). `npm run ci` runs lint + tsc + test + build, mirroring the GitHub Actions CI pipeline.

Coverage includes: lib unit tests (credits, stripe, claude, script-generator, reference-validator, audio-stitcher, etc.), API route tests (fork, billing, discovery, feed, podcasts CRUD, webhooks), component tests (AudioPlayer, MiniPlayer, DiscoveryChat, FeedGrid, etc.), worker tests (script-generation, audio-generation, audio-stitching, twitter-mentions, etc.), hook tests, and 2 integration tests (generation pipeline, auth flow).

**Remaining**: Expand coverage for edge cases and add more integration tests as new features land.

---

### 17. Analytics & Attribution

**Status**: `BehavioralEvent` model exists. No analytics dashboard for growth metrics.

Need to know: Where do users come from? What's the create-to-share conversion? How many forks per podcast?

**Action**:

1. Wire up event tracking for key actions (create, fork, share, import, subscribe)
2. Build admin analytics view (or integrate PostHog/Mixpanel)
3. Track Twitter → signup → first podcast funnel

**Estimate**: 1-2 days

---

### 18. Social Sharing OG Images

**Status**: DONE.

Dynamic OG images implemented via `next/og` (Satori):

- `src/app/podcast/[podcastId]/opengraph-image.tsx` — 1200x630, cream background (#FEFCF8), amber accent bar, podcast title, creator name, duration
- `src/app/podcast/[podcastId]/twitter-image.tsx` — re-exports from opengraph-image
- `src/app/profile/[userId]/opengraph-image.tsx` — navy accent (#1E3A5F), user name, bio, podcast count, follower count
- `og:audio` metadata on podcast pages (links to audioUrl when available)
- `twitter:card: summary_large_image` on podcast pages
- oEmbed endpoint at `/api/oembed` linked via `<link rel="alternate">` for embed discovery

---

### 19. Mobile App (PWA Improvements)

**Status**: Basic PWA manifest. No offline support, no install prompt.

**Action**:

1. Service worker for offline audio playback (cache playing podcast)
2. Install prompt component ("Add Sotto to Home Screen")
3. Offline fallback page
4. Background audio playback improvements

**Estimate**: 2-3 days

---

### 20. Creator Monetization (Deferred)

**Status**: Not built. Listed as "vaporware" in post-pivot analysis.

Until there's traction (1000+ WAU), building monetization is premature. But the promise of creator economics is part of the social platform pitch.

**Action** (when ready):

- Tip jar (Stripe Connect)
- Premium podcast access (per-creator paywall)
- Revenue share on forked content

**Estimate**: 2-3 weeks (when prioritized)

---

## Ship-by-Date Planner

### Week 1: "It Works" (P0 + Critical P1)

| Day | Task                                               | Est. |
| --- | -------------------------------------------------- | ---- |
| Mon | Database migration + indexes + health check queues | 1h   |
| Mon | Stripe POWER product + env vars                    | 1h   |
| Mon | Rate limiting on critical endpoints                | 2h   |
| Tue | Twitter @sottofm bot activation + end-to-end test  | 3h   |
| Tue | Sentry error tracking setup                        | 1h   |
| Wed | End-to-end smoke test (full pipeline)              | 8h   |
| Thu | Fix whatever broke during smoke test               | 4h   |
| Thu | Legal pages (Terms + Privacy)                      | 4h   |
| Fri | Transactional email (podcast ready)                | 3h   |
| Fri | STT_PROVIDER env var + documentation               | 15m  |

**Total**: ~27 hours across 5 days

### Week 2: "It's Ready for People" (P2)

| Day     | Task                               | Est. |
| ------- | ---------------------------------- | ---- |
| Mon     | Sitemap generation                 | 1h   |
| Mon     | PWA icon set                       | 30m  |
| Mon     | Monitoring dashboard (UptimeRobot) | 1h   |
| Tue     | Content moderation pipeline        | 4h   |
| Wed     | Invite 10 beta testers, observe    | —    |
| Thu-Fri | Fix bugs from beta feedback        | —    |

**Total**: ~7 hours + beta observation

### Week 3: "Tell the World" (P3 start)

| Task                                  | Est.   |
| ------------------------------------- | ------ |
| Automated test suite (critical paths) | 2 days |
| ~~Social sharing OG images~~          | DONE   |
| Analytics setup                       | 1 day  |

---

## The One Thing That Matters Most

Everything above is infrastructure. The actual shipping blocker is:

**Has a real person, who isn't you, successfully created a podcast, shared it, and had someone else fork it?**

If the answer is no, nothing else matters. Get 5 people using it this week. The bugs they find are more valuable than any test suite.

---

## Feature Completeness vs Ship-Readiness

| Category                    | Code Complete | Ship Ready | Gap                                                                                        |
| --------------------------- | :-----------: | :--------: | ------------------------------------------------------------------------------------------ |
| Podcast generation pipeline |      ✅       |     ⚠️     | Needs smoke test on prod                                                                   |
| Twitter @sottofm bot        |      ✅       |     ❌     | Needs activation + E2E test                                                                |
| Audio import                |      ✅       |     ⚠️     | Needs smoke test                                                                           |
| BYOK multi-provider TTS     |      ✅       |     ⚠️     | Needs Stripe POWER product                                                                 |
| Fork/remix flow             |      ✅       |     ✅     | Working (credit check, synthetic Discovery, pipeline enqueue, PODCAST_FORKED notification) |
| Version history             |      ✅       |     ⚠️     | Needs smoke test                                                                           |
| Feed + social               |      ✅       |     ✅     | Working                                                                                    |
| Landing page                |      ✅       |     ✅     | Working                                                                                    |
| Pricing page                |      ✅       |     ⚠️     | POWER tier not purchasable                                                                 |
| Auth + profiles             |      ✅       |     ✅     | Working                                                                                    |
| Push notifications          |      ✅       |     ✅     | Working                                                                                    |
| Voice clones + allowlist    |      ✅       |     ⚠️     | Needs TTS provider keys                                                                    |
| Admin dashboard             |      ✅       |     ✅     | Working                                                                                    |
| CI/CD + deploy              |      ✅       |     ✅     | Working                                                                                    |
| Rate limiting               |      ❌       |     ❌     | Not implemented                                                                            |
| Error tracking              |      ❌       |     ❌     | Not implemented                                                                            |
| Email notifications         |      ❌       |     ❌     | Not implemented                                                                            |
| Legal pages                 |      ❌       |     ❌     | Not implemented                                                                            |
| Automated tests             |      ✅       |     ✅     | 97 files, 2196 tests passing (vitest + npm run ci)                                         |
| Social sharing OG images    |      ✅       |     ✅     | Dynamic per-podcast + per-profile OG images                                                |
| Embeddable player           |      ✅       |     ✅     | iframe embed at /podcast/[id]/embed + oEmbed endpoint                                      |
| RSS feeds                   |      ✅       |     ✅     | Per-creator RSS at /api/users/[userId]/rss                                                 |
| Interrupt Q&A               |      ✅       |     ⚠️     | Full InterruptChatPanel lifecycle with resolution feedback — needs smoke test              |
| Knowledge gap aggregation   |      ✅       |     ⚠️     | Per-segment question density badges for owners — needs smoke test                          |
| Sitemap                     |      ❌       |     ❌     | Not implemented                                                                            |
