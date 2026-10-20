# services/local-tts

The bundled private-network service runs Kokoro. Keep the generic Local provider
compatible with external servers. Unsupported explicit engines must fail without
switching providers or selecting another model.

`app.py` owns the HTTP contract. `/health` reports the engine, `/voices` returns
configured voice IDs with ISO language codes, and `/tts` returns mono 16-bit
PCM WAV at 24 kHz. Validate text, voice, model, and language before synthesis.
Do not add German voices to Kokoro's catalogue without actual engine support.

Keep Compose at the repository root. Workers use `http://local-tts:8000` on
their shared network. This service does not authenticate incoming requests.

Run `uv sync --locked --python 3.11`, `uv run pytest`, `uv run ruff check .`,
and `uv run ruff format --check .`. HTTP tests replace only the neural pipeline.
The adjacent STT tests also run in this environment with
`uv run pytest ../local-stt/tests`. Real STT qualification uses its own baked,
versioned recordings and never depends on this TTS image.

Production pulls verified immutable images. Never build or download dependencies
on the serving host. Preserve existing image inventory and continuity checks for
operators running an external speech service.
