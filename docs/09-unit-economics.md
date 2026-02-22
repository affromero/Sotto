# Unit Economics — Free + Pro + BYOK Model

> Three-tier model: Free (1/day, platform AI), Pro ($12/mo, unlimited), BYOK (unlimited, own keys).
> Last updated: February 2026

---

## Revenue Streams

| Stream | Model | Platform Take |
|---|---|---|
| Pro subscriptions | $12/month recurring (Stripe) | 100% minus Stripe fees |
| Voice marketplace | Per-podcast price set by creator | 10% platform fee via Stripe Connect |
| BYOK | Free — users pay their own providers | $0 revenue, $0 AI cost |

---

## Platform Cost Per Podcast

When Sotto generates a podcast (Free or Pro tier), the platform pays for AI compute.
BYOK users cost us nothing beyond infrastructure.

### AI Cost: Groq (hosted, pay-per-token)

| Tier | Model | Input (8K tokens) | Output (4K tokens) | Total AI/podcast |
|---|---|---|---|---|
| Free | Llama 3.1 8B Instant | $0.0004 | $0.00032 | **~$0.0007** |
| Pro | Llama 3.3 70B Versatile | $0.0047 | $0.0032 | **~$0.008** |

Prices: 8B = $0.05/M in, $0.08/M out · 70B = $0.59/M in, $0.79/M out.
Token estimate: one full podcast (script gen + Q&A + discovery chat ≈ 12K input, 5K output).

### TTS Cost: KittenTTS (self-hosted, CPU-only sidecar)

**$0.** Runs on the existing VPS. No per-request charge.
Tradeoff vs. ElevenLabs ($2.55/podcast) or OpenAI TTS ($0.23/podcast): quality is lower,
which is why BYOK users can bring premium TTS and Pro users still use KittenTTS (for now —
see roadmap).

### Infrastructure Per Podcast

| Component | Cost |
|---|---|
| R2 storage (~15MB audio) | $0.0002 |
| FFmpeg (concat + normalize) | $0.001 |
| Redis + Postgres overhead | $0.001 |
| **Total infra** | **~$0.002** |

### Combined Platform Cost

| Tier | AI | TTS | Infra | **Total** |
|---|---|---|---|---|
| Free | $0.0007 | $0 | $0.002 | **~$0.003** |
| Pro | $0.008 | $0 | $0.002 | **~$0.010** |
| BYOK | $0 | $0 | $0.002 | **~$0.002** |

---

## Pro Tier Unit Economics

**Price:** $12.00/month
**Stripe fee:** 2.9% + $0.30 = ~$0.65/month
**Net revenue per subscriber:** ~$11.35/month

| Assumption | Conservative | Base | Optimistic |
|---|---|---|---|
| Podcasts/month per Pro user | 15 | 30 | 60 |
| AI cost (30 × $0.010) | $0.15 | $0.30 | $0.60 |
| Infra share | $0.08 | $0.10 | $0.15 |
| **Gross profit/subscriber** | **$11.12** | **$10.95** | **$10.60** |
| **Gross margin** | **98%** | **96%** | **93%** |

This is a SaaS gross margin profile. The model works at any realistic usage level.

---

## Fixed Infrastructure Cost

| Scale | VPS | Storage | Monthly | Annual |
|---|---|---|---|---|
| 0–500 users | CPX41 8 vCPU (KittenTTS needs headroom) | 1TB | **$30** | $360 |
| 500–2K users | CPX51 16 vCPU | 1TB | **$55** | $660 |
| 2K–10K users | 2× CCX33 | 2TB | **$115** | $1,380 |
| 10K–50K users | Dedicated + CDN | 5TB | **~$400** | $4,800 |

Note: Upgraded from CX32 to CPX41 baseline because KittenTTS is CPU-intensive
(2–4 vCPU per concurrent synthesis). The $8/month CX32 is too tight under real load.

---

## Break-Even Analysis

**Monthly fixed cost:** ~$30 (CPX41 VPS + storage + domain)

| Pro subscribers | Monthly revenue | AI cost (30 pods/mo) | Infra | **Net P&L** |
|---|---|---|---|---|
| 1 | $11.35 | $0.30 | $30 | **-$19** |
| 3 | $34.05 | $0.90 | $30 | **+$3** |
| 5 | $56.75 | $1.50 | $30 | **+$25** |
| 10 | $113.50 | $3.00 | $30 | **+$80** |
| 50 | $567.50 | $15.00 | $30 | **+$522** |
| 100 | $1,135 | $30.00 | $55 | **+$1,050** |

**Break-even: 3 Pro subscribers.** That is not a typo.

---

## Growth Scenarios

### Scenario A — 500 MAU, 3% Pro conversion (15 Pro)
| | |
|---|---|
| Pro revenue | $170/month |
| AI cost (free: 485 × 30 × $0.003 + pro: 15 × 30 × $0.010) | $48 |
| Infrastructure | $30 |
| Stripe fees | $10 |
| Voice marketplace (est. $50 GMV) | +$5 |
| **Net** | **+$87/month** |

### Scenario B — 2,000 MAU, 5% Pro conversion (100 Pro)
| | |
|---|---|
| Pro revenue | $1,135/month |
| AI cost (free: 1,900 × 30 × $0.003 + pro: 100 × 30 × $0.010) | $201 |
| Infrastructure | $55 |
| Stripe fees | $65 |
| Voice marketplace (est. $200 GMV) | +$20 |
| **Net** | **+$834/month (~$10K ARR)** |

### Scenario C — 10,000 MAU, 5% Pro conversion (500 Pro)
| | |
|---|---|
| Pro revenue | $5,675/month |
| AI cost (free: 9,500 × 30 × $0.003 + pro: 500 × 30 × $0.010) | $1,005 |
| Infrastructure | $115 |
| Stripe fees | $325 |
| Voice marketplace (est. $1,000 GMV) | +$100 |
| **Net** | **+$4,430/month (~$53K ARR)** |

**Net margin at scale: ~78%.** Most SaaS companies target 60–80%. This exceeds that because
TTS is on-VPS (zero marginal cost) and LLM costs are negligible at these token volumes.

---

## BYOK Users: Why They're Still Worth Having

BYOK users cost ~$0.002/podcast (infra only). They don't pay — but they:
1. Fill the public feed with content, increasing value for everyone
2. Qualify as organic word-of-mouth (power users, developers)
3. Convert to Pro when they want features: priority queue, analytics, private podcasts
4. May eventually join the voice marketplace (revenue from their voice clones)

CAC for BYOK users is $0. They are free distribution.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| KittenTTS quality too low → no Pro conversions | High | Upgrade Pro to a premium TTS option (ElevenLabs BYOK subsidy or Cartesia) |
| Groq 8B quality insufficient → free tier doesn't hook users | Medium | Tune prompts; fall back to Anthropic if Groq is unavailable |
| Groq pricing increases | Low | Abstraction layer in `ai.ts` → swap to another hosted inference in hours |
| High CPU load from KittenTTS → VPS upgrade needed | Medium | CPX41 has headroom for ~20 concurrent syntheses; upgrade at 500+ DAU |
| Low Pro conversion (< 2%) | Medium | Add more Pro-exclusive features; push analytics and priority more visibly |
| Free users overwhelm Groq rate limits | Low | Groq free tier: 14,400 req/day; paid tier is cheap (~$0.0007/req) |

---

## Key Metrics to Track

| Metric | Definition | Target |
|---|---|---|
| Pro conversion rate | Pro subscribers / registered users | > 3% |
| MRR | Monthly recurring Pro revenue | $1K → $10K → $50K |
| Cost per free user/month | Platform AI cost for free-tier MAU | < $0.10 |
| Gross margin | (MRR - AI cost - Stripe fees) / MRR | > 90% |
| DAU/MAU ratio | Engagement stickiness | > 30% |
| Free → Pro time | Days from signup to first Pro payment | < 30 days |
| Voice marketplace GMV | Monthly gross voice revenue | Track growth |

---

## Bottom Line

**Sotto is profitable at 3 Pro subscribers.** Gross margins exceed 90% at any realistic
usage level because TTS is on-VPS (free) and LLM costs are fractions of a cent per podcast.

The ceiling is high: at 10K MAU with 5% Pro conversion, net profit exceeds $50K ARR from
subscriptions alone — before voice marketplace revenue, which scales independently.

The risk is not economics. The risk is whether the free tier AI quality (Llama 8B +
KittenTTS) is good enough to convert users to Pro. That's a product question, not a
financial one.
