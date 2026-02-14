# Unit Economics — Free BYOK Model

> Sotto is 100% free. Users bring their own API keys. Sotto's cost is infrastructure only.
> Last updated: February 2026

---

## BYOK Model: Sotto Pays Nothing for AI

With full BYOK (user provides LLM + TTS keys), Sotto's cost per podcast is:

| Component | Cost |
|---|---|
| R2/local storage (~15MB audio) | $0.0002 |
| FFmpeg compute (concat + normalize) | $0.001 |
| Redis queue overhead | ~$0.0005 |
| PostgreSQL storage (metadata) | ~$0.0005 |
| **Total per podcast** | **~$0.002** |

Two-tenths of a cent. At 1,000 podcasts/day, variable cost is $2/day ($60/month).

---

## User's Cost per Podcast (They Pay Their Own Provider)

### LLM Cost (discovery + script + Q&A)

| Provider + Model | Cost per Podcast | Notes |
|---|---|---|
| Gemini 2.0 Flash | $0.004 | Ultra-budget |
| DeepSeek-V3 | $0.005 | Cheapest available |
| GPT-4o-mini | $0.005 | OpenAI budget |
| Claude Haiku 4.5 | $0.076 | Fast + quality |
| Claude Sonnet 4.5 | $0.108 | Best quality |

### TTS Cost (audio generation, ~15K chars for 10 min)

| Provider | Cost per Podcast | Quality | Free Tier |
|---|---|---|---|
| Google Cloud TTS (WaveNet) | $0.24 | Good | 1M chars/mo (~66 podcasts FREE) |
| Amazon Polly (Neural) | $0.24 | Good | 1M chars/mo for 12 months |
| Azure Speech (Neural) | $0.24 | Good | 5M chars/mo (~333 podcasts FREE) |
| OpenAI TTS-1 | $0.23 | Good | None |
| OpenAI TTS-1-HD | $0.45 | Better | None |
| Cartesia Sonic | $0.75 | Good | Limited |
| ElevenLabs (Scale) | $2.55 | Best | 10K chars/mo |

### Total User Cost (cheapest path)

| Scenario | LLM | TTS | User Total |
|---|---|---|---|
| Budget (Gemini Flash + Google WaveNet free tier) | $0.004 | $0.00 | **$0.004** |
| Balanced (Claude Haiku + OpenAI TTS-1) | $0.076 | $0.23 | **$0.31** |
| Premium (Claude Sonnet + ElevenLabs) | $0.108 | $2.55 | **$2.66** |
| One-key (OpenAI GPT-4o-mini + OpenAI TTS-1-HD) | $0.005 | $0.45 | **$0.46** |

**Lowest friction path**: One OpenAI API key covers both LLM and TTS. ~$0.46/podcast.

---

## Fixed Infrastructure Cost

### Current (Hetzner VPS)

| Component | Monthly |
|---|---|
| Hetzner CPX31 (4 vCPU, 8GB RAM) | $11 |
| Storage Box 1TB | $4 |
| Automated backups | $2 |
| Domain (sotto.fm) | $1 |
| Cloudflare CDN (free tier) | $0 |
| SSL (Let's Encrypt via Caddy) | $0 |
| **Total** | **~$18/month** |

### Scaling roadmap

| Users | VPS | Storage | Total/Month | Total/Year |
|---|---|---|---|---|
| 0-500 | CPX31 ($11) | 1TB ($4) | ~$18 | ~$216 |
| 500-1K | CPX41 ($21) | 1TB ($4) | ~$28 | ~$336 |
| 1K-5K | CCX33 ($55) | 1TB ($4) | ~$62 | ~$744 |
| 5K-10K | 2x servers ($100) | 2TB ($8) | ~$115 | ~$1,380 |

**At no scale does Sotto require revenue to survive.** Even at 10K users, the annual cost is ~$1,400.

---

## Comparison: Old vs New Economics

| Metric | Old (5-Tier Paid) | New (Free BYOK) |
|---|---|---|
| Revenue needed to survive | $460/month | $0 |
| Paying subscribers needed | 20-30 | 0 |
| COGS per podcast | $0.55-$2.65 | $0.002 |
| Monthly burn | $460 | $18 |
| Annual burn | $5,520 | $216 |
| Time to bankruptcy (no revenue) | ~12 months | Never |
| Billing complexity | Stripe webhooks, credit tracking, 5 tiers | None |
| User friction | Credit walls, tier gates | API key setup (one-time) |

---

## Rate Limits (Abuse Prevention)

Without credits as a natural limiter, Redis-based rate limits prevent abuse:

| Action | Limit | Window |
|---|---|---|
| Podcast generation | 20 | Per hour |
| Podcast generation | 100 | Per day |
| Interactions (Q&A) | 60 | Per hour |
| Imports | 10 | Per hour |
| Fork | 20 | Per hour |
| Discovery chat | 120 | Per hour |

These are generous for legitimate use and only block automated abuse.

---

## Platform Keys (Seeding & Dev)

Sotto may use platform-owned API keys for:

1. **Content seeding**: @sotto system account generates seed podcasts for the feed
2. **Twitter bot**: @sottofm mentions processing
3. **Development**: `AI_PROVIDER=claude-code` mode uses Claude CLI (no API key needed)

Platform key costs (seeding budget):

| Activity | Monthly Budget | Podcasts |
|---|---|---|
| Feed seeding (Claude Sonnet + OpenAI TTS) | ~$50 | ~100 podcasts |
| Twitter bot (Claude Haiku) | ~$5 | ~65 responses |
| **Total platform AI spend** | **~$55/month** | — |

This is optional and temporary — once the network has content, organic creation sustains the feed.

---

## Key Metrics to Track

| Metric | Definition | Why It Matters |
|---|---|---|
| WAL | Weekly Active Listeners | Core engagement metric |
| Podcasts/day | New podcasts created per day | Content velocity |
| Fork rate | Forks per public podcast | Network effect strength |
| Key setup rate | % of signups who configure keys | Onboarding health |
| Time to first podcast | Minutes from signup to first creation | Friction measurement |
| Return rate | % of users who come back in 7 days | Retention |
| Feed browse rate | Users who browse feed without creating | Network value signal |

---

## Bottom Line

Sotto's burn rate is $18-60/month depending on scale. There is no revenue target, no breakeven point, no subscriber count to hit. The product sustains itself indefinitely on infrastructure costs alone.

The question is not "can Sotto survive?" — it can, for years, on pocket change. The question is "can Sotto grow?" — and that depends on the network effects, not the economics.
