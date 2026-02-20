import asyncio
import io
import logging
import os
from contextlib import asynccontextmanager
from typing import Annotated

import numpy as np
import soundfile as sf
from fastapi import FastAPI, Form, HTTPException
from fastapi.responses import JSONResponse, Response

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# kittentts 0.1.3 uses a fixed nano model — no model-ID env var.
# Internal voice IDs use the expr-voice-X-{m,f} naming from the npz file.
# We expose named aliases (bella, jasper, etc.) that the Sotto voice pool uses.
VOICE_MAP: dict[str, str] = {
    # host voices (female)
    "bella": "expr-voice-2-f",
    "rosie": "expr-voice-3-f",
    "kiki": "expr-voice-4-f",
    "luna": "expr-voice-5-f",
    # expert voices (male)
    "jasper": "expr-voice-2-m",
    "bruno": "expr-voice-3-m",
    "hugo": "expr-voice-4-m",
    "leo": "expr-voice-5-m",
}

VOICES = {
    "host": ["bella", "rosie", "kiki", "luna"],
    "expert": ["jasper", "bruno", "hugo", "leo"],
}

model = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    logger.info("Loading KittenTTS model (kitten-tts-nano-0.1)")
    try:
        from kittentts import KittenTTS  # type: ignore[import]

        model = KittenTTS()
        logger.info("KittenTTS model loaded")
    except Exception as exc:
        logger.error("Failed to load KittenTTS model: %s", exc)
        raise
    yield
    model = None


app = FastAPI(title="KittenTTS", version="0.1.3", lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    if model is None:
        return JSONResponse({"status": "loading"}, status_code=503)
    return {"status": "ok", "model": "kitten-tts-nano-0.1"}


@app.get("/voices")
async def voices() -> dict:
    return VOICES


@app.post("/synthesize")
async def synthesize(
    text: Annotated[str, Form()],
    voice: Annotated[str, Form()] = "jasper",
) -> Response:
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    voice_lower = voice.lower()
    if voice_lower not in VOICE_MAP:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice '{voice}'. Available: {list(VOICE_MAP)}",
        )

    internal_voice = VOICE_MAP[voice_lower]

    try:
        audio = await asyncio.to_thread(model.generate, text, voice=internal_voice)
    except Exception as exc:
        logger.error("Synthesis failed for voice=%s: %s", voice_lower, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    buf = io.BytesIO()
    audio_array = np.array(audio) if not isinstance(audio, np.ndarray) else audio
    sf.write(buf, audio_array, 22050, format="WAV", subtype="PCM_16")
    buf.seek(0)

    return Response(content=buf.read(), media_type="audio/wav")
