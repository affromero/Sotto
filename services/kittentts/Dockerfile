# ── uv version pin — bump here to upgrade uv across all envs ─────────────────
FROM ghcr.io/astral-sh/uv:0.10.4 AS uv

# ── runtime image ─────────────────────────────────────────────────────────────
FROM python:3.12.9-slim

WORKDIR /app

# System deps:
#   libsndfile1  — required by soundfile
#   espeak-ng    — required by phonemizer (used internally by kittentts 0.1.x)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    espeak-ng \
    && rm -rf /var/lib/apt/lists/*

# Copy uv binary from the pinned uv image
COPY --from=uv /uv /uvx /usr/local/bin/

# Use system Python (no venv needed in a single-purpose container) and
# disable the cache to keep the image lean
ENV UV_SYSTEM_PYTHON=1 \
    UV_NO_CACHE=1 \
    UV_COMPILE_BYTECODE=1

# Copy dependency manifests first — Docker caches this layer until they change
COPY pyproject.toml uv.lock .python-version ./

# Install from lock file for reproducible builds
RUN uv pip install -r pyproject.toml

COPY main.py .

# Pre-download the nano model at build time so the first request is instant.
# kittentts 0.1.x always fetches KittenML/kitten-tts-nano-0.1 — no model arg.
# "|| true" prevents a build failure if HuggingFace is unreachable in CI;
# the model will be pulled on first startup instead.
RUN python -c "from kittentts import KittenTTS; KittenTTS()" || true

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
