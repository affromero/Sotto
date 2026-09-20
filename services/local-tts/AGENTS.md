# services/local-tts — Bundled Kokoro TTS sidecar

Keyless, self-hosted text-to-speech server wrapping the open-source
[Kokoro-82M](https://github.com/hexgrad/kokoro) model in FastAPI. It is the TTS
analog of the keyless local LLM and local STT backends. A self-hoster selects
Kokoro and saves its base URL, and all lesson/speaking audio is generated with
no cloud keys. For other local TTS models, keep the same sidecar HTTP shape and
select Local. Keep custom sidecars distinct from Kokoro.

## Purpose

- Multilingual on-device TTS (en, es, fr, it, pt, hi, ja, zh) for the adaptive
  listening and speaking skills.
- Paired with the Sotto `kokoro` provider in
  `apps/web/src/lib/providers/tts/kokoro.provider.ts`.
- Reference shape for the generic Sotto `local` TTS provider in
  `apps/web/src/lib/providers/tts/local.provider.ts`.

## HTTP contract

| Method | Path      | Body / Query                       | Response                                        |
| ------ | --------- | ---------------------------------- | ----------------------------------------------- |
| POST   | `/tts`    | `{ "text", "voice", "language"? }` | `audio/wav` bytes (24 kHz, mono, 16-bit PCM)    |
| GET    | `/voices` | —                                  | `{ "voices": [{ "id", "language", "label" }] }` |
| GET    | `/health` | —                                  | `{ "status": "ok" }`                            |

No auth — the server ignores `Authorization`. Voice ids follow Kokoro's
`{lang}{gender}_{name}` convention; the first letter selects the pipeline
language.

## Port & networking

- Listens on **8000**.
- Local dev (outside Docker): save `http://localhost:8000`.
- Inside Docker Compose, the worker reaches it via the **service name**, not
  localhost: save `http://local-tts:8000`.

## Build & run

```bash
docker build -t sotto-local-tts services/local-tts
docker run --rm -p 8000:8000 sotto-local-tts
curl http://localhost:8000/health
```

See `README.md` for the full contract, voice list, and curl smoke tests.
