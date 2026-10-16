"""Exercise qualification through real child processes and HTTP boundaries."""

import hashlib
import importlib.util
import io
import json
import subprocess
import sys
import wave
from email.message import Message
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request

import pytest

SPEC = importlib.util.spec_from_file_location(
    "piper_smoke", Path(__file__).parents[1] / "smoke.py"
)
assert SPEC is not None and SPEC.loader is not None
SMOKE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SMOKE)
POPEN = subprocess.Popen


class Response(io.BytesIO):
    def __init__(self, body: bytes, content_type: str) -> None:
        super().__init__(body)
        self.headers = Message()
        self.headers["Content-Type"] = content_type


def test_seed_precedes_model_session_and_default_remains_unseeded(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    boundary = tmp_path / "runtime"
    boundary.mkdir()
    state = tmp_path / "session.json"
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"models": [{"id": "fixture-model"}]}))
    (boundary / "onnxruntime.py").write_text(
        "import json,os,sys\n"
        "from pathlib import Path\n"
        "seed=None\n"
        "def set_seed(value):\n"
        " global seed\n"
        " seed=value\n"
        "class InferenceSession:\n"
        " def __init__(self):\n"
        "  Path(os.environ['SESSION_PROOF']).write_text(json.dumps({"
        "'seedObserved':seed,'arguments':sys.argv[1:]}))\n"
    )
    (boundary / "app.py").write_text(
        "import onnxruntime\nonnxruntime.InferenceSession()\n"
    )
    (boundary / "uvicorn.py").write_text("import app\n")
    monkeypatch.setenv("PIPER_VOICE_MANIFEST", str(manifest))

    def launch(
        arguments: list[str], stdout: int, stderr: int, env: dict[str, str]
    ) -> subprocess.Popen[bytes]:
        process = POPEN(
            arguments,
            stdout=stdout,
            stderr=stderr,
            cwd=boundary,
            env={
                **env,
                "PYTHONPATH": str(boundary),
                "SESSION_PROOF": str(state),
            },
        )
        process.wait(timeout=10)
        return process

    def request(url: str | Request, timeout: int) -> Response:
        if not state.exists():
            raise URLError("The model session did not start")
        address = url if isinstance(url, str) else url.full_url
        if address.endswith("/health"):
            return Response(b'{"status":"ok","engine":"piper"}', "application/json")
        if address.endswith("/voices"):
            return Response(
                b'{"voices":[{"id":"first","language":"de"},'
                b'{"id":"second","language":"de"}]}',
                "application/json",
            )
        assert isinstance(url, Request) and isinstance(url.data, bytes)
        packet = json.loads(url.data)
        assert packet["language"] == "de" and packet["model"] == "local"
        assert packet["text"] == "Public qualification text."
        body = io.BytesIO()
        with wave.open(body, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(16000)
            audio.writeframes(b"\x01\x00" * 160)
        return Response(body.getvalue(), "audio/wav")

    monkeypatch.setattr(SMOKE.subprocess, "Popen", launch)
    monkeypatch.setattr(SMOKE.urllib.request, "urlopen", request)
    for seed in (None, 0):
        output = tmp_path / ("ordinary" if seed is None else "qualified")
        arguments = [
            "smoke.py",
            "--output-directory",
            str(output),
            "--text",
            "Public qualification text.",
        ]
        if seed is not None:
            arguments += ["--qualification-seed", str(seed)]
        monkeypatch.setattr(sys, "argv", arguments)
        SMOKE.main()
        receipt = json.loads(capsys.readouterr().out)
        observed = json.loads(state.read_bytes())
        assert observed["seedObserved"] == seed
        assert observed["arguments"] == [
            "app:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ]
        assert receipt["qualificationSeed"] == seed
        assert (
            receipt["voiceBundle"]["manifestSha256"]
            == hashlib.sha256(manifest.read_bytes()).hexdigest()
        )
        assert receipt["voiceBundle"]["models"] == [{"id": "fixture-model"}]
        assert receipt["engineVersions"] == {
            "piper": "1.8.0",
            "onnxruntime": "1.30.0",
        }
        assert [
            (row["voiceId"], row["requestIndex"], row["warm"])
            for row in receipt["measurements"]
        ] == [
            ("first", 0, False),
            ("first", 1, True),
            ("second", 0, False),
            ("second", 1, True),
        ]
        for number in range(2):
            path = output / f"voice-{number}.wav"
            warm = receipt["measurements"][number * 2 + 1]
            assert hashlib.sha256(path.read_bytes()).hexdigest() == warm["sha256"]
        state.unlink()

    (boundary / "onnxruntime.py").write_text(
        "def set_seed(value):\n raise RuntimeError('Seed initialization failed')\n"
    )
    output = tmp_path / "failed"
    monkeypatch.setattr(
        sys,
        "argv",
        ["smoke.py", "--output-directory", str(output), "--qualification-seed", "0"],
    )
    with pytest.raises(RuntimeError, match="did not become healthy"):
        SMOKE.main()
    assert not state.exists()
    assert not list(output.glob("*.wav"))
    assert "Seed initialization failed" in (output / "server.stderr.log").read_text()


def test_qualification_rejects_undeclared_seeds_before_startup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output = tmp_path / "unused"
    monkeypatch.setattr(
        sys,
        "argv",
        ["smoke.py", "--output-directory", str(output), "--qualification-seed", "1"],
    )
    with pytest.raises(SystemExit) as failure:
        SMOKE.main()
    assert failure.value.code == 2
    assert not output.exists()
