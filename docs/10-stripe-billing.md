# Stripe Billing - Managed Infrastructure

> **Date**: 2026-05-15
>
> **Summary**: Billing should charge for managed Sotto infrastructure and operations, not for private access or generic AI-generated content. Local OSS, self-hosted, and BYOK workflows remain first-class. Privacy must never depend on a paid plan.

---

## 1. Billing Principle

Sotto can charge when it operates infrastructure for the user:

- hosted app runtime
- hosted workers
- database and Redis
- storage
- scheduled source ingestion
- Twitter, Telegram, and webhook operations
- backups, monitoring, and updates
- optional provider-key custody

Sotto should not charge for:

- private visibility
- private RSS
- local OSS usage
- self-hosted deployment rights
- the mere ability to bring your own provider keys

---

## 2. Product Plans

| Plan | Who it serves | Billing basis |
|---|---|---|
| Local OSS | technical self-hosters | no Sotto billing |
| VPS self-hosted | users running their own server | no Sotto billing |
| BYOK hosted | users who want Sotto-hosted infra with their own provider keys | managed infra subscription |
| Fully managed hosted | users who want Sotto to operate infra and provider access | managed infra subscription plus usage limits |

Every plan keeps podcasts private by default.

---

## 3. Trial

Managed hosting should start with a short trial that proves the recurring workflow:

- workspace created
- provider path selected
- at least one ready episode
- private RSS token created
- at least one source connected or scheduled

Trial expiration can pause managed workers or scheduled source execution. It must not make private content public or revoke local export rights.

---

## 4. Stripe Components

| Component | Purpose |
|---|---|
| Checkout | start managed hosting subscription |
| Customer Portal | update payment method, cancel, view invoices |
| Webhooks | sync subscription status and trial state |
| Connect | optional paid voice sharing or payouts if retained |

Environment variables:

```env
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_MANAGED_HOSTING_PRICE_ID=
```

Managed or self-hosted deployments can provide these through any deployment secret manager or env file. Local OSS setup should keep `PAYMENT_PROVIDER=none`.

---

## 5. Subscription State

The app should model managed hosting state separately from privacy:

```text
trialing
active
past_due
canceled
paused
```

Allowed effects:

- pause scheduled jobs
- stop bot polling/webhook processing
- stop managed provider usage
- keep data export available
- keep private library visibility unchanged
- keep private RSS revocation controls available

Disallowed effects:

- make private episodes public
- hide private RSS because a user is not paying
- delete user data as an automatic billing side effect
- route provider usage to a different provider silently

---

## 6. Webhook Handling

Webhook route requirements:

- verify Stripe signature
- handle duplicate events idempotently
- update subscription/trial records
- avoid heavy work in the webhook request
- enqueue follow-up jobs when needed
- log sanitized event IDs and state transitions

Expected events:

- checkout session completed
- subscription created
- subscription updated
- subscription deleted
- invoice payment succeeded
- invoice payment failed

---

## 7. Tests

Required tests:

- local OSS keeps `PAYMENT_PROVIDER=none`
- privacy is not gated by plan state
- trial expiration pauses managed jobs only
- webhook signature verification rejects invalid payloads
- duplicate webhook events are idempotent
- customer portal creation requires authentication
- subscription state changes do not alter podcast visibility
