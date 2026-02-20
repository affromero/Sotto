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

MODEL_ID = os.getenv("KITTENTTS_MODEL", "KittenML/kitten-tts-mini-0.8")

# Available voices split into host (warm, conversational) and expert (authoritative) roles.
# These are verified voices from the KittenTTS mini model.
VOICES = {
    "host": ["bella", "rosie", "kiki", "luna"],
    "expert": ["jasper", "bruno", "hugo", "leo"],
}

ALL_VOICES = VOICES["host"] + VOICES["expert"]

model = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    logger.info("Loading KittenTTS model: %s", MODEL_ID)
    try:
        from kittentts import KittenTTS  # type: ignore[import]

        model = KittenTTS(MODEL_ID)
        logger.info("KittenTTS model loaded")
    except Exception as exc:
        logger.error("Failed to load KittenTTS model: %s", exc)
        raise
    yield
    model = None


app = FastAPI(title="KittenTTS", version="0.8.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    if model is None:
        return JSONResponse({"status": "loading"}, status_code=503)
    return {"status": "ok", "model": MODEL_ID}


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
    if voice_lower not in ALL_VOICES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown voice '{voice}'. Available: {ALL_VOICES}",
        )

    try:
        audio = await asyncio.to_thread(model.generate, text, voice=voice_lower)
    except Exception as exc:
        logger.error("Synthesis failed for voice=%s: %s", voice_lower, exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    # Convert numpy array → WAV bytes in-memory.
    buf = io.BytesIO()
    sample_rate = getattr(audio, "sample_rate", 24000)
    audio_array = np.array(audio) if not isinstance(audio, np.ndarray) else audio
    sf.write(buf, audio_array, sample_rate, format="WAV", subtype="PCM_16")
    buf.seek(0)

    return Response(content=buf.read(), media_type="audio/wav")
