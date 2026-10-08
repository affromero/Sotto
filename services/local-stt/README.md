# Optional local speech recognition

This image serves the existing OpenAI-compatible STT API on CPU. Selection is
manual. It does not change cloud credentials, provider defaults or learner progress.

The base is Speaches 0.8.3 CPU, pinned to its published linux/amd64 manifest
`sha256:1d4f852ff5b148d675bcd751f414835c0bcef2541c1df8ffdeb43714968aafe6`.
The build downloads multilingual `Systran/faster-whisper-small` at revision
`536b0662742c02347bc0e980a01041f333bce120`, which includes German. It writes
`sotto-model-provenance.json` with the model file hashes and the explicit alias
`whisper-1` to that model. This alias replaces Speaches' larger default model.
The runtime uses CPU int8, two inference threads and one worker. Hugging Face
access is offline; missing models fail rather than downloading or selecting another model.

Build offserver for the target architecture:

```sh
docker build --platform linux/amd64 --build-arg COMMIT_SHA="$SOURCE" \
  -t sotto-local-stt:review services/local-stt
```

Before publishing, run the image with a read-only filesystem, a temporary `/tmp`,
two CPUs, a 2048 MiB memory limit and no network egress. Send a public German WAV
synthesized by Piper to `/v1/audio/transcriptions` with `model=whisper-1`,
`language=de`, `response_format=verbose_json`, and word/segment timestamps.
Check the transcript, finite timestamp bounds, model/alias hashes and rejection
of an unknown model. Record peak memory and transcription time divided by audio
duration. This checks the synthetic audio pipeline; it does not assess a person's pronunciation.

The paired image smoke declares the whole task sentence
`Gestern bin ich zu Fuß zum Markt gegangen.` before synthesis. Every configured
Piper voice must transcribe that complete sentence, preserving its time, actor,
walking action and destination. The comparison allows case, punctuation and
`ß`/`ss` differences. Missing or additional words fail. It records every raw
transcript, timestamp error, WAV hash, model hash, memory peak and timing before
reporting failure. Earlier greeting and place-name diagnostics remain separate;
this task smoke does not claim perfect general German recognition.

Run both verified images from the same actual source revision:

```sh
scripts/deploy/smoke-local-stt-image.sh "$STT_IMAGE" "$PIPER_IMAGE" "$SOURCE"
```

An optional fourth argument names a new evidence directory and retains the
public WAVs and receipts. An existing directory is rejected. Without it, the
script cleans temporary samples and its containers after printing the receipt.
Both images run without network egress, as UID 1000 on a read-only filesystem.
Piper has a 512 MiB limit; STT has a 2048 MiB limit, two CPUs and a 128 process
limit. The published image contains Small itself; no model overlay or alternate
image is substituted by this smoke.

The previous Base model failed this whole-sentence check on newly synthesized
audio. Piper generates fresh samples, so one passing pair does not guarantee
other generated samples will pass. CI retains the public WAVs, full transcripts,
timestamps and resource receipts on success and failure. Its publication gate
still requires every fresh voice sample to pass the unchanged whole sentence.

Publish the verified image offserver and supply its full `repository@sha256`
reference as `SOTTO_LOCAL_STT_IMAGE` to `docker-compose.local-stt.yml`. The optional
service uses the existing `sotto-network` and loopback port 8002. Do not mount a
cache volume over its baked model files. Verify capacity before starting it.

In Admin, explicitly save STT provider `local`, base URL
`http://local-stt:8000/v1`, and model `whisper-1`. In the selected learner's speech
settings, explicitly select `whisper-1` to replace any saved cloud STT model.
Keep the listening/speaking language set to the actual course language. Returning
to cloud STT requires an explicit Admin provider change. Errors do not switch providers.

Upstream references: [Speaches aliases](https://github.com/speaches-ai/speaches/blob/v0.8.3/src/speaches/model_aliases.py),
[CPU image](https://github.com/speaches-ai/speaches/pkgs/container/speaches/519955595?tag=0.8.3-cpu),
[pinned model](https://huggingface.co/Systran/faster-whisper-small/tree/536b0662742c02347bc0e980a01041f333bce120).
