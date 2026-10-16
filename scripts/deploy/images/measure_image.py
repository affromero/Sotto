"""Measure built Linux amd64 images off-server for capacity admission.

Keep this algorithm equivalent to the maintained production measure-image.py.
Serving hosts must consume its receipt instead of saving image archives.

Source: affromero/pricetoken, scripts/measure-image.py
Commit: 8f0e14633dd39075b12bb273f54e3f5c19b5008c
Source SHA-256:
    6f376366e3f931970db9ac296bfd0f457500c9e8f130b68e08d4d85ebebe11db
"""

from __future__ import annotations

import contextlib
import gzip
import io
import json
import shutil
import subprocess
import tarfile
import tempfile
from collections.abc import Generator
from pathlib import Path
from typing import IO, TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    from _typeshed import ReadableBuffer


class Measurement(TypedDict):
    expanded_bytes: int
    compressed_bytes: int
    archive_gzip_bytes: int
    archive_bytes: int
    layer_allocated_bytes: int
    history_expanded_bytes: int
    layer_file_count: int


@contextlib.contextmanager
def layer_reader(
    source: IO[bytes],
) -> Generator[IO[bytes] | gzip.GzipFile, None, None]:
    magic = source.read(4)
    source.seek(0)
    if magic[:2] == b'\x1f\x8b':
        with gzip.GzipFile(fileobj=source) as expanded:
            yield expanded
    elif magic == b'\x28\xb5\x2f\xfd':
        with tempfile.NamedTemporaryFile() as compressed:
            shutil.copyfileobj(source, compressed)
            compressed.flush()
            process = subprocess.Popen(
                ['zstd', '-dc', compressed.name], stdout=subprocess.PIPE)
            if process.stdout is None:
                raise ValueError('Layer decompression output is unavailable')
            try:
                yield process.stdout
                if process.wait() != 0:
                    raise ValueError('Zstandard layer decompression failed')
            finally:
                process.stdout.close()
                if process.poll() is None:
                    process.kill()
                    process.wait()
    else:
        yield source


def archive_layers(archive_path: Path) -> tuple[int, int]:
    with tarfile.open(archive_path, 'r:') as archive:
        manifest_file = archive.extractfile('manifest.json')
        if manifest_file is None:
            raise ValueError('Saved image manifest is unavailable')
        with manifest_file:
            manifests = json.load(manifest_file)
        selected = []
        for manifest in manifests:
            config_file = archive.extractfile(manifest['Config'])
            if config_file is None:
                raise ValueError('Saved image configuration is unavailable')
            with config_file:
                config = json.load(config_file)
            if (config.get('os') == 'linux'
                    and config.get('architecture') == 'amd64'):
                selected.append(manifest)
        if len(selected) != 1:
            raise ValueError('Expected exactly one Linux amd64 saved image')
        allocated = 0
        file_count = 0
        for name in set(selected[0]['Layers']):
            source = archive.extractfile(name)
            if source is None:
                raise ValueError('Image layer is unavailable')
            with source, layer_reader(source) as expanded:
                with tarfile.open(fileobj=expanded, mode='r|') as layer:
                    for member in layer:
                        if member.isfile():
                            allocated += ((member.size + 4095) // 4096) * 4096
                        elif member.isdir() or member.issym():
                            allocated += 4096
                        elif member.islnk():
                            continue
                        else:
                            raise ValueError('Unsupported image layer entry')
                        file_count += 1
        if allocated <= 0 or file_count <= 0:
            raise ValueError('Expanded image measurement is empty')
        return allocated, file_count


class Counter(io.RawIOBase):
    bytes: int

    def __init__(self) -> None:
        self.bytes = 0

    def writable(self) -> bool:
        return True

    def write(self, data: ReadableBuffer) -> int:
        size = memoryview(data).nbytes
        self.bytes += size
        return size


def measure(image: str) -> Measurement:
    history = subprocess.check_output([
        'docker', 'history', '--platform', 'linux/amd64', '--no-trunc',
        '--human=false', '--format', '{{.Size}}', image,
    ], text=True).splitlines()
    if not history or any(not value.isdecimal() for value in history):
        raise ValueError('Expanded image history is unavailable')
    history_bytes = sum(int(value) for value in history)
    if history_bytes <= 0:
        raise ValueError('Expanded image history is empty')
    with tempfile.TemporaryDirectory(
            prefix='sotto-image-measure-') as directory:
        archive = Path(directory) / 'image.tar'
        subprocess.run([
            'docker', 'save', '--platform', 'linux/amd64', '-o', str(archive),
            image,
        ], check=True)
        allocated, files = archive_layers(archive)
        counter = Counter()
        with archive.open('rb') as source:
            with gzip.GzipFile(
                    fileobj=counter, mode='wb', mtime=0) as compressed:
                shutil.copyfileobj(source, compressed)
        archive_bytes = archive.stat().st_size
        return {
            'expanded_bytes': max(allocated, history_bytes),
            'compressed_bytes': max(counter.bytes, archive_bytes),
            'archive_gzip_bytes': counter.bytes,
            'archive_bytes': archive_bytes,
            'layer_allocated_bytes': allocated,
            'history_expanded_bytes': history_bytes,
            'layer_file_count': files,
        }


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image')
    print(json.dumps(measure(parser.parse_args().image)))
