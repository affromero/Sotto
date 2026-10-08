# services/local-tts

Optional keyless CPU speech sidecar. Kokoro remains the default. Piper is an
explicit alternative selected through `LOCAL_TTS_ENGINE=piper` and Sotto's
existing generic Local provider. Never switch engines after a failed request.

## Contract

- `/health` returns `{status: "ok", engine}` after Piper's verified models load.
- `/voices` exposes configured IDs, labels, and ISO language codes.
- `/tts` accepts `{text, voice?, language?, model?}` and returns native-rate,
  mono, 16-bit PCM WAV. Kokoro is 24 kHz; German Thorsten is 22,050 Hz and
  Kerstin is 16 kHz. Preserve the selected model's native rate.
- Invalid voice/model/language and blank or oversized text fail closed.
- This service is private-network only and does not authenticate requests.
- Workers sharing Compose reach `http://local-tts:8000`, not localhost.

## Implementation

`app.py` owns HTTP and explicit engine selection. `piper_backend.py` validates
local manifests, hashes, language and speaker bounds, then calls the official
Piper CPU synthesis API. It never downloads anything or invokes a paid provider.
Keep every configured voice explicit. Do not invent gender or quality labels.

`voices/german.json` pins two German single-speaker models, their source revision,
and checksums. Keep the bundled CC0 model cards and GPL engine source references
in the README. Both configured voices use speaker index zero in their own model.
Additional configured voices must use real installed speaker IDs.

`download_models.py` runs only on development/build machines. Production pulls
an immutable image with verified models already baked in, or mounts a prepared
read-only bundle. No builds or dependency/model downloads on the serving host.
Validate every model ID, matching filename, canonical Hugging Face source and
immutable revision before filesystem writes. Verify downloaded and cached hashes.

Use `uv lock` and `uv sync --locked` for the Piper project. Do not run pip or
uv pip install. The final default Docker target is still Kokoro; the separate
`piper` target must exclude Kokoro/Torch/CUDA dependencies.

## Checks

Run `uv run pytest`, `uv run ruff check .`, and `uv run ruff format --check .`.
Mock only the neural model boundary in HTTP tests and HTTP fetch in download
tests. Real offserver image checks
must synthesize German with network disabled, decode both voices' WAV output,
and measure latency, real-time factor, and RSS. A mocked WAV is not live speech
acceptance. Keep text and generated samples out of ordinary logs.
