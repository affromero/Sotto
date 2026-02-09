# Unit Economics & Business Model

> Dual-TTS cost analysis, tier profitability, breakeven targets, and guardrails to prevent runaway costs.

---

## Dual-TTS Provider Model

Sotto uses **two TTS providers** with different cost profiles:

| Provider | Role | Cost per 1K chars | 10-min podcast (~15K chars) | When Used |
|----------|------|-------------------|----------------------------|-----------|
| **OpenAI TTS** (tts-1-hd) | Standard (default) | $0.015 | ~$0.23 | All podcasts by default |
| **ElevenLabs** (scale tier) | Premium (credits) | $0.17 | ~$2.55 | When user spends a premium voice credit |

Standard voices (OpenAI) are always available. Premium voices (ElevenLabs) are gated behind per-month credits that vary by tier.

---

## Cost Per Podcast (10 min, ~15K chars)

### Standard Podcast (OpenAI TTS)

| Component | Cost |
|-----------|------|
| Claude discovery (5 exchanges) | $0.05 |
| Claude script generation | $0.08 |
| OpenAI TTS audio (15K chars) | $0.23 |
| Sound effects (bundled stock) | $0.00 |
| R2 storage (~15MB) | $0.0002 |
| FFmpeg compute | $0.001 |
| **Total** | **~$0.36** |

### Premium Podcast (ElevenLabs TTS)

| Component | Cost |
|-----------|------|
| Claude discovery (5 exchanges) | $0.05 |
| Claude script generation | $0.08 |
| ElevenLabs TTS audio (15K chars, scale tier) | $2.55 |
| Sound effects (ElevenLabs SFX, Creator only) | ~$0.10 |
| R2 storage (~15MB) | $0.0002 |
| FFmpeg compute | $0.001 |
| **Total** | **~$2.78** |

---

## Pricing Tiers

| | Free | Pro | Creator |
|---|---|---|---|
| **Price** | $0 | $14/mo | $29/mo |
| **Podcasts/month** | 2 | 8 | 30 |
| **Duration** | 10 min | 10 min | 10 min |
| **Interactions** | 2/podcast | 10/podcast | Unlimited |
| **Premium voice credits** | 0 | 3 | 10 |
| **Voice clones** | 0 | 2 | 5 |
| **Sound effects** | Standard | Standard | Premium (ElevenLabs SFX) |
| **Download/PDF** | No | Yes | Yes |
| **Private podcasts** | No | Yes | Yes |
| **Voice library** | No | Yes | Yes |
| **Marketplace/Analytics** | No | No | Yes |

---

## Tier Profitability — Worst Case (Every User Maxes Out)

| Tier | Revenue | Max standard cost | Max premium cost | Total worst case | Margin |
|------|---------|-------------------|------------------|-----------------|--------|
| Free | $0 | 2 x $0.36 = $0.72 | -- | -$0.72 | N/A |
| Pro ($14) | $14 | 8 x $0.36 = $2.88 | 3 x $2.78 = $8.34 | $14 - $11.22 = $2.78 | 20% |
| Creator ($29) | $29 | 30 x $0.36 = $10.80 | 10 x $2.78 = $27.80 | $29 - $38.60 = -$9.60 | -33% |

### Key Insight

Creator tier is **unprofitable at worst case** if a user burns all 30 standard podcasts AND all 10 premium credits. This is the price ceiling we accept because:

1. Most users won't exhaust all premium credits every month
2. ElevenLabs pricing drops further with enterprise negotiation
3. Credits can be adjusted (10 -> 8 -> 5) based on actual usage data

---

## Tier Profitability — Realistic (Average Usage)

| Tier | Revenue | Avg standard cost | Avg premium cost | Total avg | Margin |
|------|---------|-------------------|------------------|----------|--------|
| Free | $0 | 1 x $0.36 = $0.36 | -- | -$0.36 | N/A |
| Pro ($14) | $14 | 4 x $0.36 = $1.44 | 1 x $2.78 = $2.78 | $14 - $4.22 = $9.78 | 70% |
| Creator ($29) | $29 | 12 x $0.36 = $4.32 | 4 x $2.78 = $11.12 | $29 - $15.44 = $13.56 | 47% |

Average usage assumptions: Free users create ~1 podcast, Pro users ~4 (50% utilization), Creator users ~12 (40% utilization). Premium credit usage: Pro ~1/3, Creator ~4/10.

---

## Breakeven Analysis

### Fixed Infrastructure Costs (Phase 3: Public Beta)

| Item | Monthly Cost |
|------|-------------|
| Vercel Pro | $20 |
| Railway (workers) | $20 |
| Anthropic API (base) | $50 |
| R2 Storage | $5 |
| Neon DB | $25 |
| Upstash Redis | $10 |
| ElevenLabs Scale | $99 |
| **Total** | **~$230** |

### Subscribers Needed to Cover Fixed Costs

| Scenario | Margin/subscriber | Subscribers needed |
|----------|-------------------|-------------------|
| All Pro | $9.78 | 24 |
| All Creator | $13.56 | 17 |
| Mixed (70% Pro, 30% Creator) | $10.91 avg | 21 |

---

## Revenue Projections (Conservative)

| Month | Free Users | Pro Users | Creator Users | MRR | Est. COGS | Gross Profit |
|-------|-----------|-----------|--------------|-----|-----------|-------------|
| 3 | 50 | 0 | 0 | $0 | $18 | -$248 |
| 6 | 200 | 8 | 2 | $170 | $95 | -$155 |
| 9 | 500 | 20 | 5 | $425 | $180 | $15 |
| 12 | 1,000 | 45 | 12 | $978 | $350 | $398 |

---

## Guardrails to Prevent Runaway Costs

### 1. Hard Podcast Caps (No Infinity Anywhere)

Every tier has an explicit podcast limit enforced in `canCreatePodcast()`:
- Free: 2, Pro: 8, Creator: 30

No tier uses `Infinity` for any limit except Creator interactions (which cost ~$0.02 each via Claude, negligible).

### 2. Premium Voice Credits Tracked Per Billing Cycle

The `Subscription.premiumCreditsUsed` counter resets on period renewal (via Stripe webhook). Enforced in `consumeVoiceCredit()` — throws if depleted.

### 3. Sound Effects Cost Isolation

- Free/Pro: bundled stock SFX files (zero marginal cost)
- Creator: ElevenLabs `generateSoundEffect()` API (~$0.10 per podcast)
- If ElevenLabs SFX generation fails, gracefully falls back to stock SFX

### 4. Rate Limiting

API routes (especially `/api/podcasts` POST and `/api/podcasts/[id]/generate` POST) enforce rate limits via Redis to prevent abuse.

### 5. Monthly Cost Monitoring

`ApiUsageLog` tracks per-user, per-service costs. Alert if a single user's API costs exceed 80% of their subscription revenue in a billing period.

### 6. TTS Provider Flexibility

The `TTS_PROVIDER` env var allows switching the default TTS provider. If OpenAI raises prices, can swap to another provider without code changes.

---

## Key Metrics to Track

| Metric | Definition | Target |
|--------|-----------|--------|
| **CAC** | Customer Acquisition Cost | < $5 (organic/social) |
| **LTV** | Lifetime Value (Pro) | $14 x 8 months = $112 |
| **LTV:CAC** | Ratio | > 3:1 |
| **Churn** | Monthly Pro churn | < 10% |
| **Activation** | % signups -> first podcast | > 50% |
| **Conversion** | Free -> paid | > 5% |
| **COGS/Revenue** | Cost of goods sold ratio | < 30% |
| **Premium credit burn rate** | Avg credits used / credits available | Track monthly |
| **Podcast utilization** | Avg podcasts created / limit | Track per tier |

---

## Bootstrapping Budget

### Phase 1: MVP (Month 1-2) -- $0

| Item | Cost | Notes |
|------|------|-------|
| Development | $0 | Self-built |
| Hosting (Vercel) | $0 | Hobby tier |
| PostgreSQL | $0 | Docker local / Neon free tier |
| Redis | $0 | Docker local / Upstash free tier |
| Domain | $12/year | sotto.fm |
| **Total** | **~$12** | |

### Phase 2: Friends & Family (Month 2-3) -- $50/month

| Item | Monthly Cost | Notes |
|------|-------------|-------|
| Vercel Pro | $20 | Production hosting |
| Railway (workers) | $5 | Worker compute |
| ElevenLabs Starter | $5 | 30K chars/month (~2 podcasts) |
| Anthropic API | $10 | Claude usage for ~50 discovery chats |
| R2 Storage | $0 | 10GB free tier |
| Neon DB | $0 | Free tier |
| Upstash Redis | $0 | Free tier |
| **Total** | **~$40** | |

### Phase 3: Public Beta (Month 3-6) -- $230/month

See fixed infrastructure table above.

### Phase 4: Growth (Month 6-12) -- $1,000-3,000/month

Scale costs depend on user growth and premium credit usage patterns. The dual-TTS model means standard podcast costs scale linearly at $0.36/podcast (negligible). Premium credits are the main variable.

---

## Initial Investment Summary

| Phase | Duration | Total Cost | What You Get |
|-------|----------|-----------|--------------|
| MVP | 2 months | ~$25 | Working product, local testing |
| Friends & Family | 1 month | ~$120 | 20-50 real users, feedback |
| Public Beta | 3 months | ~$700 | 200+ users, product-market fit signal |
| Growth | 6 months | ~$6,000-18,000 | 1,000+ users, revenue |
| **Total to revenue** | **~12 months** | **~$7,000-19,000** | |
