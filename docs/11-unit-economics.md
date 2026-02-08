# Unit Economics & Bootstrapping Budget

> Cost analysis per user, initial investment requirements, and path to profitability.

---

## Cost Per Podcast Generation

Each podcast generation incurs costs across three services:

| Service | Operation | Cost per Unit | Units per Podcast (10 min) | Cost per Podcast |
|---------|-----------|--------------|--------------------------|-----------------|
| **Claude** | Discovery chat (5 exchanges) | ~$0.01/exchange | 5 | $0.05 |
| **Claude** | Script generation | ~$0.08/script | 1 | $0.08 |
| **Claude** | Q&A interaction | ~$0.02/interaction | 0 (avg) | $0.00 |
| **ElevenLabs** | TTS audio (10 min) | $0.30/1K chars | ~15K chars | $4.50 |
| **R2 Storage** | Audio file (~15MB) | $0.015/GB/month | 0.015 GB | $0.0002 |
| **FFmpeg** | Stitching (compute) | ~$0.001/min | 1 | $0.001 |
| | | | **Total** | **~$4.63** |

### Key Insight: ElevenLabs is 97% of COGS

Audio generation dominates cost. Everything else is negligible.

### Cost by Tier

| Tier | Price | Max Podcasts | Max Cost (all used) | Gross Margin |
|------|-------|-------------|--------------------|--------------| 
| **Free** | $0 | 3/month | $13.89 | -$13.89 |
| **Pro** | $19/month | 20/month | $92.60 | -$73.60 (if all 20 used) |
| **Team** | $49/month | Unlimited | Variable | Depends on usage |

### Realistic Usage (not all users max out)

| Tier | Avg Podcasts/User/Month | Avg Cost/User | Revenue/User | Gross Margin |
|------|------------------------|---------------|-------------|--------------|
| **Free** | 1.2 | $5.56 | $0 | -$5.56 |
| **Pro** | 6 | $27.78 | $19 | -$8.78 |
| **Team** | 15 (across seats) | $69.45 | $49 | -$20.45 |

### Problem: Negative Gross Margins

At current ElevenLabs pricing ($0.30/1K chars), every tier is **unprofitable**. Solutions:

1. **ElevenLabs Enterprise plan** — negotiate volume pricing (target: $0.10/1K chars → $1.50/podcast → Pro becomes profitable)
2. **Open-source TTS** — Coqui TTS, Bark, or XTTS v2 for self-hosted audio (cost: ~$0.05/podcast on GPU)
3. **Shorter default podcasts** — 5 min default for Free tier (halves cost)
4. **Caching** — If someone generates a similar podcast, serve cached version (amortize cost across users)
5. **Hybrid approach** — Self-hosted TTS for Free tier, ElevenLabs for Pro/Team (premium quality)

### Target Unit Economics (with optimizations)

| Tier | Avg Cost/User | Revenue/User | Gross Margin | Gross % |
|------|---------------|-------------|--------------|---------|
| **Free** | $0.50 | $0 | -$0.50 | N/A |
| **Pro** | $3.00 | $19 | $16.00 | 84% |
| **Team** | $7.00 | $49 | $42.00 | 86% |

---

## Bootstrapping Budget

### Phase 1: MVP (Month 1-2) — $0

| Item | Cost | Notes |
|------|------|-------|
| Development | $0 | Self-built |
| Hosting (Vercel) | $0 | Hobby tier |
| PostgreSQL | $0 | Docker local / Neon free tier |
| Redis | $0 | Docker local / Upstash free tier |
| Domain | $12/year | sotto.fm or sotto.audio |
| **Total** | **~$12** | |

### Phase 2: Friends & Family (Month 2-3) — $50-100/month

| Item | Monthly Cost | Notes |
|------|-------------|-------|
| Vercel Pro | $20 | Production hosting |
| Railway (workers) | $5 | Worker compute |
| ElevenLabs Starter | $5 | 30K chars/month (~2 podcasts) |
| Anthropic API | $10 | Claude usage for ~50 discovery chats |
| R2 Storage | $0 | 10GB free tier |
| Neon DB | $0 | Free tier (0.5GB) |
| Upstash Redis | $0 | Free tier |
| **Total** | **~$40** | |

### Phase 3: Public Beta (Month 3-6) — $200-500/month

| Item | Monthly Cost | Notes |
|------|-------------|-------|
| Vercel Pro | $20 | |
| Railway (workers) | $20 | More worker capacity |
| ElevenLabs Scale | $99 | 500K chars/month (~33 podcasts) |
| Anthropic API | $50 | ~250 discovery chats + scripts |
| R2 Storage | $5 | ~300GB stored audio |
| Neon DB | $25 | Production tier |
| Upstash Redis | $10 | Pro tier |
| PostHog | $0 | Free tier (1M events) |
| Sentry | $0 | Free tier |
| **Total** | **~$230** | |

### Phase 4: Growth (Month 6-12) — $1,000-3,000/month

Scale costs depend heavily on user growth and TTS strategy (ElevenLabs vs self-hosted).

---

## Revenue Projections

### Conservative Scenario

| Month | Free Users | Pro Users | Team Users | MRR |
|-------|-----------|-----------|------------|-----|
| 3 | 50 | 0 | 0 | $0 |
| 6 | 200 | 5 | 0 | $95 |
| 9 | 500 | 15 | 1 | $334 |
| 12 | 1,000 | 40 | 3 | $907 |

### Breakeven Analysis

- **Fixed costs**: ~$230/month (Phase 3 infrastructure)
- **Variable cost**: ~$4.63/podcast (or ~$0.50 with self-hosted TTS)
- **Pro subscriber breakeven**: $230 / ($19 - $3) = **15 Pro subscribers**
- **With self-hosted TTS**: $230 / ($19 - $0.50) = **13 Pro subscribers**

---

## Key Metrics to Track

| Metric | Definition | Target |
|--------|-----------|--------|
| **CAC** | Customer Acquisition Cost | < $5 (organic/social) |
| **LTV** | Lifetime Value (Pro) | $19 × 6 months = $114 |
| **LTV:CAC** | Ratio | > 3:1 |
| **Churn** | Monthly Pro churn | < 10% |
| **Activation** | % signups → first podcast | > 50% |
| **Conversion** | Free → Pro | > 5% |
| **COGS/Revenue** | Cost of goods sold ratio | < 30% |

---

## Initial Investment Summary

| Phase | Duration | Total Cost | What You Get |
|-------|----------|-----------|--------------|
| MVP | 2 months | ~$25 | Working product, local testing |
| Friends & Family | 1 month | ~$120 | 20-50 real users, feedback |
| Public Beta | 3 months | ~$700 | 200+ users, product-market fit signal |
| Growth | 6 months | ~$6,000-18,000 | 1,000+ users, revenue |
| **Total to revenue** | **~12 months** | **~$7,000-19,000** | |

The biggest variable is TTS cost. Self-hosting TTS with GPU (e.g., Lambda Cloud at $0.50/hr) drops cost by 90% but requires engineering effort for quality parity with ElevenLabs.
