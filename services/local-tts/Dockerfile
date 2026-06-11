FROM python:3.11-slim

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
