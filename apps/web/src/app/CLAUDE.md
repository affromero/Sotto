# src/app/ — Next.js App Router Pages & API Routes

## Page Index

| Path | File | Auth | Description |
|------|------|------|-------------|
| `/` | `page.tsx` | No | Landing page |
| `/@handle` | Rewrite → `profile/handle/[handle]` | No | Vanity profile URL |
| `/auth/login` | `auth/login/page.tsx` | No | OAuth sign in |
| `/auth/signup` | `auth/signup/page.tsx` | No | Create account (invite-only notice) |
| `/auth/waitlisted` | `auth/waitlisted/page.tsx` | No | Waitlisted user landing (reason-based messages) |
| `/dashboard` | `(dashboard)/dashboard/page.tsx` | Yes | My podcasts, usage |
| `/settings` | `(dashboard)/settings/page.tsx` | Yes | Profile & preferences |
| `/billing` | `(dashboard)/billing/page.tsx` | Yes | Keys & usage |
| `/analytics` | `(dashboard)/analytics/page.tsx` | Yes | Usage analytics |
| `/settings/api` | `(dashboard)/settings/api/page.tsx` | Yes | API key management |
| `/settings/voices` | `(dashboard)/settings/voices/page.tsx` | Yes | Voice clone management |
| `/ideas` | `(dashboard)/ideas/page.tsx` | Yes | Saved podcast ideas |
| `/onboarding` | `onboarding/page.tsx` | Yes | Post-signup interest + BYOK setup |
| `/create` | `create/page.tsx` | Yes | Chat-based creation + Import |
| `/podcast/[podcastId]` | `podcast/[podcastId]/page.tsx` | Mixed | Podcast player |
| `/podcast/[podcastId]/edit` | `podcast/[podcastId]/edit/page.tsx` | Yes | Edit metadata (owner) |
| `/podcast/[podcastId]/embed` | `podcast/[podcastId]/embed/page.tsx` | No | Embeddable player |
| `/feed` | `feed/page.tsx` | No | Public podcast feed |
| `/profile/[userId]` | `profile/[userId]/page.tsx` | No | User profile |
| `/collections/[id]` | `collections/[collectionId]/page.tsx` | No | Collection detail |
| `/voices` | `voices/page.tsx` | No | Voice marketplace |
| `/connect/telegram` | `connect/telegram/page.tsx` | Yes | Link Telegram account |
| `/pitch` | `pitch/page.tsx` | Password | Investor pitch deck |
| Static pages | `about`, `pricing`, `support`, `join`, `changelog`, `developers`, `privacy`, `terms`, `feedback`, `banned` | No | Public info pages |
| `/admin/*` | `(admin)/admin/*.tsx` | ADMIN | 19 admin pages (overview, users, podcasts, revenue, costs, storage, engagement, playback, pipeline, retention, waitlist, analytics, moderation, handles, config, twitter, inspire, ratings, quality, announcements, models) |
| `/admin/storage/[podcastId]` | `(admin)/admin/storage/[podcastId]/page.tsx` | ADMIN | Per-podcast data inspector: 19 sections (provider info, R2 files, script, references, segments, Q&A, discovery, tags, engagement, ratings, API costs, pipeline, ML features, voice assignments, voice tracks, segment voice map, TTS providers, completeness) |
| `not-found` / `error` | `not-found.tsx` / `error.tsx` | No | 404 + error boundary |
| `sitemap.xml` | `sitemap.ts` | No | Dynamic sitemap |

## API Route Index

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/[...nextauth]` | GET/POST | — | NextAuth handlers |
| `/api/auth/mobile` | POST | No | Mobile OAuth → API key token |
| `/api/discovery` | POST | Yes | Streaming discovery chat |
| `/api/discovery/client-error` | POST | Yes | Log client-side stream fallback errors for admin panel |
| `/api/podcasts` | GET/POST | Yes | List/create podcasts |
| `/api/podcasts/import` | POST | Yes | Import audio (multipart) |
| `/api/podcasts/[id]` | GET/PATCH/DELETE | Yes | Podcast CRUD |
| `/api/podcasts/[id]/generate` | POST | Yes | Trigger generation (BYOK) |
| `/api/podcasts/[id]/interact` | POST | Yes | Submit Q&A interaction |
| `/api/podcasts/[id]/interact/[iid]` | GET | Yes | Poll interaction status |
| `/api/podcasts/[id]/interact/[iid]/resolve` | PATCH | Yes | Resolve with feedback |
| `/api/podcasts/[id]/interact/[iid]/incorporate` | POST | Yes | Incorporate Q&A into podcast |
| `/api/podcasts/[id]/interact/[iid]/vote` | POST | Yes | Upvote Q&A |
| `/api/podcasts/[id]/knowledge-gaps` | GET | Yes | Knowledge gap aggregation |
| `/api/podcasts/[id]/questions` | GET | No | Public Q&A questions |
| `/api/podcasts/[id]/script` | GET/PATCH | Yes | Fetch/edit script turns |
| `/api/podcasts/[id]/script/approve` | POST | Yes | Approve → queue audio |
| `/api/podcasts/[id]/script/regenerate` | POST | Yes | Re-queue script generation |
| `/api/podcasts/[id]/fork` | POST | Yes | Fork podcast |
| `/api/podcasts/[id]/download` | GET | No | Download audio |
| `/api/podcasts/[id]/versions` | GET | Yes | Version history |
| `/api/podcasts/[id]/lineage` | GET | No | Fork tree |
| `/api/podcasts/[id]/like` | POST/DELETE | Yes | Like/unlike |
| `/api/podcasts/[id]/save` | POST/DELETE | Yes | Save/unsave |
| `/api/podcasts/[id]/comments` | GET/POST | Mixed | Threaded comments |
| `/api/podcasts/[id]/comments/[cid]` | DELETE | Yes | Delete comment |
| `/api/podcasts/[id]/comments/[cid]/replies` | GET | No | Comment replies |
| `/api/podcasts/[id]/rating` | GET/POST | Yes | Podcast rating (creator + listener) |
| `/api/podcasts/[id]/claims` | POST/GET | Yes | Flag/list inaccurate claims |
| `/api/podcasts/[id]/export` | POST/GET | Yes | PDF export |
| `/api/feed` | GET | No | Public feed (search/filter/sort) |
| `/api/activity` | GET | Yes | Followed users activity |
| `/api/recommendations` | GET | Yes | Similar podcasts |
| `/api/tags` | GET | No | Tag taxonomy |
| `/api/users/[id]` | GET | No | User profile |
| `/api/users/[id]/rss` | GET | No | Creator RSS feed |
| `/api/users/[id]/follow` | POST/DELETE | Yes | Follow/unfollow |
| `/api/users/[id]/followers` | GET | No | Follower list |
| `/api/users/[id]/following` | GET | No | Following list |
| `/api/users/[id]/liked` | GET | No | Liked podcasts |
| `/api/users/[id]/collections` | GET | No | User collections |
| `/api/users/[id]/activity` | GET | No | User activity |
| `/api/users/handle/[handle]/rss` | GET | No | RSS by handle |
| `/api/users/me` | GET/PATCH | Yes | Current user |
| `/api/users/me/avatar` | POST | Yes | Upload avatar |
| `/api/users/me/twitter` | GET/PATCH/DELETE | Yes | Twitter settings |
| `/api/users/discover` | GET | Opt | Search users |
| `/api/users/suggested` | GET | Yes | Suggested follows |
| `/api/oembed` | GET | No | oEmbed for embeds |
| `/api/notifications` | GET/PATCH | Yes | List/mark read |
| `/api/notifications/mark-all-read` | POST | Yes | Mark all read |
| `/api/billing/subscription` | GET | Yes | BYOK status |
| `/api/billing/usage` | GET | Yes | Generation count |
| `/api/collections` | GET/POST | Yes | Collection CRUD |
| `/api/collections/[id]` | GET/PATCH/DELETE | Yes | Single collection |
| `/api/collections/[id]/items` | GET/POST/DELETE | Yes | Collection items |
| `/api/collections/[id]/follow` | POST/DELETE | Yes | Follow collection |
| `/api/keys` | GET/POST/DELETE | Yes | API key management |
| `/api/teams/[id]` | GET/PATCH/DELETE | Yes | Team CRUD |
| `/api/stripe/connect` | GET/POST | Yes | Stripe Connect |
| `/api/stripe/webhooks` | POST | No | Stripe webhooks |
| `/api/stripe/payment-intent` | POST | Yes | Voice charges |
| `/api/voices/clone` | POST | Yes | Create voice clone |
| `/api/voices/preview` | POST | Yes | Preview voice |
| `/api/voices/allowlist` | GET/POST/DELETE | Yes | Voice allowlist |
| `/api/voices/browse` | GET | Opt | Browse voices |
| `/api/voices/hume` | GET | Yes | Browse Hume AI voice library (BYOK or platform key) |
| `/api/voices/request` | GET/POST/PATCH | Yes | Voice requests |
| `/api/tts-providers` | GET | Yes | TTS providers + BYOK |
| `/api/tts-options` | GET | Yes | TTS provider:model list |
| `/api/ai-models` | GET | Yes | AI model list |
| `/api/tts-models` | GET | Yes | TTS models by provider |
| `/api/stt-providers` | GET | Yes | STT providers |
| `/api/settings/ai-keys` | GET/POST/DELETE | Yes | AI BYOK keys |
| `/api/settings/byok` | GET/POST/DELETE | Yes | TTS BYOK keys |
| `/api/onboarding/interests` | POST | Yes | Save interests |
| `/api/inspire/all` | GET | Yes | Inspire Me sections |
| `/api/handles/check` | GET | No | Handle availability |
| `/api/connect/telegram` | GET/POST | Yes | Telegram linking |
| `/api/telegram/webhook` | POST | No | Telegram webhook |
| `/api/events` | POST | Opt | Behavioral events |
| `/api/ideas` | GET/POST/DELETE | Yes | Podcast ideas |
| `/api/picks` | GET/POST | Yes | Daily picks |
| `/api/queue` | GET/POST/DELETE/PATCH | Yes | Listening queue |
| `/api/reports` | POST | Yes | Content reports |
| `/api/taste-quiz` | GET/POST/DELETE | Yes | Taste quiz |
| `/api/waitlist` | POST | No | Waitlist signup |
| `/api/health` | GET | No | Health check |
| `/api/feedback` | POST/GET | No | Feedback |
| `/api/admin/waitlist` | PATCH | ADMIN | Approve/reject waitlist entries |
| `/api/admin/*` | Various | ADMIN | Admin endpoints (users, podcasts, config, auto-models, costs, ratings, handles, announcements, twitter, moderation, reports, claims, test-model, traffic-report) |
| `/api/admin/kittentts/health` | GET | ADMIN | Proxy to `KITTENTTS_URL/health`; returns `{ configured, status, model?, latencyMs }` |

## Route Groups

`(dashboard)/` — protected, dashboard layout. `(admin)/` — admin-only layout. `auth/` — public.

## Adding Routes

**Page**: `src/app/route-name/page.tsx` + optional `.module.css`. Add auth in `middleware.ts`.
**API**: `src/app/api/resource/route.ts` + Zod schema in `lib/validations.ts`.
