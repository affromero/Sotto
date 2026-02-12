# src/app/ — Next.js App Router Pages & API Routes

## Page Index

| Path                         | File                                       | Auth Required               | Description                                              |
| ---------------------------- | ------------------------------------------ | --------------------------- | -------------------------------------------------------- |
| `/`                          | `page.tsx`                                 | No                          | Full landing page — Create. Fork. Share.                 |
| `/romero`                    | `romero/page.tsx`                          | No                          | Redirects to `/`                                         |
| `/auth/login`                | `auth/login/page.tsx`                      | No                          | Sign in with OAuth                                       |
| `/auth/signup`               | `auth/signup/page.tsx`                     | No                          | Create account                                           |
| `/dashboard`                 | `(dashboard)/dashboard/page.tsx`           | Yes                         | My podcasts, usage                                       |
| `/settings`                  | `(dashboard)/settings/page.tsx`            | Yes                         | Profile & preferences                                    |
| `/billing`                   | `(dashboard)/billing/page.tsx`             | Yes                         | Subscription management                                  |
| `/analytics`                 | `(dashboard)/analytics/page.tsx`           | Yes                         | Usage analytics dashboard                                |
| `/settings/api`              | `(dashboard)/settings/api/page.tsx`        | Yes                         | API key management                                       |
| `/settings/voices`           | `(dashboard)/settings/voices/page.tsx`     | Yes                         | Voice clone management                                   |
| `/team`                      | `(dashboard)/team/page.tsx`                | Yes                         | Team management                                          |
| `/team/invite/[token]`       | `(dashboard)/team/invite/[token]/page.tsx` | Yes                         | Accept team invite                                       |
| `/onboarding`                | `onboarding/page.tsx`                      | Yes                         | Post-signup interest selection (skippable)               |
| `/create`                    | `create/page.tsx`                          | Yes                         | Chat-based creation + Import tab + TTS provider selector |
| `/podcast/[podcastId]`       | `podcast/[podcastId]/page.tsx`             | No (public) / Yes (private) | Podcast player                                           |
| `/podcast/[podcastId]/embed` | `podcast/[podcastId]/embed/page.tsx`       | No                          | Embeddable player (noindex, iframe-friendly)             |
| `/feed`                      | `feed/page.tsx`                            | No                          | Public podcast feed                                      |
| `/profile/[userId]`          | `profile/[userId]/page.tsx`                | No                          | User profile (by ID)                                     |
| `/profile/handle/[handle]`   | `profile/handle/[handle]/page.tsx`         | No                          | User profile by handle (vanity URL)                      |
| `/pricing`                   | `pricing/page.tsx`                         | No                          | Pricing tiers                                            |
| `/feedback`                  | `feedback/page.tsx`                        | No                          | Feedback form (early access)                             |
| `/admin`                     | `(admin)/admin/page.tsx`                   | Yes (ADMIN only)            | Admin overview dashboard                                 |
| `/admin/users`               | `(admin)/admin/users/page.tsx`             | Yes (ADMIN only)            | User management + role assignment                        |
| `/admin/podcasts`            | `(admin)/admin/podcasts/page.tsx`          | Yes (ADMIN only)            | Podcast management                                       |
| `/admin/waitlist`            | `(admin)/admin/waitlist/page.tsx`          | Yes (ADMIN only)            | Waitlist entries + CSV export                            |
| `/admin/analytics`           | `(admin)/admin/analytics/page.tsx`         | Yes (ADMIN only)            | Site analytics (page views, visitors, devices)           |
| `/admin/moderation`          | `(admin)/admin/moderation/page.tsx`        | Yes (ADMIN only)            | Failed podcasts + feedback review                        |
| `/admin/handles`             | `(admin)/admin/handles/page.tsx`           | Yes (ADMIN only)            | Reserved handle management                               |

## API Route Index

| Endpoint                                                         | Method           | Auth       | Description                                                                 |
| ---------------------------------------------------------------- | ---------------- | ---------- | --------------------------------------------------------------------------- |
| `/api/auth/[...nextauth]`                                        | GET/POST         | —          | NextAuth handlers                                                           |
| `/api/discovery`                                                 | POST             | Yes        | Streaming discovery chat                                                    |
| `/api/podcasts`                                                  | GET/POST         | Yes        | List/create podcasts                                                        |
| `/api/podcasts/import`                                           | POST             | Yes        | Import audio podcast (multipart upload, 0.5 credits)                        |
| `/api/podcasts/[podcastId]`                                      | GET/PATCH/DELETE | Yes        | Single podcast CRUD                                                         |
| `/api/podcasts/[podcastId]/generate`                             | POST             | Yes        | Trigger generation (consumes credit via credits.ts)                         |
| `/api/podcasts/[podcastId]/interact`                             | POST             | Yes        | Submit Q&A interaction (tier-based limit enforced)                          |
| `/api/podcasts/[podcastId]/interact/[interactionId]`             | GET              | Yes        | Get single interaction (for polling until ANSWERED)                         |
| `/api/podcasts/[podcastId]/interact/[interactionId]/resolve`     | PATCH            | Yes        | Resolve interaction with helpful/unhelpful feedback                         |
| `/api/podcasts/[podcastId]/interact/[interactionId]/incorporate` | POST             | Yes        | Incorporate answered Q&A into podcast (generates segment, queues re-stitch) |
| `/api/podcasts/[podcastId]/knowledge-gaps`                       | GET              | Yes        | Knowledge gap aggregation by segment (owner/admin only)                     |
| `/api/podcasts/[podcastId]/fork`                                 | POST             | Yes        | Fork a podcast (credit check, Discovery, pipeline enqueue, notification)    |
| `/api/podcasts/[podcastId]/download`                             | GET              | No         | Download podcast audio (Content-Disposition: attachment)                    |
| `/api/podcasts/[podcastId]/versions`                             | GET              | Yes        | List podcast version history                                                |
| `/api/podcasts/[podcastId]/lineage`                              | GET              | No         | Fork tree traversal (ancestors + descendants)                               |
| `/api/podcasts/[podcastId]/like`                                 | POST/DELETE      | Yes        | Like/unlike                                                                 |
| `/api/podcasts/[podcastId]/save`                                 | POST/DELETE      | Yes        | Save/unsave                                                                 |
| `/api/podcasts/[podcastId]/export`                               | POST/GET         | Yes        | Trigger PDF generation / check status                                       |
| `/api/feed`                                                      | GET              | No         | Public feed with search/filter/sort (includes most_forked, remixes mode)    |
| `/api/recommendations`                                           | GET              | Yes        | Search similar podcasts                                                     |
| `/api/tags`                                                      | GET              | No         | Tag taxonomy                                                                |
| `/api/users/[userId]`                                            | GET              | No         | User profile                                                                |
| `/api/users/[userId]/rss`                                        | GET              | No         | Per-creator RSS 2.0 feed (public podcasts)                                  |
| `/api/users/[userId]/follow`                                     | POST/DELETE      | Yes        | Follow/unfollow                                                             |
| `/api/users/handle/[handle]/rss`                                 | GET              | No         | Per-creator RSS feed (resolved by handle)                                   |
| `/api/oembed`                                                    | GET              | No         | oEmbed 1.0 JSON for podcast embeds                                          |
| `/api/notifications`                                             | GET              | Yes        | List notifications                                                          |
| `/api/notifications/[notificationId]`                            | PATCH            | Yes        | Mark notification read                                                      |
| `/api/notifications/mark-all-read`                               | POST             | Yes        | Mark all read                                                               |
| `/api/analytics`                                                 | GET              | Yes        | Usage analytics data                                                        |
| `/api/billing/checkout`                                          | POST             | Yes        | Stripe checkout (subscriptions + credit packs)                              |
| `/api/billing/portal`                                            | POST             | Yes        | Stripe billing portal                                                       |
| `/api/billing/subscription`                                      | GET              | Yes        | Current subscription details (includes voiceCreatorAddonActive)             |
| `/api/billing/usage`                                             | GET              | Yes        | Credit balance, limits, recent transactions                                 |
| `/api/billing/voice-creator-addon`                               | POST/DELETE      | Yes        | Voice Creator addon checkout / cancel ($15/mo)                              |
| `/api/keys`                                                      | GET/POST         | Yes        | List/create API keys                                                        |
| `/api/keys/[keyId]`                                              | DELETE           | Yes        | Revoke API key                                                              |
| `/api/teams/[teamId]`                                            | GET/PATCH/DELETE | Yes        | Team CRUD                                                                   |
| `/api/teams/invite`                                              | POST             | Yes        | Send team invite                                                            |
| `/api/users/me`                                                  | GET/PATCH        | Yes        | Current user profile                                                        |
| `/api/users/me/twitter`                                          | GET/PATCH/DELETE | Yes        | Twitter settings (handle, enabled, voice prefs, disconnect)                 |
| `/api/users/search`                                              | GET              | Yes        | Search users by handle (for allowlist)                                      |
| `/api/voices/clone`                                              | POST             | Yes        | Create voice clone                                                          |
| `/api/voices/preview`                                            | POST             | Yes        | Preview voice sample                                                        |
| `/api/voices/allowlist`                                          | GET/POST         | Yes        | List/add voice allowlist entries (Studio + addon)                           |
| `/api/voices/allowlist/[entryId]`                                | DELETE           | Yes        | Remove voice allowlist entry                                                |
| `/api/waitlist`                                                  | POST             | No         | Waitlist signup                                                             |
| `/api/health`                                                    | GET              | No         | Health check                                                                |
| `/api/feedback`                                                  | POST/GET         | No         | Submit/list feedback                                                        |
| `/api/webhooks/stripe`                                           | POST             | Stripe sig | Stripe webhook handler                                                      |
| `/api/admin/users/[userId]/role`                                 | PATCH            | ADMIN      | Change user role (USER/CREATOR/ADMIN)                                       |
| `/api/admin/podcasts/[podcastId]`                                | DELETE           | ADMIN      | Delete podcast (admin removal)                                              |
| `/api/admin/waitlist/export`                                     | GET              | ADMIN      | Export waitlist as CSV                                                      |
| `/api/admin/costs`                                               | GET              | ADMIN      | Provider cost breakdown dashboard                                           |
| `/api/users/me/avatar`                                           | POST             | Yes        | Upload avatar image (multipart/form-data)                                   |
| `/api/onboarding/interests`                                      | POST             | Yes        | Save onboarding interest selections + mark onboarded                        |
| `/api/inspire`                                                   | GET              | Yes        | "Inspire Me" topics: personalized, trending, current events                 |
| `/api/inspire/drill`                                             | POST             | Yes        | Drill down into a category for specific subtopics                           |
| `/api/handles/check`                                             | GET              | No         | Check handle availability                                                   |
| `/api/admin/handles`                                             | GET/POST/DELETE  | ADMIN      | Manage reserved handles                                                     |
| `/api/admin/podcasts/create-as-sotto`                            | POST             | ADMIN      | Create podcast as @sotto                                                    |
| `/api/voices/request`                                            | GET/POST         | Yes        | Voice request listing/creation                                              |
| `/api/voices/request/[id]`                                       | PATCH            | Yes        | Update voice request status                                                 |
| `/api/tts-providers`                                             | GET              | Yes        | List available TTS providers + user BYOK status                             |
| `/api/settings/byok`                                             | GET/POST/DELETE  | Yes        | Multi-provider BYOK key management (5 providers)                            |

## Route Groups

- `(dashboard)/` — protected routes sharing dashboard layout (sidebar, auth check)
- `(admin)/` — admin-only routes sharing admin layout (admin sidebar, ADMIN role check)
- `auth/` — public auth pages

## Adding a New Page

1. Create `src/app/route-name/page.tsx`
2. Create `src/app/route-name/page.module.css` if needed
3. Add auth requirement in `src/middleware.ts` if protected
4. Update this CLAUDE.md

## Adding a New API Route

1. Create `src/app/api/resource/route.ts`
2. Add Zod validation schema in `src/lib/validations.ts`
3. Update this CLAUDE.md
