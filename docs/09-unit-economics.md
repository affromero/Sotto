# Unit Economics & Business Model

> ElevenLabs-only TTS model, tier profitability, breakeven targets, and guardrails to prevent runaway costs.

---

## ElevenLabs-Only TTS Model

Sotto uses **ElevenLabs exclusively** for all TTS. Quality is the product — no OpenAI TTS fallback. Every user hears premium voices from day one.

| Provider                    | Tier  | Cost per 1K chars | 5-min podcast (~7.5K chars) | 10-min podcast (~15K chars) |
| --------------------------- | ----- | ----------------- | --------------------------- | --------------------------- |
| **ElevenLabs** (scale tier) | Scale | $0.17             | ~$1.28                      | ~$2.55                      |

---

## Cost Per Podcast

### 5-Minute Podcast (Free tier)

| Component                         | Cost       |
| --------------------------------- | ---------- |
| Claude discovery (5 exchanges)    | $0.05      |
| Claude script generation          | $0.04      |
| ElevenLabs TTS audio (7.5K chars) | $1.28      |
| Sound effects (bundled stock)     | $0.00      |
| R2 storage (~7.5MB)               | $0.0001    |
| FFmpeg compute                    | $0.001     |
| **Total**                         | **~$1.37** |

### 10-Minute Podcast (Starter / Pro / Studio)

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

|                          | Free      | Starter   | Pro       | Studio                   |
| ------------------------ | --------- | --------- | --------- | ------------------------ |
| **Price**                | $0        | $14/mo    | $34/mo    | $69/mo                   |
| **Credits/month**        | 1         | 3         | 10        | 20                       |
| **Rollover credits**     | 0         | 1         | 3         | 8                        |
| **Duration**             | 5 min     | 10 min    | 10 min    | 10 min                   |
| **Interactions**         | 2/podcast | 5/podcast | Unlimited | Unlimited                |
| **Voice clones**         | 0         | 1         | 3         | 10                       |
| **Sound effects**        | Standard  | Standard  | Standard  | Premium (ElevenLabs SFX) |
| **Download**             | No        | Yes       | Yes       | Yes                      |
| **Private podcasts**     | No        | No        | Yes       | Yes                      |
| **Voice library**        | No        | Yes       | Yes       | Yes                      |
| **Marketplace**          | No        | No        | No        | Yes                      |
| **Analytics/PDF export** | No        | No        | Yes       | Yes                      |

**Credit Packs (one-time purchase)**: 3 credits ($7), 10 credits ($20), 25 credits ($45)

Each podcast generation costs 1 credit. All tiers use ElevenLabs TTS — no surcharge system.

---

## Tier Profitability — Worst Case (Every User Maxes Out)

| Tier          | Revenue | Max cost            | Margin           |
| ------------- | ------- | ------------------- | ---------------- |
| Free          | $0      | 1 x $1.37 = $1.37   | -$1.37 (CAC)     |
| Starter ($14) | $14     | 3 x $2.78 = $8.34   | **$5.66 (40%)**  |
| Pro ($34)     | $34     | 10 x $2.78 = $27.80 | **$6.20 (18%)**  |
| Studio ($69)  | $69     | 20 x $2.78 = $55.60 | **$13.40 (19%)** |

### Key Insight

**All paid tiers are profitable even at worst case.** This is a fundamental improvement over the old dual-TTS model where Studio was -184% at max usage. The key changes that made this work:

1. ElevenLabs-only eliminates the unpredictable premium/standard mix
2. Reduced credit counts match the higher per-podcast cost
3. Higher prices ($14/$34/$69) reflect the true cost of premium TTS
4. Free tier at 5 min keeps CAC low ($1.37)

---

## Tier Profitability — Realistic (Average Usage)

| Tier          | Revenue | Avg cost            | Margin           |
| ------------- | ------- | ------------------- | ---------------- |
| Free          | $0      | 1 x $1.37 = $1.37   | -$1.37 (CAC)     |
| Starter ($14) | $14     | 2 x $2.78 = $5.56   | **$8.44 (60%)**  |
| Pro ($34)     | $34     | 6 x $2.78 = $16.68  | **$17.32 (51%)** |
| Studio ($69)  | $69     | 12 x $2.78 = $33.36 | **$35.64 (52%)** |

Average usage assumptions:

- Free users create 1 podcast (100% utilization — it's their only credit)
- Starter users ~2 podcasts (67% utilization)
- Pro users ~6 podcasts (60% utilization)
- Studio users ~12 podcasts (60% utilization)

All tiers maintain healthy margins at realistic usage: 51-60% for paid tiers.

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
| ElevenLabs Scale     | $330         |
| **Total**            | **~$460**    |

### Subscribers Needed to Cover Fixed Costs

| Scenario                                 | Margin/subscriber | Subscribers needed |
| ---------------------------------------- | ----------------- | ------------------ |
| All Starter                              | $8.44             | 55                 |
| All Pro                                  | $17.32            | 27                 |
| All Studio                               | $35.64            | 13                 |
| Mixed (50% Starter, 30% Pro, 20% Studio) | $17.53 avg        | 26                 |

---

## Revenue Projections (Conservative)

| Month | Free Users | Starter Users | Pro Users | Studio Users | MRR    | Est. COGS | Gross Profit |
| ----- | ---------- | ------------- | --------- | ------------ | ------ | --------- | ------------ |
| 3     | 50         | 0             | 0         | 0            | $0     | $69       | -$529        |
| 6     | 200        | 10            | 5         | 0            | $310   | $484      | -$634        |
| 9     | 500        | 25            | 15        | 3            | $1,067 | $842      | -$235        |
| 12    | 1,000      | 50            | 35        | 8            | $2,442 | $1,500    | $482         |

Note: Higher fixed costs (ElevenLabs Scale at $330/mo) push breakeven later than the old dual-TTS model, but margins are healthier and predictable once past breakeven.

---

## Guardrails to Prevent Runaway Costs

### 1. Hard Credit Caps (No Infinity Anywhere)

Every tier has explicit credit limits enforced in `canGenerate()`:

- Free: 1 credit/mo (0 rollover)
- Starter: 3 credits/mo (1 rollover)
- Pro: 10 credits/mo (3 rollover)
- Studio: 20 credits/mo (8 rollover)

No tier uses `Infinity` for any limit except Pro/Studio interactions (see breakdown below).

### Interaction & Incorporation Costs

| Operation                         | Service         | Est. Input   | Est. Output | Cost per call |
| --------------------------------- | --------------- | ------------ | ----------- | ------------- |
| Q&A interaction                   | Claude (Sonnet) | ~1K tokens   | ~300 tokens | ~$0.02        |
| Incorporation (script generation) | Claude (Sonnet) | ~1.5K tokens | ~200 tokens | ~$0.02        |
| Incorporation (TTS)               | ElevenLabs      | ~500 chars   | —           | ~$0.085       |
| Incorporation (re-stitch)         | FFmpeg          | —            | —           | ~$0.001       |

**Per-interaction total**: ~$0.02 (Q&A only, no audio cost).

**Per-incorporation total**: ~$0.11 (Q&A + script gen + TTS + re-stitch).

**Worst-case scenario** (Studio user, 20 podcasts, unlimited interactions, 5 incorporations each):

- 100 interactions x $0.02 = $2.00
- 100 incorporations x $0.11 = $11.00
- Combined: ~$13.00 (well within Studio's $69 revenue after $55.60 generation costs)

Pro/Studio interactions are unlimited because the per-call cost (~$0.02) is negligible relative to subscription revenue. Incorporation re-stitching skips SFX to avoid repositioning costs.

### 2. Credits Tracked Per Billing Cycle

The `Subscription.creditsUsed` counter resets on period renewal (via Stripe webhook). Enforced in `consumeCredit()` — throws if depleted.

### 3. Sound Effects Cost Isolation

- Free/Starter/Pro: bundled stock SFX files (zero marginal cost)
- Studio: ElevenLabs `generateSoundEffect()` API (~$0.10 per podcast)
- If ElevenLabs SFX generation fails, gracefully falls back to stock SFX

### 4. Rate Limiting

API routes (especially `/api/podcasts` POST and `/api/podcasts/[id]/generate` POST) enforce rate limits via Redis to prevent abuse.

### 5. Monthly Cost Monitoring

`ApiUsageLog` tracks per-user, per-service costs. Alert if a single user's API costs exceed 80% of their subscription revenue in a billing period.

### 6. ElevenLabs Tier Negotiation

At scale (>500 podcasts/month), negotiate ElevenLabs Enterprise pricing. Current Scale tier ($330/mo) includes ~2M chars/month (~133 podcasts). Enterprise pricing could reduce per-char cost by 30-50%.

---

## Key Metrics to Track

| Metric                    | Definition                           | Target                        |
| ------------------------- | ------------------------------------ | ----------------------------- |
| **CAC**                   | Customer Acquisition Cost            | < $5 (organic/social)         |
| **LTV**                   | Lifetime Value (Starter)             | $14 x 8 months = $112         |
| **LTV**                   | Lifetime Value (Pro)                 | $34 x 8 months = $272         |
| **LTV:CAC**               | Ratio                                | > 3:1                         |
| **Churn**                 | Monthly paid churn                   | < 10%                         |
| **Activation**            | % signups -> first podcast           | > 50%                         |
| **Conversion**            | Free -> paid                         | > 5%                          |
| **COGS/Revenue**          | Cost of goods sold ratio             | < 50%                         |
| **Credit burn rate**      | Avg credits used / credits available | Track monthly                 |
| **Credit utilization**    | Avg credits used per subscriber      | Track per tier                |
| **Rollover accumulation** | Avg rollover credits held per user   | Monitor for "credit hoarders" |

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

### Phase 2: Friends & Family (Month 2-3) -- $70/month

| Item               | Monthly Cost | Notes                                |
| ------------------ | ------------ | ------------------------------------ |
| Vercel Pro         | $20          | Production hosting                   |
| Railway (workers)  | $5           | Worker compute                       |
| ElevenLabs Creator | $22          | 100K chars/month (~6 podcasts)       |
| Anthropic API      | $10          | Claude usage for ~50 discovery chats |
| R2 Storage         | $0           | 10GB free tier                       |
| Neon DB            | $0           | Free tier                            |
| Upstash Redis      | $0           | Free tier                            |
| **Total**          | **~$57**     |                                      |

### Phase 3: Public Beta (Month 3-6) -- $460/month

See fixed infrastructure table above.

### Phase 4: Growth (Month 6-12) -- $2,000-5,000/month

Scale costs depend on user growth. ElevenLabs is the primary cost driver at $2.78/podcast. At 500 podcasts/month, TTS costs alone are ~$1,390. Enterprise ElevenLabs pricing becomes critical at this stage.

---

## Initial Investment Summary

| Phase                | Duration       | Total Cost          | What You Get                          |
| -------------------- | -------------- | ------------------- | ------------------------------------- |
| MVP                  | 2 months       | ~$25                | Working product, local testing        |
| Friends & Family     | 1 month        | ~$170               | 20-50 real users, feedback            |
| Public Beta          | 3 months       | ~$1,400             | 200+ users, product-market fit signal |
| Growth               | 6 months       | ~$12,000-30,000     | 1,000+ users, revenue                 |
| **Total to revenue** | **~12 months** | **~$14,000-32,000** |                                       |
