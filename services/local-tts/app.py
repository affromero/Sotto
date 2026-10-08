"""
Local speech sidecar with explicitly selected Kokoro or German Piper engines.

The existing Kokoro provider and generic Local provider use this private-network
HTTP service. No cloud credential is needed. Engine selection never changes
in response to a synthesis failure.

HTTP contract
-------------
POST /tts
    Request JSON:  { "text": str, "voice": str, "language"?: str }
    Response:      audio/wav bytes (native sample rate, mono, 16-bit PCM)

GET /voices
    Response JSON: { "voices": [ { "id": str, "language": str, "label": str }, ... ] }

GET /health
    Response JSON: { "status": "ok", "engine": "kokoro" | "piper" }

Kokoro voices follow the `{lang}{gender}_{name}` convention. The first letter of
the voice id selects the Kokoro pipeline language code (`a` = American English,
`b` = British English, `e` = Spanish, `f` = French, `i` = Italian, `p` =
Brazilian Portuguese, `h` = Hindi, `j` = Japanese, `z` = Mandarin Chinese).
"""

from __future__ import annotations

import io
import logging
import os
from contextlib import asynccontextmanager
from functools import cache
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator

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


class TtsRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4096)
    voice: str | None = Field(default=None, min_length=1)
    language: str | None = Field(default=None, min_length=1)
    model: str | None = None

    @field_validator("text")
    @classmethod
    def text_has_words(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Speech text must not be blank.")
        return value


@cache
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
        raise HTTPException(
            status_code=500, detail="Kokoro produced no audio for the given text."
        )

    return np.concatenate(chunks)


def create_app() -> FastAPI:
    engine = os.environ.get("LOCAL_TTS_ENGINE", "kokoro")
    if engine not in ("kokoro", "piper"):
        raise ValueError("Unknown local TTS engine.")

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        if engine == "piper":
            from piper_backend import PiperBackend

            path = Path(
                os.environ.get(
                    "PIPER_VOICE_MANIFEST", "/opt/piper/models/manifest.json"
                )
            )
            application.state.piper = PiperBackend(path)
        yield

    application = FastAPI(title="Sotto Local TTS", version="1.0.0", lifespan=lifespan)

    @application.get("/health")
    def health() -> JSONResponse:
        return JSONResponse({"status": "ok", "engine": engine})

    @application.get("/voices")
    def voices() -> JSONResponse:
        catalogue = application.state.piper.catalogue() if engine == "piper" else VOICES
        return JSONResponse({"voices": catalogue})

    @application.post("/tts")
    def tts(req: TtsRequest) -> Response:
        if engine == "piper":
            from piper_backend import PiperRequestError

            try:
                data = application.state.piper.synthesize(
                    req.text, req.voice, req.language, req.model
                )
            except PiperRequestError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
            except Exception as error:
                logger.error("Piper synthesis failed: %s", type(error).__name__)
                raise HTTPException(
                    status_code=500, detail="Local speech synthesis failed."
                ) from error
            return Response(content=data, media_type="audio/wav")
        voice = req.voice or DEFAULT_VOICE
        if not any(item["id"] == voice for item in VOICES):
            raise HTTPException(status_code=400, detail="Unknown Kokoro voice.")
        language = next(item["language"] for item in VOICES if item["id"] == voice)
        if (
            req.language
            and req.language.replace("_", "-").split("-")[0].lower() != language
        ):
            raise HTTPException(
                status_code=400, detail="The language does not match the voice."
            )
        if req.model not in (None, "kokoro", "local"):
            raise HTTPException(status_code=400, detail="Unknown Kokoro model.")
        audio = _synthesize(req.text, voice)
        buffer = io.BytesIO()
        sf.write(buffer, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
        logger.info("Synthesized %d samples for voice=%s", audio.size, voice)
        return Response(content=buffer.getvalue(), media_type="audio/wav")

    return application


app = create_app()
