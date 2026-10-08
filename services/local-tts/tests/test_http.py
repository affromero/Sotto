"""Exercise the sidecar HTTP contract with only the neural engine mocked."""

import hashlib
import io
import json
import struct
import sys
import types
import wave

import numpy as np
import onnxruntime
import pytest
from fastapi.testclient import TestClient
from piper import PiperVoice

from app import create_app


@pytest.fixture
def bundle(tmp_path, monkeypatch):
    manifest = {"version": 1, "models": []}
    for name, quality, sample_rate in [
        ("thorsten", "medium", 22050),
        ("kerstin", "low", 16000),
    ]:
        model_id = f"de_DE-{name}-{quality}"
        model = f"test neural model {model_id}".encode()
        config = json.dumps(
            {
                "num_symbols": 3,
                "num_speakers": 1,
                "language": {"code": "de_DE"},
                "audio": {"sample_rate": sample_rate},
                "espeak": {"voice": "de"},
                "phoneme_id_map": {},
                "phoneme_type": "espeak",
            }
        ).encode()
        (tmp_path / f"{model_id}.onnx").write_bytes(model)
        (tmp_path / f"{model_id}.onnx.json").write_bytes(config)
        manifest["models"].append(
            {
                "id": model_id,
                "file": f"{model_id}.onnx",
                "sha256": hashlib.sha256(model).hexdigest(),
                "config_file": f"{model_id}.onnx.json",
                "config_sha256": hashlib.sha256(config).hexdigest(),
                "source_url": "https://huggingface.co/rhasspy/piper-voices/resolve/",
                "source_revision": "a" * 40,
                "license": "CC0-1.0",
                "voices": [
                    {
                        "id": f"de-{name}-{quality}",
                        "language": "de",
                        "label": f"German {name}",
                        "speaker_id": 0,
                    }
                ],
            }
        )
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest))
    deliveries = []

    def synthesize_wav(self, text, wav, syn_config):
        deliveries.append(
            {
                "text": text,
                "speaker_id": syn_config.speaker_id,
                "sample_rate": self.config.sample_rate,
            }
        )
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(self.config.sample_rate)
        wav.writeframes(
            struct.pack("<h", self.config.sample_rate) * (self.config.sample_rate // 10)
        )

    def session(model_path, sess_options, providers):
        assert model_path in {
            str(tmp_path / model["file"]) for model in manifest["models"]
        }
        assert providers == ["CPUExecutionProvider"]
        assert sess_options.intra_op_num_threads == 2
        assert sess_options.inter_op_num_threads == 1
        return object()

    monkeypatch.setattr(onnxruntime, "InferenceSession", session)
    monkeypatch.setattr(PiperVoice, "synthesize_wav", synthesize_wav)
    monkeypatch.setenv("LOCAL_TTS_ENGINE", "piper")
    monkeypatch.setenv("PIPER_VOICE_MANIFEST", str(path))
    return path, manifest, deliveries


def test_german_voices_produce_pcm_wav_with_the_selected_model_native_rate(bundle):
    _, _, deliveries = bundle
    with TestClient(create_app()) as client:
        assert client.get("/health").json() == {"status": "ok", "engine": "piper"}
        catalogue = client.get("/voices").json()["voices"]
        assert {voice["id"] for voice in catalogue} == {
            "de-thorsten-medium",
            "de-kerstin-low",
        }
        assert all(voice["language"] == "de" for voice in catalogue)
        output = []
        for voice, rate in [("de-thorsten-medium", 22050), ("de-kerstin-low", 16000)]:
            response = client.post(
                "/tts",
                json={
                    "text": "Grüße aus Köln. Gestern bin ich zu Fuß zum Markt gegangen.",
                    "voice": voice,
                    "language": "de-DE",
                    "model": "local",
                },
            )
            assert response.status_code == 200
            assert response.headers["content-type"] == "audio/wav"
            with wave.open(io.BytesIO(response.content), "rb") as wav:
                assert (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) == (
                    rate,
                    1,
                    2,
                )
                assert wav.getnframes() > 0
            output.append(response.content)
        assert output[0] != output[1]
    assert [row["speaker_id"] for row in deliveries] == [0, 0]
    assert [row["sample_rate"] for row in deliveries] == [22050, 16000]
    assert all("Grüße aus Köln" in row["text"] for row in deliveries)


@pytest.mark.parametrize(
    "changes",
    [
        {"voice": "unknown"},
        {"language": "en"},
        {"language": ""},
        {"model": "cloud"},
        {"model": "de_DE-kerstin-low"},
        {"text": "   "},
        {"text": "a" * 4097},
        {"voice": ""},
    ],
)
def test_invalid_requests_do_not_reach_the_neural_engine(bundle, changes):
    _, _, deliveries = bundle
    with TestClient(create_app()) as client:
        response = client.post(
            "/tts",
            json={"text": "Guten Morgen", "voice": "de-thorsten-medium", **changes},
        )
        assert response.status_code in (400, 422)
    assert deliveries == []


@pytest.mark.parametrize(
    "damage",
    [
        "checksum",
        "missing",
        "speaker",
        "language",
        "duplicate",
        "traversal",
        "phonemizer",
    ],
)
def test_unusable_voice_bundles_cannot_start_a_healthy_service(bundle, damage):
    path, manifest, _ = bundle
    model = manifest["models"][0]
    if damage == "checksum":
        (path.parent / model["file"]).write_bytes(b"changed model")
    elif damage == "missing":
        (path.parent / model["file"]).unlink()
    elif damage == "speaker":
        model["voices"][0]["speaker_id"] = 1
    elif damage == "language":
        model["voices"][0]["language"] = "en"
    elif damage == "duplicate":
        manifest["models"][1]["voices"][0]["id"] = model["voices"][0]["id"]
    elif damage == "phonemizer":
        config_path = path.parent / model["config_file"]
        config = json.loads(config_path.read_text())
        config["espeak"]["voice"] = "ar"
        config_bytes = json.dumps(config).encode()
        config_path.write_bytes(config_bytes)
        model["config_sha256"] = hashlib.sha256(config_bytes).hexdigest()
    else:
        model["file"] = "../voice.onnx"
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError), TestClient(create_app()):
        pass


def test_unknown_engine_does_not_select_another_backend(monkeypatch):
    monkeypatch.setenv("LOCAL_TTS_ENGINE", "unknown")
    with pytest.raises(ValueError):
        create_app()


def test_default_service_retains_kokoro_catalogue(monkeypatch):
    monkeypatch.delenv("LOCAL_TTS_ENGINE", raising=False)
    with TestClient(create_app()) as client:
        assert client.get("/health").json()["engine"] == "kokoro"
        catalogue = client.get("/voices").json()["voices"]
        assert any(voice["id"] == "af_heart" for voice in catalogue)
        assert (
            client.post(
                "/tts", json={"text": "Hallo", "voice": "de-thorsten-medium"}
            ).status_code
            == 400
        )


def test_default_kokoro_speech_still_uses_its_native_wave_format(monkeypatch):
    monkeypatch.delenv("LOCAL_TTS_ENGINE", raising=False)

    class NeuralPipeline:
        def __init__(self, lang_code):
            assert lang_code == "a"

        def __call__(self, text, voice):
            assert text == "Hello from Kokoro"
            assert voice == "af_heart"
            yield text, "", np.ones(2400, dtype=np.float32) * 0.1

    monkeypatch.setitem(
        sys.modules, "kokoro", types.SimpleNamespace(KPipeline=NeuralPipeline)
    )
    with TestClient(create_app()) as client:
        response = client.post("/tts", json={"text": "Hello from Kokoro"})
        assert response.status_code == 200
        with wave.open(io.BytesIO(response.content), "rb") as wav:
            assert (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) == (
                24000,
                1,
                2,
            )
            assert wav.getnframes() == 2400


@pytest.mark.parametrize("failure", ["runtime", "value", "empty"])
def test_neural_failure_or_empty_audio_does_not_return_success_or_private_text(
    bundle, monkeypatch, failure
):
    def synthesize_wav(self, text, wav, syn_config):
        if failure == "runtime":
            raise RuntimeError(text)
        if failure == "value":
            raise ValueError(text)
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(22050)
        wav.writeframes(b"")

    monkeypatch.setattr(PiperVoice, "synthesize_wav", synthesize_wav)
    with TestClient(create_app()) as client:
        response = client.post(
            "/tts",
            json={"text": "Private learner sentence", "voice": "de-thorsten-medium"},
        )
        assert response.status_code == 500
        assert "Private learner sentence" not in response.text
