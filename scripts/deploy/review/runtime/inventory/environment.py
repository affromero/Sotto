"""Authenticate a completed review candidate's retained environment."""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import TYPE_CHECKING, Literal, cast

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.build_observer import bounded_bytes
from scripts.deploy.review.runtime import services
from scripts.deploy.review.runtime.inventory.predecessor import (
    RetainedPhase,
    _verify_release,
)
from scripts.deploy.review.state import checksum, private_json
from scripts.deploy.review.topology import (
    AUTH_HOME,
    PRESERVED_ENVIRONMENT,
    PUBLIC_ENVIRONMENT,
    classified_environment,
    environment,
    rows,
)

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations

PredecessorTool = Literal['pause', 'retained-inventory', 'migration']
MIGRATE_DEPLOY = ('--no-install', 'prisma', 'migrate', 'deploy',
                  '--config=/app/prisma.config.ts')


def review_code_mount(operations: HostOperations) -> str:
    return (f'type=bind,src={operations.root / "scripts/deploy"},'
            'dst=/app/scripts/deploy,readonly')


def retained_inventory_network(
    previous: HostOperations, successor: HostOperations,
    *, phase: RetainedPhase = 'FENCED',
) -> str:
    from scripts.deploy.review.runtime.inventory.network import verify_retained_network

    verify_retained_network(previous, successor, phase=phase)
    topology = record(previous.manifest['topology'], 'predecessor topology')
    services = record(topology['services'], 'predecessor services')
    redis = record(services['redis'], 'predecessor Redis')
    return 'container:' + digest(redis['id'], 'predecessor Redis identity')


def retained_inventory_phase(operations: HostOperations) -> RetainedPhase:
    phase = operations.attempt.state()['phase']
    if phase not in ('FENCED', 'QUIESCENT', 'BACKED_UP', 'SQL_STARTED',
                     'FINAL_SCHEMA_VERIFIED'):
        raise ValueError('retained-inventory-phase-invalid')
    return phase


def admit_predecessor_helper_environment(
    previous: HostOperations, successor: HostOperations,
    receipt: Mapping[str, object], entrypoint: str, *,
    mounts: Sequence[str], name: str | None, network: str,
    arguments: Sequence[str], operation: PredecessorTool, content: bytes | None,
) -> dict[str, str]:
    if name is None:
        raise ValueError('predecessor-helper-not-admitted')
    phase: RetainedPhase = 'FENCED'
    if operation == 'migration':
        phase = admit_migration_tool(
            previous, successor, receipt, entrypoint, arguments,
            network=network, mounts=mounts, content=content,
        )
    elif operation == 'retained-inventory':
        phase = retained_inventory_phase(successor)
        if (entrypoint != 'node' or list(mounts) != [review_code_mount(successor)]
                or network != retained_inventory_network(previous, successor, phase=phase)
                or receipt != successor.attempt.manifest()['finalWorker']):
            raise ValueError('retained-inventory-helper-not-admitted')
    elif operation == 'pause':
        worker = services.verify_candidate(previous, 'workers')
        if (entrypoint != 'node' or mounts or network != 'container:' + worker
                or receipt != previous.attempt.manifest()['finalWorker']):
            raise ValueError('predecessor-queue-helper-not-admitted')
    else:
        raise ValueError('predecessor-helper-not-admitted')
    values, _ = admit_successor_environment(previous, successor, phase=phase)
    values['NODE_OPTIONS'] = ''
    return values


def admit_migration_tool(
    previous: HostOperations, successor: HostOperations,
    receipt: Mapping[str, object], entrypoint: str, arguments: Sequence[str], *,
    network: str, mounts: Sequence[str], content: bytes | None,
) -> RetainedPhase:
    state = successor.attempt.state()
    phase = state['phase']
    if phase not in ('BACKED_UP', 'SQL_STARTED', 'FINAL_SCHEMA_VERIFIED'):
        raise ValueError('successor-migration-helper-phase-invalid')
    _, stage = exact_successor_sql_stages(previous, successor)
    worker = record(stage['receipt'], 'successor worker')
    if receipt != worker or network != retained_inventory_network(
        previous, successor, phase=phase,
    ):
        raise ValueError('successor-migration-helper-not-admitted')
    if entrypoint == 'npx':
        if (phase != 'SQL_STARTED' or state['sqlMayHaveStarted'] is not True
                or state['status'] != 'active'
                or mounts or tuple(arguments) != MIGRATE_DEPLOY or content is not None):
            raise ValueError('successor-schema-write-not-admitted')
    elif entrypoint == 'node':
        admit_migration_node(
            successor, stage, arguments, phase, mounts=mounts, content=content,
        )
    else:
        raise ValueError('successor-migration-helper-not-admitted')
    return phase


def exact_successor_sql_stages(
    previous: HostOperations, operations: HostOperations,
) -> tuple[dict[str, object], dict[str, object]]:
    from scripts.deploy.review.topology import rows

    manifest = operations.attempt.manifest()
    initial = record(manifest['initialStage'], 'successor initial stage')
    stages = rows(manifest['stages'], 'successor migration stage')
    if (len(stages) != 1 or stages[0]['receipt'] != manifest['finalWorker']
            or initial['receipt'] != previous.attempt.manifest()['finalWorker']
            or any(operations.manifest[key] != manifest[key]
                   for key in ('initialStage', 'stages', 'finalWorker'))):
        raise ValueError('exact-successor-sql-stage-required')
    return initial, stages[0]


def admit_migration_node(
    operations: HostOperations, stage: Mapping[str, object],
    arguments: Sequence[str], phase: RetainedPhase, *,
    mounts: Sequence[str], content: bytes | None,
) -> None:
    from scripts.deploy.review.runtime.policy import helper_arguments
    from scripts.deploy.review.runtime.release.migrations import (
        PRISMA_DIFF,
        applied_migration_script,
        canonical_loader,
        child_transport,
        stage_asset_directory,
        strict_json,
    )

    def matches(expected: Sequence[str]) -> bool:
        return list(arguments) == helper_arguments(operations.manifest, 'node', expected)

    if (not mounts and content is None
            and matches(['-e', applied_migration_script(require_idle=True)])):
        return
    if not mounts and matches(['-e', services.PRESERVATION_OBSERVER]):
        from scripts.deploy.review.runtime.release.successor import successor_preservation_input

        expected, _ = successor_preservation_input(operations)
        if content == expected:
            return
        raise ValueError('successor-preservation-projection-not-admitted')
    if phase == 'BACKED_UP':
        raise ValueError('successor-schema-verifier-before-sql')
    if mounts:
        raise ValueError('successor-migration-helper-mount-not-admitted')
    if phase == 'SQL_STARTED' and content == b'{"command":"established"}':
        worker = record(stage['receipt'], 'successor worker')
        path = stage_asset_directory(operations, worker) / 'queue-lifecycle.cjs'
        source = bounded_bytes(path)
        if hashlib.sha256(source).hexdigest() != stage['lifecycleSha256']:
            raise ValueError('successor-lifecycle-tool-changed')
        if matches(['--require', 'tsx/cjs', '-e', canonical_loader(source)]):
            return
    if content is None and matches(['-e', child_transport(PRISMA_DIFF)]):
        return
    if content is not None:
        request = strict_json(content)
        command = request.get('command')
        if ((command in ('snapshot', 'database-identity') and set(request) == {'command'})
                or (command == 'schema-index' and set(request) == {'command', 'manifest'})):
            operations.verify_tools()
            relative = 'scripts/deploy/queue-lifecycle.cjs'
            source = bounded_bytes(operations.root / relative)
            tools = record(operations.attempt.manifest()['tools'], 'successor tools')
            if hashlib.sha256(source).hexdigest() != tools[relative]:
                raise ValueError('successor-lifecycle-tool-changed')
            if matches(['--require', 'tsx/cjs', '-e', canonical_loader(source)]):
                return
    raise ValueError('successor-migration-node-command-not-admitted')


def _private_bytes(path: Path) -> bytes:
    if path.lstat().st_uid != os.geteuid():
        raise ValueError('review-environment-owner-changed')
    value = bounded_bytes(path, private=True)
    if len(value) > 262_144:
        raise ValueError('review-environment-bound-exceeded')
    return value


def stage_runtime_environment(operations: HostOperations) -> Path:
    if 'predecessor' in operations.manifest:
        from scripts.deploy.review.runtime.release.successor import read_successor_compose

        document = read_successor_compose(operations)
        services = record(document['services'], 'candidate services')
        web = record(services['web'], 'candidate web')
        sealed = record(web['environment'], 'candidate environment')
        if any(not isinstance(value, str) for value in sealed.values()):
            raise ValueError('invalid-candidate-environment-value')
        values = cast(dict[str, str], sealed)
    else:
        topology = record(operations.manifest['topology'], 'topology')
        web = record(record(topology['services'], 'services')['web'], 'web')
        original = operations.inspect(cast(str, web['id']))[0]
        if original.get('Image') != web['imageId']:
            raise ValueError('historical-runtime-image-changed')
        values = environment(original)
        if checksum(values) != web['environmentHash']:
            raise ValueError('historical-environment-changed')
    operations.private_environment = values
    if any('\n' in value or '\r' in value or '\x00' in value for value in values.values()):
        raise ValueError('unsupported-docker-environment-value')
    encoded = ''.join(f'{name}={value}\n' for name, value in sorted(values.items())).encode()
    target = operations.attempt.directory / 'original.env'
    if target.exists() or target.is_symlink():
        if bounded_bytes(target, private=True) != encoded:
            raise ValueError('retained-private-environment-changed')
    else:
        operations.private_file(target, encoded)
    return target


def runtime_helper_environment(operations: HostOperations) -> dict[str, str]:
    operations.runtime_environment()
    operations.verify_storage()
    if 'predecessor' in operations.manifest:
        return dict(operations.private_environment)
    topology = record(operations.manifest['topology'], 'topology')
    old = record(record(topology['services'], 'services')['web'], 'web')
    image = rows(json.loads(operations.docker(
        'image', 'inspect', cast(str, old['imageId']),
    )), 'historical image')[0]
    return classified_environment(operations.private_environment, environment(image))


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
    *, phase: RetainedPhase = 'FENCED',
) -> tuple[dict[str, str], dict[str, str]]:
    """Return verified worker settings and hashes without logging secrets.

    The caller must keep values in memory or a private 0600 helper env file.
    This does not admit any helper process or establish workload quiescence.
    """
    _verify_release(previous, successor, allow_unresolved=True, phase=phase)
    values, binding = observe_predecessor_environment(previous)
    successor.verify_fence()
    return values, binding


def observe_predecessor_environment(
    previous: HostOperations,
) -> tuple[dict[str, str], dict[str, str]]:
    """Compare the retained settings with both exact predecessor containers."""
    previous.lock.validate()
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
    previous.lock.validate()
    return worker_values, {
        'originalEnvironmentSha256': checksum(original),
        'candidateComposeSha256': compose_hash,
        'workerEnvironmentSha256': checksum(worker_values),
    }
