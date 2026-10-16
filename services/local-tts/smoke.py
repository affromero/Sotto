"""Real-image German HTTP/WAV smoke, suitable for Docker --network none."""

import argparse
import hashlib
import importlib.metadata
import io
import json
import os
import resource
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-directory", type=Path, required=True)
    parser.add_argument(
        "--text",
        default="Grüße aus Köln. Gestern bin ich zu Fuß zum Markt gegangen.",
    )
    parser.add_argument(
        "--qualification-seed",
        type=int,
        choices=[0],
        help="Use fixed ONNX randomness only for reproducible qualification.",
    )
    args = parser.parse_args()
    text = args.text.strip()
    if not text or len(text) > 4096:
        parser.error("Text must contain between 1 and 4096 characters.")
    os.umask(0o077)
    args.output_directory.mkdir(parents=True, exist_ok=True)
    if any(args.output_directory.iterdir()):
        raise ValueError(
            "Use a fresh output directory to preserve earlier smoke evidence."
        )
    started = time.monotonic()
    server = ["app:app", "--host", "127.0.0.1", "--port", "8000"]
    launch = [sys.executable, "-m", "uvicorn", *server]
    if args.qualification_seed is not None:
        launch = [
            sys.executable,
            "-c",
            (
                "import onnxruntime, runpy, sys; "
                "onnxruntime.set_seed(0); "
                "sys.argv = ['uvicorn', *sys.argv[1:]]; "
                "runpy.run_module('uvicorn', run_name='__main__')"
            ),
            *server,
        ]
    process = subprocess.Popen(
        launch,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        env={**os.environ, "LOCAL_TTS_ENGINE": "piper"},
    )
    measurements = []
    try:
        deadline = started + 60
        while True:
            try:
                with urllib.request.urlopen(
                    "http://127.0.0.1:8000/health", timeout=2
                ) as response:
                    health = json.load(response)
                assert health["status"] == "ok" and health["engine"] == "piper"
                break
            except (urllib.error.URLError, TimeoutError):
                if process.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError("Piper image did not become healthy.")
                time.sleep(0.2)
        startup_seconds = time.monotonic() - started
        manifest_path = Path(
            os.environ.get("PIPER_VOICE_MANIFEST", "/opt/piper/models/manifest.json")
        )
        manifest = manifest_path.read_bytes()
        with urllib.request.urlopen(
            "http://127.0.0.1:8000/voices", timeout=5
        ) as response:
            voices = json.load(response)["voices"]
        assert len(voices) >= 2 and all(voice["language"] == "de" for voice in voices)
        for index, voice in enumerate(voices):
            packet = {
                "text": text,
                "voice": voice["id"],
                "language": "de",
                "model": "local",
            }
            for run in range(2):
                request = urllib.request.Request(
                    "http://127.0.0.1:8000/tts",
                    data=json.dumps(packet).encode(),
                    headers={"Content-Type": "application/json"},
                )
                before = time.monotonic()
                with urllib.request.urlopen(request, timeout=120) as response:
                    assert response.headers.get_content_type() == "audio/wav"
                    audio = response.read()
                elapsed = time.monotonic() - before
                with wave.open(io.BytesIO(audio), "rb") as wav:
                    assert wav.getnchannels() == 1 and wav.getsampwidth() == 2
                    frames, rate = wav.getnframes(), wav.getframerate()
                    assert frames > 0 and rate > 0
                duration = frames / rate
                measurements.append(
                    {
                        "voiceId": voice["id"],
                        "requestIndex": run,
                        "warm": run == 1,
                        "seconds": elapsed,
                        "audioSeconds": duration,
                        "realTimeFactor": elapsed / duration,
                        "sampleRate": rate,
                        "sha256": hashlib.sha256(audio).hexdigest(),
                    }
                )
                if run == 1:
                    with (args.output_directory / f"voice-{index}.wav").open(
                        "xb"
                    ) as output:
                        output.write(audio)
    finally:
        process.terminate()
        try:
            _, errors = process.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
            _, errors = process.communicate()
        (args.output_directory / "server.stderr.log").write_bytes(errors)
    rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    print(
        json.dumps(
            {
                "engine": "piper",
                "qualificationSeed": args.qualification_seed,
                "engineVersions": {
                    "piper": importlib.metadata.version("piper-tts"),
                    "onnxruntime": importlib.metadata.version("onnxruntime"),
                },
                "voiceBundle": {
                    "manifestSha256": hashlib.sha256(manifest).hexdigest(),
                    "models": json.loads(manifest)["models"],
                },
                "referenceText": text,
                "startupSeconds": startup_seconds,
                "measurements": measurements,
                "peakRssBytes": int(rss if sys.platform == "darwin" else rss * 1024),
                "qualification": "Real CPU synthesis. Pronunciation and voice distinction require listening to samples.",
            }
        )
    )


if __name__ == "__main__":
    main()
