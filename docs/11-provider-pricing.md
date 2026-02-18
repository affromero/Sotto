# AI Provider Pricing & Cost Comparison

> Comprehensive cost analysis for all external AI services Sotto depends on.
> Last updated: February 2026

---

## 1. LLM / Chat Providers (Script Generation, Discovery Chat, Q&A)

Sotto uses LLMs for three operations: discovery chat (~5 exchanges), script generation (~1 call), and interactive Q&A (~1 call per interaction).

### Pricing per Million Tokens

| Provider      | Model             | Input $/M | Output $/M | Best For                           | Pricing Page                                                                     |
| ------------- | ----------------- | --------- | ---------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| **Anthropic** | Claude Haiku 4.5  | $1.00     | $5.00      | Discovery chat, Q&A (fast + cheap) | [anthropic.com/pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |
| **Anthropic** | Claude Sonnet 4.5 | $3.00     | $15.00     | Script generation (balanced)       | [anthropic.com/pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |
| **Anthropic** | Claude Opus 4.6   | $5.00     | $25.00     | Complex scripts (highest quality)  | [anthropic.com/pricing](https://docs.anthropic.com/en/docs/about-claude/pricing) |
| **OpenAI**    | GPT-4.1           | $2.00     | $8.00      | General purpose                    | [platform.openai.com/pricing](https://platform.openai.com/docs/pricing)          |
| **OpenAI**    | GPT-4o            | $2.50     | $10.00     | Multimodal                         | [platform.openai.com/pricing](https://platform.openai.com/docs/pricing)          |
| **OpenAI**    | GPT-4o-mini       | $0.15     | $0.60      | Budget chat                        | [platform.openai.com/pricing](https://platform.openai.com/docs/pricing)          |
| **Google**    | Gemini 2.0 Flash  | $0.10     | $0.40      | Ultra-budget, high volume          | [ai.google.dev/pricing](https://ai.google.dev/gemini-api/docs/pricing)           |
| **Google**    | Gemini 2.5 Pro    | $1.25     | $10.00     | Quality + cost balance             | [ai.google.dev/pricing](https://ai.google.dev/gemini-api/docs/pricing)           |
| **Mistral**   | Mistral Large     | $2.00     | $6.00      | EU data residency                  | [mistral.ai/pricing](https://mistral.ai/pricing)                                 |
| **Mistral**   | Mistral Small 3.2 | $0.10     | $0.30      | Budget option                      | [mistral.ai/pricing](https://mistral.ai/pricing)                                 |
| **DeepSeek**  | DeepSeek-V3       | $0.03     | $0.70      | Cheapest available                 | [deepseek.com/pricing](https://api-docs.deepseek.com/quick_start/pricing/)       |
| **DeepSeek**  | DeepSeek-R1       | $0.12     | $0.20      | Budget reasoning                   | [deepseek.com/pricing](https://api-docs.deepseek.com/quick_start/pricing/)       |

### Cost Per Sotto Operation (estimated)

A typical 10-minute podcast uses approximately:

- **Discovery chat**: 5 exchanges × ~500 input + ~300 output tokens each = ~2,500 input / ~1,500 output tokens
- **Script generation**: ~2,000 input + ~4,000 output tokens
- **Q&A interaction**: ~1,500 input + ~500 output tokens

| Provider + Model  | Discovery Chat | Script Gen | Q&A Interaction | Total per Podcast |
| ----------------- | -------------- | ---------- | --------------- | ----------------- |
| Claude Haiku 4.5  | $0.010         | $0.062     | $0.004          | **$0.076**        |
| Claude Sonnet 4.5 | $0.030         | $0.066     | $0.012          | **$0.108**        |
| GPT-4o-mini       | $0.001         | $0.003     | $0.001          | **$0.005**        |
| Gemini 2.0 Flash  | $0.001         | $0.002     | $0.001          | **$0.004**        |
| DeepSeek-V3       | $0.001         | $0.003     | $0.001          | **$0.005**        |

### Cost Reduction Strategies

| Strategy             | Savings                              | Provider Support            |
| -------------------- | ------------------------------------ | --------------------------- |
| **Prompt caching**   | Up to 90% on repeated system prompts | Anthropic, Google, DeepSeek |
| **Batch API**        | 50% discount                         | Anthropic, OpenAI           |
| **Off-peak pricing** | 50-75% discount                      | DeepSeek                    |
| **Model routing**    | Use cheap models for simple tasks    | All (implement in code)     |

### Recommended Strategy for Sotto

| Operation         | Recommended Model | Fallback         | Reason                                            |
| ----------------- | ----------------- | ---------------- | ------------------------------------------------- |
| Discovery chat    | Claude Haiku 4.5  | Gemini 2.0 Flash | Fast, cheap, good enough for conversational Q&A   |
| Script generation | Claude Sonnet 4.5 | GPT-4.1          | Needs creativity + structure — Sonnet excels here |
| Q&A interactions  | Claude Haiku 4.5  | GPT-4o-mini      | Speed matters (user is waiting), Haiku is fast    |

**Bottom line**: LLM costs are <2% of total COGS. The model choice barely matters financially — optimize for quality and latency.

---

## 2. Text-to-Speech Providers (Podcast Audio Generation)

TTS is **97% of Sotto's COGS**. This is the most critical cost decision.

### Pricing Comparison (Sotto's 5 Integrated Providers)

These are the TTS providers actually integrated in Sotto's codebase (resolved via `resolveTtsProvider()` in `src/lib/providers/tts.ts`). Users bring their own key for any one of these via BYOK.

| Provider       | Model/Tier       | Cost per 1K chars | Cost for 10-min podcast (~15K chars) | Quality (1-5) | Pricing Page                                                                    |
| -------------- | ---------------- | ----------------- | ------------------------------------ | ------------- | ------------------------------------------------------------------------------- |
| **ElevenLabs** | Creator ($22/mo) | ~$0.22            | **$3.30**                            | ★★★★★         | [elevenlabs.io/pricing](https://elevenlabs.io/pricing/api)                      |
| **ElevenLabs** | Pro ($99/mo)     | ~$0.20            | **$3.00**                            | ★★★★★         | [elevenlabs.io/pricing](https://elevenlabs.io/pricing/api)                      |
| **ElevenLabs** | Scale ($330/mo)  | ~$0.17            | **$2.55**                            | ★★★★★         | [elevenlabs.io/pricing](https://elevenlabs.io/pricing/api)                      |
| **OpenAI**     | TTS-1            | $0.015            | **$0.23**                            | ★★★★          | [platform.openai.com/pricing](https://platform.openai.com/docs/pricing)         |
| **OpenAI**     | TTS-1-HD         | $0.030            | **$0.45**                            | ★★★★½         | [platform.openai.com/pricing](https://platform.openai.com/docs/pricing)         |
| **PlayHT**     | Professional     | $0.02-0.24        | **$0.30-$3.60**                      | ★★★★          | [play.ht/pricing](https://play.ht/pricing/)                                     |
| **Cartesia**   | Sonic            | ~$0.05            | **$0.75**                            | ★★★★          | [cartesia.ai/pricing](https://cartesia.ai/pricing)                              |
| **Hume**       | Octave           | ~$0.05            | **$0.75**                            | ★★★★★         | [hume.ai/pricing](https://www.hume.ai/pricing)                                  |

### Free Tiers

| Provider   | Free Tier           | Enough for          |
| ---------- | ------------------- | ------------------- |
| ElevenLabs | 10K chars/month     | ~0.7 podcasts/month |
| OpenAI TTS | No free tier        | —                   |
| PlayHT     | Trial credits       | ~1-2 podcasts       |
| Cartesia   | Trial credits       | ~1-2 podcasts       |
| Hume       | Trial credits       | ~1-2 podcasts       |

### Self-Hosted Open-Source TTS

| Solution          | Hardware                   | Monthly Cloud Cost         | Quality | Setup Effort | License                               |
| ----------------- | -------------------------- | -------------------------- | ------- | ------------ | ------------------------------------- |
| **Coqui XTTS v2** | GPU (8-16GB VRAM)          | $50-150/mo (Lambda/RunPod) | ★★★★    | ~40 hours    | Coqui Public License (non-commercial) |
| **Piper TTS**     | CPU (Raspberry Pi capable) | $5-20/mo (any VPS)         | ★★★     | ~8 hours     | MIT                                   |
| **Bark**          | GPU (16GB+ VRAM)           | $100-300/mo                | ★★★½    | ~20 hours    | MIT                                   |
| **StyleTTS 2**    | GPU (8GB VRAM)             | $50-100/mo                 | ★★★★    | ~30 hours    | MIT                                   |

**Self-hosted cost per podcast**: ~$0.01-0.05 (amortized GPU time)

### Recommended TTS Strategy

| Phase                   | Provider                                     | Cost per Podcast | Why                                                  |
| ----------------------- | -------------------------------------------- | ---------------- | ---------------------------------------------------- |
| **MVP (0-50 users)**    | OpenAI TTS-1-HD                              | $0.45            | Best price/quality ratio, simple API                 |
| **Beta (50-500 users)** | OpenAI TTS-1-HD + Google WaveNet             | $0.24-0.45       | Add Google as fallback, use free tiers               |
| **Growth (500+ users)** | Self-hosted XTTS v2 + ElevenLabs for premium | $0.05-3.00       | Self-hosted for Free tier, ElevenLabs for Pro/Studio |

**Critical insight**: Switching from ElevenLabs ($3.00/podcast) to OpenAI TTS-1-HD ($0.45/podcast) makes Pro tier immediately profitable. ElevenLabs quality is noticeably better, but OpenAI is "good enough" for MVP.

---

## 3. Voice Agent Providers (Driver Mode — Real-Time Voice Interaction)

For the future "driver mode" where users interact with Sotto by voice while driving.

### Pricing Comparison

| Provider                         | Cost per Minute          | Quality | Latency   | Features                      | Pricing Page                                                            |
| -------------------------------- | ------------------------ | ------- | --------- | ----------------------------- | ----------------------------------------------------------------------- |
| **ElevenLabs** Conversational AI | $0.08-0.10               | ★★★★★   | <200ms    | Emotional, multilingual       | [elevenlabs.io/pricing](https://elevenlabs.io/pricing/api)              |
| **OpenAI** Realtime API          | ~$0.30/min (audio only)  | ★★★★½   | 200-400ms | Integrated with GPT-4o        | [platform.openai.com/pricing](https://platform.openai.com/docs/pricing) |
| **Hume AI** EVI 2                | $0.05-0.07               | ★★★★★   | <200ms    | Emotion detection, expressive | [hume.ai/pricing](https://www.hume.ai/pricing)                          |
| **Vapi**                         | $0.13-0.33+              | ★★★★    | 300-500ms | Orchestration platform        | [vapi.ai/pricing](https://vapi.ai/pricing)                              |
| **LiveKit** + Models             | $0.006/min + model costs | ★★★★    | Varies    | Open-source infra             | [livekit.io/pricing](https://livekit.io/pricing)                        |

### Cost for a Typical Voice Interaction (2-minute Q&A)

| Provider        | Cost per 2-min Interaction | Monthly cost (1K interactions) |
| --------------- | -------------------------- | ------------------------------ |
| ElevenLabs      | $0.16-0.20                 | $160-200                       |
| OpenAI Realtime | $0.60                      | $600                           |
| Hume AI         | $0.10-0.14                 | $100-140                       |
| Vapi            | $0.26-0.66                 | $260-660                       |

### Recommended Voice Agent Strategy

**Phase 1 (MVP)**: Text-based interactions only (no voice agent cost)
**Phase 2 (Beta)**: Hume AI EVI 2 — best quality-to-price ratio, emotion detection is a differentiator
**Phase 3 (Scale)**: ElevenLabs Conversational AI — ecosystem synergy with TTS, or self-hosted with LiveKit

---

## 4. BYOK Cost Per Podcast (What Users Pay)

With the free BYOK model, Sotto's platform costs are near-zero (~$0.002/podcast for storage + compute). Users pay their own AI providers directly. Here's what a typical 10-minute podcast costs the **user** depending on their provider choices:

### LLM + TTS Combined Cost Per Podcast

| LLM Provider      | TTS Provider | LLM Cost | TTS Cost | **Total/Podcast** |
| ------------------ | ------------ | -------- | -------- | ----------------- |
| Claude Sonnet 4.5  | ElevenLabs   | $0.108   | $3.00    | **$3.11**         |
| Claude Sonnet 4.5  | OpenAI HD    | $0.108   | $0.45    | **$0.56**         |
| Claude Haiku 4.5   | OpenAI       | $0.076   | $0.23    | **$0.31**         |
| Claude Haiku 4.5   | Cartesia     | $0.076   | $0.75    | **$0.83**         |
| Claude Haiku 4.5   | Hume Octave  | $0.076   | $0.75    | **$0.83**         |
| Claude Haiku 4.5   | PlayHT       | $0.076   | $0.30    | **$0.38**         |
| GPT-4o-mini        | OpenAI       | $0.005   | $0.23    | **$0.24**         |

### Sotto's Platform Cost Per Podcast

| Component              | Cost    |
| ---------------------- | ------- |
| R2 storage (~15MB)     | $0.0002 |
| FFmpeg compute         | $0.001  |
| Redis/Postgres overhead | ~$0.001 |
| **Total platform cost** | **~$0.002** |

### Key Takeaway

TTS is **97% of user COGS**. The cheapest path is OpenAI TTS-1 ($0.23/podcast). The premium path is ElevenLabs ($3.00/podcast). Users choose their own quality/cost tradeoff via BYOK.

---

## 5. Speech-to-Text Providers (Audio Import + Transcription)

Sotto supports STT for importing existing podcasts (human or AI). Three providers are integrated in `src/lib/providers/stt.ts`.

| Provider       | Model                        | Cost               | Quality | Speed    | Pricing Page                                                            |
| -------------- | ---------------------------- | ------------------- | ------- | -------- | ----------------------------------------------------------------------- |
| **Groq**       | whisper-large-v3-turbo       | Free (rate-limited) | ★★★★    | Fastest  | [groq.com/pricing](https://groq.com/pricing/)                          |
| **Groq**       | whisper-large-v3             | Free (rate-limited) | ★★★★½   | Fast     | [groq.com/pricing](https://groq.com/pricing/)                          |
| **OpenAI**     | whisper-1                    | $0.006/min          | ★★★★    | Moderate | [platform.openai.com/pricing](https://platform.openai.com/docs/pricing) |
| **OpenAI**     | gpt-4o-transcribe            | ~$0.01/min          | ★★★★½   | Moderate | [platform.openai.com/pricing](https://platform.openai.com/docs/pricing) |
| **ElevenLabs** | scribe_v1                    | Credits-based       | ★★★★    | Fast     | [elevenlabs.io/pricing](https://elevenlabs.io/pricing/api)             |

**Default provider**: Groq (free, fast). Configurable via `STT_PROVIDER` env var.

**Cost for importing a 30-min podcast**:
- Groq: Free
- OpenAI whisper-1: ~$0.18
- ElevenLabs Scribe: ~credits equivalent

---

## 6. Voice Marketplace Pricing

The voice marketplace lets voice clone owners sell access on a per-podcast basis via Stripe Connect.

| Component         | Details                                                      |
| ----------------- | ------------------------------------------------------------ |
| Payment model     | Per-podcast, authorized upfront, captured on READY           |
| Platform fee      | 10% via Stripe `application_fee_amount`                      |
| Free access paths | Voice owner, allowlisted user, approved VoiceRequest, existing purchase |
| Failed podcasts   | Payment authorization cancelled automatically                |
| Refunds           | Supported via `refunded` status                              |

### Example Transaction

| Scenario                        | Voice Price | Platform Fee (10%) | Creator Receives |
| ------------------------------- | ----------- | ------------------ | ---------------- |
| Budget voice ($0.50/podcast)    | $0.50       | $0.05              | $0.45            |
| Standard voice ($2.00/podcast)  | $2.00       | $0.20              | $1.80            |
| Premium voice ($5.00/podcast)   | $5.00       | $0.50              | $4.50            |

---

## 7. Provider Selection Decision Matrix (Integrated Providers Only)

| Criteria           | Weight | ElevenLabs | OpenAI TTS | PlayHT | Cartesia | Hume   |
| ------------------ | ------ | ---------- | ---------- | ------ | -------- | ------ |
| Voice quality      | 30%    | 10         | 8          | 8      | 8        | 9      |
| Cost               | 25%    | 3          | 9          | 7      | 7        | 7      |
| API simplicity     | 15%    | 9          | 10         | 7      | 8        | 7      |
| Voice variety      | 15%    | 10         | 6          | 8      | 7        | 8      |
| Emotion control    | 15%    | 7          | 4          | 6      | 6        | 10     |
| **Weighted Score** |        | **7.30**   | **7.45**   | **7.15** | **7.15** | **8.00** |

**Best overall quality: ElevenLabs** — widest voice library, voice cloning, proven at scale.
**Best budget option: OpenAI TTS** — simple API, low cost, good enough for most use cases.
**Best emotional delivery: Hume Octave** — native emotion detection, most expressive output.

---

## 8. Voice Diversity & Immersive Audio Production

**This is Sotto's differentiator.** If every podcast sounds like the same two people reading a script, there's no reason to come back. The goal is "4K podcast" quality — rich, diverse voices, sound effects, natural interactions, and production value that makes episodes addictive.

### 8.1 Voice Diversity Strategy

Every podcast MUST have a unique voice pair. The `elevenlabs.ts` voice pool contains 16 curated voices (8 male, 8 female) spanning American, British, and Australian accents, across young/middle/mature age ranges. Voice selection is deterministic per podcast ID, ensuring consistency across re-listens while maximizing variety across the catalog.

| Capability                    | ElevenLabs                           | Fish Audio                                | Google Gemini TTS         | Hume AI (Octave)         | OpenAI TTS |
| ----------------------------- | ------------------------------------ | ----------------------------------------- | ------------------------- | ------------------------ | ---------- |
| **Voice library size**        | 10,000+ community voices             | 2,000,000+ voices                         | 30 prebuilt               | Prompt-based generation  | 6 prebuilt |
| **Voice cloning**             | Yes (30s sample)                     | Yes (1-min sample)                        | No                        | No                       | No         |
| **Voice design from text**    | Yes (v3 — age, accent, tone, pacing) | No                                        | No                        | Yes (Octave)             | No         |
| **Emotional delivery**        | Style parameter (0-1)                | Emotion tags: (angry), (sad), (chuckling) | Natural language prompts  | Native emotion detection | No         |
| **Languages**                 | 70+                                  | 30+                                       | 24                        | 10+                      | 6          |
| **Multi-speaker in one call** | No (per-segment)                     | No (per-segment)                          | Yes (2 speakers natively) | No                       | No         |

### 8.2 Sound Effects & Production Value

Sound effects transform a flat conversation into an immersive audio experience. Sotto uses ElevenLabs Sound Effects v2 API for:

| Sound Type             | When Used                                | ElevenLabs Cost      | Duration |
| ---------------------- | ---------------------------------------- | -------------------- | -------- |
| **Intro jingle**       | Start of every podcast                   | 200 credits (~$0.02) | 3s       |
| **Topic transitions**  | Between major sections (2-3 per episode) | 200 credits each     | 1-2s     |
| **Outro music**        | End of every podcast                     | 200 credits (~$0.02) | 4s       |
| **Ambient atmosphere** | Optional for storytelling tone           | 40 credits/sec       | 5-10s    |

**Cost per podcast (sound effects)**: ~$0.08-0.15 (5 cues × 200 credits)

| Provider                        | Sound Effects                                    | Quality | Cost                              | Pricing Page                                                       |
| ------------------------------- | ------------------------------------------------ | ------- | --------------------------------- | ------------------------------------------------------------------ |
| **ElevenLabs SFX v2**           | Text-to-SFX, up to 30s, 48kHz, seamless loops    | ★★★★★   | 200 credits/gen or 40 credits/sec | [elevenlabs.io/sound-effects](https://elevenlabs.io/sound-effects) |
| **Stability AI (Stable Audio)** | Text-to-music/SFX, 45s max                       | ★★★★    | $0.01-0.04/gen                    | [stability.ai](https://stability.ai/)                              |
| **FFmpeg built-in**             | Silence, fade-in/out, crossfade between segments | ★★★     | Free                              | Local processing                                                   |

### 8.3 Natural Interaction Quality

The script generator now includes delivery directions that influence TTS parameters:

| Direction            | TTS Adjustment                     | Effect                                       |
| -------------------- | ---------------------------------- | -------------------------------------------- |
| `(laughing)`         | stability: 0.3, style: 0.7         | More expressive, natural laughter inflection |
| `(whispering)`       | stability: 0.8, style: 0.1         | Quieter, more intimate delivery              |
| `(excited)`          | stability: 0.4, style: 0.6         | Higher energy, faster pace                   |
| `(thoughtful pause)` | Insert 0.5s silence before segment | Creates dramatic pacing                      |
| `(leaning in)`       | similarity_boost: 0.9, style: 0.5  | More intense, focused delivery               |

### 8.4 Competitive Voice Quality Benchmarks

| Feature                   | Sotto (Current)                          | NotebookLM        | Podbean AI    | Spotify AI |
| ------------------------- | ---------------------------------------- | ----------------- | ------------- | ---------- |
| Voice variety per episode | 16-voice pool (unique per podcast)       | 2 fixed voices    | 1 narrator    | N/A        |
| Sound effects             | AI-generated intros, transitions, outros | None              | None          | Music only |
| Emotional delivery        | Direction-aware TTS parameters           | Fixed cheerful    | Monotone      | N/A        |
| Cross-gender pairs        | Yes (automatic contrast selection)       | No (both similar) | N/A           | N/A        |
| Accent diversity          | American, British, Australian            | American only     | American only | N/A        |
| Interactive Q&A           | Yes (mid-playback interrupt)             | No                | No            | No         |

### 8.5 Recommended Voice Diversity Strategy

| Phase      | Voice Approach                                                                         | Sound Effects                                   | Cost per Podcast               |
| ---------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------ |
| **MVP**    | 16-voice pool from ElevenLabs prebuilt voices                                          | ElevenLabs SFX v2 (intro + transitions + outro) | $0.45-3.15 (TTS) + $0.10 (SFX) |
| **Beta**   | Voice Design API — generate unique voices per podcast topic                            | ElevenLabs SFX v2 + FFmpeg crossfades           | $0.50-3.20                     |
| **Growth** | User voice selection UI + Voice cloning for "listen in my voice" premium feature       | Curated SFX library (pre-generated, cached)     | $0.05-3.00                     |
| **Scale**  | Self-hosted XTTS v2 for Free tier + ElevenLabs for Pro/Studio + Fish Audio as fallback | Mixed (self-hosted + cached + generated)        | $0.05-2.00                     |

### 8.6 Alternative TTS Providers for Voice Diversity

| Provider              | Voices                        | Emotion Control                | Cost/Hour     | Best For                         | Pricing Page                                                           |
| --------------------- | ----------------------------- | ------------------------------ | ------------- | -------------------------------- | ---------------------------------------------------------------------- |
| **Fish Audio**        | 2M+ community voices          | Open-domain emotion tags       | ~$0.80/hr     | Budget diversity at scale        | [fish.audio/plan](https://fish.audio/plan/)                            |
| **Hume AI Octave**    | Prompt-generated              | Native emotion detection       | ~$0.50/hr     | Most expressive delivery         | [hume.ai/pricing](https://www.hume.ai/pricing)                         |
| **Google Gemini TTS** | 30 prebuilt, natural handoffs | Natural language style prompts | ~$0.24/hr     | Multi-speaker in single API call | [ai.google.dev/pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| **Rime**              | 300+ demographic-profiled     | Conversational training data   | Contact sales | Most natural "real person" feel  | [rime.ai](https://rime.ai/)                                            |
| **MiniMax**           | 300+ voices, 30 languages     | Style control                  | ~$0.50/hr     | Long-form (200K chars/request)   | [minimax.io](https://www.minimaxi.com/)                                |

### 8.7 The "4K Podcast" Quality Checklist

For every generated podcast to feel premium and addictive:

1. **Unique voice pair** — no two podcasts in the feed should sound identical
2. **Gender/accent contrast** — host and expert should be audibly distinct
3. **Production bookends** — AI-generated intro jingle and outro music
4. **Natural transitions** — subtle sound effects between topic shifts
5. **Delivery variation** — not monotone; scripts include emotional directions
6. **Conversational hooks** — opening 15 seconds grabs attention with a bold claim or question
7. **Pacing rhythm** — alternating high-energy and reflective moments
8. **Loudness normalization** — consistent volume via FFmpeg loudnorm filter (already implemented)
