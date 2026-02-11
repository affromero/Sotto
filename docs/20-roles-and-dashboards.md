# 17 — Roles, Dashboards & Admin

## Role System Overview

Sotto uses a three-tier role system stored on the `User` model:

| Role        | How Assigned                                             | Limits                                              | Dashboard Access                                      |
| ----------- | -------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| **USER**    | Default on signup                                        | Tied to subscription tier (FREE/STARTER/PRO/STUDIO) | `/dashboard`                                          |
| **CREATOR** | Auto-granted with STUDIO subscription, or admin-assigned | Tied to subscription tier                           | `/dashboard` + creator stats, analytics, voices, team |
| **ADMIN**   | Auto-assigned on sign-in if email is in `ADMIN_EMAILS`   | Unlimited everything (no subscription needed)       | `/dashboard` + `/admin`                               |

### Key Design Decisions

- **Roles and tiers are independent.** A user can be CREATOR with a FREE subscription (admin-granted) or USER with a PRO subscription.
- **ADMIN bypasses all limits.** The `getEffectiveTier()` helper in `src/lib/stripe.ts` returns ADMIN-tier limits (Infinity credits, 60 min max) when the user's role is ADMIN, regardless of their Stripe subscription.
- **Roles never auto-downgrade.** If a CREATOR cancels their subscription, the CREATOR role persists (it may have been admin-granted).

## How to Access Each Dashboard

### User Dashboard (`/dashboard`)

Available to all signed-in users. Shows:

- Podcast library with status badges
- Usage stats (podcasts created, current plan)
- Quick-create CTA

### Creator Dashboard (same `/dashboard`, enhanced)

For CREATOR and ADMIN roles, the dashboard shows additional **Creator Stats**:

- Total Listens (sum of all podcast play counts)
- Followers
- Total Forks

Plus access to:

- `/analytics` — usage analytics (also available to PRO+ subscribers)
- `/settings/voices` — voice clone management
- `/team` — team management (also available to STUDIO subscribers)

### Admin Dashboard (`/admin`)

ADMIN-only. Protected by both middleware (JWT role check) and server-side layout auth.

| Page       | Path                | Description                                                                                 |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------- |
| Overview   | `/admin`            | Total users, podcasts, waitlist, signups (today/week/month), tier distribution, total plays |
| Users      | `/admin/users`      | User table with search, pagination, role dropdown (USER/CREATOR/ADMIN)                      |
| Podcasts   | `/admin/podcasts`   | Podcast table with search, status filter, pagination                                        |
| Waitlist   | `/admin/waitlist`   | Waitlist entries with CSV export                                                            |
| Analytics  | `/admin/analytics`  | Site analytics: page views, visitors, referrers, devices, time-series chart                 |
| Moderation | `/admin/moderation` | Failed podcasts, recent feedback                                                            |

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

Two paths:

1. **Automatic:** Subscribe to the STUDIO tier via Stripe — the webhook auto-grants CREATOR role
2. **Manual:** Admin visits `/admin/users`, finds the user, and changes their role to CREATOR via the dropdown

## Tier Limits Per Role

| Limit                   | FREE   | STARTER | PRO       | STUDIO    | ADMIN     |
| ----------------------- | ------ | ------- | --------- | --------- | --------- |
| Credits/month           | 2      | 5       | 15        | 50        | Infinity  |
| Rollover credits (max)  | 0      | 2       | 5         | 20        | Infinity  |
| Max duration            | 10 min | 10 min  | 10 min    | 10 min    | 60 min    |
| Interactions/podcast    | 2      | 5       | Unlimited | Unlimited | Unlimited |
| Voice clones            | 0      | 1       | 3         | 10        | Unlimited |
| Premium voice surcharge | +1     | +1      | +1        | 0         | 0         |
| Download                | No     | Yes     | Yes       | Yes       | Yes       |
| Private podcasts        | No     | No      | Yes       | Yes       | Yes       |
| Voice library           | No     | No      | Yes       | Yes       | Yes       |
| Marketplace listing     | No     | No      | No        | Yes       | Yes       |
| Premium SFX             | No     | No      | No        | Yes       | Yes       |
| Analytics               | No     | No      | Yes       | Yes       | Yes       |
| PDF export              | No     | No      | Yes       | Yes       | Yes       |

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
