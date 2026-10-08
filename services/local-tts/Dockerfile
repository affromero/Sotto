FROM python:3.11-slim AS piper

ARG COMMIT_SHA=local
LABEL org.opencontainers.image.revision=$COMMIT_SHA

COPY --from=ghcr.io/astral-sh/uv:0.11.17 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project --python /usr/local/bin/python
ENV PATH="/app/.venv/bin:$PATH" LOCAL_TTS_ENGINE=piper PYTHONDONTWRITEBYTECODE=1
COPY app.py piper_backend.py download_models.py smoke.py ./
COPY README.md ./
COPY voices ./voices
# Models are downloaded and verified only during the offserver image build.
RUN python download_models.py --directory /opt/piper/models
USER 1000:1000
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]

FROM python:3.11-slim AS kokoro

# System dependencies:
#   - libsndfile1 for the `soundfile` package (WAV encoding)
#   - espeak-ng as Kokoro's grapheme-to-phoneme fallback for some languages
#   - git for pip installs that resolve from source
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    espeak-ng \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for better layer caching. CPU-only by default —
# Kokoro-82M runs comfortably on CPU; no CUDA layers are pulled in.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py ./

EXPOSE 8000

# Single worker keeps the loaded Kokoro pipelines in one process. Scale by
# running multiple replicas behind the Docker service name if needed.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
