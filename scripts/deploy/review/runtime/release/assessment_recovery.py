"""Verify the one admitted local assessment settlement against retained data."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from scripts.deploy.images.metadata import record
from scripts.deploy.review.runtime import services
from scripts.deploy.review.runtime.inventory.environment import retained_inventory_network
from scripts.deploy.review.runtime.inventory.queue_snapshot import approved_assessment_cleanup
from scripts.deploy.review.state import atomic_json, checksum, private_json
from scripts.deploy.review.topology import rows

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations


def preservation_request(
    operations: HostOperations, proof: dict[str, object],
) -> tuple[bytes, dict[str, object]]:
    from scripts.deploy.review.runtime.controller import admitted_file

    original = admitted_file(
        operations.attempt, 'original-data.json', operations.manifest['originalDataSha256'],
    )
    evidence = admitted_file(operations.attempt, 'evidence.json', operations.attempt.evidence_hash)
    projection = [{'table': item['table'], 'columns': item['columns']}
                  for item in rows(original['tables'], 'original table')]
    return json.dumps({
        'projection': projection,
        'assessmentRecovery': {'binding': proof['binding'], 'delivery': proof['delivery'],
                               'namespace': evidence['namespace']},
    }).encode(), original


def verify_change(
    before: dict[str, object], after: dict[str, object], *, settled: bool,
) -> dict[str, object]:
    expected = record(before['assessmentRecovery'], 'original recovery projection')
    actual = record(after['assessmentRecovery'], 'observed recovery projection')
    if actual != {**expected, 'settled': settled, 'receipt': True,
                  'indexesSha256': None if settled else expected['indexesSha256']}:
        raise ValueError('assessment-recovery-data-changed')
    prior = record(before['observation'], 'original data observation')
    current = record(after['observation'], 'current data observation')

    def unchanged_tables(value: dict[str, object]) -> list[dict[str, object]]:
        return [table for table in rows(value['tables'], 'protected data tables')
                if table['table'] != 'SidedoorState']

    if (prior['schemaVersion'] != current['schemaVersion']
            or unchanged_tables(prior) != unchanged_tables(current)):
        raise ValueError('assessment-recovery-protected-data-changed')
    return current


def recover_assessment_data(previous: HostOperations, operations: HostOperations) -> None:
    """Keep all reviewer data unchanged outside the exact terminal SDK transition."""
    attempt = operations.attempt
    input_value = approved_assessment_cleanup(previous, operations)
    proof = record(input_value['proof'], 'assessment recovery proof')
    content, original = preservation_request(operations, proof)
    worker = record(attempt.manifest()['finalWorker'], 'successor worker')
    network = retained_inventory_network(previous, operations)
    prior_path = attempt.directory / 'assessment-recovery-data-before.json'
    result_path = attempt.directory / 'assessment-recovery-data-result.json'
    backup_sha = checksum(private_json(attempt.directory / 'backups.json'))

    def observe() -> dict[str, object]:
        result = operations.image_command(
            worker, 'node', ['-e', services.PRESERVATION_OBSERVER],
            content=content, network=network, predecessor=previous,
            predecessor_tool='assessment-preservation',
        )
        return record(json.loads(result), 'assessment recovery observation')

    current = observe()
    projection = record(current['assessmentRecovery'], 'assessment recovery projection')
    if prior_path.exists() or prior_path.is_symlink():
        before = private_json(prior_path)
    else:
        before = {**current, 'backupSha256': backup_sha}
        if (projection.get('settled') is not False or projection.get('receipt') is not False
                or before.get('observation') != original):
            raise ValueError('assessment-recovery-original-data-changed')
        atomic_json(prior_path, before)
    if (before.get('observation') != original
            or before.get('backupSha256') != backup_sha):
        raise ValueError('assessment-recovery-original-data-changed')
    if projection.get('settled') is not True:
        if result_path.exists() or result_path.is_symlink():
            raise ValueError('assessment-recovery-result-changed')
        if current != {key: value for key, value in before.items() if key != 'backupSha256'}:
            verify_change(before, current, settled=False)
        response = operations.runtime_exchange('assessment-cleanup', input_value, predecessor=previous)
        if response != {'executionId': record(proof['binding'], 'assessment binding')['id']}:
            raise ValueError('assessment-recovery-result-changed')
        current = observe()
    data = verify_change(before, current, settled=True)
    result = {'manifestSha256': attempt.manifest_hash, 'beforeSha256': checksum(before),
              'observation': data}
    if result_path.exists() or result_path.is_symlink():
        if private_json(result_path) != result:
            raise ValueError('assessment-recovery-result-changed')
    else:
        atomic_json(result_path, result)


def retained_assessment_recovery_data(
    operations: HostOperations, original: dict[str, object],
) -> dict[str, object]:
    attempt = operations.attempt
    before = private_json(attempt.directory / 'assessment-recovery-data-before.json')
    result = private_json(attempt.directory / 'assessment-recovery-data-result.json')
    if (before.get('observation') != original
            or before.get('backupSha256') != checksum(private_json(attempt.directory / 'backups.json'))
            or result.get('manifestSha256') != attempt.manifest_hash
            or result.get('beforeSha256') != checksum(before)):
        raise ValueError('assessment-recovery-data-receipt-changed')
    return record(result['observation'], 'post-recovery data')
