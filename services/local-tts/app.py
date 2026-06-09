"""
Local Kokoro TTS sidecar — a keyless, self-hosted text-to-speech server.

Wraps the open-source Kokoro-82M model (https://github.com/hexgrad/kokoro) in a
small FastAPI service with a custom HTTP contract that the Sotto `kokoro` TTS
provider talks to. No API key is required; the server ignores auth entirely.

HTTP contract
-------------
POST /tts
    Request JSON:  { "text": str, "voice": str, "language"?: str }
    Response:      audio/wav bytes (24 kHz, mono, 16-bit PCM)

GET /voices
    Response JSON: { "voices": [ { "id": str, "language": str, "label": str }, ... ] }

GET /health
    Response JSON: { "status": "ok" }

Kokoro voices follow the `{lang}{gender}_{name}` convention. The first letter of
the voice id selects the Kokoro pipeline language code (`a` = American English,
`b` = British English, `e` = Spanish, `f` = French, `i` = Italian, `p` =
Brazilian Portuguese, `h` = Hindi, `j` = Japanese, `z` = Mandarin Chinese).
"""

from __future__ import annotations

import io
import logging
from functools import lru_cache

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("local-tts")

SAMPLE_RATE = 24_000

# Map the voice-id prefix letter → Kokoro pipeline `lang_code`.
# Kokoro builds one KPipeline per language; the prefix letter of each voice id
# tells us which pipeline that voice belongs to.
PREFIX_TO_LANG_CODE = {
    "a": "a",  # American English
    "b": "b",  # British English
    "e": "e",  # Spanish
    "f": "f",  # French
    "i": "i",  # Italian
    "p": "p",  # Brazilian Portuguese
    "h": "h",  # Hindi
    "j": "j",  # Japanese
    "z": "z",  # Mandarin Chinese
}

# Catalogue surfaced by GET /voices. ISO-639-1 language is what Sotto stores; the
# Kokoro pipeline code is derived from the id prefix at synth time.
VOICES = [
    # American English
    {"id": "af_heart", "language": "en", "label": "Heart (US English, female)"},
    {"id": "af_bella", "language": "en", "label": "Bella (US English, female)"},
    {"id": "af_nicole", "language": "en", "label": "Nicole (US English, female)"},
    {"id": "am_adam", "language": "en", "label": "Adam (US English, male)"},
    {"id": "am_michael", "language": "en", "label": "Michael (US English, male)"},
    # British English
    {"id": "bf_emma", "language": "en", "label": "Emma (British English, female)"},
    {"id": "bm_george", "language": "en", "label": "George (British English, male)"},
    # Spanish
    {"id": "ef_dora", "language": "es", "label": "Dora (Spanish, female)"},
    {"id": "em_alex", "language": "es", "label": "Alex (Spanish, male)"},
    # French
    {"id": "ff_siwis", "language": "fr", "label": "Siwis (French, female)"},
    # Italian
    {"id": "if_sara", "language": "it", "label": "Sara (Italian, female)"},
    {"id": "im_nicola", "language": "it", "label": "Nicola (Italian, male)"},
    # Portuguese
    {"id": "pf_dora", "language": "pt", "label": "Dora (Portuguese, female)"},
    {"id": "pm_alex", "language": "pt", "label": "Alex (Portuguese, male)"},
    # Hindi
    {"id": "hf_alpha", "language": "hi", "label": "Alpha (Hindi, female)"},
    {"id": "hm_omega", "language": "hi", "label": "Omega (Hindi, male)"},
    # Japanese
    {"id": "jf_alpha", "language": "ja", "label": "Alpha (Japanese, female)"},
    {"id": "jm_kumo", "language": "ja", "label": "Kumo (Japanese, male)"},
    # Chinese
    {"id": "zf_xiaobei", "language": "zh", "label": "Xiaobei (Chinese, female)"},
    {"id": "zm_yunjian", "language": "zh", "label": "Yunjian (Chinese, male)"},
]

DEFAULT_VOICE = "af_heart"

app = FastAPI(title="Sotto Local Kokoro TTS", version="1.0.0")


class TtsRequest(BaseModel):
    text: str = Field(..., min_length=1)
    voice: str = Field(default=DEFAULT_VOICE, min_length=1)
    language: str | None = None


@lru_cache(maxsize=None)
def _get_pipeline(lang_code: str):
    """Lazily build (and cache) one Kokoro KPipeline per language code."""
    from kokoro import KPipeline

    logger.info("Loading Kokoro pipeline for lang_code=%s", lang_code)
    return KPipeline(lang_code=lang_code)


def _lang_code_for_voice(voice: str) -> str:
    prefix = voice[:1].lower()
    code = PREFIX_TO_LANG_CODE.get(prefix)
    if code is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown voice prefix '{prefix}' in voice id '{voice}'. "
                f"Supported prefixes: {sorted(PREFIX_TO_LANG_CODE)}."
            ),
        )
    return code


def _synthesize(text: str, voice: str) -> np.ndarray:
    """Run Kokoro over the text and concatenate all audio chunks into one array."""
    pipeline = _get_pipeline(_lang_code_for_voice(voice))

    chunks: list[np.ndarray] = []
    # KPipeline yields (graphemes, phonemes, audio) per chunk; audio is a float32
    # torch tensor or numpy array at 24 kHz.
    for _, _, audio in pipeline(text, voice=voice):
        if audio is None:
            continue
        array = np.asarray(audio, dtype=np.float32).reshape(-1)
        if array.size:
            chunks.append(array)

    if not chunks:
        raise HTTPException(status_code=500, detail="Kokoro produced no audio for the given text.")

    return np.concatenate(chunks)


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/voices")
def voices() -> JSONResponse:
    return JSONResponse({"voices": VOICES})


@app.post("/tts")
def tts(req: TtsRequest) -> Response:
    audio = _synthesize(req.text, req.voice)

    buffer = io.BytesIO()
    sf.write(buffer, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    buffer.seek(0)

    logger.info(
        "Synthesized %d samples (%.2fs) for voice=%s",
        audio.size,
        audio.size / SAMPLE_RATE,
        req.voice,
    )
    return Response(content=buffer.read(), media_type="audio/wav")
