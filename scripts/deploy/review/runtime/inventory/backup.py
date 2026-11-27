"""Resolve archive inputs from a fenced, stopped App Review predecessor."""

from __future__ import annotations

import hashlib
import stat
from pathlib import Path
from typing import TYPE_CHECKING, TypedDict, cast

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.build_observer import bounded_bytes
from scripts.deploy.review.runtime.inventory.environment import (
    _parse_environment,
    admit_successor_environment,
)
from scripts.deploy.review.runtime.inventory.network import verify_retained_network
from scripts.deploy.review.state import checksum, private_json
from scripts.deploy.review.topology import DIRECTORY

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations


class BackupInputs(TypedDict):
    binding: dict[str, str] | None
    postgres: str
    redis: str
    web: str
    image: str
    database_url: str
    files: dict[str, bytes]


def predecessor_backup_binding(
    previous: HostOperations, successor: HostOperations,
) -> dict[str, str]:
    return {
        'predecessorManifestSha256': previous.attempt.manifest_hash,
        'predecessorEvidenceSha256': previous.attempt.evidence_hash,
        'successorManifestSha256': successor.attempt.manifest_hash,
        'successorEvidenceSha256': successor.attempt.evidence_hash,
    }


def predecessor_backup_sources(
    previous: HostOperations, successor: HostOperations,
) -> BackupInputs:
    verify_retained_network(previous, successor)
    values, environment = admit_successor_environment(previous, successor)
    directory = previous.attempt.directory
    topology = record(previous.manifest['topology'], 'predecessor topology')
    services = record(topology['services'], 'predecessor services')
    postgres = record(services['postgres'], 'predecessor PostgreSQL')
    redis = record(services['redis'], 'predecessor Redis')
    web = private_json(directory / 'candidate-web.json')
    image = record(previous.manifest['finalWeb'], 'predecessor review web')
    files = {
        'compose': bounded_bytes(Path(DIRECTORY) / 'compose.yml'),
        'candidate': bounded_bytes(
            directory / 'candidate-compose.json', private=True,
        ),
        'caddy': bounded_bytes(successor.attempt.directory
                               / 'original-caddy.conf', private=True),
        'environment': bounded_bytes(directory / 'original.env', private=True),
    }
    old_files = record(previous.manifest['originalFiles'], 'predecessor files')
    new_files = record(successor.manifest['originalFiles'], 'successor files')
    expected = {
        'compose': old_files['compose'], 'caddy': new_files['caddyFragment'],
        'candidate': environment['candidateComposeSha256'],
    }
    if any(hashlib.sha256(files[name]).hexdigest() != digest(value, name)
           for name, value in expected.items()):
        raise ValueError('predecessor-backup-configuration-changed')
    original_environment = _parse_environment(files['environment'])
    if checksum(original_environment) != environment['originalEnvironmentSha256']:
        raise ValueError('predecessor-backup-environment-changed')
    return {
        'binding': predecessor_backup_binding(previous, successor),
        'postgres': digest(postgres['id'], 'predecessor PostgreSQL'),
        'redis': digest(redis['id'], 'predecessor Redis'),
        'web': digest(web['id'], 'predecessor web'),
        'image': digest(image['imageId'], 'predecessor web image', 'sha256:'),
        'database_url': values['DATABASE_URL'],
        'files': files,
    }


def original_backup_sources(operations: HostOperations) -> BackupInputs:
    environment = operations.runtime_environment()
    topology = record(operations.manifest['topology'], 'topology')
    services = record(topology['services'], 'services')
    web = record(services['web'], 'web')
    return {
        'binding': None,
        'postgres': cast(str, record(services['postgres'], 'postgres')['id']),
        'redis': cast(str, record(services['redis'], 'redis')['id']),
        'web': cast(str, web['id']),
        'image': cast(str, web['imageId']),
        'database_url': operations.private_environment['DATABASE_URL'],
        'files': {
            'compose': bounded_bytes(Path(DIRECTORY) / 'compose.yml'),
            'caddy': bounded_bytes(
                operations.attempt.directory / 'original-caddy.conf',
            ),
            'environment': bounded_bytes(environment),
        },
    }


def file_integrity(path: Path, budget: int) -> dict[str, object]:
    metadata = path.stat(follow_symlinks=False)
    if not stat.S_ISREG(metadata.st_mode) or not 0 < metadata.st_size <= budget:
        raise ValueError('bounded-backup-file-required')
    hashed = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hashed.update(chunk)
    return {'sha256': hashed.hexdigest(), 'bytes': metadata.st_size}
