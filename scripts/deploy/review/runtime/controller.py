"""Advance one independently admitted, forward-only shared review upgrade."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import stat
import subprocess
import sys
import time
import traceback
from collections.abc import Callable
from importlib import import_module
from pathlib import Path
from types import FrameType
from typing import cast

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.build_observer import bounded_bytes
from scripts.deploy.review.runtime import services
from scripts.deploy.review.runtime.operations import (
    HOST_STATE,
    HostOperations,
)
from scripts.deploy.review.state import (
    PHASES,
    Attempt,
    DeploymentLock,
    atomic_json,
    private_json,
)
from scripts.deploy.review.topology import rows


def admitted_file(
    attempt: Attempt, name: str, expected: object,
) -> dict[str, object]:
    """Consume the same private captured bytes that admission hashed."""
    path = attempt.directory / name
    content = bounded_bytes(path, private=True)
    if hashlib.sha256(content).hexdigest() != digest(expected, name):
        raise ValueError('admitted-review-evidence-changed')
    # Require the canonical owned-file boundary as well as the byte binding.
    if private_json(path) != json.loads(content):
        raise ValueError('private-review-evidence-replaced')
    return record(json.loads(content), 'admitted review evidence')


def admission(operations: HostOperations) -> dict[str, object]:
    attempt, manifest = operations.attempt, operations.manifest
    operations.verify_tools()
    evidence = admitted_file(attempt, 'evidence.json', attempt.evidence_hash)
    jobs = rows(evidence.get('jobs'), 'admitted worksheet job')
    identifiers = [item.get('id') for item in jobs]
    if (len(jobs) != 3 or any(not isinstance(item, str)
                              for item in identifiers)
            or len(set(identifiers)) != 3
            or identifiers != sorted(cast(list[str], identifiers))):
        raise ValueError('three-ordered-historical-jobs-required')
    kernel = admitted_file(attempt, 'kernel-proof.json',
                           manifest['kernelProofSha256'])
    tools = record(manifest['tools'], 'bound review tools')
    if (kernel.get('egressSourceSha256')
            != tools.get('scripts/deploy/review/egress.py')
            or type(kernel.get('cases')) is not int
            or cast(int, kernel['cases']) < 1
            or kernel.get('unguardedCases') != kernel['cases']
            or any(kernel.get(name) is not True for name in (
                'hostPolicyUnchanged', 'hostLinksUnchanged',
                'outerNamespaceUnchanged', 'namespaceOnly',
                'unrelatedRulePreserved', 'noExternalNetwork',
            ))):
        raise ValueError('actual-admitted-kernel-proof-required')
    for name in ('fullProofSha256', 'scriptSha256', 'renderSha256'):
        digest(kernel.get(name), 'kernel proof binding')
    codex = admitted_file(attempt, 'codex-proof.json',
                          manifest['offserverCodexProofSha256'])
    if (codex.get('exactResponse') is not True
            or codex.get('toolsUsed') is not False):
        raise ValueError('actual-isolated-codex-proof-required')
    digest(codex.get('requestSha256'), 'Codex request proof')
    digest(codex.get('eventsSha256'), 'Codex response proof')
    initial = record(manifest['initialStage'], 'initial schema stage')
    stages = rows(manifest['stages'], 'admitted SQL stage')
    if not 1 <= len(stages) <= 8:
        raise ValueError('bounded-admitted-sql-stages-required')
    previous = initial
    schema_guard = import_module('scripts.deploy.compatibility-review')
    for stage in stages:
        before = record(previous['migrations'], 'previous SQL inventory')
        after = record(stage['migrations'], 'candidate SQL inventory')
        if (not before or not after
                or not before.items() <= after.items()):
            raise ValueError('additive-schema-stage-inventory-required')
        for value in after.values():
            digest(value, 'published migration SQL')
        changes = {
            name: {'previousSha256': before.get(name),
                   'candidateSha256': after.get(name)}
            for name in sorted(before.keys() | after.keys())
            if before.get(name) != after.get(name)
        }
        schema_guard.published_migration_additions(changes)
        previous = stage
    final = record(manifest['finalWorker'], 'final worker')
    web = record(manifest['finalWeb'], 'final web')
    receipt = record(stages[-1]['receipt'], 'last schema receipt')
    if (receipt != final or web.get('sha') != final.get('sha')
            or len(record(stages[-1]['migrations'], 'final SQL')) != 31):
        raise ValueError('one-admitted-final-thirty-one-schema-required')
    queues = record(manifest['originalQueues'], 'original queue flags')
    flags = rows(queues.get('queues'), 'original queue')
    if (len(flags) != 27 or len({item.get('name') for item in flags}) != 27
            or any(item.get('paused') is not False for item in flags)):
        raise ValueError('original-empty-twenty-seven-queue-flags-required')
    return evidence


def inspect_original(
    operations: HostOperations, evidence: dict[str, object],
) -> None:
    actual = operations.runtime_exchange('capture', {
        'namespace': evidence['namespace'],
        'jobs': [{'id': row['id']} for row in rows(evidence['jobs'], 'job')],
    })
    if actual != evidence:
        raise ValueError('independently-admitted-worksheet-evidence-changed')
    services.preserve_data(operations)
    admitted_file(operations.attempt, 'original-data.json',
                  operations.manifest['originalDataSha256'])


def read_activation(operations: HostOperations) -> dict[str, object]:
    path = operations.attempt.directory / 'activation.json'
    if not path.exists():
        value: dict[str, object] = {
            'prepareIntent': False, 'queuesPrepared': False,
            'workerStartIntent': False,
            'restoreIntent': False, 'queuesRestored': False,
        }
        atomic_json(path, value)
        return value
    value = private_json(path)
    if (set(value) != {'prepareIntent', 'queuesPrepared', 'workerStartIntent',
                      'restoreIntent', 'queuesRestored'}
            or any(type(item) is not bool for item in value.values())
            or (value['queuesPrepared'] and not value['prepareIntent'])
            or (value['workerStartIntent'] and not value['queuesPrepared'])
            or (value['restoreIntent'] and not value['workerStartIntent'])
            or (value['queuesRestored'] and not value['restoreIntent'])):
        raise ValueError('invalid-review-activation-journal')
    return value


def inspect_continuation(
    operations: HostOperations, evidence: dict[str, object],
    continue_check: Callable[[], None] | None = None,
) -> None:
    deadline = time.monotonic() + 120
    while True:
        if continue_check is not None:
            continue_check()
        operations.verify_fence()
        try:
            result = operations.runtime_exchange('continuation', evidence)
        except (ValueError, RuntimeError) as error:
            if time.monotonic() >= deadline:
                raise RuntimeError('historical-delivery-unresolved') from error
            time.sleep(2)
            continue
        if result != {
            'retained': True, 'zeroWork': False,
            'pending': 3, 'failed': 3, 'attempts': 2,
        }:
            raise ValueError('historical-continuation-proof-changed')
        return


def activate(
    operations: HostOperations, evidence: dict[str, object],
    continue_check: Callable[[], None] | None = None,
) -> None:
    operations.verify_fence()
    operations.verify_egress()
    inputs = services.private_inputs(operations)
    readiness = record(inputs['readiness'], 'provider readiness input')
    workloads = record(inputs['workloads'], 'workload input')
    if (readiness.get('expectedOwnerId') != workloads.get('expectedOwnerId')
            or [(row['id'], row['preferences']) for row in
                rows(readiness['profiles'], 'readiness profile')]
            != [(row['id'], row['preferences']) for row in
                rows(workloads['profiles'], 'workload profile')]):
        raise ValueError('same-two-review-profiles-required')
    journal = read_activation(operations)
    path = operations.attempt.directory / 'activation.json'
    original_queues = record(operations.manifest['originalQueues'],
                             'original queues')
    if not journal['queuesPrepared']:
        if continue_check is not None:
            continue_check()
        if journal['prepareIntent']:
            raise ValueError(
                'partial-queue-preparation-needs-canonical-inspection',
            )
        operations.verify_empty_redis()
        journal['prepareIntent'] = True
        atomic_json(path, journal)
        prepared = record(operations.runtime_exchange('prepare', evidence),
                          'queue preparation')
        if (prepared.get('prepared') is not True
                or prepared.get('manifest') != original_queues
                or prepared.get('zeroWork') is not False
                or prepared.get('pending') != 3
                or private_json(operations.attempt.directory
                                / 'original-queues.json') != original_queues):
            raise ValueError('original-queue-preparation-not-verified')
        journal['queuesPrepared'] = True
        atomic_json(path, journal)
    elif private_json(operations.attempt.directory
                      / 'original-queues.json') != original_queues:
        raise ValueError('retained-original-queue-flags-changed')

    if continue_check is not None:
        continue_check()
    services.handover_auth(operations)
    web = services.candidate(operations, 'web')
    services.wait_health(operations)
    checkpoint_path = operations.attempt.directory / 'provider-checkpoint.json'
    provider_checkpoint = (
        private_json(checkpoint_path) if checkpoint_path.exists()
        else {'credentials': [], 'modelChangePrepared': False}
    )
    if continue_check is not None:
        continue_check()
    ready = record(operations.runtime_exchange(
        'providers', readiness, checkpoint=provider_checkpoint,
        candidate_id=web,
    ), 'provider readiness')
    if (ready.get('credentialValidation') != 'verified'
            or ready.get('profileCount') != 2
            or ready.get('credentialCount') != 4
            or ready.get('modelDiscovery') != 'live'
            or ready.get('modelId') != readiness['selectedModelId']
            or ready.get('speechSelectionsPreserved') is not True
            or ready.get('workloadVerification') != 'required'):
        raise ValueError('canonical-provider-readiness-not-verified')
    if not journal['restoreIntent']:
        if continue_check is not None:
            continue_check()
        original_inspection = {
            'evidenceSha256': operations.attempt.evidence_hash,
            'admitted': True, 'zeroWork': False, 'pending': 3,
        }
        inspected_path = operations.attempt.directory / 'initial-inspect.json'
        if not journal['workerStartIntent']:
            if operations.runtime_exchange('inspect', evidence) != {
                'admitted': True, 'zeroWork': False, 'pending': 3,
            }:
                raise ValueError('original-worksheet-admission-not-verified')
            atomic_json(inspected_path, original_inspection)
            journal['workerStartIntent'] = True
            atomic_json(path, journal)
        elif private_json(inspected_path) != original_inspection:
            raise ValueError('retained-pre-worker-admission-changed')
        worker_path = operations.attempt.directory / 'candidate-workers.json'
        if not worker_path.exists():
            operations.runtime_exchange('consumers', {
                'address': '172.30.99.11', 'paused': True, 'count': 0,
            })
        if continue_check is not None:
            continue_check()
        services.candidate(operations, 'workers')
        operations.runtime_exchange('consumers', {
            'address': '172.30.99.11', 'paused': True, 'count': 1,
        })
        if operations.runtime_exchange('paused-admission', evidence) != {
            'admitted': True, 'zeroWork': False, 'pending': 3,
        }:
            raise ValueError('paused-original-work-not-admitted')
        if continue_check is not None:
            continue_check()
        journal['restoreIntent'] = True
        atomic_json(path, journal)
        restored = operations.runtime_exchange('queues', {
            'command': 'restore', 'manifest': original_queues,
        })
        if restored != original_queues:
            raise ValueError('original-queue-flags-not-restored')
        journal['queuesRestored'] = True
        atomic_json(path, journal)
    else:
        services.verify_candidate(operations, 'workers')
        # A lost restore response is accepted only from an exact readback.
        if operations.runtime_exchange('queues', {'command': 'snapshot'}) \
                != original_queues:
            raise ValueError(
                'partial-queue-restore-needs-canonical-inspection',
            )
        if not journal['queuesRestored']:
            journal['queuesRestored'] = True
            atomic_json(path, journal)
    inspect_continuation(operations, evidence, continue_check)
    checkpoint_path = operations.attempt.directory / 'workload-checkpoint.json'
    workload_checkpoint = (private_json(checkpoint_path)
                           if checkpoint_path.exists() else None)
    if continue_check is not None:
        continue_check()
    result = record(operations.runtime_exchange(
        'workloads', workloads, checkpoint=workload_checkpoint,
        candidate_id=web,
    ), 'actual learning and speech workload')
    if (result.get('profileCount') != 2 or result.get('generatedClasses') != 2
            or result.get('syntheticAssessments') != 2
            or result.get('humanPronunciationVerified') is not False
            or result.get('codexWorkload') != 'verified'
            or result.get('selectedSpeechWorkload') != 'verified'
            or result.get('speechSelections') != [row['selection'] for row
                in rows(workloads['profiles'], 'workload profile')]):
        raise ValueError('actual-learning-and-speech-proof-required')
    hashes = result.get('referenceAudioSha256')
    if not isinstance(hashes, list) or len(hashes) != 2:
        raise ValueError('two-generated-reference-audio-proofs-required')
    for value in hashes:
        digest(value, 'generated reference audio')
    atomic_json(operations.attempt.directory / 'workloads-verified.json',
                result)
    services.verify_candidate(operations, 'web')
    services.verify_candidate(operations, 'workers')
    operations.verify_fence()
    operations.verify_egress()


def execute(
    attempt: Attempt, lock: DeploymentLock, *, recover: bool = False,
    continue_check: Callable[[], None] | None = None,
) -> dict[str, object]:
    """The caller retains FD9 and the public fence on every raised failure."""
    lock.validate()
    if continue_check is not None:
        continue_check()
    state = attempt.state()
    phase = cast(str, state['phase'])
    operations = HostOperations(attempt, lock)
    evidence = admission(operations)
    if state['status'] == 'complete':
        marker = HOST_STATE / 'unresolved.json'
        if recover and (marker.exists() or marker.is_symlink()):
            if continue_check is not None:
                continue_check()
            services.recover_completed(operations,
                                       continue_check=continue_check)
        services.verify_completed(operations)
        if marker.exists() or marker.is_symlink():
            if continue_check is not None:
                continue_check()
            attempt.clear_marker(marker)
        return {'complete': True, 'browserVerification': 'required'}
    if not recover and (phase != 'PRECHECK' or state['status'] != 'active'):
        raise ValueError('explicit-same-attempt-recovery-required')
    if recover:
        operations.settle_pending_helpers()
        if PHASES.index(phase) >= PHASES.index('FENCED'):
            operations.fence()
    while True:
        lock.validate()
        if continue_check is not None:
            continue_check()
        phase = cast(str, attempt.state()['phase'])
        if phase == 'PRECHECK':
            operations.preflight()
            services.runtime_identity(operations)
            services.private_inputs(operations)
            inspect_original(operations, evidence)
            attempt.advance('ADMITTED')
        elif phase == 'ADMITTED':
            operations.runtime_environment()
            operations.capacity()
            operations.verify_tools()
            services.before_fence(operations)
            attempt.advance('PREPARED')
        elif phase == 'PREPARED':
            operations.fence()
            attempt.advance('FENCED')
        elif phase == 'FENCED':
            operations.retire_old_web()
            operations.verify_empty_redis()
            inspect_original(operations, evidence)
            attempt.advance('QUIESCENT')
        elif phase == 'QUIESCENT':
            operations.backups()
            attempt.advance('BACKED_UP')
        elif phase == 'BACKED_UP':
            operations.verify_fence()
            operations.verify_storage()
            operations.capacity()
            # Persist before any command can reach a schema-writing runtime.
            attempt.advance('SQL_STARTED')
        elif phase == 'SQL_STARTED':
            previous = record(operations.manifest['initialStage'],
                              'initial stage')
            for stage in rows(operations.manifest['stages'], 'SQL stage'):
                if continue_check is not None:
                    continue_check()
                operations.migrate_stage(stage, previous)
                inspect_original(operations, evidence)
                previous = stage
            attempt.advance('FINAL_SCHEMA_VERIFIED')
        elif phase == 'FINAL_SCHEMA_VERIFIED':
            operations.install_egress()
            operations.verify_egress()
            attempt.advance('EGRESS_GUARDED')
        elif phase == 'EGRESS_GUARDED':
            activate(operations, evidence, continue_check)
            attempt.advance('CANDIDATE_READY')
        elif phase == 'CANDIDATE_READY':
            if continue_check is not None:
                continue_check()
            services.cutover(operations, continue_check=continue_check)
            services.wait_health(operations, public=True)
            attempt.advance('PUBLIC_COMMITTED')
        elif phase == 'PUBLIC_COMMITTED':
            if recover:
                if continue_check is not None:
                    continue_check()
                services.cutover(operations, continue_check=continue_check)
            services.wait_health(operations, public=True)
            if continue_check is not None:
                continue_check()
            services.finalize(operations, continue_check=continue_check)
            attempt.advance('COMPLETE')
        elif phase == 'COMPLETE':
            services.verify_completed(operations)
            if continue_check is not None:
                continue_check()
            attempt.clear_marker(HOST_STATE / 'unresolved.json')
            return {'complete': True, 'browserVerification': 'required'}


CANONICAL_LOCK = Path('/var/lock/production-build.lock')
MODULE = 'scripts.deploy.review.runtime.controller'


def process_identity(pid: int) -> dict[str, object]:
    """Read Linux kernel identity, arguments, and process start time."""
    if pid <= 0:
        raise ValueError('positive-supervisor-process-required')
    directory = Path('/proc') / str(pid)
    raw = bounded_bytes(directory / 'stat')
    fields = raw.decode().rsplit(') ', 1)[1].split()
    command = bounded_bytes(directory / 'cmdline').decode().rstrip('\x00')
    if len(fields) <= 19 or not command:
        raise ValueError('actual-supervisor-process-required')
    return {'pid': pid, 'startTicks': fields[19],
            'executable': os.readlink(directory / 'exe'),
            'commandLine': command.split('\x00')}


def verify_supervisor(attempt: Attempt) -> dict[str, object]:
    """Require this admitted supervisor's exact kernel process and lock."""
    value = private_json(attempt.directory / 'supervisor.json')
    pid = value.get('pid')
    recovering = value.get('launchRecover')
    if (type(pid) is not int or type(recovering) is not bool
            or value.get('attemptDirectory') != str(attempt.directory)
            or value.get('manifestSha256') != attempt.manifest_hash
            or type(value.get('ready')) is not bool
            or value.get('operation') not in {'deploy', 'startup'}
            or value.get('status') not in {'running', 'held'}):
        raise ValueError('exact-admitted-supervisor-required')
    identity = process_identity(pid)
    expected = [sys.executable, '-m', MODULE,
                '--start-completed' if value['operation'] == 'startup'
                else '--supervise',
                '--attempt', str(attempt.directory),
                '--lock', str(CANONICAL_LOCK),
                *(['--recover'] if recovering else [])]
    for name in ('pid', 'startTicks', 'executable', 'commandLine'):
        if identity[name] != value.get(name):
            raise ValueError('retained-supervisor-process-changed')
    if (identity['commandLine'] != expected
            or identity['executable'] != str(Path(sys.executable).resolve())):
        raise ValueError('supervisor-command-or-interpreter-changed')
    descriptor = (Path('/proc') / str(pid) / 'fd/9').stat()
    canonical = CANONICAL_LOCK.stat(follow_symlinks=False)
    if (not stat.S_ISREG(descriptor.st_mode)
            or not stat.S_ISREG(canonical.st_mode)
            or [descriptor.st_dev, descriptor.st_ino]
            != [canonical.st_dev, canonical.st_ino]
            or value.get('lockIdentity')
            != [canonical.st_dev, canonical.st_ino]):
        raise ValueError('supervisor-shared-lock-identity-changed')
    held = False
    for line in bounded_bytes(Path('/proc/locks')).decode().splitlines():
        fields = line.split()
        if (len(fields) < 8 or fields[1:4] != ['FLOCK', 'ADVISORY', 'WRITE']
                or fields[4] != str(pid)):
            continue
        major, minor, inode = fields[5].split(':')
        if (int(major, 16), int(minor, 16), int(inode)) == (
            os.major(canonical.st_dev), os.minor(canonical.st_dev),
            canonical.st_ino,
        ):
            held = True
    if not held:
        raise ValueError('supervisor-held-kernel-lock-not-proven')
    return value


def hold_failure(operations: HostOperations, category: str) -> None:
    """Preserve every failure while the caller continues holding FD9."""
    attempt = operations.attempt
    state: dict[str, object] | None = None
    failure: BaseException | None = None
    try:
        state = attempt.state()
        atomic_json(attempt.directory / (
            'supervisor-failure-' + str(time.time_ns()) + '.json'
        ), {'category': category, 'phase': state['phase']})
        if state['status'] != 'complete':
            attempt.unresolved(category)
    except BaseException as error:
        failure = error
    marker = HOST_STATE / 'unresolved.json'
    if marker.exists() or marker.is_symlink():
        attempt.verify_marker(marker)
        operations.fence()
    elif (state is not None and PHASES.index(cast(str, state['phase']))
          >= PHASES.index('FENCED')):
        operations.fence()
    if failure is not None:
        raise RuntimeError(
            'supervisor-failure-record-unavailable',
        ) from failure


class SupervisorHold(BaseException):
    """Leave the current command through the normal supervised failure path."""


def diagnose_failure() -> None:
    """A failed diagnostic sink must never release the deployment lock."""
    try:
        traceback.print_exc()
    except (OSError, ValueError):
        return


def supervise(
    attempt: Attempt, lock: DeploymentLock, *, recover: bool = False,
    start_completed: bool = False,
) -> dict[str, object]:
    """Signals request a held failure or verified forward recovery."""
    operations = HostOperations(attempt, lock)
    flags = {'hold': False, 'resume': False, 'holding': False}

    def request_hold(number: int, frame: FrameType | None) -> None:
        flags['hold'] = True

    def request_resume(number: int, frame: FrameType | None) -> None:
        if flags['holding']:
            flags['resume'] = True

    def continue_running() -> None:
        if flags['hold']:
            raise SupervisorHold('supervisor-stop-requested')

    previous = {number: signal.getsignal(number) for number in (
        signal.SIGHUP, signal.SIGINT, signal.SIGTERM, signal.SIGUSR1,
    )}
    for number in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
        signal.signal(number, request_hold)
    signal.signal(signal.SIGUSR1, request_resume)
    try:
        lock.validate()
        metadata = os.fstat(9)
        retained = {
            **process_identity(os.getpid()),
            'attemptDirectory': str(attempt.directory),
            'manifestSha256': attempt.manifest_hash,
            'lockIdentity': [metadata.st_dev, metadata.st_ino],
            'launchRecover': recover, 'ready': False,
            'operation': 'startup' if start_completed else 'deploy',
            'status': 'running',
        }
        path = attempt.directory / 'supervisor.json'
        while True:
            try:
                flags['holding'] = False
                atomic_json(path, {**retained, 'status': 'running'})
                admission(operations)
                retained['ready'] = True
                atomic_json(path, {**retained, 'status': 'running'})
                continue_running()
                if start_completed and not recover:
                    services.start_completed(operations,
                                             continue_check=continue_running)
                    result: dict[str, object] = {
                        'status': 'completed-release-started',
                    }
                else:
                    result = execute(attempt, lock, recover=recover,
                                     continue_check=continue_running)
                if flags['hold']:
                    raise SupervisorHold('supervisor-stop-requested')
                atomic_json(path, {**retained, 'status': 'completed'})
                return result
            except BaseException:
                flags['holding'] = False
                diagnose_failure()
                try:
                    hold_failure(operations, 'review-operation-unresolved')
                except BaseException:
                    diagnose_failure()
                flags['hold'] = False
                flags['resume'] = False
                flags['holding'] = True
                try:
                    atomic_json(path, {**retained, 'status': 'held'})
                except BaseException:
                    diagnose_failure()
            while not flags['resume']:
                if flags['hold']:
                    flags['hold'] = False
                    try:
                        hold_failure(operations, 'review-stop-requested')
                        atomic_json(path, {**retained, 'status': 'held'})
                    except BaseException:
                        diagnose_failure()
                time.sleep(0.1)
            flags['resume'] = False
            recover = True
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


def launch(attempt: Attempt, *, recover: bool = False) -> dict[str, object]:
    """Launch one owner without taking the deployment lock in this parent."""
    root = Path(__file__).resolve().parents[4]
    HostOperations.verify_tool_inventory(root, attempt.manifest())
    retained = attempt.directory / 'supervisor.json'
    if retained.exists():
        prior = private_json(retained)
        pid = prior.get('pid')
        if type(pid) is not int:
            raise ValueError('invalid-existing-supervisor-record')
        try:
            actual = process_identity(pid)
        except FileNotFoundError:
            actual = None
        if (actual is not None
                and actual.get('startTicks') == prior.get('startTicks')):
            raise ValueError('existing-supervisor-requires-verified-resume')
        if not recover:
            raise ValueError('stale-supervisor-requires-explicit-recovery')
    command = [sys.executable, '-m', MODULE, '--supervise',
               '--attempt', str(attempt.directory),
               '--lock', str(CANONICAL_LOCK),
               *(['--recover'] if recover else [])]
    name = 'supervisor-output-' + str(time.time_ns())
    with (attempt.directory / (name + '.log')).open('xb') as output:
        os.fchmod(output.fileno(), 0o600)
        process = subprocess.Popen(
            command, stdin=subprocess.DEVNULL,
            stdout=output, stderr=output,
            start_new_session=True, cwd=root,
        )
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            if process.returncode == 0 and retained.exists():
                final = private_json(retained)
                if (final.get('pid') == process.pid
                        and final.get('status') == 'completed'
                        and final.get('manifestSha256')
                        == attempt.manifest_hash
                        and final.get('attemptDirectory')
                        == str(attempt.directory)
                        and final.get('operation') == 'deploy'
                        and final.get('launchRecover') == recover
                        and attempt.state()['status'] == 'complete'):
                    return {'status': 'completed',
                            'browserVerification': 'required'}
            raise RuntimeError(
                'launch-outcome-unknown-inspect-attempt-supervisor-json',
            )
        if retained.exists():
            observed = private_json(retained)
            if (observed.get('pid') != process.pid
                    or observed.get('status') == 'completed'):
                time.sleep(0.05)
                continue
        try:
            value = verify_supervisor(attempt)
        except FileNotFoundError:
            time.sleep(0.05)
            continue
        except ValueError:
            # Completion can replace a running receipt between the two reads.
            completed = private_json(retained)
            if (completed.get('pid') == process.pid
                    and completed.get('status') == 'completed'
                    and completed.get('manifestSha256')
                    == attempt.manifest_hash):
                time.sleep(0.05)
                continue
            raise
        if value['pid'] != process.pid:
            raise ValueError('supervisor-handoff-process-changed')
        if value['ready'] is not True:
            time.sleep(0.05)
            continue
        return {'status': 'supervised', 'pid': process.pid,
                'supervisorStatus': value['status']}
    raise TimeoutError(
        'launch-outcome-unknown-inspect-attempt-supervisor-json',
    )


def request_recovery(attempt: Attempt) -> None:
    """Bind the recovery signal to the inspected process through a pidfd."""
    if sys.platform != 'linux':
        raise ValueError('linux-supervisor-recovery-required')
    HostOperations.verify_tool_inventory(
        Path(__file__).resolve().parents[4], attempt.manifest(),
    )
    retained = private_json(attempt.directory / 'supervisor.json')
    pid = retained.get('pid')
    if type(pid) is not int:
        raise ValueError('positive-supervisor-process-required')
    descriptor = os.pidfd_open(pid, 0)
    try:
        current = verify_supervisor(attempt)
        if current['pid'] != pid or current['status'] != 'held':
            raise ValueError('only-held-supervisor-can-resume')
        signal.pidfd_send_signal(descriptor, signal.SIGUSR1)
    finally:
        os.close(descriptor)


def canonical_attempt(path: Path, lock: Path) -> Attempt:
    if (not sys.platform.startswith('linux') or os.geteuid() == 0
            or lock != CANONICAL_LOCK or lock.is_symlink()
            or not path.is_absolute() or path.is_symlink()
            or path.parent != HOST_STATE or path.resolve() != path):
        raise ValueError('owned-canonical-linux-review-attempt-required')
    return Attempt(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--attempt', type=Path, required=True)
    parser.add_argument('--lock', type=Path, default=CANONICAL_LOCK)
    parser.add_argument('--recover', action='store_true')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--launch', action='store_true')
    mode.add_argument('--supervise', action='store_true')
    mode.add_argument('--resume', action='store_true')
    mode.add_argument('--start-completed', action='store_true')
    arguments = parser.parse_args()
    os.umask(0o077)
    attempt = canonical_attempt(arguments.attempt, arguments.lock)
    if arguments.recover and not (arguments.launch or arguments.supervise):
        raise ValueError('recovery-requires-the-admitted-supervisor')
    if arguments.resume:
        request_recovery(attempt)
        print(json.dumps({'status': 'recovery-requested'}))
        return
    if arguments.launch:
        print(json.dumps(launch(attempt, recover=arguments.recover)))
        return
    # Each supervisor opens its own description. Concurrent launchers compete
    # on the actual kernel lock before either can publish a ready record.
    lock = DeploymentLock(arguments.lock)
    completed = False
    try:
        result = supervise(
            attempt, lock, recover=arguments.recover,
            start_completed=arguments.start_completed,
        )
        completed = True
        print(json.dumps(result))
    finally:
        if completed:
            lock.close()


if __name__ == '__main__':
    main()
