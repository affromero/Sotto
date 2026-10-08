# Speaches 0.8.3 CPU, published linux/amd64 manifest.
FROM ghcr.io/speaches-ai/speaches:0.8.3-cpu@sha256:1d4f852ff5b148d675bcd751f414835c0bcef2541c1df8ffdeb43714968aafe6

ARG COMMIT_SHA=local
LABEL org.opencontainers.image.revision=$COMMIT_SHA \
      co.afromero.sotto.stt.model="Systran/faster-whisper-base" \
      co.afromero.sotto.stt.model-revision="ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66" \
      co.afromero.sotto.stt.model-alias="whisper-1"

WORKDIR /home/ubuntu/speaches
ENV HF_HUB_CACHE=/home/ubuntu/.cache/huggingface/hub
# Download only during the offserver build. Preserve the model card and the
# pinned main reference that faster-whisper resolves when running offline.
RUN /home/ubuntu/speaches/.venv/bin/python - <<'PY'
import hashlib
import json
from pathlib import Path
from huggingface_hub import snapshot_download

model = "Systran/faster-whisper-base"
revision = "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66"
snapshot = Path(snapshot_download(repo_id=model, revision=revision))
assert snapshot.name == revision
for required in ("README.md", "config.json", "model.bin", "tokenizer.json", "vocabulary.txt"):
    assert (snapshot / required).is_file(), required
refs = snapshot.parent.parent / "refs"
refs.mkdir(exist_ok=True)
(refs / "main").write_text(revision)
aliases = {"whisper-1": model}
Path("model_aliases.json").write_text(json.dumps(aliases, sort_keys=True) + "\n")
provenance = {
    "model": model,
    "revision": revision,
    "aliases": aliases,
    "files": {
        file.name: hashlib.sha256(file.read_bytes()).hexdigest()
        for file in sorted(snapshot.iterdir()) if file.is_file()
    },
    "aliasSha256": hashlib.sha256(Path("model_aliases.json").read_bytes()).hexdigest(),
}
Path("sotto-model-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
PY

COPY --chown=1000:1000 smoke.py /home/ubuntu/speaches/smoke.py

ENV HF_HUB_OFFLINE=1 \
    ENABLE_UI=false \
    WHISPER__INFERENCE_DEVICE=cpu \
    WHISPER__COMPUTE_TYPE=int8 \
    WHISPER__CPU_THREADS=2 \
    WHISPER__NUM_WORKERS=1 \
    PYTHONDONTWRITEBYTECODE=1
USER 1000:1000
EXPOSE 8000
CMD ["/home/ubuntu/speaches/.venv/bin/uvicorn", "--factory", "speaches.main:create_app", "--host", "0.0.0.0", "--port", "8000"]
