# src/app/ — Next.js App Router Pages & API Routes

## Page Index

| Path | File | Auth Required | Description |
|------|------|--------------|-------------|
| `/` | `page.tsx` | No | Landing page (hero, how it works, pricing) |
| `/auth/login` | `auth/login/page.tsx` | No | Sign in with OAuth |
| `/auth/signup` | `auth/signup/page.tsx` | No | Create account |
| `/dashboard` | `(dashboard)/dashboard/page.tsx` | Yes | My podcasts, usage |
| `/settings` | `(dashboard)/settings/page.tsx` | Yes | Profile & preferences |
| `/billing` | `(dashboard)/billing/page.tsx` | Yes | Subscription management |
| `/analytics` | `(dashboard)/analytics/page.tsx` | Yes | Usage analytics dashboard |
| `/settings/api` | `(dashboard)/settings/api/page.tsx` | Yes | API key management |
| `/settings/voices` | `(dashboard)/settings/voices/page.tsx` | Yes | Voice clone management |
| `/team` | `(dashboard)/team/page.tsx` | Yes | Team management |
| `/team/invite/[token]` | `(dashboard)/team/invite/[token]/page.tsx` | Yes | Accept team invite |
| `/create` | `create/page.tsx` | Yes | Chat-based podcast creation |
| `/podcast/[podcastId]` | `podcast/[podcastId]/page.tsx` | No (public) / Yes (private) | Podcast player |
| `/feed` | `feed/page.tsx` | No | Public podcast feed |
| `/profile/[userId]` | `profile/[userId]/page.tsx` | No | User profile |
| `/pricing` | `pricing/page.tsx` | No | Pricing tiers |
| `/feedback` | `feedback/page.tsx` | No | Feedback form (early access) |

## API Route Index

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/[...nextauth]` | GET/POST | — | NextAuth handlers |
| `/api/discovery` | POST | Yes | Streaming discovery chat |
| `/api/podcasts` | GET/POST | Yes | List/create podcasts |
| `/api/podcasts/[podcastId]` | GET/PATCH/DELETE | Yes | Single podcast CRUD |
| `/api/podcasts/[podcastId]/generate` | POST | Yes | Trigger podcast generation |
| `/api/podcasts/[podcastId]/interact` | POST | Yes | Submit Q&A interaction |
| `/api/podcasts/[podcastId]/fork` | POST | Yes | Fork a podcast |
| `/api/podcasts/[podcastId]/like` | POST/DELETE | Yes | Like/unlike |
| `/api/podcasts/[podcastId]/save` | POST/DELETE | Yes | Save/unsave |
| `/api/podcasts/[podcastId]/export` | POST/GET | Yes | Trigger PDF generation / check status |
| `/api/feed` | GET | No | Public feed with search/filter |
| `/api/recommendations` | GET | Yes | Search similar podcasts |
| `/api/tags` | GET | No | Tag taxonomy |
| `/api/users/[userId]` | GET | No | User profile |
| `/api/users/[userId]/follow` | POST/DELETE | Yes | Follow/unfollow |
| `/api/notifications` | GET | Yes | List notifications |
| `/api/notifications/[notificationId]` | PATCH | Yes | Mark notification read |
| `/api/notifications/mark-all-read` | POST | Yes | Mark all read |
| `/api/analytics` | GET | Yes | Usage analytics data |
| `/api/billing/checkout` | POST | Yes | Stripe checkout session |
| `/api/billing/portal` | POST | Yes | Stripe billing portal |
| `/api/billing/subscription` | GET | Yes | Current subscription details |
| `/api/billing/usage` | GET | Yes | Usage tracking |
| `/api/keys` | GET/POST | Yes | List/create API keys |
| `/api/keys/[keyId]` | DELETE | Yes | Revoke API key |
| `/api/teams/[teamId]` | GET/PATCH/DELETE | Yes | Team CRUD |
| `/api/teams/invite` | POST | Yes | Send team invite |
| `/api/users/me` | GET/PATCH | Yes | Current user profile |
| `/api/users/me/twitter` | GET/PATCH/DELETE | Yes | Twitter settings (handle, enabled, voice prefs, disconnect) |
| `/api/voices/clone` | POST | Yes | Create voice clone |
| `/api/voices/preview` | POST | Yes | Preview voice sample |
| `/api/waitlist` | POST | No | Waitlist signup |
| `/api/health` | GET | No | Health check |
| `/api/feedback` | POST/GET | No | Submit/list feedback |
| `/api/webhooks/stripe` | POST | Stripe sig | Stripe webhook handler |

## Route Groups
- `(dashboard)/` — protected routes sharing dashboard layout (sidebar, auth check)
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
