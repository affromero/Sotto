"""Verify bundle preparation through the actual filesystem and HTTP boundary."""

import hashlib
import io
import json
from pathlib import Path

import pytest

from download_models import download_bundle


@pytest.fixture
def source(tmp_path, monkeypatch):
    manifest = json.loads(
        (Path(__file__).parents[1] / "voices/german.json").read_text()
    )
    bodies = {}
    for model in manifest["models"]:
        for field, checksum in [("file", "sha256"), ("config_file", "config_sha256")]:
            content = f"verified download {model[field]}".encode()
            bodies[model[field]] = content
            model[checksum] = hashlib.sha256(content).hexdigest()
    path = tmp_path / "source.json"
    path.write_text(json.dumps(manifest))
    requests = []

    def fetch(url, timeout):
        requests.append(url)
        assert timeout == 120
        return io.BytesIO(bodies[url.rsplit("/", 1)[1]])

    monkeypatch.setattr("urllib.request.urlopen", fetch)
    return path, manifest, bodies, requests


def test_prepared_bundle_contains_verified_files_from_pinned_model_urls(
    source, tmp_path
):
    path, manifest, bodies, requests = source
    directory = tmp_path / "models"
    download_bundle(path, directory)
    assert (directory / "manifest.json").read_bytes() == path.read_bytes()
    assert all((directory / name).read_bytes() == body for name, body in bodies.items())
    revision = "c10ece1aade47bb51c153c893d14e5bf8e5b7117"
    prefix = f"https://huggingface.co/rhasspy/piper-voices/resolve/{revision}/de/de_DE"
    assert set(requests) == {
        f"{prefix}/thorsten/medium/de_DE-thorsten-medium.onnx",
        f"{prefix}/thorsten/medium/de_DE-thorsten-medium.onnx.json",
        f"{prefix}/kerstin/low/de_DE-kerstin-low.onnx",
        f"{prefix}/kerstin/low/de_DE-kerstin-low.onnx.json",
    }
    requests.clear()
    download_bundle(path, directory)
    assert requests == []
    assert json.loads((directory / "manifest.json").read_text()) == manifest


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("id", "de_DE-../kerstin-low"),
        ("id", "de_DE-kerstin%2flow-low"),
        ("id", "de_DE-kerstin-low?query"),
        ("id", "de_DE-kerstin-unknown"),
        ("file", "../de_DE-kerstin-low.onnx"),
        ("config_file", "other.onnx.json"),
        ("source_url", "https://example.invalid/resolve/"),
        ("source_url", "https://huggingface.co/rhasspy/piper-voices/resolve/?query="),
        ("source_revision", "main"),
    ],
)
def test_invalid_second_model_is_rejected_before_any_download_or_directory_write(
    source, tmp_path, field, value
):
    path, manifest, _, requests = source
    manifest["models"][1][field] = value
    path.write_text(json.dumps(manifest))
    directory = tmp_path / "models"
    with pytest.raises(ValueError):
        download_bundle(path, directory)
    assert not directory.exists()
    assert requests == []


def test_download_checksum_failure_leaves_no_published_file_or_manifest(
    source, tmp_path
):
    path, manifest, bodies, _ = source
    name = manifest["models"][0]["file"]
    bodies[name] = b"corrupted network response"
    directory = tmp_path / "models"
    with pytest.raises(ValueError, match="checksum"):
        download_bundle(path, directory)
    assert list(directory.iterdir()) == []


def test_corrupt_existing_file_is_preserved_and_cannot_be_accepted(source, tmp_path):
    path, manifest, _, requests = source
    directory = tmp_path / "models"
    directory.mkdir()
    target = directory / manifest["models"][0]["file"]
    target.write_bytes(b"corrupted cache")
    with pytest.raises(ValueError, match="checksum"):
        download_bundle(path, directory)
    assert target.read_bytes() == b"corrupted cache"
    assert not (directory / "manifest.json").exists()
    assert requests == []


@pytest.mark.parametrize("target_name", ["model", "manifest"])
def test_symlink_destination_never_overwrites_an_external_file(
    source, tmp_path, target_name
):
    path, manifest, _, requests = source
    directory = tmp_path / "models"
    directory.mkdir()
    outside = tmp_path / "outside"
    outside.write_bytes(b"preserve outside")
    name = manifest["models"][0]["file"] if target_name == "model" else "manifest.json"
    (directory / name).symlink_to(outside)
    with pytest.raises(ValueError, match="symlink"):
        download_bundle(path, directory)
    assert outside.read_bytes() == b"preserve outside"
    assert requests == []


def test_existing_partial_download_is_preserved_without_network_request(
    source, tmp_path
):
    path, manifest, _, requests = source
    directory = tmp_path / "models"
    directory.mkdir()
    partial = directory / f"{manifest['models'][0]['file']}.partial"
    partial.write_bytes(b"another download owns this file")
    with pytest.raises(FileExistsError):
        download_bundle(path, directory)
    assert partial.read_bytes() == b"another download owns this file"
    assert not (directory / "manifest.json").exists()
    assert requests == []


def test_failed_network_download_cleans_only_its_unpublished_partial(
    source, tmp_path, monkeypatch
):
    path, _, _, _ = source

    def fetch(url, timeout):
        raise OSError("network failed")

    monkeypatch.setattr("urllib.request.urlopen", fetch)
    directory = tmp_path / "models"
    with pytest.raises(OSError, match="network"):
        download_bundle(path, directory)
    assert list(directory.iterdir()) == []
