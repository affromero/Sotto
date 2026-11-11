"""Verify retained review storage after the original web is gone."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, cast

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.runtime import services
from scripts.deploy.review.runtime.mounts import (
    MOUNT_PROBE, container_inventory, physical_identity, resolve_mounts,
)
from scripts.deploy.review.runtime.inventory.stopped_writer import (
    capture_running_writer, inspect_stopped_writer,
)
from scripts.deploy.review.runtime.release import verify_completed_records, verify_startup_unit
from scripts.deploy.review.state import atomic_json, checksum, private_json
from scripts.deploy.review.topology import AUTH_HOME, DIRECTORY, EXECUTIONS, STORAGE, rows

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations


def retained_candidate_mounts(
    topology: Mapping[str, object], original: Mapping[str, object],
    candidates: Mapping[str, object], handover: Mapping[str, object],
) -> tuple[set[str], dict[str, object]]:
    """Translate old web mount identities to both exact candidate IDs."""
    services = record(topology['services'], 'original services')
    if set(services) != {'web', 'postgres', 'redis'}:
        raise ValueError('original-review-service-set-changed')
    if set(candidates) != {'web', 'workers'}:
        raise ValueError('candidate-review-service-set-changed')
    identities = {role: digest(record(services[role], 'service')['id'], 'service')
                  for role in ('web', 'postgres', 'redis')}
    active = {role: digest(record(candidates[role], 'candidate')['id'], 'candidate')
              for role in ('web', 'workers')}
    protected = {identities['postgres'], identities['redis'], *active.values()}
    if len(protected) != 4 or identities['web'] in protected:
        raise ValueError('distinct-review-storage-writers-required')
    destinations = {
        'web': {STORAGE, EXECUTIONS}, 'postgres': {'/var/lib/postgresql/data'},
        'redis': {'/data'},
    }
    keys: dict[str, object] = {}
    for role, expected in destinations.items():
        mounts = rows(record(services[role], 'service')['mounts'], 'service mount')
        if {mount.get('Destination') for mount in mounts} != expected or len(mounts) != len(expected):
            raise ValueError('original-review-mount-set-changed')
        for destination in expected:
            key = identities[role] + ':' + destination
            value = record(original.get(key), 'original mount proof')
            if set(value) != {'source', 'identity'}:
                raise ValueError('original-review-mount-proof-changed')
            source = value.get('source')
            if (not isinstance(source, str) or not PurePosixPath(source).is_absolute()
                    or '..' in PurePosixPath(source).parts):
                raise ValueError('original-review-mount-source-invalid')
            physical_identity(value.get('identity'))
            if role == 'web':
                for candidate in active.values():
                    keys[candidate + ':' + destination] = value
            else:
                keys[key] = value
    expected_original = {identities[role] + ':' + destination
                         for role, values in destinations.items() for destination in values}
    if set(original) != expected_original:
        raise ValueError('original-review-mount-proof-changed')
    home = handover.get('home')
    if home != DIRECTORY + '/auth/codex':
        raise ValueError('review-auth-home-changed')
    auth = {'source': home, 'identity': physical_identity(handover.get('identity'))}
    for candidate in active.values():
        keys[candidate + ':' + AUTH_HOME] = auth
    return protected, keys


def inspect_completed_storage(
    containers: Sequence[Mapping[str, object]], topology: Mapping[str, object],
    original: Mapping[str, object], candidates: Mapping[str, object],
    handover: Mapping[str, object], *, probe: Callable[[bytes], bytes],
    previous: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """Check roots and aliases; caller must durably retain the initial proof."""
    from scripts.deploy.review.runtime.operations import HostOperations

    protected, retained = retained_candidate_mounts(topology, original, candidates, handover)
    indexed = {container.get('Id'): container for container in containers}
    if len(indexed) != len(containers) or not protected <= indexed.keys():
        raise ValueError('review-storage-container-set-changed')
    old = record(record(topology['services'], 'services')['web'], 'old web')['id']
    if old in indexed:
        raise ValueError('retired-review-web-still-present')
    for role in ('web', 'workers'):
        candidate = record(candidates[role], 'candidate')
        actual = indexed[candidate['id']]
        if HostOperations.writer_binding(actual) != candidate:
            raise ValueError('review-storage-candidate-changed')
        state = record(actual['State'], 'candidate state')
        if state.get('Running') is not True and previous is None:
            raise ValueError('running-candidate-mount-proof-required')
    proof: dict[str, object] = {'originalSha256': checksum(original),
             'mappedSha256': checksum(retained),
             'candidatesSha256': checksum(candidates)}
    if previous is not None and dict(previous) != proof:
        raise ValueError('retained-candidate-mount-proof-changed')
    resolve_mounts(containers, protected, probe, retained)
    return proof


def verify_completed_storage(
    previous: HostOperations, successor: HostOperations,
) -> None:
    """Verify actual prior mounts and durably record their live inspection."""
    from scripts.deploy.review.runtime.operations import HostOperations

    if previous.lock is not successor.lock:
        raise ValueError('shared-review-storage-lock-required')
    successor.verify_fence()
    if previous.attempt.state()['status'] != 'complete':
        raise ValueError('completed-review-release-required')
    previous.verify_tools()
    previous.verify_images(require_imports=False, final_only=True)
    previous.verify_egress()
    verify_completed_records(previous, fenced=True)
    verify_startup_unit(previous)
    directory = previous.attempt.directory
    topology = record(previous.attempt.manifest()['topology'], 'topology')
    original = private_json(directory / 'original-mount-objects.json')
    handover = private_json(directory / 'auth-handover.json')
    candidates = {role: private_json(directory / ('candidate-' + role + '.json'))
                  for role in ('web', 'workers')}
    for role in ('web', 'workers'):
        if services.verify_candidate(previous, role, require_running=False) \
                != candidates[role]['id']:
            raise ValueError('review-storage-candidate-changed')
    ids = previous.docker('ps', '-aq', '--no-trunc').decode().split()
    containers = previous.inspect(*ids)
    by_id = {container['Id']: container for container in containers}
    for role in ('postgres', 'redis'):
        expected = record(record(topology['services'], 'services')[role], 'service')
        actual = record(by_id.get(expected['id']), 'retained service')
        state = record(actual.get('State'), 'service state')
        health = state.get('Health')
        if (actual.get('Image') != expected['imageId']
                or state.get('Status') != 'running'
                or state.get('Running') is not True
                or state.get('Paused') is not False
                or state.get('Restarting') is not False
                or state.get('OOMKilled') is not False
                or state.get('Dead') is not False
                or state.get('Error') != ''
                or (health is not None
                    and record(health, 'service health').get('Status') != 'healthy')):
            raise ValueError('retained-storage-service-unavailable')
    protected_ids = {
        candidates['web']['id'], candidates['workers']['id'],
        record(record(topology['services'], 'services')['postgres'], 'postgres')['id'],
        record(record(topology['services'], 'services')['redis'], 'redis')['id'],
    }
    if len(protected_ids) != 4:
        raise ValueError('distinct-review-storage-writers-required')
    before = container_inventory(containers, cast(set[str], protected_ids))
    binding = {
        'predecessorDirectory': str(previous.attempt.directory),
        'predecessorManifestSha256': previous.attempt.manifest_hash,
        'predecessorEvidenceSha256': previous.attempt.evidence_hash,
        'successorDirectory': str(successor.attempt.directory),
        'successorManifestSha256': successor.attempt.manifest_hash,
        'successorEvidenceSha256': successor.attempt.evidence_hash,
    }
    def probe(content: bytes) -> bytes:
        return successor.command(
            ['sudo', '-n', '/usr/bin/python3', '-c', MOUNT_PROBE], content=content,
        )

    def verify_after_probe() -> None:
        successor.verify_fence()
        current_ids = previous.docker('ps', '-aq', '--no-trunc').decode().split()
        if set(current_ids) != set(ids) or len(current_ids) != len(ids):
            raise ValueError('review-storage-container-inventory-changed')
        refreshed = previous.inspect(*current_ids)
        if container_inventory(refreshed, cast(set[str], protected_ids)) != before:
            raise ValueError('review-storage-mount-inventory-changed')
        successor.verify_fence()

    _retain_completed_storage(
        successor.attempt.directory / 'predecessor-mounted-storage.json', binding,
        containers, topology, original, candidates, handover,
        probe=probe, verify_fence=verify_after_probe,
    )


def _retain_completed_storage(
    path: Path, binding: Mapping[str, object],
    containers: Sequence[Mapping[str, object]], topology: Mapping[str, object],
    original: Mapping[str, object], candidates: Mapping[str, object],
    handover: Mapping[str, object], *, probe: Callable[[bytes], bytes],
    verify_fence: Callable[[], None],
) -> None:
    saved = private_json(path) if path.exists() or path.is_symlink() else None
    if saved is not None and (set(saved) != {*binding, 'proof', 'instances'}
                              or any(saved[key] != value for key, value in binding.items())):
        raise ValueError('retained-storage-attempt-binding-changed')
    by_id = {container.get('Id'): container for container in containers}
    instances: dict[str, object] = {}
    retained_instances = record(saved['instances'], 'retained instances') if saved else {}
    if saved and set(retained_instances) != {'web', 'workers'}:
        raise ValueError('retained-storage-instance-set-changed')
    for role in ('web', 'workers'):
        candidate = record(candidates[role], 'candidate')
        actual = record(by_id.get(candidate['id']), 'candidate container')
        state = record(actual['State'], 'candidate state')
        if state.get('Running') is True:
            value = capture_running_writer(actual, candidate, role=role)
            if saved and value != retained_instances[role]:
                raise ValueError('retained-storage-instance-changed')
            instances[role] = value
        else:
            if not saved:
                raise ValueError('running-candidate-mount-proof-required')
            baseline = record(retained_instances[role], 'running candidate')
            inspect_stopped_writer(actual, candidate, role=role, baseline=baseline)
            instances[role] = baseline
    proof = inspect_completed_storage(
        containers, topology, original, candidates, handover, probe=probe,
        previous=record(saved['proof'], 'retained storage proof') if saved else None,
    )
    verify_fence()
    if saved is None:
        atomic_json(path, {**binding, 'proof': proof, 'instances': instances})
