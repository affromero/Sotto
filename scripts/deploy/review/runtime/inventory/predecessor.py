"""Capture the completed review release before its writers are stopped."""

from __future__ import annotations

import hashlib
import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import TYPE_CHECKING, Literal, cast

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.build_observer import bounded_bytes
from scripts.deploy.review.runtime import services
from scripts.deploy.review.runtime.inventory.stopped_writer import (
    capture_running_writer,
    inspect_stopped_writer,
)
from scripts.deploy.review.runtime.inventory.storage import verify_completed_storage
from scripts.deploy.review.state import Attempt, atomic_json, checksum, private_json

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations

RetainedPhase = Literal[
    'FENCED', 'QUIESCENT', 'BACKED_UP', 'SQL_STARTED', 'FINAL_SCHEMA_VERIFIED',
]


def bind_predecessor(successor: HostOperations) -> HostOperations:
    """Open the exact completed release named by the successor admission."""
    from scripts.deploy.review.runtime.operations import HostOperations

    successor.lock.validate()
    binding = record(successor.attempt.manifest()['predecessor'],
                     'admitted predecessor')
    if set(binding) != {'directory', 'manifestSha256', 'evidenceSha256',
                       'releaseSha256', 'startupSha256'}:
        raise ValueError('exact-predecessor-attempt-binding-required')
    name = binding['directory']
    if not isinstance(name, str):
        raise ValueError('predecessor-attempt-directory-invalid')
    directory = Path(name)
    if (not directory.is_absolute() or directory.is_symlink()
            or directory.resolve() != directory
            or directory.parent != successor.attempt.directory.parent
            or directory == successor.attempt.directory):
        raise ValueError('predecessor-attempt-directory-invalid')
    attempt = Attempt(directory)
    _, startup = _predecessor_records(attempt, binding)
    source = startup.get('sourceRoot')
    if not isinstance(source, str):
        raise ValueError('predecessor-source-root-changed')
    root = Path(source)
    if (not root.is_absolute() or root.resolve() != root or not root.is_dir()):
        raise ValueError('predecessor-source-root-changed')
    previous = HostOperations(attempt, successor.lock)
    previous.root = root
    previous.verify_tools()
    successor.lock.validate()
    return previous


def _predecessor_records(
    attempt: Attempt, binding: Mapping[str, object],
) -> tuple[dict[str, object], dict[str, object]]:
    directory = attempt.directory
    release = private_json(directory / 'release-record.json')
    startup = private_json(directory / 'startup-unit.json')
    if (str(directory) != binding.get('directory')
            or attempt.manifest_hash != digest(binding['manifestSha256'], 'predecessor manifest')
            or attempt.evidence_hash != digest(binding['evidenceSha256'], 'predecessor evidence')
            or attempt.state()['status'] != 'complete'
            or checksum(release) != digest(binding['releaseSha256'], 'predecessor release')):
        raise ValueError('completed-predecessor-binding-changed')
    if checksum(startup) != digest(binding['startupSha256'], 'predecessor startup'):
        raise ValueError('predecessor-startup-binding-changed')
    return release, startup


def capture_predecessor(
    previous: HostOperations, successor: HostOperations,
) -> dict[str, object]:
    """Durably capture both canonical writers under the successor fence.

    This does not stop a writer or establish queue, provider, or network
    quiescence. A retry may only reproduce identical running evidence.
    """
    release = _verify_release(previous, successor, allow_unresolved=False)
    writers: dict[str, object] = {}
    for role in ('web', 'workers'):
        binding = private_json(previous.attempt.directory
                               / ('candidate-' + role + '.json'))
        identity = services.verify_candidate(previous, role)
        if identity != binding.get('id'):
            raise ValueError('predecessor-candidate-identity-changed')
        actual = previous.inspect(identity)
        if len(actual) != 1:
            raise ValueError('unique-predecessor-candidate-required')
        writers[role] = capture_running_writer(
            actual[0], binding, role=role,
        )
    web = cast(dict[str, object], writers['web'])
    workers = cast(dict[str, object], writers['workers'])
    if web['id'] == workers['id']:
        raise ValueError('distinct-predecessor-writers-required')
    value = {
        **_identity(previous, successor, release),
        'writers': writers,
    }
    successor.verify_fence()
    path = successor.attempt.directory / 'predecessor-running.json'
    if path.exists() or path.is_symlink():
        if private_json(path) != value:
            raise ValueError('predecessor-running-evidence-changed')
    else:
        atomic_json(path, value)
    return value


def _verify_release(
    previous: HostOperations, successor: HostOperations, *,
    allow_unresolved: bool,
    phase: RetainedPhase = 'FENCED',
) -> dict[str, object]:
    if previous.lock is not successor.lock:
        raise ValueError('shared-predecessor-lock-required')
    successor.verify_fence()
    state = successor.attempt.state()
    if (previous.attempt.directory == successor.attempt.directory
            or previous.attempt.state()['status'] != 'complete'
            or state['phase'] != phase
            or state['status'] not in (
                {'active', 'unresolved'} if allow_unresolved else {'active'}
            )):
        raise ValueError('completed-predecessor-and-fenced-successor-required')
    binding = successor.attempt.manifest().get('predecessor')
    if binding is None:
        release = private_json(previous.attempt.directory / 'release-record.json')
        startup = private_json(previous.attempt.directory / 'startup-unit.json')
    else:
        release, startup = _predecessor_records(
            previous.attempt, record(binding, 'admitted predecessor'),
        )
    source_root = startup.get('sourceRoot')
    if (not isinstance(source_root, str) or not Path(source_root).is_absolute()
            or Path(source_root).resolve() != previous.root
            or str(previous.root) != source_root):
        raise ValueError('predecessor-source-root-changed')
    verify_completed_storage(previous, successor)
    return release


def _identity(
    previous: HostOperations, successor: HostOperations,
    release: dict[str, object],
) -> dict[str, object]:
    return {
        'predecessorDirectory': str(previous.attempt.directory),
        'predecessorManifestSha256': previous.attempt.manifest_hash,
        'predecessorEvidenceSha256': previous.attempt.evidence_hash,
        'releaseSha256': checksum(release),
        'successorDirectory': str(successor.attempt.directory),
        'successorManifestSha256': successor.attempt.manifest_hash,
        'successorEvidenceSha256': successor.attempt.evidence_hash,
    }


def _stop_binding(
    baseline: dict[str, object], role: Literal['web', 'workers'],
) -> dict[str, object]:
    writers = record(baseline['writers'], 'predecessor writers')
    writer = record(writers[role], 'predecessor running instance')
    return {'role': role, 'id': writer['id'],
            'runningEvidenceSha256': checksum(baseline)}


def prepare_predecessor_stop(
    previous: HostOperations, successor: HostOperations, *,
    role: Literal['web', 'workers'],
) -> None:
    """Record one stop intent; caller must separately prove workload drain.

    A retained intent is never permission to repeat an uncertain stop.
    """
    if role not in ('web', 'workers'):
        raise ValueError('predecessor-role-invalid')
    _verify_release(previous, successor, allow_unresolved=False)
    path = successor.attempt.directory / ('predecessor-stop-intent-' + role + '.json')
    if path.exists() or path.is_symlink():
        raise ValueError('predecessor-stop-intent-already-exists')
    if inspect_predecessor(previous, successor)[role] != 'running':
        raise ValueError('predecessor-writer-not-running')
    baseline = private_json(successor.attempt.directory / 'predecessor-running.json')
    binding = _stop_binding(baseline, role)
    successor.verify_fence()
    atomic_json(path, binding)
    candidate = services.verify_candidate(previous, role)
    current = previous.inspect(candidate)
    expected = record(record(baseline['writers'], 'writers')[role], 'writer')
    recorded = private_json(previous.attempt.directory
                            / ('candidate-' + role + '.json'))
    if (len(current) != 1 or capture_running_writer(
            current[0], recorded, role=role) != expected):
        raise ValueError('predecessor-stop-preparation-unresolved')
    successor.verify_fence()


def stop_predecessor(
    previous: HostOperations, successor: HostOperations, *,
    role: Literal['web', 'workers'],
    verify_drained: Callable[[], None],
) -> dict[str, object]:
    """Dispatch once while the caller holds admission closed through the stop."""
    if role not in ('web', 'workers'):
        raise ValueError('predecessor-role-invalid')
    _verify_release(previous, successor, allow_unresolved=False)
    directory = successor.attempt.directory
    result_path = directory / ('predecessor-stop-result-' + role + '.json')
    intent_path = directory / ('predecessor-stop-intent-' + role + '.json')
    if result_path.exists() or result_path.is_symlink():
        raise ValueError('predecessor-stop-result-already-exists')
    if intent_path.exists() or intent_path.is_symlink():
        raise ValueError('predecessor-stop-intent-already-exists')
    relative = 'scripts/deploy/stop-workers.py'
    helper = successor.root / relative
    source = bounded_bytes(helper)
    tools = record(successor.manifest['tools'], 'bound review tools')
    if hashlib.sha256(source).hexdigest() != digest(
        tools.get(relative), 'predecessor stop helper',
    ):
        raise ValueError('predecessor-stop-helper-changed')
    baseline = private_json(directory / 'predecessor-running.json')
    intent = _stop_binding(baseline, role)
    expected = record(record(baseline['writers'], 'writers')[role], 'writer')
    binding_path = previous.attempt.directory / ('candidate-' + role + '.json')
    binding = private_json(binding_path)
    verify_drained()
    prepare_predecessor_stop(previous, successor, role=role)
    if private_json(intent_path) != intent:
        raise ValueError('predecessor-stop-intent-missing-or-changed')
    identity = cast(str, intent['id'])
    successor.verify_fence()
    if bounded_bytes(helper) != source:
        raise ValueError('predecessor-stop-helper-changed')
    operation = 'stop' if role == 'workers' else 'stop-web'
    # Preserve the stop helper's deliberate absence of a forced-kill deadline.
    successor.command(
        [sys.executable, '-I', '-', operation, identity],
        content=source, timeout=None,
    )
    _verify_release(previous, successor, allow_unresolved=False)
    actual = successor.inspect(identity)
    if len(actual) != 1:
        raise ValueError('unique-predecessor-candidate-required')
    stopped = inspect_stopped_writer(
        actual[0], binding, role=role, baseline=expected,
    )
    if (private_json(directory / 'predecessor-running.json') != baseline
            or private_json(intent_path) != intent
            or private_json(binding_path) != binding
            or result_path.exists() or result_path.is_symlink()):
        raise ValueError('predecessor-stop-dispatch-evidence-changed')
    successor.verify_fence()
    atomic_json(result_path, {
        'outcome': 'confirmed', 'intentSha256': checksum(intent),
        'stopped': stopped,
    })
    return inspect_predecessor(previous, successor)


def inspect_predecessor(
    previous: HostOperations, successor: HostOperations,
    *, phase: RetainedPhase = 'FENCED',
) -> dict[str, object]:
    """Recheck captured instances, including a partially completed stop.

    Persist each observed stop before returning so a retry cannot accept a
    later, different exit. This is not a complete writer or queue fence.
    """
    release = _verify_release(previous, successor, allow_unresolved=True, phase=phase)
    directory = successor.attempt.directory
    baseline = private_json(directory / 'predecessor-running.json')
    identity = _identity(previous, successor, release)
    if (set(baseline) != {*identity, 'writers'}
            or any(baseline[key] != value for key, value in identity.items())):
        raise ValueError('predecessor-running-evidence-changed')
    writers = record(baseline['writers'], 'predecessor writers')
    if set(writers) != {'web', 'workers'}:
        raise ValueError('predecessor-writer-set-changed')
    path = directory / 'predecessor-stopped.json'
    retained = private_json(path) if path.exists() or path.is_symlink() else {}
    if not retained.keys() <= {'web', 'workers'}:
        raise ValueError('predecessor-stop-receipt-invalid')
    stops = dict(retained)
    observed: dict[str, object] = {}
    ids: set[object] = set()
    for role in ('web', 'workers'):
        binding = private_json(previous.attempt.directory
                               / ('candidate-' + role + '.json'))
        candidate = services.verify_candidate(previous, role,
                                              require_running=False)
        if candidate != binding.get('id') or candidate in ids:
            raise ValueError('predecessor-candidate-identity-changed')
        ids.add(candidate)
        actual = previous.inspect(candidate)
        if len(actual) != 1:
            raise ValueError('unique-predecessor-candidate-required')
        original = record(writers[role], 'predecessor running instance')
        state = record(actual[0].get('State'), 'predecessor state')
        if state.get('Running') is True:
            if phase != 'FENCED':
                raise ValueError('predecessor-writer-running-after-quiescence')
            if role in retained or capture_running_writer(
                actual[0], binding, role=role,
            ) != original:
                raise ValueError('predecessor-running-evidence-changed')
            observed[role] = 'running'
        else:
            intent = directory / ('predecessor-stop-intent-' + role + '.json')
            if (not intent.exists() or private_json(intent)
                    != _stop_binding(baseline, role)):
                raise ValueError('predecessor-stop-intent-missing-or-changed')
            prior = record(retained[role], 'prior stop') if role in retained else None
            stopped = inspect_stopped_writer(
                actual[0], binding, role=role, baseline=original,
                previous=prior,
            )
            result_path = directory / ('predecessor-stop-result-' + role + '.json')
            expected_result = {
                'outcome': 'confirmed',
                'intentSha256': checksum(private_json(intent)),
                'stopped': stopped,
            }
            if (not result_path.exists()
                    or private_json(result_path) != expected_result):
                raise ValueError('predecessor-stop-result-unresolved')
            stops[role] = stopped
            observed[role] = 'stopped'
    successor.verify_fence()
    if stops != retained:
        atomic_json(path, stops)
    return observed
