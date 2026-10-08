"""CPU Piper synthesis from an explicitly configured, verified local voice bundle."""

from __future__ import annotations

import hashlib
import io
import json
import threading
import wave
from pathlib import Path

import onnxruntime
from piper import PiperConfig, PiperVoice, SynthesisConfig
from pydantic import BaseModel, ConfigDict, Field, StrictInt


class Voice(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=128)
    label: str = Field(min_length=1, max_length=128)
    language: str = Field(pattern=r"^[a-z]{2}$")
    speaker_id: StrictInt = Field(ge=0)


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=128)
    file: str = Field(min_length=1)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    config_file: str = Field(min_length=1)
    config_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    source_url: str
    source_revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    license: str = Field(min_length=1)
    voices: list[Voice] = Field(min_length=1, max_length=32)


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: StrictInt
    models: list[Model] = Field(min_length=1, max_length=8)


def read_manifest(path: Path) -> Manifest:
    if path.stat().st_size > 65536:
        raise ValueError("Voice manifest exceeds its size limit.")
    manifest = Manifest.model_validate_json(path.read_bytes())
    if manifest.version != 1:
        raise ValueError("Unsupported voice manifest version.")
    models = [model.id for model in manifest.models]
    voices = [voice.id for model in manifest.models for voice in model.voices]
    if len(set(models)) != len(models) or len(set(voices)) != len(voices):
        raise ValueError("Duplicate configured model or voice identity.")
    return manifest


def bundle_file(directory: Path, name: str) -> Path:
    if Path(name).name != name or name in (".", ".."):
        raise ValueError("Voice files must be local bundle filenames.")
    path = directory / name
    if path.is_symlink() or not path.is_file():
        raise ValueError("A configured voice file is missing or is a symlink.")
    return path


def verify_file(path: Path, expected: str) -> None:
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != expected:
        raise ValueError("A configured voice file failed checksum verification.")


class PiperRequestError(ValueError):
    """A static request-validation error safe to return over HTTP."""


class PiperBackend:
    def __init__(self, manifest_path: Path):
        manifest = read_manifest(manifest_path)
        self.voices: dict[str, tuple[Model, Voice]] = {}
        self.models: dict[str, PiperVoice] = {}
        self.lock = threading.Lock()
        for model in manifest.models:
            path = bundle_file(manifest_path.parent, model.file)
            config = bundle_file(manifest_path.parent, model.config_file)
            verify_file(path, model.sha256)
            verify_file(config, model.config_sha256)
            config_data = json.loads(config.read_text())
            count = config_data["num_speakers"]
            if type(count) is not int or count < 1:
                raise ValueError("Invalid voice speaker count.")
            language = config_data["language"]["code"].split("_")[0]
            if (
                language != "de"
                or config_data.get("phoneme_type", "espeak") != "espeak"
                or config_data["espeak"]["voice"] != "de"
            ):
                raise ValueError(
                    "The local Piper bundle must use German espeak voices."
                )
            for voice in model.voices:
                if voice.speaker_id >= count or voice.language != language:
                    raise ValueError("Configured voice does not match its model.")
                self.voices[voice.id] = (model, voice)
            options = onnxruntime.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            self.models[model.id] = PiperVoice(
                config=PiperConfig.from_dict(config_data),
                session=onnxruntime.InferenceSession(
                    str(path), sess_options=options, providers=["CPUExecutionProvider"]
                ),
            )

    def catalogue(self) -> list[dict[str, str]]:
        return [
            {"id": voice.id, "label": voice.label, "language": voice.language}
            for _, voice in self.voices.values()
        ]

    def synthesize(
        self,
        text: str,
        voice_id: str | None,
        language: str | None,
        model_id: str | None,
    ) -> bytes:
        voice_id = voice_id or next(iter(self.voices))
        if voice_id not in self.voices:
            raise PiperRequestError("Unknown configured voice.")
        model, voice = self.voices[voice_id]
        if (
            language
            and language.replace("_", "-").split("-")[0].lower() != voice.language
        ):
            raise PiperRequestError(
                "The requested language does not match the configured voice."
            )
        if model_id not in (None, "local", "piper", model.id):
            raise PiperRequestError("Unknown configured model.")
        buffer = io.BytesIO()
        with self.lock, wave.open(buffer, "wb") as wav:
            self.models[model.id].synthesize_wav(
                text, wav, syn_config=SynthesisConfig(speaker_id=voice.speaker_id)
            )
        data = buffer.getvalue()
        with wave.open(io.BytesIO(data), "rb") as wav:
            if wav.getnframes() == 0:
                raise RuntimeError("Piper produced no audio.")
        return data
