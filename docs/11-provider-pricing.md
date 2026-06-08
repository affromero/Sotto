# Provider Strategy and Cost Posture

> **Date**: 2026-05-15
>
> **Summary**: Sotto should make provider choice explicit, easy to validate, and understandable to users. Exact provider prices change frequently, so release docs should link to provider pricing pages instead of baking stale numbers into onboarding.

---

## 1. Provider Categories

| Capability | Used for |
|---|---|
| LLM or local agent | discovery, script generation, Q&A, source summarization |
| TTS | segment audio generation |
| STT | meeting and audio transcription |
| Storage | podcast audio, segment audio, images, transcripts |

Each capability should be selected explicitly. Missing capability errors should name the selected provider and the missing credential or setup step.

---

## 2. Supported Onboarding Profiles

| Profile | LLM | TTS | STT | Best for |
|---|---|---|---|---|
| Local agent + hosted TTS | local CLI | selected TTS provider | optional selected STT | technical self-hosters |
| OpenAI one-key | OpenAI | OpenAI | OpenAI | fastest hosted-provider setup |
| Anthropic + TTS | Anthropic | selected TTS provider | optional selected STT | high-quality script generation |
| Advanced BYOK | user-selected | user-selected | user-selected | users who want cost/quality control |
| Managed hosted | Sotto-managed | Sotto-managed | Sotto-managed | non-technical users |

The implementation should represent these as provider-profile data, not scattered conditionals.

---

## 3. No Implicit Provider Fallbacks

Provider routing must not behave like this:

```text
selected provider failed -> try another provider with a key present
```

Correct behavior:

```text
selected provider failed -> return typed setup or provider error -> user/admin fixes the selected profile
```

This matters for:

- predictable costs
- reproducible tests
- privacy expectations
- user trust
- provider-specific model behavior

---

## 4. Cost Drivers

Main cost drivers:

| Driver | Notes |
|---|---|
| TTS characters or generated audio minutes | usually the largest variable cost |
| STT minutes | important for meeting ingestion |
| LLM tokens | lower than TTS for many workflows, but can grow with long source material |
| storage | depends on retention and generated audio volume |
| worker runtime | relevant for managed hosting |
| bot polling/webhook operations | relevant for managed hosting |

The app should show estimated cost where possible, but should not promise exact prices without a verification date and provider source.

---

## 5. Provider Links

Keep links current when editing this doc:

| Provider | Pricing/docs |
|---|---|
| Anthropic | `https://docs.anthropic.com/` |
| OpenAI | `https://platform.openai.com/docs/` |
| Google Gemini | `https://ai.google.dev/` |
| ElevenLabs | `https://elevenlabs.io/docs` |
| Cartesia | `https://docs.cartesia.ai/` |
| Hume | `https://dev.hume.ai/docs` |
| Mistral | `https://docs.mistral.ai/` |
| Replicate | `https://replicate.com/docs` |
| Fal | `https://fal.ai/docs` |

Use official provider docs for pricing updates. Do not copy exact pricing into this repo unless the update includes a date and source.

---

## 6. Tests

Required tests for provider changes:

- selected provider is honored
- missing selected key returns typed setup error
- another configured key is not used automatically
- one-key profile configures all supported capabilities
- local-agent profile requires the CLI to be available
- TTS provider is validated separately from LLM provider
- managed profile records provider custody explicitly
