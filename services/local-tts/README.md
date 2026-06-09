# Local Kokoro TTS sidecar

A keyless, self-hosted text-to-speech server that wraps the open-source
[Kokoro-82M](https://github.com/hexgrad/kokoro) model in a small FastAPI service.
It lets a Sotto self-hoster generate all lesson and speaking audio with **zero
cloud keys** by setting `TTS_PROVIDER=kokoro` and pointing `TTS_BASE_URL` at this
service.

Kokoro-82M is multilingual: English (US + UK), Spanish, French, Italian,
Portuguese, Hindi, Japanese, and Chinese. It runs comfortably on CPU.

## HTTP contract

The Sotto `kokoro` provider (`apps/web/src/lib/providers/tts/kokoro.provider.ts`)
talks to these endpoints. No authentication is performed — the server ignores any
`Authorization` header.

### `POST /tts`

Request body (JSON):

```json
{ "text": "Hola, ¿cómo estás?", "voice": "ef_dora", "language": "es" }
```

- `text` (required) — the text to synthesize.
- `voice` (required) — a Kokoro voice id (see `GET /voices`).
- `language` (optional) — ISO-639-1 hint; informational only. The synthesis
  language is derived from the voice-id prefix.

Response: raw `audio/wav` bytes (24 kHz, mono, 16-bit PCM).

### `GET /voices`

```json
{
  "voices": [
    { "id": "af_heart", "language": "en", "label": "Heart (US English, female)" }
  ]
}
```

### `GET /health`

```json
{ "status": "ok" }
```

## Voice ids

Voices follow Kokoro's `{lang}{gender}_{name}` convention. The first letter
selects the pipeline language:

| Prefix | Language            |
| ------ | ------------------- |
| `a`    | American English    |
| `b`    | British English     |
| `e`    | Spanish             |
| `f`    | French              |
| `i`    | Italian             |
| `p`    | Brazilian Portuguese|
| `h`    | Hindi               |
| `j`    | Japanese            |
| `z`    | Mandarin Chinese    |

## Build & run

```bash
# From the repo root:
docker build -t sotto-local-tts services/local-tts

# Run on port 8000 (CPU-only):
docker run --rm -p 8000:8000 sotto-local-tts

# Smoke test:
curl http://localhost:8000/health
curl http://localhost:8000/voices
curl -X POST http://localhost:8000/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello from Kokoro","voice":"af_heart"}' \
  --output sample.wav
```

To run without Docker:

```bash
pip install -r services/local-tts/requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000  # from services/local-tts/
```

## Wiring into Sotto

```bash
TTS_PROVIDER=kokoro
TTS_BASE_URL=http://localhost:8000      # local dev outside Docker
# TTS_BASE_URL=http://local-tts:8000    # inside Docker Compose (service name)
# TTS_API_KEY=                          # optional — only if you front it with auth
```
