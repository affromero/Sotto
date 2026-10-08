# Local speech sidecar

This optional CPU service supports two explicitly selected engines. Kokoro
remains the default and supports English, Spanish, French, Italian, Portuguese,
Hindi, Japanese, and Chinese. Piper supplies German through a pinned local ONNX
voice bundle. Neither engine needs a cloud credential.

In Sotto settings, choose **Kokoro** for the default engine or **Local** for
Piper. Save `http://local-tts:8000` when the worker shares the Compose network,
or the sidecar's reachable URL in another deployment. Select Local manually
when replacing a paid speech service. No request automatically switches
providers, and an existing paid-provider failure remains a failure.

The **Speech selection** panel also lets a learner explicitly disable audio.
Text learning continues, and new lessons record listening and speaking as
disabled. Existing progress and generated material stay intact. Re-enabling
speech uses the explicitly configured provider; it does not select a provider
from saved keys.

Confirmed provider credit exhaustion blocks new audio-enabled lesson generation
before content generation starts. Sidedoor stores that account state separately
from credential validity. Restore credits and explicitly check speech in Settings,
select a configured local server, or disable audio to continue. Supported checks
make one short speech request and validate the actual returned audio. Usage
history and a successful key check do not establish an available credit balance.
There is no automatic reset or provider switch.

## HTTP contract

| Method | Path      | Request                                       | Response                                        |
| ------ | --------- | --------------------------------------------- | ----------------------------------------------- |
| GET    | `/health` | None                                          | `{ "status": "ok", "engine": "piper" }`         |
| GET    | `/voices` | None                                          | `{ "voices": [{ "id", "label", "language" }] }` |
| POST   | `/tts`    | `{ "text", "voice"?, "language"?, "model"? }` | PCM WAV bytes                                   |

Text must contain non-whitespace characters and is limited to 4096 characters.
Unknown voices, models, and mismatched languages fail instead of selecting a
different engine. Omitted voice uses the configured engine's first voice.
This private-network service does not authenticate requests. Protect any public
endpoint with a reverse proxy and optionally save its credential in Sotto.

Kokoro produces mono, 16-bit, 24 kHz WAV. Piper preserves its model's native
rate; the bundled German models produce mono, 16-bit WAV at 22,050 Hz for
Thorsten and 16,000 Hz for Kerstin. Consumers
must read the WAV header rather than assume a sample rate.

## German Piper bundle

The optional Piper image uses `piper-tts==1.8.0`, ONNX Runtime CPU, and the
two explicitly configured single-speaker models:

| Sotto voice ID       | Piper model             | Native sample rate | Speaker index |
| -------------------- | ----------------------- | ------------------ | ------------- |
| `de-thorsten-medium` | `de_DE-thorsten-medium` | 22,050 Hz          | 0             |
| `de-kerstin-low`     | `de_DE-kerstin-low`     | 16,000 Hz          | 0             |

These IDs identify the original models without claiming an auditioned quality
rating. Each model has one cached CPU inference session. Save both voice IDs
in Sotto to select this explicit voice pool. Additional voices can be configured
in the manifest, with speaker indices valid for the installed model. Piper
bundles must use German espeak phonemization, a local file,
configuration file, and SHA256 checksums. The service accepts at most eight
configured models and 32 voices per model.

The voice source is the [Piper voice repository](https://huggingface.co/rhasspy/piper-voices)
at revision `c10ece1aade47bb51c153c893d14e5bf8e5b7117`. The model and configuration
SHA256 values are pinned in [voices/german.json](voices/german.json). The bundled
[Thorsten model card](voices/de_DE-thorsten-medium-MODEL_CARD) identifies the
[Thorsten-Voice dataset](https://github.com/thorstenMueller/Thorsten-Voice), and the
[Kerstin model card](voices/de_DE-kerstin-low-MODEL_CARD) identifies
[dataset-voice-kerstin](https://github.com/rhasspy/dataset-voice-kerstin). Both model
cards specify [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Preserve
the cards with redistributed bundles. Piper's engine is GPL-3.0-or-later; its source is
[OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl/tree/v1.8.0).

Model-file size does not establish process memory usage. Measure warm synthesis
latency, real-time factor, peak RSS, and pronunciation for the configured voices
on the actual deployment image before choosing resource limits.

## Build and run

The default target preserves Kokoro:

```bash
docker build -t sotto-local-tts services/local-tts
docker run --rm -p 127.0.0.1:8000:8000 sotto-local-tts
```

Build the separate Piper target on a development or image-building machine:

```bash
docker build --target piper --build-arg COMMIT_SHA=local -t sotto-local-piper services/local-tts
docker run --rm -p 127.0.0.1:8000:8000 sotto-local-piper
```

The Piper target installs its locked dependencies with UV and verifies the
pinned model downloads during the image build. Startup verifies both file
checksums and loads the configured models before becoming healthy. Runtime
never downloads models. Deploy an immutable image built offserver; do not build
or install dependencies on the serving host.

The downloader validates all model IDs, matching filenames, the canonical
Hugging Face source and immutable revision before writing a bundle. Cached files
must also match their pinned hashes. A failed download cannot publish its
partial file as a model or publish a completed manifest.

The Piper image runs as UID/GID 1000. Its CPU session uses two intra-operation
threads and one inter-operation thread; synthesis requests share a lock.

For optional local Compose, run:

```bash
LOCAL_TTS_ENGINE=piper docker compose --profile local up -d local-tts
```

`docker-compose.local-speech.yml` also runs the separate prebuilt Piper service
on an existing `sotto-network`. Set `SOTTO_LOCAL_TTS_IMAGE` to the verified full
`ghcr.io/affromero/sotto-local-piper-prod@sha256:...` reference. Compose requires
this value but does not validate digest syntax, so validate the immutable
reference before launching it. Import the image through the deployment's capacity
guard first, then start with `--no-build --pull never`. The service binds port
8001 to loopback and uses a 512 MiB memory limit and two CPU cores. Starting the
service does not change learner settings. In Settings, explicitly select Local,
save `http://local-tts:8000`, use model ID `local`, and enter the German voice IDs.

For development without Docker, from `services/local-tts`:

```bash
uv sync --locked
uv run python download_models.py --directory ./models
LOCAL_TTS_ENGINE=piper PIPER_VOICE_MANIFEST=./models/manifest.json \
  uv run uvicorn app:app --host 127.0.0.1 --port 8000
uv run pytest
```

`download_models.py` is a build/development utility and is never invoked by the
server. To use a separately prepared bundle, mount its directory read-only and
set `PIPER_VOICE_MANIFEST` to that directory's manifest path. The packaged
default is `/opt/piper/models/manifest.json`.

Verify German synthesis through the actual HTTP contract:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/voices
curl --fail http://localhost:8000/tts -H 'Content-Type: application/json' \
  -d '{"text":"Grüße aus Köln. Gestern bin ich zu Fuß zum Markt gegangen.","voice":"de-thorsten-medium","language":"de","model":"local"}' \
  --output german.wav
```

An offserver image smoke test must also synthesize the configured voices with
network access disabled and decode nonempty WAV audio. The mocked-engine HTTP
tests verify transport and validation behavior; they do not prove German
pronunciation, distinct real voices, speed, or memory usage.

The image includes a real HTTP smoke runner that saves WAV samples and reports
warm latency, real-time factor, and child-process peak RSS. Run it on the
offserver builder with no external network access and a fresh output folder:

```bash
bash scripts/deploy/smoke-local-speech-image.sh sotto-local-piper FULL_SOURCE_SHA
```

Replace `FULL_SOURCE_SHA` with the image's full source commit. The script checks
the source label, writes samples through a private host directory, decodes them
with FFmpeg, prints the measurements, and removes its temporary container and
samples. Files in a container's `/tmp` tmpfs cannot be recovered after it exits.
