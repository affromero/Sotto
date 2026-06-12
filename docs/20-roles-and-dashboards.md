# Roles, Dashboards, and Admin

> **Date**: 2026-05-15
>
> **Summary**: Sotto roles control learner, household-owner, and admin access for the current language-learning app. Dashboards focus on courses, classes, practice, exams, memory, provider readiness, worker operations, and self-host operations. They do not create billing/plan administration, a creator network, public discovery, or public ranking.

---

## 1. Role System

| Role      | Assignment                                    | Access                                                                                                     |
| --------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `USER`    | default on signup                             | learning dashboard, courses, classes, practice, exams, memory graph, settings, BYOK keys, device pairing   |
| `CREATOR` | legacy/operational role when manually granted | user access plus any expanded operational controls still wired in the app; not public creator distribution |
| `ADMIN`   | email allowlist or manual admin assignment    | admin dashboards and operational controls                                                                  |
| `SYSTEM`  | internal automation only                      | owns system operations; never assigned to a real login                                                     |

The first account on a fresh self-hosted instance can act as the owner for household invite and setup flows where those surfaces are enabled. Roles are operational permissions only. The learning loop, BYOK/local setup, and privacy are available without commercial access controls.

---

## 2. User Dashboard

The signed-in dashboard should show:

- active courses and current CEFR levels
- current or next mastery-gated class
- class generation and submission status
- ungated practice due counts by skill
- mock exams and recent attempts
- vocabulary and grammar memory graph status
- provider readiness for LLM/local agent, TTS, and STT
- speaking and writing feedback status where relevant
- recent private activity such as class passes, practice completions, recordings scored, and worksheets generated

The dashboard should not show public follower counts, public likes, public comments, public fork counts, community rank, public discovery placement, billing tier, plan status, or quota upgrade prompts.

---

## 3. Creator Role

The `CREATOR` role is not a product-facing creator-network role. Treat it as a legacy or operational permission bucket unless the codebase explicitly assigns a current learning use.

Possible controls:

- advanced voice/provider management
- source or class-generation inspection
- advanced analytics for owned learning content
- household/workspace controls where enabled
- self-host operations settings

Analytics should stay private and operational:

- placement completion
- class pass/fail and retry rates
- practice completion
- memory graph due counts
- speaking grading failures
- writing scoring failures
- provider cost estimates
- job failure reasons

Do not use this role to add public creator pages, public distribution, follows, likes, comments, or community ranking.

---

## 4. Admin Dashboard

| Page | Path | Purpose |
|---|---|---|
| Overview | `/admin` | users, jobs, health, BYOK adoption, and setup status |
| Users | `/admin/users` | search users, update role, inspect setup readiness |
| Episodes | `/admin/episodes` | legacy audio-engine inspection for generated listening audio and ownership |
| Config | `/admin/config` | provider defaults and operational limits |
| Handles | `/admin/handles` | reserved handle management where still needed |
| Inspire | `/admin/inspire` | private inspiration/source management where still enabled |
| Ratings | `/admin/ratings` | quality/rating oversight |

Admin pages must not bypass ownership checks for user-facing private resources. Admin inspection should be explicit and auditable.

There is no current billing, plan, tier, quota, or payment admin surface for unlocking learning features.

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

| Capability               | Example status                                                                 |
| ------------------------ | ------------------------------------------------------------------------------ |
| database                 | connected                                                                      |
| Redis                    | connected                                                                      |
| storage                  | local or hosted provider selected                                              |
| learning LLM/local agent | selected and validated                                                         |
| TTS                      | selected and validated                                                         |
| STT                      | selected and validated when speaking is used                                   |
| local TTS                | sidecar base URL configured when `TTS_PROVIDER=kokoro` or `TTS_PROVIDER=local` |
| local STT                | Whisper-compatible base URL configured when `STT_PROVIDER=local`               |
| course setup             | language pair, placement, current level                                        |
| memory graph             | due counts and recent review activity                                          |
| household                | owner, invite-only/open sign-up, invites where enabled                         |

The UI should not silently treat another provider as ready just because another key exists.

---

## 7. Avatar And Profile Data

Users can manage account display data in settings. Profile-style fields may still exist for account identity, household invites, or internal display, but there is no public profile hub. Avoid building UI that implies public discovery, creator following, social status, or community ranking.

---

## 8. Site Analytics

The event pipeline and model-backed reporting store have been removed. Do not add
route-level tracking, anonymous session analytics, or profile-backed admin
dashboards.

- conversion through onboarding
- placement completion
- course creation
- class generation and pass/fail
- practice completion
- exam attempts
- memory graph review activity
- provider setup completion
- BYOK/local-agent readiness

Do not add public popularity metrics, billing-plan metrics, paid conversion funnels, or social engagement as admin success criteria.
