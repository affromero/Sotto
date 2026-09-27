# Provider Extension Guide

Date: 2026-09-27

> **Summary**: Add local LLM, STT, and TTS models to Sotto with the least possible code. Prefer OpenAI-compatible local servers for LLM and STT, and the Sotto local TTS sidecar contract for TTS. Only write a native provider adapter when a model or vendor cannot fit those simple HTTP shapes.

## Meta Muse

Choose **Meta (Muse)** in provider settings or **Muse Spark** during onboarding,
save your Meta Model API key, and explicitly select **Muse Spark 1.3 (Standard)**.
Existing provider defaults stay unchanged. The integration uses Sidedoor's
OpenAI-compatible transport at `https://api.meta.ai/v1`, including structured
output, streaming, cancellation and normalized token usage.

Metadata verified against Meta documentation on 2026-09-27: Standard input costs
$1.25 per million tokens and output costs $4.25. Its context is 1,048,576 tokens.
The published Chat Completions schema accepts `max_completion_tokens` but does
not state a numeric output ceiling, so the catalog records that limit as unknown.
Contributor models permit training on prompts and completions and are excluded
from Sotto's model choices. See [models](https://dev.meta.ai/docs/models),
[pricing](https://dev.meta.ai/docs/pricing-rate-limits), and the
[request schema](https://dev.meta.ai/docs/api-reference/chat-completions/schemas).

This integration supports text and images. Hosted search is unavailable through
the selected Chat Completions transport. Spark 1.3 audio understanding is degraded
according to Meta. Muse Voice Transcribe is a separate API with turn timestamps
and no word timestamps; it is not registered as a Sotto pronunciation provider.
Serve Muse Glimmer through the existing local OpenAI-compatible provider.

### Repeatable learning evaluation

Run the synthetic fixtures without network access:

```bash
npx tsx apps/web/scripts/learning-evaluation/run.ts
```

To measure the selected model, set a credential in an environment variable and
explicitly enable live requests. This sends only the checked-in synthetic prompts:

```bash
npx tsx apps/web/scripts/learning-evaluation/run.ts --live --provider meta \
  --model muse-spark-1.3 --api-key-env META_EVALUATION_KEY --repetitions 3
```

The JSON report includes every response, failed checks, measured latency, token
usage and an uncached cost estimate where catalog pricing exists. Fixture reports
mark performance and cost as unmeasured. A failed request stops the run; it never
switches providers. Each case repeats to expose inconsistent grading.

Checks cover structured output, requested vocabulary, passage length, literal
answer support, agreement correction and overcorrection of a valid answer.
They are limited proxies. Human review of language accuracy, CEFR level and
teaching value is required before changing a production default. No live quality
result is implied by fixture success.

## Local provider contracts

Most local models should need **zero app code**.

| Capability  | Best local contract                | Saved Sotto configuration                      | Code needed |
| ----------- | ---------------------------------- | ---------------------------------------------- | ----------- |
| LLM         | OpenAI-compatible chat completions | Local provider, base URL, and model            | No          |
| STT         | OpenAI-compatible transcriptions   | Local provider, base URL, and model            | No          |
| TTS         | Sotto local TTS sidecar            | Local provider, base URL, model, and voice IDs | No          |
| Bundled TTS | Kokoro sidecar                     | Kokoro provider and base URL                   | No          |

The rule is: if your local model can sit behind one of these contracts, do that instead of adding a provider.

## Local LLM Recipe

Run any OpenAI-compatible local inference server such as Ollama, vLLM, LM Studio, or llama.cpp server.

In the welcome flow or Admin settings, choose **Local**, save the server base URL such as `http://localhost:11434/v1`, and enter the served model such as `qwen3`. Save a credential there as well if the server requires one. The model ID does not need to exist in Sotto's registry.

## Local STT Recipe

Run any OpenAI-compatible Whisper/transcription server that serves:

```text
POST /v1/audio/transcriptions
```

Choose **Local** for speech recognition, save a base URL such as `http://localhost:8001/v1`, and enter the served model such as `deepdml/faster-whisper-large-v3-turbo-ct2`. Save a credential if the server requires one.

Sotto sends audio files through the OpenAI SDK with `response_format=verbose_json` and requests word and segment timestamps where the server supports them. If the server only returns text, pronunciation scoring still works with a simpler fallback path.

## Local TTS Recipe

Run a small HTTP sidecar around any TTS model. Choose **Local** for your own model or **Kokoro** for the bundled service, then save the base URL, optional model, accepted voice IDs, and optional credential in Sotto. The usual local base URL is `http://localhost:8000`.

## Local TTS Sidecar Contract

Your server should implement three endpoints.

### `GET /health`

Response:

```json
{ "status": "ok" }
```

### `GET /voices`

Response:

```json
{
  "voices": [
    { "id": "voice_a", "label": "Voice A", "gender": "female", "description": "warm narrator" },
    { "id": "voice_b", "label": "Voice B", "gender": "male", "description": "clear explainer" }
  ]
}
```

Only `id` is required. Sotto uses `label` or `name` for display when present.

### `POST /tts`

Request:

```json
{
  "text": "Hola, como estas?",
  "voice": "voice_a",
  "language": "es",
  "model": "my-local-model"
}
```

Required fields: `text`, `voice`.

Optional fields: `language`, `model`. Sidecars may ignore optional fields.

Response: raw audio bytes. Prefer `audio/wav`, `audio/mpeg`, `audio/ogg`, or `audio/flac` as the `Content-Type`.

Authentication is optional. When you save a credential for the local TTS provider, Sotto sends `Authorization: Bearer <credential>`.

## Minimal TTS Sidecar Skeleton

```python
from fastapi import FastAPI, Response
from pydantic import BaseModel

app = FastAPI()

class TtsRequest(BaseModel):
    text: str
    voice: str
    language: str | None = None
    model: str | None = None

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/voices")
def voices():
    return {"voices": [{"id": "default", "label": "Default"}]}

@app.post("/tts")
def tts(req: TtsRequest):
    audio = synthesize_with_your_model(
        text=req.text,
        voice=req.voice,
        language=req.language,
        model=req.model,
    )
    return Response(content=audio, media_type="audio/wav")
```

## When Code Is Required

Add a native provider only when the model or vendor cannot reasonably fit the local contracts.

### Native TTS Provider Checklist

1. Add the provider ID and metadata to `apps/web/src/lib/providers/tts-registry.ts`.
2. Add `apps/web/src/lib/providers/tts/<provider>.provider.ts` implementing `TtsProvider`.
3. Add the lazy import and `createTtsProviderAsync` case in `apps/web/src/lib/providers/tts.ts`.
4. Add credential capture and request policy handling in `apps/web/src/lib/tts-generation.ts`.
5. Add voice pool support in `apps/web/src/lib/providers/tts-voices.ts`, `voice-catalog.ts`, and `voice-assigner.ts` if it has preset voices.
6. Add validation/display support in `apps/web/src/lib/validations.ts` and `packages/shared/src/provider-display.ts`.
7. Add or update tests for registry DTOs, provider construction, voice catalog, voice assignment, admin test-model, and connectivity smoke tests.

### Native STT Provider Checklist

1. Add the provider ID and metadata to `apps/web/src/lib/providers/stt-registry.ts`.
2. Add a provider class in `apps/web/src/lib/providers/stt.ts` implementing `SttProvider`.
3. Add a `createSttProvider` switch case.
4. Add credential capture and request policy handling for the provider.
5. Add the provider to `apps/web/src/lib/providers/ai-registry.ts` as an STT-only provider with an empty model list when it needs a saved credential.
6. Add validation/display support in `apps/web/src/lib/validations.ts`, `packages/shared/src/provider-display.ts`, `/api/v1/stt-providers`, and admin test-model routes.
7. Add tests in `apps/web/tests/lib/stt-providers.test.ts`, admin model tests, and any route tests that validate provider enums.

## Acceptance Checks

For no-code local additions:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/voices
curl -X POST http://localhost:8000/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello from Sotto","voice":"default","language":"en"}' \
  --output sample.wav
```

Then run the relevant app checks:

```bash
npm run type-check
npm test -- --run apps/web/tests/lib/providers.test.ts apps/web/tests/lib/stt-providers.test.ts
```
