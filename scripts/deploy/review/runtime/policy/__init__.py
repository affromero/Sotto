"""Validate independently admitted review resources without global defaults."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from importlib import import_module
from pathlib import Path
from typing import TYPE_CHECKING, cast

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.build_observer import bounded_bytes
from scripts.deploy.review.state import atomic_json, checksum, private_json

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations

MIB = 1024 * 1024


def runtime_policy(manifest: Mapping[str, object]) -> dict[str, object]:
    policy = record(manifest.get('runtimePolicy'), 'review runtime policy')
    resources = record(manifest.get('resources'), 'review resources')
    if (set(policy) != {
            'schemaVersion', 'webHeapMiB', 'workerHeapMiB',
            'helperHeapMiB', 'queueConcurrency', 'privacyContactEmail',
            } or type(policy['schemaVersion']) is not int
            or policy['schemaVersion'] != 1
            or type(policy['queueConcurrency']) is not int
            or policy['queueConcurrency'] != 1
            or not isinstance(policy['privacyContactEmail'], str)
            or not 1 <= len(policy['privacyContactEmail']) <= 254):
        raise ValueError('strict-admitted-review-runtime-policy-required')
    for role, cushion in (('web', 128), ('worker', 256), ('helper', 128)):
        heap = policy[role + 'HeapMiB']
        memory = resources.get(role + 'MemoryBytes')
        if (type(heap) is not int or type(memory) is not int
                or not 64 <= heap <= 4096
                or memory < (heap + cushion) * MIB):
            raise ValueError('review-heap-native-memory-cushion-required')
    return policy


def role_command(
    policy: Mapping[str, object], role: str,
) -> list[str]:
    if role not in {'web', 'workers'}:
        raise ValueError('exact-review-runtime-role-required')
    name = 'webHeapMiB' if role == 'web' else 'workerHeapMiB'
    arguments = ['node', '--max-old-space-size=' + str(policy[name])]
    return arguments + (['server.js'] if role == 'web' else
                        ['--import', 'tsx', 'src/workers/index.ts'])


def helper_arguments(
    manifest: Mapping[str, object], entrypoint: str,
    arguments: Sequence[str],
) -> list[str]:
    policy = runtime_policy(manifest)
    if entrypoint == 'node':
        if any(value.replace('_', '-').startswith('--max-old-space-size')
               for value in arguments):
            raise ValueError('helper-heap-override-not-admitted')
        return ['--max-old-space-size=' + str(policy['helperHeapMiB']),
                *arguments]
    return list(arguments)


def helper_memory(manifest: Mapping[str, object]) -> int:
    runtime_policy(manifest)
    return cast(int, record(manifest['resources'], 'review resources')
                ['helperMemoryBytes'])


def concurrent_memory(manifest: Mapping[str, object]) -> int:
    runtime_policy(manifest)
    resources = record(manifest['resources'], 'review resources')
    return sum(cast(int, resources[role + 'MemoryBytes'])
               for role in ('web', 'worker', 'helper'))


def projected_predecessor_memory(
    manifest: Mapping[str, object], predecessor_anonymous: int,
) -> int:
    """The only new allocation before the predecessor stops is one helper."""
    if type(predecessor_anonymous) is not int or predecessor_anonymous < 0:
        raise ValueError('invalid-review-predecessor-memory')
    return max(helper_memory(manifest), concurrent_memory(manifest) - predecessor_anonymous)


def successor_helper_budget(
    operations: HostOperations, *, previous: HostOperations | None,
) -> int:
    """Use only the admitted helper allowance during the pre-candidate phase."""
    phase = operations.attempt.state()['phase']
    manifest = operations.manifest
    binding = record(manifest.get('predecessor'), 'review predecessor')
    preparing = phase in {'PRECHECK', 'ADMITTED', 'PREPARED'}
    if not preparing and phase not in {'FENCED', 'QUIESCENT'}:
        raise ValueError('early-review-helper-capacity-required')
    if operations.docker(
        'ps', '-q', '--filter', 'label=io.sotto.review-attempt=' + operations.attempt.manifest_hash,
    ).strip():
        raise ValueError('review-attempt-already-has-a-running-container')
    if previous is None:
        if preparing:
            raise ValueError('live-predecessor-memory-projection-required')
        return helper_memory(manifest)
    if (not preparing or previous.lock is not operations.lock
            or str(previous.attempt.directory) != binding['directory']
            or previous.attempt.manifest_hash != binding['manifestSha256']):
        raise ValueError('exact-live-predecessor-memory-required')
    anonymous = sum(live_writer_anonymous_memory(previous, role) for role in ('web', 'workers'))
    return projected_predecessor_memory(manifest, anonymous)


def live_writer_anonymous_memory(previous: HostOperations, role: str) -> int:
    from scripts.deploy.review.runtime.services import verify_candidate

    identity = digest(verify_candidate(previous, role), 'live review writer')
    before, = previous.inspect(identity)
    state = record(before['State'], 'live writer state')
    pid = state.get('Pid')
    if type(pid) is not int or pid <= 1:
        raise ValueError('live-review-writer-pid-required')
    relative = (Path('/proc') / str(pid) / 'cgroup').read_text().strip()
    root = Path('/sys/fs/cgroup')
    if not relative.startswith('0::/') or '\n' in relative:
        raise ValueError('unified-review-writer-cgroup-required')
    group = root / relative.removeprefix('0::/')
    if (group != group.resolve(strict=True) or not group.is_relative_to(root)
            or group.name not in {identity, 'docker-' + identity + '.scope'}):
        raise ValueError('exact-review-writer-cgroup-required')
    counts = [line.removeprefix('anon ').strip()
              for line in (group / 'memory.stat').read_text().splitlines()
              if line.startswith('anon ')]
    maximum = record(before['HostConfig'], 'live writer host')['Memory']
    after, = previous.inspect(identity)
    current = record(after['State'], 'live writer state')
    if (len(counts) != 1 or not counts[0].isdigit() or type(maximum) is not int
            or type(state.get('StartedAt')) is not str
            or current.get('Pid') != pid or current.get('StartedAt') != state['StartedAt']
            or current.get('Running') is not True or verify_candidate(previous, role) != identity):
        raise ValueError('live-review-writer-memory-changed')
    anonymous = int(counts[0])
    if not 0 <= anonymous <= maximum:
        raise ValueError('review-writer-memory-outside-admission')
    return anonymous


def verify_queue_policy(operations: HostOperations) -> None:
    """Getter-only verification is valid while stopped or processing work."""
    policy = runtime_policy(operations.manifest)
    count = 27
    if 'predecessor' in operations.manifest:
        _, names = successor_queue_policy_names(operations)
        count = len(names)
    result = operations.runtime_exchange('queue-policy', policy)
    if result != {'queueCount': count, 'concurrency': 1,
                  'privacyContactEmail': policy['privacyContactEmail']}:
        raise ValueError('admitted-review-queue-policy-changed')


def admit_queue_getter(operations: HostOperations) -> None:
    """Admit only the completed release's metadata getter, never a mutation."""
    from scripts.deploy.review.runtime import services
    from scripts.deploy.review.runtime.operations import CADDY, MAINTENANCE
    from scripts.deploy.review.runtime.release import (
        verify_completed_records,
        verify_startup_unit,
    )

    operations.lock.validate()
    operations.verify_tools()
    operations.verify_images(require_imports=False, final_only=True)
    operations.verify_storage()
    operations.verify_egress()
    verify_completed_records(
        operations, fenced=bounded_bytes(CADDY) == MAINTENANCE,
    )
    verify_startup_unit(operations)
    for role in ('web', 'workers'):
        services.verify_candidate(operations, role, require_running=False)


def bind_helper_environment(
    operations: HostOperations, command: Sequence[str],
    image: Mapping[str, object],
) -> str:
    from scripts.deploy.review.topology import environment

    target = Path(command[command.index('--env-file') + 1])
    raw = bounded_bytes(target, private=True).decode()
    values = dict(line.split('=', 1) for line in raw.splitlines())
    for index, argument in enumerate(command):
        if argument == '--env':
            key, value = command[index + 1].split('=', 1)
            values[key] = value
    return checksum({**environment(image), **values})


def successor_queue_policy_names(
    operations: HostOperations,
) -> tuple[list[str], list[str]]:
    from scripts.deploy.review.topology import rows

    manifest = operations.attempt.manifest()
    if any(operations.manifest.get(key) != manifest[key] for key in (
        'predecessor', 'queueTransition', 'originalQueues', 'finalWorker',
    )):
        raise ValueError('successor-queue-policy-admission-changed')
    guard = import_module('scripts.deploy.compatibility-review')
    transition = cast(
        dict[str, list[str]], guard.validate_queue_transition(manifest['queueTransition']),
    )
    original = record(manifest['originalQueues'], 'original queues')
    previous = transition['previousQueues']
    candidate = transition['candidateQueues']
    worker = record(manifest['finalWorker'], 'final worker')
    runtime = record(worker['runtime'], 'final worker runtime')
    if ([item['name'] for item in rows(original['queues'], 'original queue')] != previous
            or runtime['queueNames'] != candidate):
        raise ValueError('successor-queue-policy-inventory-changed')
    return previous, candidate


def retain_queue_intent(
    operations: HostOperations, value: Mapping[str, object],
) -> None:
    from scripts.deploy.review.topology import rows

    original = record(operations.manifest['originalQueues'], 'original queues')
    queues = rows(original['queues'], 'original queue')
    previous: set[str] = set()
    names = [item['name'] for item in queues]
    if 'predecessor' in operations.manifest:
        prior, candidate = successor_queue_policy_names(operations)
        previous = set(prior)
        names = list(candidate)
    expected = {
        'schemaVersion': 2 if previous else 1,
        'connectionIdentity': original['connectionIdentity'],
        'queues': [{'name': name, 'originalConcurrency': 1 if name in previous else None,
                    'concurrency': 1} for name in names],
    }
    if dict(value) != expected:
        raise ValueError('original-review-concurrency-intent-changed')
    path = operations.attempt.directory / 'queue-policy-intent.json'
    if path.exists():
        if private_json(path) != expected:
            raise ValueError('retained-review-concurrency-intent-changed')
    else:
        atomic_json(path, expected)
