# Roles, Dashboards, and Admin

> **Date**: 2026-05-15
>
> **Summary**: Sotto roles control workspace and admin access. They do not create a creator network or public ranking layer. Dashboards focus on private library health, provider readiness, source status, worker operations, and self-host operations.

---

## 1. Role System

| Role | Assignment | Access |
|---|---|---|
| `USER` | default on signup | private dashboard, library, settings, provider keys, private RSS |
| `CREATOR` | manually granted by admin when needed | user access plus expanded analytics and voice/source management |
| `ADMIN` | email allowlist or manual admin assignment | admin dashboards and operational controls |
| `SYSTEM` | internal automation only | owns system operations; never assigned to a real login |

Roles are operational permissions only. Privacy, private RSS, and local operation are available without commercial access controls.

---

## 2. User Dashboard

The signed-in dashboard should show:

- private podcast library
- generation status
- private RSS token status
- provider readiness
- local-agent readiness when configured
- source status for meetings, agents, news, Twitter, Telegram, and webhooks
- recent private activity such as listens, saves, and completed jobs

The dashboard should not show public follower counts, public likes, public comments, public fork counts, or community rank.

---

## 3. Creator Role

The `CREATOR` role is for users who need expanded operational controls, not public creator distribution.

Possible controls:

- voice management
- source management
- advanced analytics
- team/workspace controls
- self-host operations settings

Analytics should stay private and operational:

- listen count
- completion rate
- save-to-listen ratio
- source run success
- provider cost estimates
- job failure reasons

---

## 4. Admin Dashboard

| Page | Path | Purpose |
|---|---|---|
| Overview | `/admin` | users, podcasts, jobs, health, and setup status |
| Users | `/admin/users` | search users, update role, inspect setup readiness |
| Podcasts | `/admin/podcasts` | inspect podcast status and ownership |
| Waitlist | `/admin/waitlist` | export and manage early access |
| Analytics | `/admin/analytics` | site and product usage metrics |
| Moderation | `/admin/moderation` | reports and failed content review |
| Config | `/admin/config` | provider defaults and operational limits |
| Handles | `/admin/handles` | reserved handle management where still needed |
| Inspire | `/admin/inspire` | private inspiration/source management |
| Ratings | `/admin/ratings` | quality/rating oversight |
| Twitter | `/admin/twitter` | owner-scoped Twitter source health |
| Costs | `/admin/costs` | provider and infrastructure cost tracking |
| Pipeline | `/admin/pipeline` | queue status, failures, retries |
| Engagement | `/admin/engagement` | private activity metrics |
| Playback | `/admin/playback` | playback analytics |
| Retention | `/admin/retention` | retention cohorts |

Admin pages must not bypass ownership checks for user-facing private resources. Admin inspection should be explicit and auditable.

---

## 5. Admin Assignment

Admin access is email-based unless a future admin UI changes it:

1. Add the email to `ADMIN_EMAILS`.
2. The user signs in again.
3. The auth callback syncs the database role to `ADMIN`.
4. The session includes the role for admin navigation and server checks.

Manual role changes happen in `/admin/users`.

---

## 6. Provider And Hosting Readiness

Dashboards should report setup as capabilities:

| Capability | Example status |
|---|---|
| database | connected |
| Redis | connected |
| storage | local or hosted provider selected |
| LLM/local agent | selected and validated |
| TTS | selected and validated |
| STT | selected when meeting transcription is enabled |
| private RSS | token created or skipped |
| source | enabled, last run, last error |
| managed hosting | trial, active, overdue, canceled |

The UI should not silently treat another provider as ready just because another key exists.

---

## 7. Avatar And Profile Data

Users can manage account display data in settings. Profile-style fields may still exist for account identity, but there is no public profile hub. Avoid building UI that implies public discovery or creator following.

---

## 8. Site Analytics

The `PageViewTracker` component records route-level analytics through the existing event pipeline:

```text
EventBuffer -> /api/events -> BullMQ -> BehavioralEvent
```

Admin analytics may show:

- page views
- unique visitors
- referrers
- devices
- conversion through onboarding
- provider setup completion
- private RSS setup completion
- source activation

Do not add public popularity metrics as admin success criteria.
