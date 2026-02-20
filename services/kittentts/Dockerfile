# ── uv version pin — bump here to upgrade uv across all envs ─────────────────
FROM ghcr.io/astral-sh/uv:0.10.4 AS uv

# ── runtime image ─────────────────────────────────────────────────────────────
FROM python:3.12.9-slim

WORKDIR /app

# Install system deps needed by soundfile (libsndfile) and audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Copy uv binary from the pinned uv image
COPY --from=uv /uv /uvx /usr/local/bin/

# Use system Python (no venv needed in a single-purpose container) and
# disable the cache to keep the image lean
ENV UV_SYSTEM_PYTHON=1 \
    UV_NO_CACHE=1 \
    UV_COMPILE_BYTECODE=1

# Copy dependency manifests first — Docker caches this layer until they change
COPY pyproject.toml .python-version ./

# Install all dependencies; --no-dev skips any dev extras if added later
RUN uv pip install -r pyproject.toml

COPY main.py .

# Pre-download the model at build time so the first request is instant.
# The "|| true" prevents a build failure if the HuggingFace hub is unreachable
# (e.g., in air-gapped CI); the model will be pulled on first startup instead.
ARG KITTENTTS_MODEL=KittenML/kitten-tts-mini-0.8
ENV KITTENTTS_MODEL=${KITTENTTS_MODEL}
RUN python -c "from kittentts import KittenTTS; KittenTTS('${KITTENTTS_MODEL}')" || true

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
