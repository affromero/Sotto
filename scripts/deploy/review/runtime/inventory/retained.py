"""Bind the fenced predecessor's retained Redis and worksheet evidence."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.runtime.inventory.queue_snapshot import _original_queues
from scripts.deploy.review.state import atomic_json, checksum, private_json, runtime_only_successor
from scripts.deploy.review.topology import rows

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations


def observe_retained_inventory(
    previous: HostOperations, successor: HostOperations,
) -> dict[str, object]:
    """Recheck the same stopped runtime inventory without mutating Redis."""
    from scripts.deploy.review.runtime.controller import admitted_file

    attempt = successor.attempt
    evidence = admitted_file(attempt, 'evidence.json', attempt.evidence_hash)
    jobs = rows(evidence['jobs'], 'retained worksheet jobs')
    if (len(jobs) != 3 or len({job['id'] for job in jobs}) != 3
            or any(job.get('delivered') is not True for job in jobs)):
        raise ValueError('exact-delivered-worksheet-evidence-required')
    queue_manifest = _original_queues(successor, allow_unresolved=True)
    queues = [item['name'] for item in rows(queue_manifest['queues'], 'original review queues')]
    failure = successor.manifest.get('retainedAssessmentFailure')
    if 'retainedAssessmentFailure' in successor.manifest and (
        not runtime_only_successor(successor.manifest) or not isinstance(failure, str)
        or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', failure)
    ):
        raise ValueError('exact-retained-assessment-failure-required')
    result = record(successor.runtime_exchange(
        'retained-single-client', {'evidence': evidence, 'queues': queues,
                                   **({'assessmentFailure': failure} if failure else {})},
        predecessor=previous,
    ), 'retained review inventory')
    if set(result) != {'server', 'fingerprint', 'jobsFingerprint',
                       'keys', 'queues', 'completed', 'failed'}:
        raise ValueError('exact-retained-review-inventory-required')
    for key in ('server', 'fingerprint', 'jobsFingerprint'):
        digest(result[key], key)
    if (any(type(result[key]) is not int for key in ('keys', 'queues', 'completed', 'failed'))
            or result['queues'] != len(queues)
            or result['failed'] != len(jobs) + int(failure is not None)):
        raise ValueError('retained-review-inventory-counts-changed')
    successor.verify_fence()
    receipt = {
        'predecessorManifestSha256': previous.attempt.manifest_hash,
        'predecessorEvidenceSha256': previous.attempt.evidence_hash,
        'successorManifestSha256': attempt.manifest_hash,
        'successorEvidenceSha256': attempt.evidence_hash,
        'originalQueuesSha256': checksum(queue_manifest),
        'observation': result,
    }
    path = attempt.directory / 'retained-redis.json'
    if path.exists() or path.is_symlink():
        if private_json(path) != receipt:
            raise ValueError('retained-review-inventory-changed')
    else:
        atomic_json(path, receipt)
    return result
