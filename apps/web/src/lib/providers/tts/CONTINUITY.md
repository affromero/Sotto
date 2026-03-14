# TTS Provider Continuity Reference

When text exceeds a provider's character limit, we split into chunks and generate audio for each. This document describes what each provider offers for **voice continuity** between chunks — ensuring natural prosody, pacing, and pronunciation across chunk boundaries.

> **Last updated:** 2026-03-14
> **Docs checked:** ElevenLabs, Cartesia, Hume AI, OpenAI, Fal, Replicate, MiniMax

---

## Provider Capabilities

| Provider | Mechanism | How It Works | Model Restrictions |
|----------|-----------|-------------|-------------------|
| **ElevenLabs** | `previous_request_ids` | Pass `request-id` headers from prior chunks (max 3). Response header: `request-id`. | **NOT supported on `eleven_v3`** (API returns 400). Works on v2 models. |
| **ElevenLabs** | `previous_text` / `next_text` | Pass surrounding text as strings for context. | **NOT supported on `eleven_v3`** (API returns 400). Works on `eleven_multilingual_v2`, `eleven_flash_v2_5`, `eleven_turbo_v2`. |
| **Cartesia** | `context_id` + `continue` | WebSocket-only. Share a `context_id` across messages, set `continue: true` for intermediate chunks, `false` for last. All fields except `transcript`/`continue`/`duration` must stay the same. | Works on all Sonic models. REST API does not support this — only WebSocket. |
| **Hume AI** | `previous_generation_id` | Pass `generation_id` from the prior chunk's response. Maintains voice, tone, pacing, and phonetic consistency (e.g., "bow" rhymes correctly based on prior context). Can also send multiple `utterances` in a single request. | Works on Octave v1. |
| **OpenAI** | None | No continuity mechanism. Each `/v1/audio/speech` request is independent. OpenAI recommends larger chunks (paragraphs) over sentences for more natural output. Max 4096 chars (tts-1/tts-1-hd) or 2000 tokens (gpt-4o-mini-tts). | — |
| **Fal** | None | Qwen3-TTS has no cross-request continuity. Each request is stateless. | — |
| **Replicate** | None | Inworld TTS / Qwen3 TTS have no cross-request continuity. | — |
| **MiniMax** | None | Speech-02 has no cross-request continuity API. | — |
| **KittenTTS** | None | Local CPU model, no continuity mechanism. | — |

---

## Implementation Status in Sotto

| Provider | Status | Mechanism |
|----------|--------|-----------|
| **ElevenLabs** | Implemented | `eleven_v3` has no continuity support (both `previous_text`/`next_text` and `previous_request_ids` rejected). v2 models use `previous_text`/`next_text`. Controlled via `modelsWithoutTextContext` in registry. |
| **Hume AI** | Implemented | `previous_generation_id` passed between chunks via `continuityIds` / `getLastContinuityId()`. |
| **Cartesia** | Not feasible | Requires WebSocket migration (REST API has no continuity). |
| **OpenAI** | N/A | No continuity mechanism available. |
| **Others** | N/A | No continuity mechanism available. |

---

## ElevenLabs Request Stitching Details

### API: `POST /v1/text-to-speech/{voice_id}`

**Request body fields for continuity:**
```json
{
  "previous_text": "string (not supported on eleven_v3)",
  "next_text": "string (not supported on eleven_v3)",
  "previous_request_ids": ["id1", "id2", "id3"],
  "next_request_ids": ["id1", "id2", "id3"]
}
```

**Response header:** `request-id` — capture this and pass to subsequent chunks.

**Rules:**
- `previous_request_ids` max length: 3 (use last 3 chunk IDs)
- If both `previous_text` and `previous_request_ids` are sent, `previous_text` is ignored
- If both `next_text` and `next_request_ids` are sent, `next_text` is ignored
- Best results when same model is used across all chunks
- `eleven_v3`: only `previous_request_ids` / `next_request_ids` work
- Other models: both text-based and ID-based mechanisms work

### Chunk loop pseudocode:
```
requestIds = []
for chunk in chunks:
  response = elevenlabs.tts(chunk, previous_request_ids=requestIds[-3:])
  requestIds.push(response.headers['request-id'])
  audioBuffers.push(response.audio)
```

---

## Hume AI Continuation Details

### API: `POST /v0/tts/stream/json`

**Request body field for continuity:**
```json
{
  "utterances": [{ "text": "...", "previous_generation_id": "gen_abc123" }]
}
```

**Response field:** `generations[].generation_id` — capture and pass to next chunk.

### Chunk loop pseudocode:
```
generationId = null
for chunk in chunks:
  utterance = { text: chunk }
  if generationId: utterance.previous_generation_id = generationId
  response = hume.tts({ utterances: [utterance] })
  generationId = response.generations[0].generation_id
  audioBuffers.push(response.audio)
```

**Alternative:** Send all chunks as multiple `utterances` in a single request (no loop needed, but requires knowing all chunks upfront — which we do).

---

## Cartesia Context Details

### API: WebSocket `wss://api.cartesia.ai/tts/websocket`

**Not available via REST API.** Requires WebSocket connection with `context_id`:

```json
{"transcript": "chunk1 text ", "continue": true, "context_id": "my-ctx-123"}
{"transcript": "chunk2 text ", "continue": true, "context_id": "my-ctx-123"}
{"transcript": "last chunk.", "continue": false, "context_id": "my-ctx-123"}
```

**Rules:**
- All fields except `transcript`, `continue`, `duration` must stay identical across messages
- Transcripts are concatenated verbatim — include trailing spaces
- Set `continue: false` on the final chunk

**Migration cost:** High — Sotto currently uses Cartesia's REST API. WebSocket migration is a separate effort.
