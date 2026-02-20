FROM python:3.12-slim

WORKDIR /app

# Install system dependencies needed by soundfile (libsndfile) and numpy
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Pre-download the model at build time so first request is instant
ARG KITTENTTS_MODEL=KittenML/kitten-tts-mini-0.8
ENV KITTENTTS_MODEL=${KITTENTTS_MODEL}
RUN python -c "from kittentts import KittenTTS; KittenTTS('${KITTENTTS_MODEL}')" || true

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
