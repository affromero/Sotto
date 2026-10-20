# Local speech sidecar

The bundled CPU sidecar runs Kokoro. It supports English, Spanish, French,
Italian, Portuguese, Hindi, Japanese, and Chinese. German synthesis requires
another explicitly configured speech service.

Choose **Kokoro** in Sotto and save `http://local-tts:8000` when the worker shares
the Compose network. Use the reachable sidecar URL for other deployments.
The generic **Local** provider remains available for externally hosted speech
servers implementing the contract below. Existing external servers continue to
use their own image, model, and voice configuration.

This source tree no longer builds the Piper backend or its German voice bundle.
An explicit unsupported `LOCAL_TTS_ENGINE` fails. It never selects another engine.
Previously published images remain separate artifacts; upgrading the application
does not replace an operator's external speech image or change saved providers.

## HTTP contract

| Method | Path      | Result                                   |
| ------ | --------- | ---------------------------------------- |
| GET    | `/health` | `{"status":"ok","engine":"kokoro"}`      |
| GET    | `/voices` | `{"voices":[{"id","label","language"}]}` |
| POST   | `/tts`    | Mono, 16-bit PCM WAV at 24 kHz           |

The synthesis body contains `text` and optional `voice`, `language`, and `model`.
Text must contain non-whitespace characters and have at most 4096 characters.
The default voice is `af_heart`. Unknown voices, models, and mismatched languages
fail. Model values are `kokoro` or `local`, or omitted.

The service has no request authentication. Keep it on a private network or
protect its endpoint with a reverse proxy. Sotto can store a credential for
an external server that requires one.

## Run and verify

From the repository root:

```sh
docker compose --profile local up -d local-tts
```

The Docker target is `kokoro`. Build images away from production and pin external
images by digest in `docker-compose.local-speech.yml`. The optional STT image and
its recognition qualification are independent of this service.

The Python project provides the HTTP test environment. The runtime image installs
Kokoro from `requirements.txt`. Tests replace only the neural-model boundary:

```sh
cd services/local-tts
uv sync --locked --python 3.11
uv run pytest
uv run pytest ../local-stt/tests
uv run ruff check . ../local-stt
uv run ruff format --check . ../local-stt
```

Learners can explicitly disable audio in Speech selection and continue text
learning. Provider errors and exhausted credits remain errors until the learner
updates the configured provider, restores credits, or disables audio.
