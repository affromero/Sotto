# Post-Pivot Analysis — Sotto: The Free BYOK Network

> **Date**: 2026-02-14
>
> **Summary**: Second pivot analysis. Pivot 1 moved Sotto from "Podcasts That Listen Back" (interactive Q&A tool) to "The Open Podcast Network" (social platform with import, fork, remix). Pivot 2 goes further: strip all monetization, make every feature free, require users to bring their own API keys (LLM + TTS). The value is the network, not the AI generation. This document explains why, what changes, and what the new odds look like.

---

## 1. Two Pivots

### Pivot 1: Tool to Network (Feb 2026)

Sotto launched as an interactive Q&A podcast tool. Google NotebookLM, Hume Chatterbox, and ElevenLabs GenFM all shipped competing features within 12 months. The pivot repositioned around social features no competitor had: feed, fork, remix, import, citation verification. Detailed in the original version of this document.

**Result**: Better positioning, but the 5-tier credit-based billing model created friction at every step. Users hit credit walls, feature gates, and tier checks before they could experience the network.

### Pivot 2: Paid to Free BYOK (Feb 2026)

**Core insight**: AI generation is a commodity. Charging for it is a losing strategy.

- LLM costs range from $0.004/podcast (Gemini Flash) to $0.108/podcast (Claude Sonnet) — and falling
- Google Cloud TTS offers 1M chars/month FREE (66 podcasts). Azure offers 5M chars FREE
- Every AI provider is building consumer podcast products — they'll always undercut platform pricing
- The value isn't generation. The value is the network: discovery, forks, remix culture, community Q&A, collections

**The GitHub analogy**: GitHub doesn't compile your code — Sotto doesn't generate your podcast. Both provide the social layer on top of commodity infrastructure. GitHub charges for private repos and team features, not for `git push`. Sotto should charge for nothing — the network IS the product.

---

## 2. The Commodity Thesis

### AI costs are in freefall

Data from `docs/11-provider-pricing.md`:

| Provider + Model | Cost per Podcast (LLM) | Trend |
|---|---|---|
| DeepSeek-V3 | $0.005 | Racing to zero |
| Gemini 2.0 Flash | $0.004 | Google subsidizing |
| GPT-4o-mini | $0.005 | OpenAI budget tier |
| Claude Haiku 4.5 | $0.076 | Premium but dropping |
| Claude Sonnet 4.5 | $0.108 | Highest quality |

LLM cost is **<2% of total podcast COGS**. The model choice barely matters financially.

### TTS has free tiers

| Provider | Free Tier | Podcasts/Month (Free) |
|---|---|---|
| Google Cloud TTS | 1M chars/month (WaveNet) | ~66 |
| Azure Speech | 5M chars/month | ~333 |
| Amazon Polly | 5M chars (standard) + 1M (neural) for 12 months | ~66-333 |
| ElevenLabs | 10K chars/month | ~0.7 |

A user with a Google Cloud or Azure free tier key can generate dozens of podcasts per month at **zero cost to anyone**.

### Every AI provider is a competitor

ElevenLabs ($11B) shipped GenFM. Google ships NotebookLM. OpenAI, Hume, and every major AI company will ship podcast generation. Charging for generation means competing on price against companies with infinite resources. The only defensible position is the network layer they don't have.

---

## 3. What Changes

| Dimension | Old Model (5 Tiers) | New Model (Free BYOK) |
|---|---|---|
| Pricing | Free / Starter $14 / Pro $34 / Studio $69 / Power $9 | Free. Everything. |
| Payment processor | Stripe (checkout, portal, webhooks) | None. Stripe removed entirely. |
| Credits | 1-50/month depending on tier | No credits. No limits (rate-limited only). |
| Feature gates | Download, private, PDF, SFX, voice clones gated by tier | All features available to all users. |
| LLM keys | Platform-provided (Anthropic) | User BYOK required (Anthropic or OpenAI) |
| TTS keys | Platform + BYOK for Power tier | User BYOK required (any of 5 providers) |
| Voice clones | 0-10 depending on tier | 10 for everyone |
| Duration limit | 5 min (Free) / 10 min (paid) | 30 min for everyone |
| Rate limits | Credit-based (natural limiter) | Redis-based: 20 gen/hr, 100/day, 60 interactions/hr |
| Onboarding | Sign up, explore, hit credit wall | Sign up, configure API keys, create unlimited |
| Dev mode | Needs API keys | `AI_PROVIDER=claude-code` — no keys needed |

### What stays the same

- Social feed, fork, remix, import, citation verification, interactive Q&A
- Multi-provider TTS architecture (ElevenLabs, OpenAI, PlayHT, Cartesia, Hume)
- 16-voice diversity pool, sound effects, production quality
- Twitter bot (@sottofm), admin dashboard, team features

---

## 4. New Economics

### Sotto's cost per podcast with full BYOK

When users bring their own LLM + TTS keys, Sotto's cost is:

| Component | Cost |
|---|---|
| R2 storage (~15MB audio) | $0.0002 |
| FFmpeg compute | $0.001 |
| Redis/Postgres overhead | ~$0.001 |
| **Total per podcast** | **~$0.002** |

That's two-tenths of a cent per podcast. At 1,000 podcasts/day, Sotto's variable cost is $2/day.

### Fixed infrastructure

From `docs/18-hosting-infrastructure.md`:

| Component | Monthly Cost |
|---|---|
| Hetzner CPX31 (4 vCPU, 8GB) | $11 |
| Hetzner Storage Box 1TB | $4 |
| Automated backups (20% of VPS) | $2 |
| Domain (sotto.fm) | $1 |
| Cloudflare (free tier CDN) | $0 |
| **Total fixed** | **~$18/month** |

At scale (CPX41 for 1K+ users): ~$27/month. At serious scale (dedicated CCX33): ~$60/month.

### Annual burn

| Scale | Monthly | Annual |
|---|---|---|
| Early (0-500 users) | ~$20 | ~$240 |
| Growth (500-5K users) | ~$60 | ~$720 |
| Scale (5K+ users) | ~$150 | ~$1,800 |

**Sotto can run for years on pocket change.** No revenue needed. No investors needed. The product sustains itself indefinitely.

### Comparison to old model

| Metric | Old (5-tier) | New (free BYOK) |
|---|---|---|
| Revenue target | $460/month to break even | $0 (no revenue needed) |
| Subscribers needed | 20-30 paying users | 0 |
| COGS per podcast | $0.55-$2.65 (platform pays) | $0.002 (user pays AI costs) |
| Survival timeline without revenue | ~12 months at $460/mo burn | Indefinite at ~$20/mo |
| Complexity | Stripe webhooks, credit tracking, tier gates | Rate limiter + BYOK key check |

---

## 5. Competitive Repositioning

### Not competing on generation

Every competitor generates podcasts. That's commodity. Here's what no competitor has:

| Feature | Sotto | NotebookLM | ElevenLabs GenFM | Hume Chatterbox |
|---|---|---|---|---|
| Social feed with discovery | Yes | No | No | No |
| Fork & remix any podcast | Yes | No | No | No |
| Import human podcasts | Yes | No | No | No |
| Citation verification (4-layer) | Yes | No | No | No |
| Public Q&A on episodes | Yes | No | No | No |
| Fork lineage graph | Yes | No | No | No |
| Collections/playlists | Yes | No | No | No |
| Activity feed | Yes | No | No | No |
| Threaded comments | Yes | No | No | No |
| Version history | Yes | No | No | No |
| Twitter bot | Yes | No | No | No |

**The network features ARE the product.** Generation is just the on-ramp.

### The new competitive framing

Old: "We generate AI podcasts" (competing against Google, ElevenLabs, everyone)
New: "We're the social layer for all podcasts" (competing against... nobody)

Nobody is building a GitHub-style social network for podcasts. The closest analog is SoundCloud (social layer for music), which reached $100M+ ARR without generating a single song.

---

## 6. What This Doesn't Fix

### Cold start problem (still #1 risk)

A social network with no content is useless. Free BYOK doesn't solve this — it actually makes it slightly harder because users need API keys before they can create. Mitigations:

- Seed feed with 200+ podcasts from @sotto system account (using platform keys)
- Twitter bot generates content from trending topics
- Import public-domain lectures and talks
- The "fork any podcast" feature means one good podcast spawns many

### BYOK onboarding friction (new risk)

Requiring API keys before creation adds a step. Most casual users don't have API keys and won't get them. This is intentional — Sotto targets people who already use AI tools, not the general public. But it narrows the funnel.

Mitigations:

- "One OpenAI key covers both LLM + TTS" — lowest friction path
- Direct links to API key pages with step-by-step instructions
- Dev mode (`AI_PROVIDER=claude-code`) lets developers skip keys entirely
- Feed/social features accessible without keys — only creation requires them
- "Skip for now" lets users explore before committing

### No mobile app

Web app only. No background audio on iOS Safari, no offline, no push reliability. This is a serious handicap for a podcast product. The React Native + Expo app is scaffolded but not functional.

### Variable audio quality

AI voices are detectably synthetic. ElevenLabs (MOS 4.6) is close to human (4.7), but cheaper providers like OpenAI TTS are noticeably more robotic. BYOK means users choose their own quality/cost tradeoff — which is fine, but it means the feed will have inconsistent audio quality.

---

## 7. Strategic Bets & Odds

### Bet 1: "GitHub for podcasts" — the network matters more than the tool

**Odds: 30%**

Unproven category. No precedent for a social network built around podcasts (AI or human). GitHub succeeded because code is inherently forkable and improvable. Are podcasts? The fork/remix model suggests yes, but it's unproven at scale.

### Bet 2: BYOK-only is viable — enough people have API keys

**Odds: 25%**

This is the riskiest bet. BYOK narrows the audience to AI-literate users who already pay for API keys. That audience is growing (millions of developers, AI enthusiasts, educators using Claude/GPT), but it's not the general public. If this bet fails, the fallback is adding a platform key option (easy to add back).

### Bet 3: Fork/remix creates viral content multiplication

**Odds: 40%**

One podcast becomes 10 forks becomes 100 descendants. This is the growth flywheel. If forks produce meaningfully different content (the remix modal forces customization), the content graph grows exponentially. GitHub proved this with repositories.

### Bet 4: Near-zero burn means infinite runway

**Odds: 75%**

At $20/month fixed cost, Sotto can run indefinitely without revenue. This is the strongest bet — it removes the time pressure that kills most startups. The question isn't "can we survive?" but "can we grow?" And growth can happen slowly, over years, while the AI podcast market matures.

### Combined odds of becoming a relevant platform (10K+ active users within 3 years): **25%**

The 75% failure case: BYOK is too niche, the network never reaches critical mass, and Sotto stays a well-built tool used by dozens. But at $20/month, "failure" just means a small community project — not a bankruptcy.

---

## 8. Scenarios

### Scenario A: Bootstrap (Recommended)

**$0 external funding. $20/month burn. Grow organically. Play the long game.**

| Factor | Assessment |
|---|---|
| Runway | Infinite. $240/year is pocket change. |
| Constraints | No mobile app (can't afford contractor). Growth is purely organic. |
| Advantage | No deadline, no investors, no pressure. Iterate for 5 years if needed. |
| Risk | Burnout from maintaining a complex product solo with no revenue. |
| Odds of 10K users within 3 years | **30%** |

**Why this is recommended**: The near-zero burn rate changes the calculus entirely. The old model needed $460/month and 20+ paying subscribers just to survive. The new model needs $20/month and zero subscribers. This buys unlimited time.

### Scenario B: Angel ($100-300K)

**Raise from angels. Build mobile app. Hire a growth person.**

| Factor | Assessment |
|---|---|
| Fundability | Moderate. "GitHub for podcasts" is a compelling pitch. Working product is impressive. |
| What it buys | Mobile app ($30-50K), content seeding, 18-24 months of focus. |
| What it costs | 10-20% equity. Mild pressure for traction. |
| Odds of 10K users within 2 years | **25%** |

### Scenario C: Enterprise white-label

**License the pipeline to edtech/L&D platforms.**

| Factor | Assessment |
|---|---|
| Revenue model | $5-50K/month per client. 2-3 clients = sustainable business. |
| The pitch | "White-label AI podcast platform with citation verification + social features." |
| Target | Corporate L&D, Coursera, Udemy, university systems. |
| Odds of landing first client within 12 months | **30%** |

### Scenario D: VC (Not recommended)

**Raise $1-2M seed. Go for hypergrowth.**

| Factor | Assessment |
|---|---|
| Problem | VC expects $1B outcomes. "Free podcast network" doesn't have that trajectory. |
| Risk | Board pressure for growth before PMF. Pivot pressure if metrics don't compound. |
| Odds of returning capital | **15%** |

---

## 9. YC Narrative

### The pitch (updated for free BYOK)

> "We're GitHub for podcasts. Create AI podcasts from any topic, fork and remix anyone's episode, share on a social feed. Everything is free — users bring their own API keys. One person built the entire platform: 13 async workers, 5 TTS providers, full social stack. We need YC to help us reach critical mass."

### Updated application answers

**What does your company do?**

> Sotto is GitHub for podcasts — create AI podcasts, import human ones, fork and remix them, share on a social feed. 100% free, BYOK.

**What's your insight?**

> AI generation is a commodity — every major AI company ships podcast generators. The network (forks, remix, community Q&A) is defensible and nobody else is building it. We don't charge for generation. We provide the social layer.

**How do you make money?**

> We don't, yet. Our burn is $20/month. We're building the network first. Monetization options when the network has value: premium features, enterprise white-label, creator tools. But the priority is reaching critical mass — GitHub was free for 4 years before monetizing.

**What's your moat?**

> Network effects. Every podcast, fork, Q&A interaction, and collection makes the platform more valuable for every user. Also: 4-layer citation verification that no competitor has, and full BYOK architecture that makes us provider-independent.

### YC odds

| Scenario | Odds |
|---|---|
| Apply now (solo, no traction) | 2% |
| Apply with 500 WAU + 15% WoW (solo) | 10% |
| Apply with 500 WAU + 15% WoW + co-founder | 20-25% |
| Apply with 2K WAU + 20% WoW + co-founder | 40%+ |

---

## 10. Path Forward

1. **Ship the BYOK pivot** — strip Stripe, add LLM BYOK, remove all feature gates
2. **Build community features** — follower lists, public Q&A, comments, collections, activity feed
3. **Seed 200+ podcasts** on the feed using platform keys and @sotto account
4. **Launch on HN** with "GitHub for podcasts — fork any episode" angle
5. **Find 10 power users** — educators, AI enthusiasts, content creators
6. **Measure WAL** (weekly active listeners) — if people come back to the feed, everything else follows
7. **Ship mobile** when the network has traction (not before)

**Timeline**: Pivot implementation (Phases 1-5) in 1-2 weeks. Community features (Phase 6) in 2-3 weeks. Content seeding in parallel. Launch when the feed has 200+ diverse podcasts.

**The bet**: At $20/month burn, Sotto has years to find its audience. The product is built. The network features are shipping. The only question is distribution — and the best way to answer that is to launch.
