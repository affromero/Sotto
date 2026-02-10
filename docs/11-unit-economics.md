# Unit Economics & Business Model

> Dual-TTS cost analysis, tier profitability, breakeven targets, and guardrails to prevent runaway costs.

---

## Dual-TTS Provider Model

Sotto uses **two TTS providers** with different cost profiles:

| Provider                    | Role               | Cost per 1K chars | 10-min podcast (~15K chars) | When Used                               |
| --------------------------- | ------------------ | ----------------- | --------------------------- | --------------------------------------- |
| **OpenAI TTS** (tts-1-hd)   | Standard (default) | $0.015            | ~$0.23                      | All podcasts by default                 |
| **ElevenLabs** (scale tier) | Premium (credits)  | $0.17             | ~$2.55                      | When user spends a premium voice credit |

Standard voices (OpenAI) are always available. Premium voices (ElevenLabs) are gated behind per-month credits that vary by tier.

---

## Cost Per Podcast (10 min, ~15K chars)

### Standard Podcast (OpenAI TTS)

| Component                      | Cost       |
| ------------------------------ | ---------- |
| Claude discovery (5 exchanges) | $0.05      |
| Claude script generation       | $0.08      |
| OpenAI TTS audio (15K chars)   | $0.23      |
| Sound effects (bundled stock)  | $0.00      |
| R2 storage (~15MB)             | $0.0002    |
| FFmpeg compute                 | $0.001     |
| **Total**                      | **~$0.36** |

### Premium Podcast (ElevenLabs TTS)

| Component                                    | Cost       |
| -------------------------------------------- | ---------- |
| Claude discovery (5 exchanges)               | $0.05      |
| Claude script generation                     | $0.08      |
| ElevenLabs TTS audio (15K chars, scale tier) | $2.55      |
| Sound effects (ElevenLabs SFX, Studio only)  | ~$0.10     |
| R2 storage (~15MB)                           | $0.0002    |
| FFmpeg compute                               | $0.001     |
| **Total**                                    | **~$2.78** |

---

## Pricing Tiers

|                             | Free      | Starter   | Pro       | Studio                   |
| --------------------------- | --------- | --------- | --------- | ------------------------ |
| **Price**                   | $0        | $9/mo     | $24/mo    | $49/mo                   |
| **Credits/month**           | 2         | 5         | 15        | 50                       |
| **Rollover credits**        | 0         | 2         | 5         | 20                       |
| **Duration**                | 10 min    | 10 min    | 10 min    | 10 min                   |
| **Interactions**            | 2/podcast | 5/podcast | Unlimited | Unlimited                |
| **Premium voice surcharge** | +1 credit | +1 credit | +1 credit | Included (no surcharge)  |
| **Voice clones**            | 0         | 1         | 3         | 10                       |
| **Sound effects**           | Standard  | Standard  | Standard  | Premium (ElevenLabs SFX) |
| **Download/PDF**            | No        | Yes       | Yes       | Yes                      |
| **Private podcasts**        | No        | No        | Yes       | Yes                      |
| **Voice library**           | No        | No        | Yes       | Yes                      |
| **Marketplace**             | No        | No        | No        | Yes                      |
| **Analytics/PDF export**    | No        | No        | Yes       | Yes                      |

**Credit Packs (one-time purchase)**: 3 credits ($5), 10 credits ($15), 25 credits ($30)

Each podcast generation costs 1 credit. Premium voices add +1 credit surcharge (except Studio tier).

---

## Tier Profitability — Worst Case (Every User Maxes Out)

| Tier         | Revenue | Max standard cost    | Max premium cost | Total worst case        | Margin |
| ------------ | ------- | -------------------- | ---------------- | ----------------------- | ------ |
| Free         | $0      | 2 x $0.36 = $0.72    | --               | -$0.72                  | N/A    |
| Starter ($9) | $9      | 5 x $0.36 = $1.80    | --               | $9 - $1.80 = $7.20      | 80%    |
| Pro ($24)    | $24     | 15 x $0.36 = $5.40   | --               | $24 - $5.40 = $18.60    | 78%    |
| Studio ($49) | $49     | 50 x $2.78 = $139.00 | --               | $49 - $139.00 = -$90.00 | -184%  |

### Key Insight

Studio tier is **unprofitable at worst case** if a user burns all 50 credits on premium voice podcasts. This is the price ceiling we accept because:

1. Most Studio users will mix standard (1 credit) and premium (2 credits) podcasts, not use premium every time
2. ElevenLabs pricing drops further with enterprise negotiation
3. Studio tier is priced for creators who value convenience and time-saving over marginal cost optimization
4. Rollover mechanics incentivize steady usage rather than burst consumption

**Breakeven for Studio tier**: 18 premium podcasts (18 x $2.78 = $50.04) or 136 standard podcasts

---

## Tier Profitability — Realistic (Average Usage)

| Tier         | Revenue | Avg standard cost  | Avg premium cost    | Total avg            | Margin |
| ------------ | ------- | ------------------ | ------------------- | -------------------- | ------ |
| Free         | $0      | 1 x $0.36 = $0.36  | --                  | -$0.36               | N/A    |
| Starter ($9) | $9      | 3 x $0.36 = $1.08  | --                  | $9 - $1.08 = $7.92   | 88%    |
| Pro ($24)    | $24     | 8 x $0.36 = $2.88  | 2 x $2.78 = $5.56   | $24 - $8.44 = $15.56 | 65%    |
| Studio ($49) | $49     | 10 x $0.36 = $3.60 | 15 x $2.78 = $41.70 | $49 - $45.30 = $3.70 | 8%     |

Average usage assumptions:

- Free users create ~1 podcast (50% utilization)
- Starter users ~3 podcasts (60% utilization), all standard voices
- Pro users ~10 podcasts (67% utilization): 8 standard + 2 premium
- Studio users ~25 podcasts (50% utilization): 10 standard + 15 premium

Studio users are creators who value premium quality and use premium voices frequently.

---

## Breakeven Analysis

### Fixed Infrastructure Costs (Phase 3: Public Beta)

| Item                 | Monthly Cost |
| -------------------- | ------------ |
| Vercel Pro           | $20          |
| Railway (workers)    | $20          |
| Anthropic API (base) | $50          |
| R2 Storage           | $5           |
| Neon DB              | $25          |
| Upstash Redis        | $10          |
| ElevenLabs Scale     | $99          |
| **Total**            | **~$230**    |

### Subscribers Needed to Cover Fixed Costs

| Scenario                                 | Margin/subscriber | Subscribers needed |
| ---------------------------------------- | ----------------- | ------------------ |
| All Starter                              | $7.92             | 29                 |
| All Pro                                  | $15.56            | 15                 |
| All Studio                               | $3.70             | 62                 |
| Mixed (50% Starter, 30% Pro, 20% Studio) | $10.90 avg        | 21                 |

---

## Revenue Projections (Conservative)

| Month | Free Users | Starter Users | Pro Users | Studio Users | MRR    | Est. COGS | Gross Profit |
| ----- | ---------- | ------------- | --------- | ------------ | ------ | --------- | ------------ |
| 3     | 50         | 0             | 0         | 0            | $0     | $18       | -$248        |
| 6     | 200        | 10            | 5         | 0            | $210   | $65       | -$85         |
| 9     | 500        | 25            | 15        | 3            | $672   | $180      | $262         |
| 12    | 1,000      | 50            | 35        | 8            | $1,634 | $420      | $984         |

---

## Guardrails to Prevent Runaway Costs

### 1. Hard Credit Caps (No Infinity Anywhere)

Every tier has explicit credit limits enforced in `canGenerate()`:

- Free: 2 credits/mo (0 rollover)
- Starter: 5 credits/mo (2 rollover)
- Pro: 15 credits/mo (5 rollover)
- Studio: 50 credits/mo (20 rollover)

No tier uses `Infinity` for any limit except Pro/Studio interactions (which cost ~$0.02 each via Claude, negligible).

### 2. Credits Tracked Per Billing Cycle

The `Subscription.creditsUsed` counter resets on period renewal (via Stripe webhook). Enforced in `consumeCredit()` — throws if depleted. Premium voice surcharge (+1 credit) is applied at generation time for Free/Starter/Pro tiers.

### 3. Sound Effects Cost Isolation

- Free/Starter/Pro: bundled stock SFX files (zero marginal cost)
- Studio: ElevenLabs `generateSoundEffect()` API (~$0.10 per podcast)
- If ElevenLabs SFX generation fails, gracefully falls back to stock SFX

### 4. Rate Limiting

API routes (especially `/api/podcasts` POST and `/api/podcasts/[id]/generate` POST) enforce rate limits via Redis to prevent abuse.

### 5. Monthly Cost Monitoring

`ApiUsageLog` tracks per-user, per-service costs. Alert if a single user's API costs exceed 80% of their subscription revenue in a billing period.

### 6. TTS Provider Flexibility

The `TTS_PROVIDER` env var allows switching the default TTS provider. If OpenAI raises prices, can swap to another provider without code changes.

---

## Key Metrics to Track

| Metric                     | Definition                           | Target                        |
| -------------------------- | ------------------------------------ | ----------------------------- |
| **CAC**                    | Customer Acquisition Cost            | < $5 (organic/social)         |
| **LTV**                    | Lifetime Value (Starter)             | $9 x 8 months = $72           |
| **LTV**                    | Lifetime Value (Pro)                 | $24 x 8 months = $192         |
| **LTV:CAC**                | Ratio                                | > 3:1                         |
| **Churn**                  | Monthly paid churn                   | < 10%                         |
| **Activation**             | % signups -> first podcast           | > 50%                         |
| **Conversion**             | Free -> paid                         | > 5%                          |
| **COGS/Revenue**           | Cost of goods sold ratio             | < 30%                         |
| **Credit burn rate**       | Avg credits used / credits available | Track monthly                 |
| **Credit utilization**     | Avg credits used per subscriber      | Track per tier                |
| **Premium voice adoption** | % podcasts using premium voices      | Track per tier                |
| **Rollover accumulation**  | Avg rollover credits held per user   | Monitor for "credit hoarders" |

---

## Bootstrapping Budget

### Phase 1: MVP (Month 1-2) -- $0

| Item             | Cost     | Notes                            |
| ---------------- | -------- | -------------------------------- |
| Development      | $0       | Self-built                       |
| Hosting (Vercel) | $0       | Hobby tier                       |
| PostgreSQL       | $0       | Docker local / Neon free tier    |
| Redis            | $0       | Docker local / Upstash free tier |
| Domain           | $12/year | sotto.fm                         |
| **Total**        | **~$12** |                                  |

### Phase 2: Friends & Family (Month 2-3) -- $50/month

| Item               | Monthly Cost | Notes                                |
| ------------------ | ------------ | ------------------------------------ |
| Vercel Pro         | $20          | Production hosting                   |
| Railway (workers)  | $5           | Worker compute                       |
| ElevenLabs Starter | $5           | 30K chars/month (~2 podcasts)        |
| Anthropic API      | $10          | Claude usage for ~50 discovery chats |
| R2 Storage         | $0           | 10GB free tier                       |
| Neon DB            | $0           | Free tier                            |
| Upstash Redis      | $0           | Free tier                            |
| **Total**          | **~$40**     |                                      |

### Phase 3: Public Beta (Month 3-6) -- $230/month

See fixed infrastructure table above.

### Phase 4: Growth (Month 6-12) -- $1,000-3,000/month

Scale costs depend on user growth and premium credit usage patterns. The dual-TTS model means standard podcast costs scale linearly at $0.36/podcast (negligible). Premium credits are the main variable.

---

## Initial Investment Summary

| Phase                | Duration       | Total Cost         | What You Get                          |
| -------------------- | -------------- | ------------------ | ------------------------------------- |
| MVP                  | 2 months       | ~$25               | Working product, local testing        |
| Friends & Family     | 1 month        | ~$120              | 20-50 real users, feedback            |
| Public Beta          | 3 months       | ~$700              | 200+ users, product-market fit signal |
| Growth               | 6 months       | ~$6,000-18,000     | 1,000+ users, revenue                 |
| **Total to revenue** | **~12 months** | **~$7,000-19,000** |                                       |
