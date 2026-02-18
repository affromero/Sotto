# 17 — Roles, Dashboards & Admin

## Role System Overview

Sotto uses a four-role system stored on the `User` model. All features are available to all users — users bring their own API keys (BYOK) for AI and TTS providers. There are no subscription tiers or credit limits.

| Role        | How Assigned                                           | Access                                                        |
| ----------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| **USER**    | Default on signup                                      | `/dashboard` — all features with BYOK keys                   |
| **CREATOR** | Manually granted by admin via `/admin/users`           | `/dashboard` + creator stats, analytics, voices, team         |
| **ADMIN**   | Auto-assigned on sign-in if email is in `ADMIN_EMAILS` | `/dashboard` + `/admin` — full platform access                |
| **SYSTEM**  | Used for system-generated content/actions              | Not a login role — used internally for automated operations   |

### Key Design Decisions

- **No subscription tiers.** All users get the same features. Revenue comes from the voice marketplace (Stripe Connect), not subscriptions.
- **BYOK model.** Users bring their own API keys for AI providers (Anthropic/OpenAI) and TTS providers (ElevenLabs, OpenAI, PlayHT, Cartesia, Hume). Keys are encrypted with AES-256-GCM.
- **ADMIN bypasses BYOK requirements.** Admin users can use platform-level API keys when configured.
- **Roles never auto-downgrade.** Once granted, a role persists unless manually changed by an admin.
- **SYSTEM role** is for automated actions (e.g., system-generated podcasts, internal operations). It is never assigned to real users.

## BYOK (Bring Your Own Key) Model

Instead of subscription tiers with credit limits, all users access all features by providing their own API keys:

| Requirement | Details |
|-------------|---------|
| **AI key**  | Anthropic or OpenAI — required for discovery chat, script generation, Q&A |
| **TTS key** | ElevenLabs, OpenAI, PlayHT, Cartesia, or Hume — required for audio generation |
| **Features** | Unlimited — voice clones, downloads, private podcasts, collections, analytics, PDF export, everything |

**Rate limits** (abuse prevention only): 20 generations/hour, 100/day per user. 60 interactions/hour.

**Dev mode**: When `AI_PROVIDER=claude-code`, the Claude CLI is used instead of an API key. Platform-level TTS keys also satisfy the TTS requirement. Developers can run the full pipeline locally without any BYOK keys.

Users manage their keys at `/settings` → BYOK section. Key status (valid/invalid/missing) is shown in the dashboard.

## Voice Marketplace

Voice owners connect Stripe and set a per-podcast price (or keep voices free). Buyers pay once per podcast. Payment flow:

1. **Authorize** — Payment held when buyer starts generating with a paid voice
2. **Capture** — Funds transferred on READY (minus 10% platform fee via `application_fee_amount`)
3. **Cancel** — Hold released on FAILED

**Free access paths**: voice owner, allowlisted user, approved VoiceRequest, or existing VoicePurchase.

Dashboard shows voice marketplace earnings for sellers and purchase history for buyers.

## How to Access Each Dashboard

### User Dashboard (`/dashboard`)

Available to all signed-in users. Shows:

- Podcast library with status badges
- BYOK key status (AI + TTS provider connection status)
- Quick-create CTA

### Creator Dashboard (same `/dashboard`, enhanced)

For CREATOR and ADMIN roles, the dashboard shows additional **Creator Stats**:

- Total Listens (sum of all podcast play counts)
- Followers
- Total Forks

Plus access to:

- `/analytics` — usage analytics
- `/settings/voices` — voice clone management + marketplace earnings
- `/team` — team management

### Admin Dashboard (`/admin`)

ADMIN-only. Protected by both middleware (JWT role check) and server-side layout auth.

| Page        | Path                  | Description                                                                          |
| ----------- | --------------------- | ------------------------------------------------------------------------------------ |
| Overview    | `/admin`              | Total users, podcasts, waitlist, signups (today/week/month), monetization snapshot   |
| Users       | `/admin/users`        | User table with search, pagination, role dropdown (USER/CREATOR/ADMIN)               |
| Podcasts    | `/admin/podcasts`     | Podcast table with search, status filter, pagination                                 |
| Waitlist    | `/admin/waitlist`     | Waitlist entries with CSV export                                                     |
| Analytics   | `/admin/analytics`    | Site analytics: page views, visitors, referrers, devices, time-series chart          |
| Moderation  | `/admin/moderation`   | Failed podcasts, recent feedback                                                     |
| Config      | `/admin/config`       | Free tier configuration (default AI/TTS providers, generation limits)                |
| Handles     | `/admin/handles`      | Reserved handle management                                                           |
| Inspire     | `/admin/inspire`      | Inspiration/featured podcast management                                              |
| Ratings     | `/admin/ratings`      | Podcast rating oversight                                                             |
| Twitter     | `/admin/twitter`      | @sottofm Twitter integration status, mention tracking                                |
| Revenue     | `/admin/revenue`      | Voice marketplace revenue, connected sellers, platform fees                          |
| Costs       | `/admin/costs`        | API cost tracking (Claude, ElevenLabs, FFmpeg)                                       |
| Pipeline    | `/admin/pipeline`     | Worker job queue status, failed jobs, retry management                               |
| Engagement  | `/admin/engagement`   | User engagement metrics, interaction rates                                           |
| Playback    | `/admin/playback`     | Playback analytics, listen durations                                                 |
| Retention   | `/admin/retention`    | User retention cohort analysis                                                       |

## How Admin Works

Admin access is **email-based**:

1. A comma-separated list of admin emails is stored in the `ADMIN_EMAILS` environment variable
2. On every sign-in, the NextAuth `jwt` callback checks if the user's email matches
3. If it matches, the user's `role` is set to `ADMIN` in the database
4. The ADMIN role is stored in the JWT token and propagated to the session

### How to Add New Admins

1. Add the email to `ADMIN_EMAILS` in your environment (comma-separated):
   ```
   ADMIN_EMAILS=andres2912@gmail.com,newadmin@example.com
   ```
2. The user gets ADMIN role on their **next sign-in**

### How to Grant Creator Role

Admin visits `/admin/users`, finds the user, and changes their role to CREATOR via the dropdown.

## Avatar Management

Users can upload custom avatars in Settings (`/settings`):

- Click "Change Avatar" button next to the current avatar
- Supported formats: JPEG, PNG, WebP, GIF
- Max file size: 2MB
- Uploaded to Cloudflare R2 at `avatars/{userId}/{timestamp}.{ext}`
- Immediately updates in the UI (optimistic)
- Falls back to OAuth avatar or initials if no custom avatar

## Badges

Role badges appear next to user names on profiles and feed cards:

| Role    | Badge Text | Colors                                                                 |
| ------- | ---------- | ---------------------------------------------------------------------- |
| CREATOR | "Creator"  | Navy background (rgba(30,58,95,0.1)), navy text (`--color-accent`)     |
| ADMIN   | "Admin"    | Amber background (rgba(217,119,6,0.1)), amber text (`--color-primary`) |
| USER    | (none)     | No badge                                                               |

Badges are shown in:

- Profile header (next to the user's name)
- Podcast cards in the feed (next to the creator name)

## Site Analytics (Page View Tracking)

The `PageViewTracker` component fires `page.view` events on every route change:

- Mounted once in the root layout inside `EventProvider`
- Uses `usePathname()` to detect navigation
- Events flow through the existing pipeline: EventBuffer → `/api/events` → BullMQ → `BehavioralEvent` table

The admin analytics page (`/admin/analytics`) visualizes this data with:

- Page views, unique visitors, avg pages/session stat cards
- Daily visitor time-series bar chart (CSS-only, no chart library)
- Top pages table
- Referrer sources table
- Device type breakdown with percentage bars
- Selectable time range: 7d / 30d / 90d
