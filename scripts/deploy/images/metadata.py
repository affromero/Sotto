"""Validate and assemble exact-image CI receipts without image downloads."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

SOURCE = 'https://github.com/affromero/Sotto'
ROLES = {
    'showcase': 'ghcr.io/affromero/sotto-web-prod',
    'personal': 'ghcr.io/affromero/sotto-web-personal-prod',
    'workers': 'ghcr.io/affromero/sotto-workers-prod',
}
MEASUREMENT_KEYS = {
    'expanded_bytes', 'compressed_bytes', 'archive_gzip_bytes',
    'archive_bytes',
    'layer_allocated_bytes', 'history_expanded_bytes', 'layer_file_count',
}


def record(value: object, name: str) -> dict[str, object]:
    if not isinstance(value, dict) or any(
            not isinstance(key, str) for key in value):
        raise ValueError(f'{name} must be an object')
    return value


def digest(value: object, name: str, prefix: str = '') -> str:
    if not isinstance(value, str) or not re.fullmatch(
            re.escape(prefix) + r'[0-9a-f]{64}', value):
        raise ValueError(f'{name} must contain a SHA-256 digest')
    return value


def source_sha(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r'[0-9a-f]{40}', value):
        raise ValueError('A full source SHA is required')
    return value


def image_reference(role: str, value: object) -> str:
    if role not in ROLES or not isinstance(value, str) or not re.fullmatch(
            re.escape(ROLES[role]) + r'@sha256:[0-9a-f]{64}', value):
        raise ValueError(f'Invalid immutable image reference for {role}')
    return value


def positive_integer(value: object, name: str) -> int:
    if type(value) is not int or value <= 0:
        raise ValueError(f'{name} must be a positive integer')
    return value


def measurement(value: object) -> dict[str, int]:
    result = record(value, 'measurement')
    if set(result) != MEASUREMENT_KEYS:
        raise ValueError('Canonical measurements must be positive integers')
    numbers = {key: positive_integer(value, key)
               for key, value in result.items()}
    expanded = numbers['expanded_bytes']
    transfer = numbers['compressed_bytes']
    if expanded != max(numbers['layer_allocated_bytes'],
                       numbers['history_expanded_bytes']):
        raise ValueError('Expanded measurement does not preserve its bounds')
    if transfer != max(numbers['archive_bytes'],
                       numbers['archive_gzip_bytes']):
        raise ValueError('Transfer measurement does not preserve its bounds')
    return numbers


def runtime_metadata(value: object) -> dict[str, object]:
    runtime = record(value, 'runtime')
    if set(runtime) != {
            'schemaHash', 'rollingContract', 'queueNames', 'providerAssets'}:
        raise ValueError('Worker runtime metadata is incomplete')
    digest(runtime['schemaHash'], 'schemaHash')
    digest(runtime['rollingContract'], 'rollingContract')
    queues = runtime['queueNames']
    if (not isinstance(queues, list) or not queues
            or any(not isinstance(name, str)
                   or not re.fullmatch(r'[a-z][a-z-]*', name)
                   for name in queues)
            or queues != sorted(set(queues))):
        raise ValueError('Worker queue names must be unique and sorted')
    assets = record(runtime['providerAssets'], 'providerAssets')
    if set(assets) != {'protectedHash', 'files'}:
        raise ValueError('Provider asset evidence is incomplete')
    digest(assets['protectedHash'], 'protectedHash')
    files = record(assets['files'], 'provider asset files')
    if not files:
        raise ValueError('Provider asset files are empty')
    for path, value in files.items():
        if (path.startswith('/') or '\\' in path or '\x00' in path
                or any(part in ('', '.', '..') for part in path.split('/'))):
            raise ValueError('Provider asset path must be relative and exact')
        digest(value, path)
    return runtime


def provenance(value: object) -> dict[str, object]:
    result = record(value, 'provenance')
    if (set(result) != {'repository', 'workflow', 'runId', 'runAttempt',
                       'sourceRunId'}
            or result['repository'] != 'affromero/Sotto'
            or result['workflow'] != '.github/workflows/deploy.yml'):
        raise ValueError('Production source/run provenance is incomplete')
    for key in ('runId', 'runAttempt', 'sourceRunId'):
        positive_integer(result[key], key)
    return result


def validate_receipt(value: object, role: str, sha: str,
                     reference: str) -> dict[str, object]:
    receipt = record(value, role)
    keys = {
        'schemaVersion', 'sha', 'role', 'reference', 'imageId', 'configDigest',
        'source', 'revision', 'platform', 'measurement', 'provenance',
    }
    if role == 'workers':
        keys.add('runtime')
    if set(receipt) != keys or type(receipt['schemaVersion']) is not int:
        raise ValueError(f'{role}: incomplete image receipt')
    if (receipt['schemaVersion'] != 1 or receipt['sha'] != source_sha(sha)
            or receipt['revision'] != sha or receipt['role'] != role
            or receipt['source'] != SOURCE
            or receipt['platform'] != 'linux/amd64'
            or receipt['reference'] != image_reference(role, reference)):
        raise ValueError(f'{role}: image provenance differs from this release')
    actual_id = digest(receipt['imageId'], 'imageId', 'sha256:')
    if actual_id != reference.split('@', 1)[1]:
        raise ValueError('Actual containerd image ID differs from its digest')
    digest(receipt['configDigest'], 'configDigest', 'sha256:')
    measurement(receipt['measurement'])
    provenance(receipt['provenance'])
    if role == 'workers':
        runtime_metadata(receipt['runtime'])
    return receipt


def assemble(release_value: object, receipts: dict[str, object],
             expected_provenance: dict[str, object]) -> dict[str, object]:
    release = record(release_value, 'release')
    if set(release) != {'sha', 'images'}:
        raise ValueError('Release record must retain its existing two fields')
    sha = source_sha(release['sha'])
    images = record(release['images'], 'images')
    if set(images) != set(ROLES) or set(receipts) != set(ROLES):
        raise ValueError('All three production image roles are required')
    expected = provenance(expected_provenance)
    verified = {}
    for role in ROLES:
        reference = image_reference(role, images[role])
        receipt = validate_receipt(receipts[role], role, sha, reference)
        actual = provenance(receipt['provenance'])
        attempt = positive_integer(actual['runAttempt'], 'receipt runAttempt')
        latest = positive_integer(expected['runAttempt'], 'current runAttempt')
        if attempt > latest or any(
                actual[key] != value for key, value in expected.items()
                if key != 'runAttempt'):
            raise ValueError(f'{role}: receipt came from another Actions run')
        verified[role] = receipt
    return {
        'schemaVersion': 1, 'sha': sha, 'platform': 'linux/amd64',
        'provenance': expected, 'images': verified,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', type=Path, required=True)
    parser.add_argument('--receipts', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--run-id', type=int, required=True)
    parser.add_argument('--run-attempt', type=int, required=True)
    parser.add_argument('--source-run-id', type=int, required=True)
    args = parser.parse_args()
    paths = list(args.receipts.glob('*.json'))
    if {path.name for path in paths} != {f'{role}.json' for role in ROLES}:
        raise ValueError('Expected exactly the three image metadata receipts')
    result = assemble(
        json.loads(args.release.read_text()),
        {path.stem: json.loads(path.read_text()) for path in paths},
        {'repository': 'affromero/Sotto',
         'workflow': '.github/workflows/deploy.yml',
         'runId': args.run_id, 'runAttempt': args.run_attempt,
         'sourceRunId': args.source_run_id},
    )
    args.output.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
