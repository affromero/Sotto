# Optional local speech recognition

This optional CPU image serves the OpenAI-compatible STT API. Provider selection
is explicit. It does not change saved cloud credentials or learner progress.

The base is Speaches 0.8.3 CPU, pinned to its Linux amd64 manifest
`sha256:1d4f852ff5b148d675bcd751f414835c0bcef2541c1df8ffdeb43714968aafe6`.
The build downloads `Systran/faster-whisper-small` at revision
`536b0662742c02347bc0e980a01041f333bce120` and records every model file hash
in `sotto-model-provenance.json`. The explicit `whisper-1` alias selects that
model. Runtime inference uses CPU int8 with two threads and one worker.
Hugging Face access is offline. Missing files fail without a download or switch.

## Build and qualify

Build away from production for the published architecture:

```sh
docker build --platform linux/amd64 --build-arg COMMIT_SHA="$SOURCE" \
  -t sotto-local-stt:review services/local-stt
scripts/deploy/smoke-local-stt-image.sh sotto-local-stt:review "$SOURCE" "$NEW_EVIDENCE_DIR"
```

The optional third argument must name a new evidence directory. Without it,
the runner prints its receipt and cleans temporary evidence. Qualification
requires the image's source label to match the supplied full source revision.

The image contains two public German recordings from different speakers.
`fixtures/manifest.json` records immutable source and transcript references,
CC0 provenance, conversion steps, SHA-256 hashes, native sample rates, durations,
and expected text. Inputs require no TTS image or network download.

The smoke validates the WAV files and calls the real STT server with
`model=whisper-1`, `language=de`, `response_format=verbose_json`, and word
and segment timestamps. Each entire transcript must match its own declared
reference. Case, punctuation, and `ß`/`ss` differences are accepted.
Missing or added words, partial timestamp coverage, and invalid timing fail.

The runner uses UID 1000, a read-only filesystem, no network egress, two CPUs,
a 2048 MiB memory limit, and a 128-process limit. It verifies unchanged model
and alias bytes, unknown-model HTTP 404, and peak memory below 2 GiB.
Version 2 receipts bind the fixture manifest and each audio/response hash.
Raw responses, partial outcomes, server logs, public WAVs, container identity,
exit status, and OOM state are retained before a failure is reported.

This bounded smoke checks these two recordings. It does not establish general
German recognition accuracy or assess pronunciation.

## Configure

Publish only after the baked image passes qualification. Set its full
`repository@sha256` reference as `SOTTO_LOCAL_STT_IMAGE` in
`docker-compose.local-stt.yml`. Do not mount a cache over its baked models.
Verify host capacity before starting it.

In Admin, select STT provider `local`, URL `http://local-stt:8000/v1`, and model
`whisper-1`. In the learner's speech settings, select the same model. Keep the
course's actual language. Returning to cloud STT requires an explicit provider
change. Request errors never switch providers.

References: [Speaches aliases](https://github.com/speaches-ai/speaches/blob/v0.8.3/src/speaches/model_aliases.py),
[pinned model](https://huggingface.co/Systran/faster-whisper-small/tree/536b0662742c02347bc0e980a01041f333bce120).
