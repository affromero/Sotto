"""Build isolated Docker archive and receipt fixtures."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SHA = 'a' * 40
REPOSITORIES = {
    'showcase': 'ghcr.io/affromero/sotto-web-prod',
    'personal': 'ghcr.io/affromero/sotto-web-personal-prod',
    'workers': 'ghcr.io/affromero/sotto-workers-prod',
}
PROVENANCE: dict[str, object] = {
    'repository': 'affromero/Sotto',
    'workflow': '.github/workflows/deploy.yml',
    'runId': 123, 'runAttempt': 1, 'sourceRunId': 100,
}


def environment() -> dict[str, str]:
    return {key: value for key, value in os.environ.items()
            if not key.startswith('GIT_') and key != 'PYTHONPATH'}


def receipt(role: str) -> dict[str, object]:
    result: dict[str, object] = {
        'schemaVersion': 1, 'sha': SHA, 'role': role,
        'reference': REPOSITORIES[role] + '@sha256:' + 'b' * 64,
        'imageId': 'sha256:' + 'b' * 64,
        'configDigest': 'sha256:' + 'c' * 64,
        'source': 'https://github.com/affromero/Sotto', 'revision': SHA,
        'platform': 'linux/amd64',
        'measurement': {
            'expanded_bytes': 12288, 'compressed_bytes': 20480,
            'archive_bytes': 20480, 'archive_gzip_bytes': 1024,
            'layer_allocated_bytes': 12288, 'history_expanded_bytes': 8192,
            'layer_file_count': 3,
        },
        'provenance': dict(PROVENANCE),
    }
    if role == 'workers':
        result['runtime'] = {
            'schemaHash': 'd' * 64, 'rollingContract': 'e' * 64,
            'queueNames': ['audio-generation', 'class-preparation'],
            'providerAssets': {
                'protectedHash': 'f' * 64,
                'files': {'apps/web/src/lib/queue.ts': 'd' * 64},
            },
        }
    return result


def field(value: dict[str, object], key: str) -> dict[str, object]:
    child = value[key]
    if not isinstance(child, dict):
        raise ValueError('Expected fixture object')
    return child


def tar_bytes(entries: list[tuple[tarfile.TarInfo, bytes]]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w') as archive:
        for entry, data in entries:
            entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))
    return buffer.getvalue()


def image_archive(path: Path, layer: bytes,
                  architecture: str = 'amd64') -> None:
    manifest = json.dumps([{
        'Config': 'config.json', 'Layers': ['layer.tar', 'layer.tar'],
    }]).encode()
    configuration = json.dumps({
        'os': 'linux', 'architecture': architecture,
    }).encode()
    path.write_bytes(tar_bytes([
        (tarfile.TarInfo('manifest.json'), manifest),
        (tarfile.TarInfo('config.json'), configuration),
        (tarfile.TarInfo('layer.tar'), layer),
    ]))


class ReceiptFixture(unittest.TestCase):
    root: Path
    directory: tempfile.TemporaryDirectory[str]
    release: dict[str, object]
    receipts: dict[str, dict[str, object]]

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(
            prefix='sotto-image-test-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.release = {
            'sha': SHA,
            'images': {role: receipt(role)['reference']
                       for role in REPOSITORIES},
        }
        self.receipts = {role: receipt(role) for role in REPOSITORIES}

    def aggregate(
        self, attempt: int = 1,
    ) -> tuple[int, str, dict[str, object] | None]:
        (self.root / 'receipts').mkdir(exist_ok=True)
        for role, value in self.receipts.items():
            (self.root / f'receipts/{role}.json').write_text(json.dumps(value))
        (self.root / 'release.json').write_text(json.dumps(self.release))
        output = self.root / 'metadata.json'
        result = subprocess.run([
            sys.executable, '-m', 'scripts.deploy.images.metadata',
            '--release', str(self.root / 'release.json'),
            '--receipts', str(self.root / 'receipts'),
            '--output', str(output), '--run-id', '123',
            '--run-attempt', str(attempt),
            '--source-run-id', '100',
        ], cwd=ROOT, env=environment(), text=True, capture_output=True)
        return (result.returncode, result.stdout + result.stderr,
                json.loads(output.read_text()) if output.exists() else None)
