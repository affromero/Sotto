# Stripe & Billing: Free + Pro + BYOK

> Three-tier model: Free (1 podcast/day, platform AI), Pro ($12/month, unlimited),
> BYOK (unlimited, own keys). Voice marketplace via Stripe Connect.
>
> Date: February 2026

---

## Overview

| Tier | Cost | AI | TTS | Limits |
|---|---|---|---|---|
| Free | $0 forever | Groq Llama 3.1 8B | KittenTTS (platform) | 1 podcast/day (configurable via admin) |
| Pro | $12/month | Groq Llama 3.3 70B | KittenTTS (platform) | Unlimited |
| BYOK | $0 (own provider costs) | Any key user adds | Any key user adds | Unlimited |

Voice marketplace is orthogonal to tiers — any user (including Free) can sell voice clones.

---

## Key Files

| Component | File | Purpose |
|---|---|---|
| Stripe client | `lib/stripe.ts` | SDK init, `PLATFORM_FEE_PERCENT` (10%) |
| Billing checkout | `app/api/billing/checkout/route.ts` | Create Stripe Checkout session for Pro |
| Billing portal | `app/api/billing/portal/route.ts` | Customer Portal for Pro subscription management |
| Stripe webhooks | `app/api/stripe/webhooks/route.ts` | Handles subscription + Connect + payment events |
| Generation gate | `lib/generation-gate.ts` | Enforces daily limit (Free) / bypass (Pro, BYOK) |
| Tier features | `lib/tier-features.ts` | Feature caps per tier (duration, Q&A, analytics, etc.) |
| Free tier config | `lib/free-tier-config.ts` | Admin singleton: daily limit, default AI/TTS provider |
| BYOK key mgmt | `lib/byok.ts` | Encrypt/decrypt/store/validate user API keys |
| Voice pricing | `lib/voice-pricing.ts` | Marketplace: charges, PaymentIntents, capture/cancel |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | For Pro + voice marketplace | Stripe API secret key |
| `STRIPE_PUBLISHABLE_KEY` | For checkout redirect | Stripe publishable key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Build arg (baked into client) | Same as above |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | `whsec_...` from Stripe destination |
| `STRIPE_PRO_PRICE_ID` | For Pro checkout | `price_...` from Stripe Dashboard |
| `BYOK_ENCRYPTION_KEY` | Yes | AES-256-GCM key for encrypting user keys |

All managed in Doppler (`project: sotto`, `config: prd`).

---

## Pro Subscription Flow

### Checkout

```
User clicks "Upgrade to Pro"
    │
    ▼
POST /api/billing/checkout
    │ — creates Stripe Checkout session (mode: 'subscription')
    │ — uses STRIPE_PRO_PRICE_ID
    │ — sets subscription_data.metadata.userId
    │ — returns { url }
    ▼
User redirected to Stripe-hosted checkout page
    │
    ▼
On success → redirect to /billing?upgrade=success
On cancel  → redirect to /pricing
    │
    ▼
Stripe fires customer.subscription.created webhook
    │
    ▼
POST /api/stripe/webhooks
    │ — sets User.plan = 'PRO'
    │ — upserts Subscription record
```

### Manage Subscription

```
User clicks "Manage Subscription" on /billing
    │
    ▼
POST /api/billing/portal
    │ — creates Stripe Customer Portal session
    │ — returns { url }
    ▼
User redirected to Stripe-hosted portal (cancel, update card, view invoices)
    │
    ▼
On cancel → Stripe fires customer.subscription.updated (cancel_at_period_end = true)
            then customer.subscription.deleted at period end
    │
    ▼
POST /api/stripe/webhooks
    │ — on updated: syncs cancelAtPeriodEnd to Subscription record
    │ — on deleted: sets User.plan = 'FREE', Subscription.status = 'canceled'
```

---

## Webhook Events

The Stripe destination at `https://sotto.fm/api/stripe/webhooks` listens to:

| Event | Handler | Effect |
|---|---|---|
| `customer.subscription.created` | Sets `User.plan = PRO`, creates `Subscription` | User gains Pro access |
| `customer.subscription.updated` | Syncs status, period end, cancel flag | Keeps `Subscription` in sync |
| `customer.subscription.deleted` | Sets `User.plan = FREE`, marks `Subscription` canceled | User loses Pro access at period end |
| `account.updated` | Sets `User.stripeOnboarded` | Enables voice marketplace payouts |
| `payment_intent.payment_failed` | Cancels `VoicePurchase` | Unlocks voice for future purchase |

---

## Database Models

### `Subscription` (new — Pro tier)

```
Subscription {
  id                  String   @id
  userId              String   @unique
  stripeCustomerId    String
  stripeSubscriptionId String
  stripePriceId       String
  status              String   (active | trialing | canceled | past_due)
  currentPeriodEnd    DateTime
  cancelAtPeriodEnd   Boolean
  createdAt           DateTime
  updatedAt           DateTime
}
```

### `User` (relevant fields)

```
User {
  plan          UserPlan  @default(FREE)   // FREE | PRO
  subscription  Subscription?
}
```

### Voice Marketplace Models (unchanged)

```
VoiceClone     — id, name, userId, provider, externalVoiceId, priceInCents, sourceType
VoicePurchase  — buyerId, voiceCloneId, podcastId, amountCents, platformFeeCents,
                 stripePaymentIntent, status (authorized/captured/cancelled/refunded)
VoiceAllowlist — voiceCloneId, allowedUserId
VoiceRequest   — requesterId, voiceCloneId, status (PENDING/APPROVED/REJECTED)
```

---

## Generation Gate

`checkGenerationGate(userId)` determines if a user can start a new podcast generation.

### Decision Flow

```
Is user ADMIN/SYSTEM?    → allowed (no counting)
Is user PRO?             → allowed (no counting)
Has user BYOK TTS key?   → allowed (no counting)
Is platform TTS up?      → check Redis daily counter
  └── dailyUsed < dailyLimit? → allowed (increment Redis key free:daily:{userId} TTL 24h)
  └── otherwise          → blocked ('daily_limit_reached', returns resetInSeconds)
No platform TTS          → blocked ('no_provider')
```

### Redis Counter

Key: `free:daily:{userId}` · TTL: 86,400 seconds (rolling 24h window)

Incremented atomically via Lua script in `tryIncrementFreeGeneration()`. The `dailyLimit`
is set by `FreeTierConfig.dailyGenerationLimit` (default: 1, configurable in `/admin`).

---

## Tier Features

`getTierFeatures(plan, isByok)` returns caps that gate features across the pipeline:

| Feature | Free | Pro | BYOK |
|---|---|---|---|
| Max duration | 5 min | 30 min | Unlimited |
| Q&A interactions | 3/podcast | Unlimited | Unlimited |
| Web search in scripts | No | Yes | Yes |
| Auto-approve script | Yes (no pause) | No (user reviews) | No (user reviews) |
| Private podcasts | No | Yes | Yes |
| Analytics | No | Yes | Yes |
| BullMQ priority | 10 (low) | 1 (high) | 1 (high) |

---

## Free Tier Configuration

Admin-configurable singleton (`FreeTierConfig`) at `/admin/free-tier`:

| Field | Default | Description |
|---|---|---|
| `dailyGenerationLimit` | `1` | Max podcasts/day for free users |
| `aiProvider` | `groq` | Platform AI provider |
| `aiModel` | `llama-3.1-8b-instant` | Platform AI model |
| `ttsProvider` | `kittentts` | Platform TTS provider |
| `ttsModel` | `kitten-tts-mini-0.8` | Platform TTS model |

---

## BYOK

Users connect their own LLM (Anthropic, OpenAI, Groq) and TTS keys (7 providers).
Keys are AES-256-GCM encrypted at rest. All features unlock immediately — no daily limit,
unlimited duration, analytics, private podcasts.

See `lib/byok.ts` for encryption details and key management functions.

---

## Voice Marketplace (Stripe Connect)

Voice clone owners set a per-podcast price. Buyers pay once.
Platform takes 10% via Stripe Connect `application_fee_amount`.

Payment flow: authorize upfront → capture on READY → cancel on FAILED.
See `lib/voice-pricing.ts` for full implementation.

---

## Local Development

In dev mode (`AI_PROVIDER=claude-code`), Claude CLI handles LLM calls without an API key.
Platform-level TTS keys satisfy the TTS requirement so the full pipeline runs locally.

For Stripe, use test keys (`sk_test_...`) and the Stripe CLI for local webhooks:
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhooks
```
