"""Recover the exact fenced web candidate after measured memory exhaustion."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.runtime import services
from scripts.deploy.review.runtime.policy import concurrent_memory, live_writer_anonymous_memory
from scripts.deploy.review.runtime.recovery.workload import file_sha, web_memory_plan
from scripts.deploy.review.state import atomic_json, checksum, private_json

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations

INTENT = 'web-memory-recovery-intent.json'
START = 'web-memory-recovery-start.json'
PROOF = 'web-memory-recovery-verified.json'
RUNNING = 'web-memory-recovery-running.json'
OOM = 'web-memory-recovery-evidence.json'


def web_binding_with_memory(
    operations: HostOperations, container: dict[str, object], cap: int,
) -> dict[str, object]:
    """Derive the full same-container binding with only memory and swap changed."""
    host = record(container['HostConfig'], 'candidate host configuration')
    return operations.writer_binding({
        **container, 'HostConfig': {**host, 'Memory': cap, 'MemorySwap': cap},
    })


def validate_failure(
    operations: HostOperations, plan: dict[str, object], original: dict[str, object],
) -> dict[str, object]:
    """Tie the adjustment to repeated cgroup OOM of the admitted candidate."""
    path = operations.attempt.directory / OOM
    if file_sha(path) != digest(plan['oomEvidenceSha256'], 'web OOM evidence'):
        raise ValueError('review-web-oom-evidence-changed')
    evidence = private_json(path)
    next_peak = evidence.get('nextPeakRssBytes')
    catalog_peak = evidence.get('catalogPeakRssBytes')
    prior, cap = plan['priorBytes'], plan['bytes']
    assert type(prior) is int and type(cap) is int
    if (checksum(original) != plan['bindingSha256']
            or evidence.get('containerId') != original.get('id')
            or evidence.get('imageId') != original.get('imageId')
            or original.get('imageId') != record(operations.manifest['finalWeb'], 'final web')['imageId']
            or evidence.get('memoryBytes') != plan['priorBytes']
            or evidence.get('sameReleaseCodexCatalog') is not True
            or type(next_peak) is not int or type(catalog_peak) is not int
            or next_peak <= 0 or catalog_peak <= 0 or not prior < next_peak + catalog_peak < cap
            or not isinstance(evidence.get('secondStartedAt'), str)
            or not isinstance(evidence.get('secondFinishedAt'), str)):
        raise ValueError('exact-measured-web-container-oom-required')
    for name in ('firstKernelSha256', 'secondKernelSha256', 'catalogProofSha256'):
        digest(evidence.get(name), name)
    return evidence


def same_fenced_crash(state: dict[str, object], evidence: dict[str, object]) -> bool:
    return (state.get('Running') is False and state.get('Restarting') is False
            and state.get('Status') == 'exited' and state.get('OOMKilled') is True
            and state.get('ExitCode') == 137 and state.get('StartedAt') == evidence['secondStartedAt']
            and state.get('FinishedAt') == evidence['secondFinishedAt'])


def recovery_capacity(operations: HostOperations, plan: dict[str, object]) -> None:
    """Count the entire expanded envelope, crediting only live worker RSS."""
    prior, current = plan['priorBytes'], plan['bytes']
    assert type(prior) is int and type(current) is int
    worker = live_writer_anonymous_memory(operations, 'workers')
    operations._capacity(concurrent_memory(operations.manifest) + current - prior - worker)


def current_memory_proof(
    operations: HostOperations, identity: str, cap: int,
) -> dict[str, object]:
    """Verify the active candidate's exact cgroup and OOM counters."""
    before, = operations.inspect(identity)
    state = record(before['State'], 'restarted web state')
    pid = state.get('Pid')
    started = state.get('StartedAt')
    if type(pid) is not int or pid <= 1 or not isinstance(started, str):
        raise ValueError('running-recovered-web-pid-required')
    relative = (Path('/proc') / str(pid) / 'cgroup').read_text().strip()
    root = Path('/sys/fs/cgroup')
    group = root / relative.removeprefix('0::/')
    if (not relative.startswith('0::/') or '\n' in relative
            or group != group.resolve(strict=True) or not group.is_relative_to(root)
            or group.name not in {identity, 'docker-' + identity + '.scope'}):
        raise ValueError('exact-recovered-web-cgroup-required')
    events = dict(line.split() for line in (group / 'memory.events').read_text().splitlines())
    peak = int((group / 'memory.peak').read_text())
    if (int((group / 'memory.max').read_text()) != cap
            or (group / 'memory.swap.max').read_text().strip() != '0'
            or not 0 < peak <= cap or events.get('oom') != '0' or events.get('oom_kill') != '0'):
        raise ValueError('recovered-web-exceeded-admitted-memory')
    after, = operations.inspect(identity)
    current = record(after['State'], 'verified recovered web state')
    if (current.get('Pid') != pid or current.get('StartedAt') != started
            or services.verify_candidate(operations, 'web') != identity):
        raise ValueError('recovered-web-process-changed')
    return {'id': identity, 'startedAt': started, 'peakBytes': peak, 'limitBytes': cap}


def recover_web_memory(operations: HostOperations) -> None:
    """Apply and reconcile one guarded Docker resource adjustment and start."""
    attempt = operations.attempt
    plan = web_memory_plan(operations.root, attempt)
    if plan is None:
        return
    operations.lock.validate()
    operations.verify_fence()
    operations.verify_egress()
    if attempt.state()['phase'] != 'EGRESS_GUARDED':
        raise ValueError('review-web-memory-recovery-phase-invalid')
    if operations.docker('ps', '--quiet', '--filter', 'name=^/sotto-review-tool-').strip():
        raise ValueError('active-review-helpers-block-web-memory-recovery')
    prior, cap = plan['priorBytes'], plan['bytes']
    assert type(prior) is int and type(cap) is int
    directory = attempt.directory
    path = directory / 'candidate-web.json'
    intent_path = directory / INTENT
    start_path = directory / START
    current_binding = private_json(path)
    intent = private_json(intent_path) if intent_path.exists() or intent_path.is_symlink() else None
    original = current_binding if intent is None else record(intent['before'], 'original web binding')
    evidence = validate_failure(operations, plan, original)
    identity = digest(original['id'], 'exact recovered web')
    actual, = operations.inspect(identity)
    host = record(actual['HostConfig'], 'candidate host configuration')
    if (set(record(host['RestartPolicy'], 'candidate restart policy')) != {'Name', 'MaximumRetryCount'}
            or record(host['RestartPolicy'], 'candidate restart policy')['Name'] != 'no'
            or host['Memory'] != host['MemorySwap'] or host['Memory'] not in (prior, cap)
            or web_binding_with_memory(operations, actual, prior) != original):
        raise ValueError('unexpected-web-config-change-during-memory-recovery')
    target = web_binding_with_memory(operations, actual, cap)
    expected = {'planSha256': checksum(plan), 'before': original, 'after': target}
    state = record(actual['State'], 'OOM web candidate')
    if intent is None:
        if (attempt.state()['status'] != 'unresolved' or host['Memory'] != prior
                or start_path.exists() or not same_fenced_crash(state, evidence)):
            raise ValueError('exact-stopped-web-oom-required-before-memory-adjustment')
        operations.verify_storage()
        recovery_capacity(operations, plan)
        atomic_json(intent_path, expected)
    elif intent != expected:
        raise ValueError('review-web-memory-intent-changed')
    if current_binding not in (original, target):
        raise ValueError('review-web-binding-changed')
    if host['Memory'] == prior:
        if not same_fenced_crash(state, evidence) or current_binding != original or start_path.exists():
            raise ValueError('review-web-memory-adjustment-state-unresolved')
        operations.verify_storage()
        recovery_capacity(operations, plan)
        operations.verify_fence()
        operations.docker('update', '--memory', str(cap), '--memory-swap', str(cap), identity)
        actual, = operations.inspect(identity)
        state = record(actual['State'], 'updated candidate web')
    if operations.writer_binding(actual) != target:
        raise ValueError('review-web-memory-update-did-not-match-intent')
    if current_binding != target:
        atomic_json(path, target)
    operations.verify_storage()
    operations.verify_egress()
    start = {'intentSha256': checksum(expected), 'previousStartedAt': evidence['secondStartedAt']}
    if start_path.exists() or start_path.is_symlink():
        if private_json(start_path) != start:
            raise ValueError('review-web-memory-start-intent-changed')
    elif not same_fenced_crash(state, evidence):
        raise ValueError('review-web-memory-start-boundary-changed')
    else:
        atomic_json(start_path, start)
    if state.get('Running') is not True:
        if not same_fenced_crash(state, evidence):
            raise ValueError('review-web-memory-start-unresolved')
        recovery_capacity(operations, plan)
        operations.verify_fence()
        operations.docker('start', identity)
    running = current_memory_proof(operations, identity, cap)
    if running['startedAt'] == evidence['secondStartedAt']:
        raise ValueError('review-web-memory-start-not-observed')
    running_path = directory / RUNNING
    instance = {'id': identity, 'startedAt': running['startedAt'], 'intentSha256': checksum(expected)}
    if running_path.exists() or running_path.is_symlink():
        if private_json(running_path) != instance:
            raise ValueError('review-web-memory-running-instance-changed')
    else:
        atomic_json(running_path, instance)


def record_recovered_web_memory(operations: HostOperations) -> None:
    """Check the same web process after live model discovery and the workload."""
    plan = web_memory_plan(operations.root, operations.attempt)
    if plan is None:
        return
    cap = plan['bytes']
    assert type(cap) is int
    operations.lock.validate()
    operations.verify_fence()
    directory = operations.attempt.directory
    intent = private_json(directory / INTENT)
    start = private_json(directory / START)
    if intent.get('planSha256') != checksum(plan) or start.get('intentSha256') != checksum(intent):
        raise ValueError('review-web-memory-proof-binding-changed')
    binding = private_json(directory / 'candidate-web.json')
    if binding != intent.get('after'):
        raise ValueError('review-web-memory-live-binding-changed')
    identity = digest(binding['id'], 'recovered web')
    evidence = current_memory_proof(operations, identity, cap)
    if private_json(directory / RUNNING) != {
        'id': identity, 'startedAt': evidence['startedAt'], 'intentSha256': checksum(intent),
    }:
        raise ValueError('review-web-memory-running-instance-changed')
    atomic_json(directory / PROOF, {**evidence, 'intentSha256': checksum(intent)})
