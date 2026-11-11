"""Authenticate a completed review candidate's retained environment."""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import TYPE_CHECKING

from scripts.deploy.images.metadata import record
from scripts.deploy.review.build_observer import bounded_bytes
from scripts.deploy.review.runtime import services
from scripts.deploy.review.runtime.inventory.predecessor import _verify_release
from scripts.deploy.review.state import checksum, private_json
from scripts.deploy.review.topology import (
    AUTH_HOME,
    PRESERVED_ENVIRONMENT,
    PUBLIC_ENVIRONMENT,
    environment,
)

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations


def _private_bytes(path: Path) -> bytes:
    if path.lstat().st_uid != os.geteuid():
        raise ValueError('review-environment-owner-changed')
    value = bounded_bytes(path, private=True)
    if len(value) > 262_144:
        raise ValueError('review-environment-bound-exceeded')
    return value


def _parse_environment(data: bytes) -> dict[str, str]:
    if not data.endswith(b'\n') or b'\r' in data or b'\x00' in data:
        raise ValueError('review-environment-format-changed')
    lines = data.decode('utf-8').splitlines()
    result: dict[str, str] = {}
    for line in lines:
        name, separator, value = line.partition('=')
        if (not separator or not re.fullmatch(r'[A-Z][A-Z0-9_]*', name)
                or name in result or '\n' in value):
            raise ValueError('review-environment-format-changed')
        result[name] = value
    if len(result) > 200:
        raise ValueError('review-environment-bound-exceeded')
    return result


def admit_successor_environment(
    previous: HostOperations, successor: HostOperations,
) -> tuple[dict[str, str], dict[str, str]]:
    """Return verified worker settings and hashes without logging secrets.

    The caller must keep values in memory or a private 0600 helper env file.
    This does not admit any helper process or establish workload quiescence.
    """
    _verify_release(previous, successor, allow_unresolved=True)
    directory = previous.attempt.directory
    original_bytes = _private_bytes(directory / 'original.env')
    original = _parse_environment(original_bytes)
    topology = record(previous.manifest['topology'], 'topology')
    old_web = record(record(topology['services'], 'services')['web'], 'old web')
    if checksum(original) != old_web['environmentHash']:
        raise ValueError('review-original-environment-changed')
    raw = _private_bytes(directory / 'candidate-compose.json')
    document = record(json.loads(raw), 'candidate compose')
    if json.dumps(document, sort_keys=True).encode() != raw:
        raise ValueError('review-candidate-compose-not-canonical')
    compose_hash = hashlib.sha256(raw).hexdigest()
    desired_services = record(document['services'], 'candidate services')
    if set(desired_services) != {'web', 'workers'}:
        raise ValueError('review-candidate-services-changed')
    policy = record(previous.manifest['runtimePolicy'], 'runtime policy')
    final_web = record(previous.manifest['finalWeb'], 'final web')
    final_worker = record(previous.manifest['finalWorker'], 'final worker')
    source = final_web['sha']
    contact = policy['privacyContactEmail']
    if not isinstance(source, str) or final_worker['sha'] != source:
        raise ValueError('review-candidate-source-mismatch')
    if not isinstance(contact, str):
        raise ValueError('review-contact-invalid')
    preserved = {key: value for key, value in original.items()
                 if key in PRESERVED_ENVIRONMENT}
    preserved.update(PUBLIC_ENVIRONMENT)
    preserved.update({'COMMIT_SHA': source, 'HOME': '/home/sotto',
                      'CODEX_HOME': AUTH_HOME, 'PORT': '3000',
                      'SOTTO_PRIVACY_CONTACT_EMAIL': contact})
    if any(not preserved.get(key) for key in (
        'DATABASE_URL', 'REDIS_URL', 'BYOK_ENCRYPTION_KEY',
    )):
        raise ValueError('review-required-environment-missing')
    worker_values: dict[str, str] = {}
    for role in ('web', 'workers'):
        desired = record(desired_services[role], 'candidate service')
        image = final_web if role == 'web' else final_worker
        expected = dict(preserved)
        if role == 'workers':
            expected.update({'WORKER_PROFILE': 'all', 'WORKER_PRESET': 'full',
                             'WORKER_QUEUES': '', 'WORKER_EXCLUDE_QUEUES': ''})
        if desired.get('environment') != expected:
            raise ValueError('review-candidate-environment-changed')
        if desired.get('image') != image['reference']:
            raise ValueError('review-candidate-image-changed')
        intent = private_json(directory / ('candidate-' + role + '-intent.json'))
        if intent != {'name': desired['container_name'],
                      'reference': desired['image'], 'composeHash': compose_hash}:
            raise ValueError('review-candidate-intent-changed')
        candidate = services.verify_candidate(previous, role, require_running=False)
        actual = previous.inspect(candidate)
        if len(actual) != 1 or actual[0].get('Image') != image['imageId']:
            raise ValueError('review-candidate-not-unique')
        actual_env = environment(actual[0])
        if any(actual_env.get(key) != value for key, value in expected.items()):
            raise ValueError('review-live-environment-changed')
        if role == 'workers':
            worker_values = expected
    successor.verify_fence()
    return worker_values, {
        'originalEnvironmentSha256': checksum(original),
        'candidateComposeSha256': compose_hash,
        'workerEnvironmentSha256': checksum(worker_values),
    }
