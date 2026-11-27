"""Restore the completed App Review predecessor while SQL is still untouched."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import select
import signal
import sys
import time
from pathlib import Path
from typing import cast

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.build_observer import bounded_bytes
from scripts.deploy.review.runtime import services
from scripts.deploy.review.runtime.controller import (
    CANONICAL_LOCK,
    admission,
    canonical_attempt,
    process_identity,
    verify_supervisor,
)
from scripts.deploy.review.runtime.inventory.backup import predecessor_backup_binding
from scripts.deploy.review.runtime.inventory.network import verify_retained_network
from scripts.deploy.review.runtime.inventory.predecessor import RetainedPhase, bind_predecessor
from scripts.deploy.review.runtime.inventory.queue_snapshot import (
    DEADLINE,
    PREFIX,
    TOOL,
    verify_predecessor_queue_pause,
)
from scripts.deploy.review.runtime.inventory.storage import verify_running_completed_storage
from scripts.deploy.review.runtime.operations import CADDY, HOST_STATE, MAINTENANCE, HostOperations
from scripts.deploy.review.runtime.release import verify_completed_records
from scripts.deploy.review.state import (
    ROLLBACK_COMPLETE,
    ROLLBACK_HANDOFF,
    ROLLBACK_INTENT,
    Attempt,
    DeploymentLock,
    atomic_json,
    checksum,
    private_json,
    sync_directory,
)

READY = 'pre-sql-rollback-ready.json'
ROLES = ('workers', 'web')


def require_pre_sql(attempt: Attempt) -> dict[str, object]:
    state = attempt.state()
    if (state['status'] != 'unresolved'
            or state['phase'] not in {'FENCED', 'QUIESCENT', 'BACKED_UP'}
            or state['sqlMayHaveStarted'] is not False):
        raise ValueError('fenced-pre-sql-review-rollback-required')
    if any((attempt.directory / name).exists() or (attempt.directory / name).is_symlink()
           for name in ('candidate-compose.json', 'review-seed-intent.json',
                        'queue-policy-intent.json', 'release-record.json')):
        raise ValueError('successor-activation-already-recorded')
    if 'predecessor' not in attempt.manifest():
        raise ValueError('completed-review-predecessor-required')
    return state


def reviewed_source() -> dict[str, str]:
    """Bind a re-entry to the same reviewed deployment source."""
    root = Path(__file__).resolve().parents[5] / 'scripts/deploy'
    return {
        str(path.relative_to(root)): hashlib.sha256(bounded_bytes(path)).hexdigest()
        for path in sorted((root / 'review').rglob('*'))
        if path.is_file() and path.suffix in {'.py', '.ts'}
    }


def retire_held(attempt: Attempt, source: dict[str, str]) -> Path:
    """Release the held supervisor only after binding its exact idle identity."""
    if sys.platform != 'linux':
        raise ValueError('linux-supervisor-rollback-required')
    state = require_pre_sql(attempt)
    marker = HOST_STATE / 'unresolved.json'
    if marker.exists() or marker.is_symlink() or not (attempt.directory / ROLLBACK_COMPLETE).exists():
        attempt.verify_marker(marker)
    active_route = bounded_bytes(CADDY)
    for name in ('backups.json', 'predecessor-stopped.json', 'predecessor-queue-pause-result.json'):
        private_json(attempt.directory / name)
    path = attempt.directory / ROLLBACK_HANDOFF
    retained = private_json(path) if path.exists() or path.is_symlink() else None
    retained_root = retained.get('sourceRoot') if retained is not None else None
    supervisor = private_json(attempt.directory / 'supervisor.json')
    pid = supervisor.get('pid')
    if (type(pid) is not int or pid <= 1 or supervisor.get('status') != 'held'
            or supervisor.get('ready') is not True or supervisor.get('operation') != 'deploy'):
        raise ValueError('held-review-deploy-supervisor-required')
    try:
        descriptor = os.pidfd_open(pid)
    except ProcessLookupError:
        descriptor = None
    frozen = False
    try:
        proc = Path('/proc') / str(pid)
        active = descriptor is not None and process_identity(pid)['startTicks'] == supervisor.get('startTicks')
        if active and descriptor is not None:
            if verify_supervisor(attempt) != supervisor:
                raise ValueError('held-review-supervisor-changed')
            if active_route != MAINTENANCE:
                raise ValueError('review-maintenance-route-required')
            signal.pidfd_send_signal(descriptor, signal.SIGSTOP)
            frozen = True
            deadline = time.monotonic() + 2
            while time.monotonic() < deadline:
                status = (proc / 'status').read_text().splitlines()
                if any(line.split()[:2] == ['State:', 'T'] for line in status):
                    break
                time.sleep(0.02)
            else:
                raise TimeoutError('held-review-supervisor-not-suspended')
            children = list((proc / 'task').glob('*/children'))
            if not children or any(child.read_text().strip() for child in children):
                raise ValueError('active-review-supervisor-child')
            root = proc.joinpath('cwd').resolve(strict=True)
        elif isinstance(retained_root, str):
            root = Path(retained_root)
        else:
            raise ValueError('verified-review-rollback-handoff-required')
        if not root.is_absolute() or root != root.resolve(strict=True):
            raise ValueError('exact-review-controller-source-required')
        HostOperations.verify_tool_inventory(root, attempt.manifest())
        handoff = {
            'supervisor': supervisor, 'stateSha256': checksum(state),
            'manifestSha256': attempt.manifest_hash, 'sourceRoot': str(root),
            'rollbackTools': source,
        }
        if retained is None:
            atomic_json(path, handoff)
        elif retained != handoff:
            raise ValueError('review-rollback-handoff-changed')
        if active and descriptor is not None:
            if require_pre_sql(attempt) != state or verify_supervisor(attempt) != supervisor:
                raise ValueError('held-review-rollback-evidence-changed')
            signal.pidfd_send_signal(descriptor, signal.SIGKILL)
            frozen = False
            waiter = select.poll()
            waiter.register(descriptor, select.POLLIN)
            if not waiter.poll(10_000):
                raise TimeoutError('held-review-supervisor-did-not-exit')
        return root
    finally:
        if descriptor is not None:
            if frozen:
                signal.pidfd_send_signal(descriptor, signal.SIGCONT)
            os.close(descriptor)


def restore_queues(
    previous: HostOperations, successor: HostOperations, identity: str,
    original: dict[str, object],
) -> None:
    """Use the archived predecessor tool to restore only admitted queue flags."""
    tools = record(previous.manifest['tools'], 'predecessor tools')
    source = bounded_bytes(previous.root / TOOL)
    if len(source) > 65536 or hashlib.sha256(source).hexdigest() != digest(tools[TOOL], 'queue tool'):
        raise ValueError('predecessor-queue-tool-changed')
    successor.verify_fence()
    if services.verify_candidate(previous, 'workers') != identity:
        raise ValueError('predecessor-worker-changed')
    output = successor.command(
        ['docker', 'exec', '-i', '--workdir', '/app/apps/web', '--env', 'NODE_OPTIONS=',
         identity, 'node', '--import', 'tsx', '--input-type=commonjs', '--eval',
         source.decode() + DEADLINE],
        content=json.dumps({'command': 'restore', 'manifest': original}).encode() + b'\n',
        timeout=25,
    )
    result = [line.removeprefix(PREFIX) for line in output.splitlines() if line.startswith(PREFIX)]
    if len(result) != 1 or len(result[0]) > 65536 or json.loads(result[0]) != original:
        raise ValueError('predecessor-queue-restore-unverified')
    successor.verify_fence()
    if services.verify_candidate(previous, 'workers') != identity:
        raise ValueError('predecessor-worker-changed')


def verified_routing(attempt: Attempt) -> tuple[bytes, str]:
    route = bounded_bytes(attempt.directory / 'original-caddy.conf', private=True)
    admitted = record(attempt.manifest()['originalFiles'], 'original routing')['caddyFragment']
    actual = hashlib.sha256(route).hexdigest()
    if actual != admitted:
        raise ValueError('retained-review-routing-changed')
    return route, actual


def verify_restored(
    previous: HostOperations, successor: HostOperations, intent: dict[str, object],
    start_state: dict[str, object], routing_hash: str,
) -> dict[str, object]:
    attempt = successor.attempt
    directory = attempt.directory
    result = {**intent, 'restored': True, 'schemaChanged': False}
    if private_json(directory / READY) != result:
        raise ValueError('pre-sql-review-rollback-readiness-changed')
    services.wait_health(previous, public=True)
    verify_completed_records(previous, active_fragment_sha256=routing_hash, successor=successor)
    verify_running_completed_storage(previous, successor)
    previous.verify_egress()
    if require_pre_sql(attempt) != start_state:
        raise ValueError('review-rollback-state-changed')
    return result


def release_rollback_marker(attempt: Attempt, result: dict[str, object]) -> None:
    marker = HOST_STATE / 'unresolved.json'
    marked = marker.exists() or marker.is_symlink()
    disposition = attempt.directory / ROLLBACK_COMPLETE
    if marked or not (disposition.exists() or disposition.is_symlink()):
        attempt.verify_marker(marker)
    if disposition.exists() or disposition.is_symlink():
        if private_json(disposition) != result:
            raise ValueError('pre-sql-review-rollback-disposition-changed')
    else:
        atomic_json(disposition, result)
    if marked:
        marker.unlink()
    sync_directory(marker.parent)


def rollback(successor: HostOperations) -> dict[str, object]:
    """Reopen ingress only after exact predecessor writers and queues recover."""
    attempt = successor.attempt
    start_state = require_pre_sql(attempt)
    successor.verify_tools()
    directory = attempt.directory
    marker = HOST_STATE / 'unresolved.json'
    if marker.exists() or marker.is_symlink() or not (directory / ROLLBACK_COMPLETE).exists():
        attempt.verify_marker(marker)
    admission(successor)
    previous = bind_predecessor(successor)
    handoff = private_json(directory / ROLLBACK_HANDOFF)
    retained = private_json(directory / 'predecessor-queues.json')
    original = record(successor.manifest['originalQueues'], 'original queues')
    if (retained.get('originalQueues') != original
            or retained.get('queueToolSha256') != record(previous.manifest['tools'], 'predecessor tools')[TOOL]):
        raise ValueError('predecessor-queue-snapshot-changed')
    services.verify_backups(successor, binding=predecessor_backup_binding(previous, successor))
    backup = private_json(directory / 'backups.json')
    routing, routing_hash = verified_routing(attempt)
    ids = {role: services.verify_candidate(previous, role, require_running=False) for role in ROLES}
    intent: dict[str, object] = {
        'manifestSha256': attempt.manifest_hash, 'evidenceSha256': attempt.evidence_hash,
        'stateSha256': checksum(start_state), 'backupSha256': checksum(backup),
        'queueSnapshotSha256': checksum(retained), 'writers': ids, 'routingSha256': routing_hash,
        'handoffSha256': checksum(handoff),
    }
    path = directory / ROLLBACK_INTENT
    if path.exists() or path.is_symlink():
        if private_json(path) != intent:
            raise ValueError('pre-sql-review-rollback-intent-changed')
        if bounded_bytes(CADDY) == routing:
            result = verify_restored(previous, successor, intent, start_state, routing_hash)
            release_rollback_marker(attempt, result)
            return result
    else:
        verify_retained_network(previous, successor, phase=cast(RetainedPhase, start_state['phase']))
        atomic_json(path, intent)
    successor.verify_fence()
    successor.settle_pending_helpers()
    verify_predecessor_queue_pause(successor, allow_unresolved=True)
    verify_completed_records(previous, fenced=True, successor=successor)
    for role in ROLES:
        identity = ids[role]
        successor.verify_fence()
        if services.verify_candidate(previous, role, require_running=False) != identity:
            raise ValueError('predecessor-writer-changed')
        current = record(previous.inspect(identity)[0]['State'], 'predecessor state')
        if current.get('Running') is not True:
            if current.get('Status') != 'exited' or current.get('OOMKilled') is not False:
                raise ValueError('predecessor-writer-not-safely-restartable')
            previous.docker('start', identity)
        services.verify_candidate(previous, role)
    verify_running_completed_storage(previous, successor)
    restore_queues(previous, successor, ids['workers'], original)
    services.wait_health(previous)
    previous.verify_egress()
    result = {**intent, 'restored': True, 'schemaChanged': False}
    ready = directory / READY
    if ready.exists() or ready.is_symlink():
        if private_json(ready) != result:
            raise ValueError('pre-sql-review-rollback-readiness-changed')
    else:
        atomic_json(ready, result)
    try:
        successor.verify_fence()
        successor.install_caddy(routing)
        result = verify_restored(previous, successor, intent, start_state, routing_hash)
    except BaseException:
        successor.fence()
        raise
    release_rollback_marker(attempt, result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--attempt', type=Path, required=True)
    arguments = parser.parse_args()
    attempt = canonical_attempt(arguments.attempt, CANONICAL_LOCK, allow_rolled_back=True)
    descriptor = os.open(attempt.directory / 'pre-sql-rollback.lock',
                         os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        root = retire_held(attempt, reviewed_source())
        lock = DeploymentLock(CANONICAL_LOCK)
        try:
            operations = HostOperations(attempt, lock)
            operations.root = root
            result = rollback(operations)
            print(json.dumps(result))
        finally:
            lock.close()
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    main()
