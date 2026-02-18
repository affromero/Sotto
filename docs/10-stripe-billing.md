# Stripe & Billing: BYOK + Voice Marketplace

> BYOK (Bring Your Own Key) model, voice marketplace via Stripe Connect, generation gating, and free tier configuration.

**Date:** 2026-02-18

---

## Overview

Sotto uses a **BYOK + Voice Marketplace** model. There are no subscriptions, no tiers, no credits.

- **BYOK**: Users bring their own API keys for LLM (Anthropic/OpenAI) and TTS (ElevenLabs, OpenAI, PlayHT, Cartesia, Hume). All features are free and unlimited for BYOK users.
- **Free tier**: Users without BYOK keys get a limited number of free generations (configurable via `FreeTierConfig` admin singleton, default: 3).
- **Voice Marketplace**: Voice clone owners connect Stripe (Connect) and set a per-podcast price. Buyers pay once per podcast. Platform takes 10%.

| Component             | File                                    | Purpose                                                     |
| --------------------- | --------------------------------------- | ----------------------------------------------------------- |
| Stripe client         | `apps/web/src/lib/stripe.ts`            | Stripe SDK init, `PLATFORM_FEE_PERCENT` (10%), flat limits  |
| Voice pricing         | `apps/web/src/lib/voice-pricing.ts`     | Marketplace: compute charges, create/capture/cancel payments |
| BYOK key management   | `apps/web/src/lib/byok.ts`              | Encrypt/decrypt/store/validate user API keys (TTS + AI)     |
| Generation gate       | `apps/web/src/lib/generation-gate.ts`   | BYOK check + free tier counter enforcement                  |
| Free tier config      | `apps/web/src/lib/free-tier-config.ts`  | Admin-configurable singleton (provider, model, limit)       |
| Billing API           | `apps/web/src/app/api/billing/route.ts` | Usage stats, BYOK key status                                |

---

## Environment Variables

| Variable              | Required            | Description                               | Example                |
| --------------------- | ------------------- | ----------------------------------------- | ---------------------- |
| `STRIPE_SECRET_KEY`   | For voice marketplace | Stripe API secret key                     | `sk_test_xxxxxxxxxxxx` |
| `BYOK_ENCRYPTION_KEY` | Yes                 | AES-256-GCM key for encrypting user keys  | 64-char hex string     |

Stripe is optional — the app starts without it. Voice marketplace features are disabled gracefully when `STRIPE_SECRET_KEY` is missing. All other billing features (BYOK, generation gating, free tier) work without Stripe.

---

## BYOK Model

Users bring their own API keys. Keys are encrypted with AES-256-GCM and stored in the database.

### Key Storage Models

```
UserAiKey   — one per (userId, provider) — providers: anthropic, openai
UserTtsKey  — one per (userId, provider) — providers: elevenlabs, openai, playht, cartesia, hume
```

### Key Operations (`apps/web/src/lib/byok.ts`)

| Function                  | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `encryptApiKey()`         | Encrypt a plaintext key → base64(salt + iv + authTag + cipher) |
| `decryptApiKey()`         | Decrypt a stored key                                           |
| `storeByokKey()`          | Upsert a TTS BYOK key for a provider                          |
| `getByokKey()`            | Retrieve + decrypt a user's TTS key                            |
| `storeAiKey()`            | Upsert an AI BYOK key for a provider                           |
| `getAiKey()`              | Retrieve + decrypt a user's AI key (prefers Anthropic)         |
| `hasByokKey()`            | Check if user has any TTS key configured                       |
| `hasAiKey()`              | Check if user has any AI key configured                        |
| `validateByokKey()`       | Validate a TTS key against the provider's API                  |
| `validateAiKey()`         | Validate an AI key against the provider's API                  |
| `markTtsKeyInvalid()`     | Mark a TTS key as invalid after runtime failure                |
| `markAiKeyInvalid()`      | Mark an AI key as invalid after runtime failure                |
| `listByokProviders()`     | List all configured TTS providers for a user                   |
| `listAiProviders()`       | List all configured AI providers for a user                    |
| `removeByokKey()`         | Delete a user's TTS key for a provider                         |
| `removeAiKey()`           | Delete a user's AI key for a provider                          |

### Encryption Details

- Algorithm: `aes-256-gcm`
- Key derivation: `scryptSync(BYOK_ENCRYPTION_KEY, salt, 32)`
- Storage format: `base64(salt[16] + iv[16] + authTag[16] + ciphertext)`
- Each key gets a unique random salt and IV

---

## Generation Gate (`apps/web/src/lib/generation-gate.ts`)

`checkGenerationGate(userId)` determines if a user can start a new generation.

### Decision Flow

```
Is user ADMIN?          → allowed (no counting)
Has user any TTS key?   → allowed (BYOK user, no counting)
Has platform TTS key?   → check free tier counter
  └── freeGenerationsUsed < generationLimit? → allowed (increment counter)
  └── otherwise → blocked ("free_tier_exhausted")
No TTS available at all → blocked ("no_provider")
```

### Key Functions

| Function                        | Purpose                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `checkGenerationGate(userId)`   | Returns `{ allowed, reason, freeGenerationsUsed, isByokUser }`       |
| `tryIncrementFreeGeneration()`  | Atomic SQL increment — TOCTOU-safe, returns false if already at limit |
| `getFreeTierStatus(userId)`     | Display data for dashboard/billing UI                                |

### Rate Limits (Abuse Prevention)

Additional rate limits are enforced independently:
- 20 generations per hour per user
- 100 generations per day per user
- 60 interactions per hour per user

---

## Free Tier Configuration (`apps/web/src/lib/free-tier-config.ts`)

Admin-configurable singleton row (`FreeTierConfig` model) controlling platform defaults for users without BYOK keys.

| Field             | Default                       | Description                          |
| ----------------- | ----------------------------- | ------------------------------------ |
| `aiProvider`      | `anthropic`                   | AI provider for free tier            |
| `aiModel`         | `claude-haiku-4-5-20251001`   | AI model for free tier               |
| `ttsProvider`     | `openai`                      | TTS provider for free tier           |
| `ttsModel`        | `tts-1-hd`                    | TTS model for free tier              |
| `sttProvider`     | `groq`                        | STT provider for free tier           |
| `sttModel`        | `whisper-large-v3-turbo`      | STT model for free tier              |
| `generationLimit` | `3`                           | Max free generations per user        |

Managed via admin dashboard (`/admin` routes). Functions: `getFreeTierConfig()` and `setFreeTierConfig()`.

---

## Voice Marketplace (Stripe Connect)

Voice clone owners monetize their voices by connecting Stripe and setting a per-podcast price.

### Setup

1. Voice owner connects Stripe via OAuth (Stripe Connect onboarding)
2. `User.stripeAccountId` and `User.stripeOnboarded` are set
3. Owner sets `VoiceClone.priceInCents` (or leaves null/0 for free)

### Payment Flow

```
User selects a paid voice for their podcast
    │
    ▼
computeVoiceCharges(userId, hostVoiceId, expertVoiceId)
    │ — checks free access paths first
    │ — returns list of VoiceCharge objects (price, platformFee)
    ▼
createVoicePayment(buyerId, voiceCloneId, podcastId)
    │ — creates Stripe PaymentIntent with capture_method: 'manual'
    │ — sets application_fee_amount (10% platform fee)
    │ — uses transfer_data.destination for Connect payout
    │ — creates VoicePurchase record (status: 'authorized')
    ▼
Podcast generation pipeline runs...
    │
    ├── On READY: capturePodcastPayments(podcastId)
    │   — captures all authorized PaymentIntents
    │   — updates VoicePurchase status → 'captured'
    │
    └── On FAILED: cancelPodcastPayments(podcastId)
        — cancels all authorized PaymentIntents
        — updates VoicePurchase status → 'cancelled'
```

### Free Access Paths

Before charging, `checkFreeAccess(userId, voiceCloneId)` checks these paths (in order):

1. **Owner** — the voice clone creator always has free access
2. **Allowlisted** — user is in the `VoiceAllowlist` for this voice
3. **Approved VoiceRequest** — user's access request was approved by the owner
4. **Existing purchase** — user already has an authorized or captured `VoicePurchase` for any podcast

### Platform Fee

`PLATFORM_FEE_PERCENT = 10` — applied via Stripe Connect's `application_fee_amount` on every PaymentIntent.

### Key Functions (`apps/web/src/lib/voice-pricing.ts`)

| Function                   | Purpose                                                      |
| -------------------------- | ------------------------------------------------------------ |
| `getVoicePricing()`        | Fetch pricing info for a voice clone                         |
| `computeVoiceCharges()`    | Calculate charges for a podcast's voice selection             |
| `checkFreeAccess()`        | Check if user has free access to a voice                     |
| `createVoicePayment()`     | Create Stripe PaymentIntent with manual capture              |
| `captureVoicePayment()`    | Capture an authorized payment on successful generation       |
| `cancelVoicePayment()`     | Cancel an authorized payment on failed generation            |
| `capturePodcastPayments()` | Capture all authorized payments for a podcast (on READY)     |
| `cancelPodcastPayments()`  | Cancel all authorized payments for a podcast (on FAILED)     |

### Database Models

```
VoiceClone     — id, name, userId, elevenLabsVoiceId, priceInCents, sourceType
VoicePurchase  — buyerId, voiceCloneId, podcastId, amountCents, platformFeeCents,
                 stripePaymentIntent, status (authorized/captured/cancelled/refunded)
VoiceAllowlist — voiceCloneId, allowedUserId (unique per pair)
VoiceRequest   — requesterId, voiceCloneId, status (PENDING/APPROVED/REJECTED)
```

---

## Stripe Client (`apps/web/src/lib/stripe.ts`)

Minimal Stripe SDK wrapper — no subscription logic.

```typescript
export const PLATFORM_FEE_PERCENT = 10;

export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export const LIMITS = {
  maxDurationMinutes: 40,
  maxVoiceClones: 10,
  canDownload: true,
  canMakePrivate: true,
  canExportPdf: true,
  hasPremiumSfx: true,
} as const;
```

All features are flat-unlocked for everyone. The `LIMITS` object exists for feature-flag consistency but imposes no tier restrictions.

---

## What Was Removed

The old subscription billing model has been fully replaced:

| Removed                | Replaced By                                              |
| ---------------------- | -------------------------------------------------------- |
| `Subscription` model   | No subscriptions — all features free                     |
| `CreditTransaction`    | No credits — BYOK or free tier counter                   |
| `SubscriptionEvent`    | No subscription webhooks                                 |
| `TIER_LIMITS` (4 tiers)| Flat `LIMITS` object (all features unlocked)             |
| `canGenerate()`        | `checkGenerationGate()` — BYOK check + free tier counter |
| `consumeCredit()`      | `tryIncrementFreeGeneration()` — atomic SQL increment     |
| `getUserTier()`        | Not needed — no tiers                                    |
| `getUserCredits()`     | `getFreeTierStatus()` — free generation counter          |
| Stripe Checkout        | Not needed — no subscription purchases                   |
| Customer Portal        | Not needed — no subscription management                  |
| Subscription webhooks  | Not needed — only Stripe Connect for voice marketplace   |

---

## Testing

### Local Development

In dev mode (`AI_PROVIDER=claude-code`), the Claude CLI is used instead of an API key. Platform-level TTS keys (`ELEVENLABS_API_KEY` or `OPENAI_API_KEY`) also satisfy the TTS requirement. This means developers can run the full pipeline locally without any BYOK keys.

### Testing Voice Payments

1. Set up a Stripe test account and configure `STRIPE_SECRET_KEY`
2. Create a voice clone with a price (`priceInCents > 0`)
3. Set the voice owner's `stripeAccountId` (use Stripe Connect test account)
4. Generate a podcast using the paid voice
5. Verify `VoicePurchase` record is created with status `authorized`
6. On podcast READY, verify status changes to `captured`
7. On podcast FAILED, verify status changes to `cancelled`
