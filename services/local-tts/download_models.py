"""Fetch the pinned German bundle on a development or image-building machine."""

import argparse
import re
import shutil
import urllib.request
from pathlib import Path

from piper_backend import read_manifest, verify_file


def download_bundle(source: Path, directory: Path) -> None:
    manifest = read_manifest(source)
    downloads = []
    for model in manifest.models:
        match = re.fullmatch(
            r"de_DE-([a-z][a-z0-9_]*)-(low|medium|high|x_low)", model.id
        )
        if (
            match is None
            or model.source_url
            != "https://huggingface.co/rhasspy/piper-voices/resolve/"
            or model.file != f"{model.id}.onnx"
            or model.config_file != f"{model.id}.onnx.json"
        ):
            raise ValueError("Invalid pinned German model download path.")
        for name, expected in [
            (model.file, model.sha256),
            (model.config_file, model.config_sha256),
        ]:
            url = (
                f"{model.source_url}{model.source_revision}/de/de_DE/"
                f"{match[1]}/{match[2]}/{name}"
            )
            downloads.append((name, expected, url))
    directory.mkdir(parents=True, exist_ok=True)
    if (directory / "manifest.json").is_symlink():
        raise ValueError("Model downloads cannot use a symlink.")
    for name, expected, url in downloads:
        target = directory / name
        if target.is_symlink():
            raise ValueError("Model downloads cannot use a symlink.")
        if target.exists():
            verify_file(target, expected)
            continue
        temporary = target.with_suffix(target.suffix + ".partial")
        created = False
        try:
            with temporary.open("xb") as output:
                created = True
                with urllib.request.urlopen(url, timeout=120) as response:
                    shutil.copyfileobj(response, output)
            verify_file(temporary, expected)
            temporary.replace(target)
        finally:
            if created:
                temporary.unlink(missing_ok=True)
    shutil.copyfile(source, directory / "manifest.json")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    download_bundle(Path(__file__).parent / "voices" / "german.json", args.directory)


if __name__ == "__main__":
    main()
