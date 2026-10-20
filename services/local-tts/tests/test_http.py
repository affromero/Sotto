"""Exercise the bundled Kokoro HTTP contract at its neural-model boundary."""

import io
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

import app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("LOCAL_TTS_ENGINE", raising=False)

    def pipeline(_text, voice):
        yield None, None, np.array([0.0, 0.25], dtype=np.float32)
        yield None, None, np.array([-0.25, 0.0], dtype=np.float32)

    monkeypatch.setattr(app, "_get_pipeline", lambda _language: pipeline)
    with TestClient(app.create_app()) as http:
        yield http


def test_catalogue_and_health_describe_the_bundled_engine(client):
    assert client.get("/health").json() == {"status": "ok", "engine": "kokoro"}
    voices = client.get("/voices").json()["voices"]
    assert any(voice["id"] == "af_heart" for voice in voices)
    assert "de" not in {voice["language"] for voice in voices}


def test_synthesis_preserves_native_rate_and_all_pcm_chunks(client):
    response = client.post(
        "/tts",
        json={
            "text": "Hello there.",
            "voice": "af_heart",
            "language": "en-US",
            "model": "kokoro",
        },
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    with wave.open(io.BytesIO(response.content), "rb") as audio:
        assert audio.getnchannels() == 1
        assert audio.getsampwidth() == 2
        assert audio.getframerate() == 24000
        assert np.frombuffer(
            audio.readframes(audio.getnframes()), dtype="<i2"
        ).tolist() == [0, 8192, -8192, 0]


@pytest.mark.parametrize(
    "payload,status",
    [
        ({"text": ""}, 422),
        ({"text": "   "}, 422),
        ({"text": "x" * 4097}, 422),
        ({"text": "Hello", "voice": "uninstalled"}, 400),
        ({"text": "Hello", "voice": "af_heart", "language": "de"}, 400),
        ({"text": "Hello", "model": "uninstalled"}, 400),
    ],
)
def test_invalid_requests_do_not_produce_audio(client, payload, status):
    response = client.post("/tts", json=payload)
    assert response.status_code == status
    assert response.headers["content-type"] == "application/json"


@pytest.mark.parametrize("engine", ["piper", "unknown"])
def test_an_unsupported_explicit_engine_fails_instead_of_switching(monkeypatch, engine):
    monkeypatch.setenv("LOCAL_TTS_ENGINE", engine)
    with pytest.raises(ValueError, match="only Kokoro"):
        app.create_app()


def test_empty_model_output_is_an_http_failure(client, monkeypatch):
    monkeypatch.setattr(
        app, "_get_pipeline", lambda _language: lambda *_args, **_kwargs: iter(())
    )
    response = client.post("/tts", json={"text": "Hello"})
    assert response.status_code == 500
    assert "no audio" in response.json()["detail"]
