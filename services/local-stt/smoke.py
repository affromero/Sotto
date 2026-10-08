"""Whole-utterance synthetic speech check through the real local STT API."""

import argparse
import hashlib
import json
import math
import os
import re
import resource
import subprocess
import sys
import time
import unicodedata
import urllib.request
import wave
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def words(text: str) -> list[str]:
    return re.findall(r"[^\W_]+", unicodedata.normalize("NFC", text).casefold())


def response_errors(raw: dict, expected_text: str, duration: float) -> list[str]:
    errors = []
    text = raw.get("text")
    if not isinstance(text, str) or words(text) != words(expected_text):
        errors.append("Whole utterance differs from the declared synthesis text.")
    for key, text_key in (("words", "word"), ("segments", "text")):
        parts = raw.get(key)
        if not isinstance(parts, list) or not parts:
            errors.append(f"Missing {key} timestamps.")
            continue
        previous_start = 0.0
        for part in parts:
            if not isinstance(part, dict):
                errors.append(f"Invalid {key} timestamp: {part!r}")
                continue
            start, end = part.get("start"), part.get("end")
            if (
                type(start) not in (int, float)
                or type(end) not in (int, float)
                or not math.isfinite(start)
                or not math.isfinite(end)
                or not 0 <= start <= end <= duration + 0.5
                or start < previous_start - 0.05
                or not isinstance(part.get(text_key), str)
                or not part[text_key].strip()
            ):
                errors.append(f"Invalid {key} timestamp: {part!r}")
                continue
            previous_start = start
        if isinstance(text, str):
            complete_text = " ".join(
                part[text_key]
                for part in parts
                if isinstance(part, dict) and isinstance(part.get(text_key), str)
            )
            if words(complete_text) != words(text):
                errors.append(f"Incomplete {key} coverage of the transcript.")
    return errors


def main() -> None:
    from openai import NotFoundError, OpenAI

    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-directory", type=Path, required=True)
    parser.add_argument("--piper-receipt", type=Path, required=True)
    parser.add_argument("--expected-text", required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if not words(args.expected_text) or len(args.expected_text) > 1000:
        raise ValueError("Declare a nonempty, bounded public synthesis utterance.")
    args.output_directory.mkdir(parents=True, exist_ok=True)
    if any(args.output_directory.iterdir()):
        raise ValueError("Use a fresh directory to preserve earlier evidence.")
    output = args.output_directory
    piper = json.loads(args.piper_receipt.read_bytes())
    assert piper["engine"] == "piper"
    assert piper["referenceText"] == args.expected_text
    samples = [sample for sample in piper["measurements"] if sample["warm"]]
    assert 2 <= len(samples) <= 32
    assert len({sample["voiceId"] for sample in samples}) == len(samples)
    assert len({sample["sha256"] for sample in samples}) == len(samples)
    audio_files = sorted(
        args.audio_directory.glob("voice-*.wav"),
        key=lambda path: int(path.stem.split("-")[1]),
    )
    assert len(audio_files) == len(samples)
    provenance = json.loads(
        Path("/home/ubuntu/speaches/sotto-model-provenance.json").read_bytes()
    )
    assert provenance["model"] == "Systran/faster-whisper-small"
    assert provenance["revision"] == "536b0662742c02347bc0e980a01041f333bce120"
    assert provenance["aliases"] == {"whisper-1": provenance["model"]}
    aliases = Path("/home/ubuntu/speaches/model_aliases.json")
    assert sha256(aliases) == provenance["aliasSha256"]
    snapshot = (
        Path(os.environ["HF_HUB_CACHE"])
        / "models--Systran--faster-whisper-small"
        / "snapshots"
        / provenance["revision"]
    )
    files_before = {
        path.name: sha256(path) for path in snapshot.iterdir() if path.is_file()
    }
    assert files_before == provenance["files"]
    assert os.environ["HF_HUB_OFFLINE"] == "1"
    rows, failures = [], []
    unknown_status = None
    with (output / "server.log").open("xb") as logs:
        server = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "--factory",
                "speaches.main:create_app",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
            stdout=logs,
            stderr=logs,
        )
        try:
            deadline = time.monotonic() + 90
            while True:
                try:
                    with urllib.request.urlopen(
                        "http://127.0.0.1:8000/health", timeout=2
                    ) as response:
                        assert response.status == 200
                    break
                except OSError:
                    if server.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError("The STT image did not become healthy.")
                    time.sleep(0.2)
            client = OpenAI(
                api_key="local",
                base_url="http://127.0.0.1:8000/v1",
                max_retries=0,
                timeout=180,
            )
            for sample, path in zip(samples, audio_files, strict=True):
                assert sha256(path) == sample["sha256"]
                with wave.open(str(path), "rb") as audio:
                    assert audio.getnchannels() == 1 and audio.getsampwidth() == 2
                    rate = audio.getframerate()
                    duration = audio.getnframes() / rate
                assert rate == sample["sampleRate"] and duration > 0
                assert abs(duration - sample["audioSeconds"]) < 0.001
                started = time.monotonic()
                with path.open("rb") as audio:
                    result = client.audio.transcriptions.create(
                        file=audio,
                        model="whisper-1",
                        language="de",
                        response_format="verbose_json",
                        timestamp_granularities=["word", "segment"],
                    )
                elapsed = time.monotonic() - started
                raw = result.model_dump()
                raw_path = output / f"{path.stem}.json"
                raw_path.write_text(
                    json.dumps(raw, ensure_ascii=False, indent=2) + "\n"
                )
                errors = response_errors(raw, args.expected_text, duration)
                failures.extend(f"{sample['voiceId']}: {error}" for error in errors)
                rows.append(
                    {
                        "voiceId": sample["voiceId"],
                        "audioName": path.name,
                        "audioSha256": sample["sha256"],
                        "audioSeconds": duration,
                        "sampleRate": rate,
                        "transcript": raw["text"],
                        "errors": errors,
                        "seconds": elapsed,
                        "realTimeFactor": elapsed / duration,
                        "responseSha256": sha256(raw_path),
                    }
                )
                (output / "outcomes.json").write_text(
                    json.dumps(rows, ensure_ascii=False, indent=2) + "\n"
                )
            try:
                with audio_files[0].open("rb") as audio:
                    client.audio.transcriptions.create(
                        file=audio,
                        model="not-installed-sotto-smoke",
                        language="de",
                        response_format="verbose_json",
                    )
                failures.append("An unknown model was accepted.")
            except NotFoundError as failure:
                unknown_status = failure.status_code
                (output / "unknown-model.json").write_text(
                    json.dumps({"status": unknown_status, "body": failure.body}) + "\n"
                )
            unchanged = (
                files_before
                == {
                    path.name: sha256(path)
                    for path in snapshot.iterdir()
                    if path.is_file()
                }
                and sha256(aliases) == provenance["aliasSha256"]
            )
            peak = int(Path("/sys/fs/cgroup/memory.peak").read_text())
        finally:
            server.terminate()
            try:
                server.wait(timeout=30)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=10)
    rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss * 1024
    if not unchanged:
        failures.append("The baked model or alias bytes changed.")
    if unknown_status != 404:
        failures.append("The unknown model did not return HTTP 404.")
    if not 0 < peak < 2147483648 or not 0 < rss < 2147483648:
        failures.append("STT memory exceeded the 2GiB qualification gate.")
    receipt = {
        "version": 1,
        "qualification": "Task-specific synthetic oral pipeline, not human pronunciation or general German ASR accuracy.",
        "qualificationPassed": not failures,
        "referenceText": args.expected_text,
        "modelProvenance": provenance,
        "piperReceiptSha256": sha256(args.piper_receipt),
        "rows": rows,
        "failures": failures,
        "memoryPeakBytes": peak,
        "serverPeakRssBytes": rss,
        "modelAndAliasBytesUnchanged": unchanged,
        "unknownModelHttpStatus": unknown_status,
        "providerRetries": 0,
    }
    (output / "receipt.json").write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2) + "\n"
    )
    print(json.dumps(receipt, ensure_ascii=False), flush=True)
    if failures:
        raise AssertionError("; ".join(failures))


if __name__ == "__main__":
    main()
