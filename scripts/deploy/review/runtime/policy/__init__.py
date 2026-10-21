"""Validate independently admitted review resources without global defaults."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import TYPE_CHECKING, cast

from scripts.deploy.images.metadata import record
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


def verify_queue_policy(operations: HostOperations) -> None:
    """Getter-only verification is valid while stopped or processing work."""
    policy = runtime_policy(operations.manifest)
    result = operations.runtime_exchange('queue-policy', policy)
    if result != {'queueCount': 27, 'concurrency': 1,
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


def retain_queue_intent(
    operations: HostOperations, value: Mapping[str, object],
) -> None:
    from scripts.deploy.review.topology import rows

    original = record(operations.manifest['originalQueues'], 'original queues')
    queues = rows(original['queues'], 'original queue')
    expected = {
        'schemaVersion': 1,
        'connectionIdentity': original['connectionIdentity'],
        'queues': [{'name': item['name'], 'originalConcurrency': None,
                    'concurrency': 1} for item in queues],
    }
    if dict(value) != expected:
        raise ValueError('original-review-concurrency-intent-changed')
    path = operations.attempt.directory / 'queue-policy-intent.json'
    if path.exists():
        if private_json(path) != expected:
            raise ValueError('retained-review-concurrency-intent-changed')
    else:
        atomic_json(path, expected)
