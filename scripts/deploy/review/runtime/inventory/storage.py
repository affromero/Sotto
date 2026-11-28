"""Verify retained review storage after the original web is gone."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Literal, cast

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.runtime import services
from scripts.deploy.review.runtime.mounts import (
    MOUNT_PROBE, container_inventory, physical_identity, resolve_mounts,
)
from scripts.deploy.review.runtime.inventory.stopped_writer import (
    capture_running_writer, inspect_stopped_writer, matches_archived_writer,
)
from scripts.deploy.review.runtime.release import verify_completed_records, verify_startup_unit
from scripts.deploy.review.state import atomic_json, checksum, private_json
from scripts.deploy.review.topology import (
    AUTH_HOME, DIRECTORY, EXECUTIONS, NETWORK, PROJECT, STORAGE, rows,
)

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations


def original_mount_objects(operations: HostOperations) -> dict[str, object]:
    """Resolve the original physical mount proof through completed predecessors."""
    from scripts.deploy.review.runtime.inventory.predecessor import original_review_release

    original = original_review_release(operations)
    return private_json(original.attempt.directory / 'original-mount-objects.json')


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
    archived: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """Check roots and aliases; caller must durably retain the initial proof."""
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
        if not matches_archived_writer(actual, candidate):
            raise ValueError('review-storage-candidate-changed')
        state = record(actual['State'], 'candidate state')
        if state.get('Running') is not True and previous is None:
            raise ValueError('running-candidate-mount-proof-required')
    proof: dict[str, object] = {'originalSha256': checksum(original),
             'mappedSha256': checksum(retained),
             'candidatesSha256': checksum(candidates)}
    if previous is not None and dict(previous) != proof:
        raise ValueError('retained-candidate-mount-proof-changed')
    extend_archived_mounts(protected, retained, archived or {})
    resolve_mounts(containers, protected, probe, retained)
    return proof


def verify_stopped_generation(
    previous: HostOperations, successor: HostOperations,
    indexed: Mapping[object, Mapping[str, object]], candidates: Mapping[str, object],
    *, archived: bool = False,
) -> set[str]:
    """Recheck both exact exit receipts against the same recorded runtime instances."""
    from scripts.deploy.review.runtime.inventory.predecessor import _identity, _stop_binding

    directory = successor.attempt.directory
    baseline = private_json(directory / 'predecessor-running.json')
    release = private_json(previous.attempt.directory / 'release-record.json')
    binding_fields = _identity(previous, successor, release)
    if (set(baseline) != {*binding_fields, 'writers'}
            or any(baseline.get(key) != value for key, value in binding_fields.items())):
        raise ValueError('predecessor-running-evidence-changed')
    writers = record(baseline['writers'], 'retained predecessor writers')
    stops = private_json(directory / 'predecessor-stopped.json')
    if set(writers) != {'web', 'workers'} or set(stops) != {'web', 'workers'}:
        raise ValueError('exact-stopped-predecessor-roles-required')
    identities: set[str] = set()
    observed: set[str] = set()
    roles: tuple[Literal['web', 'workers'], ...] = ('web', 'workers')
    for role in roles:
        binding = record(candidates[role], 'retained predecessor writer')
        identity = digest(binding['id'], 'retained predecessor writer ID')
        if identity in identities:
            raise ValueError('distinct-stopped-predecessor-writers-required')
        identities.add(identity)
        if archived and identity not in indexed:
            continue
        actual = record(indexed.get(identity), 'stopped predecessor')
        if archived and record(actual['State'], 'archived writer state').get('Pid') != 0:
            raise ValueError('archived-review-writer-has-process')
        result = inspect_stopped_writer(
            actual, binding,
            role=role, baseline=record(writers[role], 'retained predecessor instance'),
            previous=record(stops[role], 'stop receipt'),
        )
        intent = _stop_binding(baseline, role)
        if (private_json(directory / ('predecessor-stop-intent-' + role + '.json')) != intent
                or private_json(directory / ('predecessor-stop-result-' + role + '.json'))
                != {'outcome': 'confirmed', 'intentSha256': checksum(intent), 'stopped': result}):
            raise ValueError('successor-predecessor-stop-receipt-changed')
        observed.add(identity)
    return observed


def archived_mounts(
    completed: HostOperations, indexed: Mapping[object, Mapping[str, object]],
    original: Mapping[str, object],
) -> dict[str, object]:
    """Bind historical mounts to stopped writers from the exact completed lineage."""
    from scripts.deploy.review.runtime.inventory.predecessor import bind_predecessor

    if completed.attempt.state()['status'] != 'complete':
        raise ValueError('completed-review-lineage-required')
    topology = record(completed.manifest['topology'], 'completed topology')
    retained: dict[str, object] = {}
    seen: set[str] = set()
    generation = completed
    for _ in range(32):
        if 'predecessor' not in generation.manifest:
            return retained
        previous = bind_predecessor(generation)
        if previous.manifest['topology'] != topology:
            raise ValueError('successor-physical-topology-changed')
        old = previous.attempt.directory
        candidates = {role: private_json(old / ('candidate-' + role + '.json'))
                      for role in ('web', 'workers')}
        stopped = verify_stopped_generation(previous, generation, indexed, candidates, archived=True)
        if stopped & seen:
            raise ValueError('archived-review-writer-duplicated')
        _, mapped = retained_candidate_mounts(
            topology, original, candidates, private_json(old / 'auth-handover.json'),
        )
        retained.update({key: value for key, value in mapped.items()
                         if key.split(':', 1)[0] in stopped})
        seen.update(stopped)
        generation = previous
    raise ValueError('review-predecessor-lineage-bound')


def extend_archived_mounts(
    protected: set[str], expected: dict[str, object], archived: Mapping[str, object],
) -> None:
    """Treat only the admitted archive as protected by the physical mount probe."""
    identities = {key.split(':', 1)[0] for key in archived}
    if identities & protected:
        raise ValueError('archived-review-writer-overlaps-current-generation')
    protected.update(identities)
    expected.update(archived)


def verify_running_completed_storage(
    previous: HostOperations, successor: HostOperations,
) -> None:
    """Inspect the live completed generation without requiring a new fence."""
    successor.lock.validate()
    if previous.lock is not successor.lock or previous.attempt.state()['status'] != 'complete':
        raise ValueError('completed-review-release-required')
    directory = previous.attempt.directory
    topology = record(previous.attempt.manifest()['topology'], 'completed topology')
    backing = record(topology['services'], 'completed backing services')
    original = original_mount_objects(previous)
    handover = private_json(directory / 'auth-handover.json')
    candidates = {
        role: private_json(directory / ('candidate-' + role + '.json'))
        for role in ('web', 'workers')
    }
    protected, _ = retained_candidate_mounts(topology, original, candidates, handover)
    candidate_ids = {digest(value['id'], 'completed candidate') for value in candidates.values()}
    identities = successor.docker('ps', '-aq', '--no-trunc').decode().split()
    containers = successor.inspect(*identities)
    indexed = {item['Id']: item for item in containers}
    archived = archived_mounts(previous, indexed, original)
    extend_archived_mounts(protected, {}, archived)

    def verify_backing(index: Mapping[object, dict[str, object]]) -> None:
        for role in ('postgres', 'redis'):
            expected = record(backing[role], 'completed backing service')
            actual = record(index.get(expected['id']), 'actual completed backing service')
            state = record(actual['State'], 'completed backing state')
            health = state.get('Health')
            if (actual['Image'] != expected['imageId']
                    or state.get('Running') is not True
                    or state.get('Status') != 'running'
                    or state.get('Paused') is not False
                    or state.get('Restarting') is not False
                    or state.get('OOMKilled') is not False
                    or state.get('Dead') is not False or state.get('Error') != ''
                    or (health is not None
                        and record(health, 'backing health').get('Status') != 'healthy')):
                raise ValueError('retained-storage-service-unavailable')

    verify_backing(indexed)
    verify_successor_network_members(previous, indexed, backing, candidate_ids)
    before = container_inventory(containers, protected)

    def probe(content: bytes) -> bytes:
        return successor.command(
            ['sudo', '-n', '/usr/bin/python3', '-c', MOUNT_PROBE], content=content,
        )

    proof = inspect_completed_storage(
        containers, topology, original, candidates, handover, probe=probe, archived=archived,
    )
    expected = record(successor.attempt.manifest()['predecessorStorage'], 'predecessor storage')
    if proof != expected:
        raise ValueError('admitted-predecessor-storage-changed')
    refreshed_ids = successor.docker('ps', '-aq', '--no-trunc').decode().split()
    if set(refreshed_ids) != set(identities) or len(refreshed_ids) != len(identities):
        raise ValueError('review-storage-container-inventory-changed')
    refreshed = successor.inspect(*refreshed_ids)
    if container_inventory(refreshed, protected) != before:
        raise ValueError('review-storage-mount-inventory-changed')
    checked = {item['Id']: item for item in refreshed}
    if archived_mounts(previous, checked, original) != archived:
        raise ValueError('archived-review-storage-changed')
    verify_backing(checked)
    verify_successor_network_members(previous, checked, backing, candidate_ids)
    successor.lock.validate()


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
    verify_completed_records(previous, fenced=True, successor=successor)
    verify_startup_unit(previous)
    directory = previous.attempt.directory
    topology = record(previous.attempt.manifest()['topology'], 'topology')
    original = original_mount_objects(previous)
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
    protected = cast(set[str], protected_ids)
    archived = archived_mounts(previous, by_id, original)
    extend_archived_mounts(protected, {}, archived)
    before = container_inventory(containers, protected)
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
        if container_inventory(refreshed, protected) != before:
            raise ValueError('review-storage-mount-inventory-changed')
        if archived_mounts(previous, {item['Id']: item for item in refreshed}, original) != archived:
            raise ValueError('archived-review-storage-changed')
        successor.verify_fence()

    _retain_completed_storage(
        successor.attempt.directory / 'predecessor-mounted-storage.json', binding,
        containers, topology, original, candidates, handover,
        probe=probe, verify_fence=verify_after_probe,
        admitted_proof=successor.attempt.manifest().get('predecessorStorage'),
        archived=archived,
    )


def verify_successor_storage(operations: HostOperations) -> None:
    """Recheck both the stopped generation and the admitted successor mounts."""
    from scripts.deploy.review.runtime.inventory.predecessor import bind_predecessor

    previous = bind_predecessor(operations)
    attempt = operations.attempt
    directory = attempt.directory
    old = previous.attempt.directory
    original = original_mount_objects(previous)
    handover = private_json(old / 'auth-handover.json')
    candidates = {
        role: private_json(old / ('candidate-' + role + '.json'))
        for role in ('web', 'workers')
    }
    topology = record(previous.manifest['topology'], 'original topology')
    if attempt.manifest()['topology'] != topology:
        raise ValueError('successor-physical-topology-changed')
    protected, expected = retained_candidate_mounts(topology, original, candidates, handover)
    proof = private_json(directory / 'predecessor-mounted-storage.json')
    if (proof.get('predecessorManifestSha256') != previous.attempt.manifest_hash
            or proof.get('predecessorEvidenceSha256') != previous.attempt.evidence_hash
            or proof.get('successorManifestSha256') != attempt.manifest_hash
            or proof.get('successorEvidenceSha256') != attempt.evidence_hash
            or proof.get('proof') != attempt.manifest()['predecessorStorage']
            or proof.get('proof') != {'originalSha256': checksum(original),
                                     'mappedSha256': checksum(expected),
                                     'candidatesSha256': checksum(candidates)}):
        raise ValueError('successor-retained-mount-proof-changed')
    identities = operations.docker('ps', '-aq', '--no-trunc').decode().split()
    containers = operations.inspect(*identities)
    indexed = {container['Id']: container for container in containers}
    backing = record(topology['services'], 'retained services')
    for role in ('postgres', 'redis'):
        service = record(backing[role], 'retained backing service')
        actual = record(indexed.get(service['id']), 'actual backing service')
        state = record(actual['State'], 'backing service state')
        if (actual.get('Image') != service['imageId']
                or state.get('Running') is not True
                or state.get('Status') != 'running'
                or state.get('Paused') is not False
                or state.get('OOMKilled') is not False):
            raise ValueError('retained-storage-service-unavailable')
    verify_stopped_generation(previous, operations, indexed, candidates)
    archived = archived_mounts(previous, indexed, original)
    extend_archived_mounts(protected, expected, archived)
    extensions = operations.admitted_writers(containers)
    if extensions & protected:
        raise ValueError('distinct-successor-storage-writers-required')
    old_web = digest(candidates['web']['id'], 'predecessor web ID')
    for identity in extensions:
        for destination in (STORAGE, EXECUTIONS, AUTH_HOME):
            expected[identity + ':' + destination] = expected[old_web + ':' + destination]
    protected.update(extensions)
    before = container_inventory(containers, protected)
    verify_successor_network_members(operations, indexed, backing, extensions)

    def probe(content: bytes) -> bytes:
        return operations.command(
            ['sudo', '-n', '/usr/bin/python3', '-c', MOUNT_PROBE], content=content,
        )

    resolve_mounts(containers, protected, probe, expected)
    current = operations.docker('ps', '-aq', '--no-trunc').decode().split()
    if set(current) != set(identities) or len(current) != len(identities):
        raise ValueError('review-storage-container-inventory-changed')
    refreshed = operations.inspect(*current)
    if container_inventory(refreshed, protected) != before:
        raise ValueError('review-storage-mount-inventory-changed')
    if archived_mounts(previous, {item['Id']: item for item in refreshed}, original) != archived:
        raise ValueError('archived-review-storage-changed')
    verify_successor_network_members(
        operations, {item['Id']: item for item in refreshed}, backing, extensions,
    )
    operations.lock.validate()


def verify_successor_network_members(
    operations: HostOperations, containers: Mapping[object, dict[str, object]],
    backing: Mapping[str, object], candidates: set[str],
) -> None:
    """Reject any unadmitted peer on either protected network."""
    operations.verify_egress()
    egress = PROJECT + '_egress'
    running = {
        identity for identity in candidates
        if record(containers[identity]['State'], 'candidate state')['Running'] is True
    }
    directory = operations.attempt.directory
    for role in ('web', 'workers'):
        path = directory / ('candidate-' + role + '.json')
        if path.exists() and private_json(path)['id'] in running:
            services.verify_candidate(operations, role)
    review_only: set[object] = set()
    for role in ('postgres', 'redis'):
        service = record(backing[role], 'retained backing service')
        identity = service['id']
        settings = record(containers[identity]['NetworkSettings'], 'backing network settings')
        attachment = record(settings['Networks'], 'backing network attachments')
        endpoint = record(attachment.get(NETWORK), 'backing review endpoint')
        admitted = record(service['network'], 'admitted backing endpoint')
        if (set(attachment) != {NETWORK} or endpoint.get('NetworkID') != admitted['id']
                or endpoint.get('IPAddress') != admitted['address']
                or endpoint.get('GlobalIPv6Address') not in ('', None)
                or any(value not in (None, []) for value in
                       record(settings['Ports'], 'backing ports').values())):
            raise ValueError('successor-retained-backing-network-changed')
        review_only.add(identity)
    networks = rows(json.loads(operations.docker('network', 'inspect', NETWORK, egress)),
                    'successor reviewed networks')
    topology = record(operations.attempt.manifest()['topology'], 'network topology')
    wanted = {
        NETWORK: record(topology['network'], 'review network')['id'],
        egress: private_json(directory / 'egress.json')['networkId'],
    }
    if {item['Name']: item['Id'] for item in networks} != wanted:
        raise ValueError('successor-network-identity-changed')
    members = {item['Name']: set(record(item['Containers'], 'members'))
               for item in networks}
    if len(networks) != 2 or members != {NETWORK: review_only | running, egress: running}:
        raise ValueError('successor-network-membership-changed')


def verify_review_storage(operations: HostOperations) -> None:
    if 'predecessor' in operations.manifest:
        verify_successor_storage(operations)
        return
    topology = record(operations.manifest['topology'], 'topology')
    services = record(topology['services'], 'services')
    identities = {str(record(item, 'service')['id']) for item in services.values()}
    all_ids = operations.docker('ps', '-aq', '--no-trunc').decode().split()
    operations.resolved_mounts(operations.inspect(*all_ids), identities)


def _retain_completed_storage(
    path: Path, binding: Mapping[str, object],
    containers: Sequence[Mapping[str, object]], topology: Mapping[str, object],
    original: Mapping[str, object], candidates: Mapping[str, object],
    handover: Mapping[str, object], *, probe: Callable[[bytes], bytes],
    verify_fence: Callable[[], None],
    admitted_proof: object = None,
    archived: Mapping[str, object] | None = None,
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
        archived=archived,
    )
    if admitted_proof is not None and admitted_proof != proof:
        raise ValueError('admitted-predecessor-storage-changed')
    verify_fence()
    if saved is None:
        atomic_json(path, {**binding, 'proof': proof, 'instances': instances})
