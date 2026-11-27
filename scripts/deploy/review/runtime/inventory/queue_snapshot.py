"""Capture the exact predecessor queue flags before pausing any queue."""

from __future__ import annotations

import hashlib
import json
import re
from typing import TYPE_CHECKING, Literal

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.build_observer import bounded_bytes
from scripts.deploy.review.runtime import services
from scripts.deploy.review.runtime.inventory.environment import (
    admit_successor_environment,
)
from scripts.deploy.review.runtime.inventory.network import (
    verify_running_predecessor_network,
)
from scripts.deploy.review.state import atomic_json, checksum, private_json
from scripts.deploy.review.topology import rows

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations

TOOL = 'scripts/deploy/queue-lifecycle.cjs'
PREFIX = b'SOTTO_DEPLOY_QUEUE='
DEADLINE = """
const reviewSnapshotDeadline = setTimeout(() => process.exit(124), 20000);
reviewSnapshotDeadline.unref();
main().catch(() => {
  console.error('Predecessor queue snapshot failed');
  process.exitCode = 1;
});
"""


def _original_queues(
    successor: HostOperations,
) -> dict[str, object]:
    successor.verify_fence()
    if successor.attempt.state()['status'] != 'active':
        raise ValueError('active-review-successor-required')
    expected = record(successor.attempt.manifest()['originalQueues'],
                      'independently admitted predecessor queue manifest')
    if (set(expected) != {'schemaVersion', 'connectionIdentity', 'queues'}
            or type(expected['schemaVersion']) is not int
            or expected['schemaVersion'] != 1):
        raise ValueError('predecessor-queue-manifest-invalid')
    digest(expected['connectionIdentity'], 'review queue connection')
    queues = rows(expected['queues'], 'review queues')
    names = []
    for queue in queues:
        name = queue.get('name')
        if (set(queue) != {'name', 'paused'}
                or not isinstance(name, str)
                or not re.fullmatch('[a-z][a-z0-9-]{0,99}', name)
                or type(queue['paused']) is not bool):
            raise ValueError('predecessor-queue-manifest-invalid')
        names.append(name)
    if not 1 <= len(names) <= 100 or names != sorted(set(names)):
        raise ValueError('predecessor-queue-manifest-invalid')
    return expected


def _run_queue_command(
    previous: HostOperations, successor: HostOperations, *,
    mode: Literal['snapshot', 'drained-all', 'pause'],
    web_stopped: bool = False,
) -> tuple[dict[str, object], dict[str, object]]:
    if mode not in ('snapshot', 'drained-all', 'pause'):
        raise ValueError('predecessor-queue-command-invalid')
    expected = _original_queues(successor)
    verify_running_predecessor_network(previous, successor, web_stopped=web_stopped)
    _, environment = admit_successor_environment(previous, successor)
    identity = services.verify_candidate(previous, 'workers')
    digest(identity, 'predecessor worker')
    tools = record(previous.attempt.manifest()['tools'], 'predecessor tools')
    source = bounded_bytes(previous.root / TOOL)
    tool_hash = hashlib.sha256(source).hexdigest()
    if len(source) > 65536 or tool_hash != digest(tools.get(TOOL), 'queue helper'):
        raise ValueError('predecessor-queue-tool-changed')

    receipt: dict[str, object] = {
        'predecessorManifestSha256': previous.attempt.manifest_hash,
        'predecessorEvidenceSha256': previous.attempt.evidence_hash,
        'successorManifestSha256': successor.attempt.manifest_hash,
        'successorEvidenceSha256': successor.attempt.evidence_hash,
        'workerId': identity,
        'workerEnvironmentSha256': environment['workerEnvironmentSha256'],
        'queueToolSha256': tool_hash,
        'originalQueues': expected,
    }
    path = successor.attempt.directory / 'predecessor-queues.json'
    request: dict[str, object] = {'command': mode}
    if mode != 'snapshot':
        if not path.exists() or private_json(path) != receipt:
            raise ValueError('exact-retained-predecessor-queue-snapshot-required')
        request['manifest'] = expected
    successor.verify_fence()
    # Node's eval mode does not enter the helper's require.main guard.
    arguments = ['--import', 'tsx', '--input-type=commonjs',
                 '--eval', source.decode() + DEADLINE]
    content = json.dumps(request, separators=(',', ':')).encode() + b'\n'
    if mode == 'pause':
        image = record(previous.attempt.manifest()['finalWorker'], 'predecessor worker')

        def record_dispatch() -> None:
            intent = successor.attempt.directory / 'predecessor-queue-pause-intent.json'
            if intent.exists() or intent.is_symlink():
                raise ValueError('predecessor-queue-pause-dispatch-already-recorded')
            if private_json(path) != receipt:
                raise ValueError('exact-retained-predecessor-queue-snapshot-required')
            atomic_json(intent, _pause_intent(receipt))

        output = successor.image_command(
            image, 'node', arguments, content=content,
            network='container:' + identity, predecessor=previous,
            before_start=record_dispatch,
        )
    else:
        output = successor.command(
            ['docker', 'exec', '-i', '--workdir', '/app/apps/web',
             '--env', 'NODE_OPTIONS=', identity, 'node', *arguments],
            content=content, timeout=25,
        )
    results = [line.removeprefix(PREFIX) for line in output.splitlines()
               if line.startswith(PREFIX)]
    if len(results) != 1 or len(results[0]) > 65536:
        raise ValueError('unique-bounded-predecessor-queue-snapshot-required')
    observed = record(json.loads(results[0]), 'predecessor queue snapshot')
    verify_running_predecessor_network(previous, successor, web_stopped=web_stopped)
    _, current_environment = admit_successor_environment(previous, successor)
    if (current_environment != environment
            or services.verify_candidate(previous, 'workers') != identity):
        raise ValueError('predecessor-queue-runtime-changed')
    if successor.attempt.state()['status'] != 'active':
        raise ValueError('active-review-successor-required')
    successor.verify_fence()
    return observed, receipt


def capture_predecessor_queue_snapshot(
    previous: HostOperations, successor: HostOperations,
) -> dict[str, object]:
    """Persist original flags after verifying a read-only predecessor snapshot."""
    observed, receipt = _run_queue_command(previous, successor, mode='snapshot')
    if checksum(observed) != checksum(receipt['originalQueues']):
        raise ValueError('predecessor-queue-snapshot-changed')
    path = successor.attempt.directory / 'predecessor-queues.json'
    if path.exists() or path.is_symlink():
        if private_json(path) != receipt:
            raise ValueError('retained-predecessor-queue-snapshot-changed')
    else:
        atomic_json(path, receipt)
    return receipt


def _paused_queues(receipt: dict[str, object]) -> dict[str, object]:
    expected = record(receipt['originalQueues'], 'predecessor queues')
    return {
        **expected,
        'queues': [{**queue, 'paused': True}
                   for queue in rows(expected['queues'], 'predecessor queues')],
    }


def _pause_intent(receipt: dict[str, object]) -> dict[str, object]:
    return {'snapshotSha256': checksum(receipt),
            'expectedPausedSha256': checksum(_paused_queues(receipt))}


def verify_predecessor_queue_pause(successor: HostOperations) -> None:
    """Verify the retained proof when the full running topology has changed."""
    directory = successor.attempt.directory
    receipt = private_json(directory / 'predecessor-queues.json')
    if (receipt.get('originalQueues') != _original_queues(successor)
            or receipt.get('successorManifestSha256') != successor.attempt.manifest_hash
            or receipt.get('successorEvidenceSha256') != successor.attempt.evidence_hash):
        raise ValueError('predecessor-queue-runtime-changed')
    intent = _pause_intent(receipt)
    result = {'intentSha256': checksum(intent),
              'pausedManifestSha256': intent['expectedPausedSha256']}
    if (private_json(directory / 'predecessor-queue-pause-intent.json') != intent
            or private_json(directory / 'predecessor-queue-pause-result.json') != result):
        raise ValueError('predecessor-queue-pause-result-changed')
    successor.verify_fence()


def pause_predecessor_queues(
    previous: HostOperations, successor: HostOperations,
) -> None:
    """Pause once, or confirm an interrupted pause through exact readback."""
    directory = successor.attempt.directory
    intent_path = directory / 'predecessor-queue-pause-intent.json'
    result_path = directory / 'predecessor-queue-pause-result.json'
    if intent_path.exists() or intent_path.is_symlink():
        successor.verify_fence()
        successor.settle_pending_helpers()
        observed, receipt = _run_queue_command(previous, successor, mode='snapshot')
    else:
        if result_path.exists() or result_path.is_symlink():
            raise ValueError('predecessor-queue-pause-result-without-intent')
        capture_predecessor_queue_snapshot(previous, successor)
        dispatch, receipt = _run_queue_command(previous, successor, mode='pause')
        if checksum(dispatch) != checksum(_paused_queues(receipt)):
            raise ValueError('predecessor-queue-pause-unresolved')
        observed, readback = _run_queue_command(previous, successor, mode='snapshot')
        if readback != receipt:
            raise ValueError('predecessor-queue-runtime-changed')
    intent = _pause_intent(receipt)
    if (private_json(directory / 'predecessor-queues.json') != receipt
            or private_json(intent_path) != intent
            or checksum(observed) != intent['expectedPausedSha256']):
        raise ValueError('predecessor-queue-pause-unresolved')
    result = {'intentSha256': checksum(intent),
              'pausedManifestSha256': checksum(observed)}
    successor.verify_fence()
    if result_path.exists() or result_path.is_symlink():
        if private_json(result_path) != result:
            raise ValueError('predecessor-queue-pause-result-changed')
    else:
        atomic_json(result_path, result)


def observe_predecessor_queue_drain(
    previous: HostOperations, successor: HostOperations,
    *, web_stopped: bool = False,
) -> bool:
    """Read whether paused queues and both execution classes have drained."""
    observed, receipt = _run_queue_command(
        previous, successor, mode='drained-all', web_stopped=web_stopped,
    )
    paused = _paused_queues(receipt)
    if (set(observed) != {*paused, 'activeJobs', 'executions', 'drained'}
            or checksum({key: observed[key] for key in paused}) != checksum(paused)):
        raise ValueError('predecessor-queue-drain-inventory-changed')
    execution = record(observed['executions'], 'predecessor execution counts')
    if set(execution) != {'inspected', 'settled', 'workerActive', 'synchronousActive'}:
        raise ValueError('predecessor-queue-drain-result-invalid')
    jobs = observed['activeJobs']
    inspected, settled = execution['inspected'], execution['settled']
    workers, synchronous = execution['workerActive'], execution['synchronousActive']
    if (type(jobs) is not int or jobs < 0
            or type(inspected) is not int or inspected < 0
            or type(settled) is not int or settled < 0
            or type(workers) is not int or workers < 0
            or type(synchronous) is not int or synchronous < 0
            or inspected != settled + workers + synchronous):
        raise ValueError('predecessor-queue-drain-result-invalid')
    drained = jobs == 0 and workers == 0 and synchronous == 0
    if observed['drained'] is not drained:
        raise ValueError('predecessor-queue-drain-result-invalid')
    path = successor.attempt.directory / 'predecessor-queues.json'
    if private_json(path) != receipt:
        raise ValueError('exact-retained-predecessor-queue-snapshot-required')
    return drained
