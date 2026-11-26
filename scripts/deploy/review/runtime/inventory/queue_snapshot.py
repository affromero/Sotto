"""Capture the exact predecessor queue flags before pausing any queue."""

from __future__ import annotations

import hashlib
import json
import re
from typing import TYPE_CHECKING

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
SNAPSHOT = b'{"command":"snapshot"}\n'
DEADLINE = """
const reviewSnapshotDeadline = setTimeout(() => process.exit(124), 20000);
reviewSnapshotDeadline.unref();
main().catch(() => {
  console.error('Predecessor queue snapshot failed');
  process.exitCode = 1;
});
"""


def capture_predecessor_queue_snapshot(
    previous: HostOperations, successor: HostOperations,
) -> dict[str, object]:
    """Persist original flags after verifying a read-only predecessor snapshot."""
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

    verify_running_predecessor_network(previous, successor)
    _, environment = admit_successor_environment(previous, successor)
    identity = services.verify_candidate(previous, 'workers')
    digest(identity, 'predecessor worker')
    tools = record(previous.attempt.manifest()['tools'], 'predecessor tools')
    source = bounded_bytes(previous.root / TOOL)
    tool_hash = hashlib.sha256(source).hexdigest()
    if len(source) > 65536 or tool_hash != digest(tools.get(TOOL), 'queue helper'):
        raise ValueError('predecessor-queue-tool-changed')

    successor.verify_fence()
    # Node's eval mode does not enter the helper's require.main guard.
    output = successor.command(
        ['docker', 'exec', '-i', '--workdir', '/app/apps/web',
         '--env', 'NODE_OPTIONS=', identity, 'node', '--import', 'tsx',
         '--input-type=commonjs', '--eval', source.decode() + DEADLINE],
        content=SNAPSHOT, timeout=25,
    )
    results = [line.removeprefix(PREFIX) for line in output.splitlines()
               if line.startswith(PREFIX)]
    if len(results) != 1 or len(results[0]) > 65536:
        raise ValueError('unique-bounded-predecessor-queue-snapshot-required')
    observed = record(json.loads(results[0]), 'predecessor queue snapshot')
    if checksum(observed) != checksum(expected):
        raise ValueError('predecessor-queue-snapshot-changed')

    verify_running_predecessor_network(previous, successor)
    _, current_environment = admit_successor_environment(previous, successor)
    if (current_environment != environment
            or services.verify_candidate(previous, 'workers') != identity):
        raise ValueError('predecessor-queue-runtime-changed')
    if successor.attempt.state()['status'] != 'active':
        raise ValueError('active-review-successor-required')
    receipt: dict[str, object] = {
        'predecessorManifestSha256': previous.attempt.manifest_hash,
        'predecessorEvidenceSha256': previous.attempt.evidence_hash,
        'successorManifestSha256': successor.attempt.manifest_hash,
        'successorEvidenceSha256': successor.attempt.evidence_hash,
        'workerId': identity,
        'workerEnvironmentSha256': environment['workerEnvironmentSha256'],
        'queueToolSha256': tool_hash,
        'originalQueues': observed,
    }
    path = successor.attempt.directory / 'predecessor-queues.json'
    successor.verify_fence()
    if path.exists() or path.is_symlink():
        if private_json(path) != receipt:
            raise ValueError('retained-predecessor-queue-snapshot-changed')
    else:
        atomic_json(path, receipt)
    return receipt
