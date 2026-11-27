"""Bind additive setup for the one independently admitted reviewer workload."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, cast

from scripts.deploy.images.metadata import digest, positive_integer, record
from scripts.deploy.review.runtime.inventory.environment import retained_inventory_network
from scripts.deploy.review.runtime.release.preservation import PRESERVATION_OBSERVER
from scripts.deploy.review.state import atomic_json, checksum, private_json

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations


def admitted_review_seed(operations: HostOperations) -> dict[str, object] | None:
    manifest = operations.attempt.manifest()
    value = manifest.get('reviewFixtureSeed')
    if value is None:
        return None
    if operations.manifest.get('reviewFixtureSeed') != value or 'predecessor' not in manifest:
        raise ValueError('review-seed-admission-changed')
    receipt = record(value, 'admitted review seed')
    if (set(receipt) != {'nativeLang', 'targetLang', 'curriculumId', 'lessons', 'mapped',
                         'unresolved', 'status', 'catalogRevision'}
            or (receipt['nativeLang'], receipt['targetLang'], receipt['curriculumId'])
            != ('en', 'es', 'review-en-es-v1')
            or receipt['status'] != 'PUBLISHED'):
        raise ValueError('exact-admitted-review-seed-required')
    lessons = positive_integer(receipt['lessons'], 'review seed lessons')
    mapped = positive_integer(receipt['mapped'], 'review seed mappings')
    unresolved = receipt['unresolved']
    if (lessons > 1000 or mapped > 10000 or type(unresolved) is not int
            or not 0 <= unresolved <= lessons):
        raise ValueError('bounded-admitted-review-seed-required')
    revision = record(receipt['catalogRevision'], 'review seed catalog revision')
    if set(revision) != {'version', 'hash'}:
        raise ValueError('exact-review-seed-catalog-required')
    positive_integer(revision['version'], 'review seed catalog version')
    digest(revision['hash'], 'review seed catalog hash')
    return receipt


def review_seed_command(receipt: dict[str, object]) -> tuple[str, ...]:
    return (
        '--no-install', 'tsx', '/app/apps/web/prisma/seed-curriculum.ts',
        '--add-missing-pair', f"{receipt['targetLang']}-from-{receipt['nativeLang']}",
        cast(str, receipt['curriculumId']), '--verify-receipt',
    )


def review_seed_payload(seed: dict[str, object]) -> bytes:
    return json.dumps(seed, sort_keys=True, separators=(',', ':')).encode()


def review_seed_projection(
    projection: bytes, seed: dict[str, object], *, after: bool,
) -> bytes:
    return json.dumps({
        'projection': json.loads(projection),
        'seed': {'id': seed['curriculumId'], 'target': seed['targetLang'],
                 'expected': seed if after else None},
    }).encode()


def review_seed_intent(
    operations: HostOperations, seed: dict[str, object],
) -> dict[str, object]:
    attempt = operations.attempt
    return {
        'manifestSha256': attempt.manifest_hash,
        'originalDataSha256': attempt.manifest()['originalDataSha256'],
        'seedSha256': checksum(seed),
    }


def prepare_review_seed(
    previous: HostOperations, operations: HostOperations, *, recover: bool,
) -> None:
    from scripts.deploy.review.runtime.release.successor import successor_preservation_input

    seed = admitted_review_seed(operations)
    if seed is None:
        return
    operations.verify_fence()
    attempt = operations.attempt
    state = attempt.state()
    if (state['phase'] != 'FINAL_SCHEMA_VERIFIED'
            or state['status'] not in ('active', 'unresolved')
            or state['status'] == 'unresolved' and not recover):
        raise ValueError('review-seed-phase-invalid')
    network = retained_inventory_network(previous, operations, phase='FINAL_SCHEMA_VERIFIED')
    worker = record(attempt.manifest()['finalWorker'], 'review seed worker')
    selected, original = successor_preservation_input(operations)

    def observe(*, after: bool) -> None:
        result = operations.image_command(
            worker, 'node', ['-e', PRESERVATION_OBSERVER],
            content=review_seed_projection(selected, seed, after=after),
            network=network, predecessor=previous, predecessor_tool='migration',
        )
        if json.loads(result) != original:
            raise ValueError('review-seed-changed-existing-data')
        operations.verify_fence()

    intent_path = attempt.directory / 'review-seed-intent.json'
    proof = attempt.directory / 'review-seed-verified.json'
    expected_intent = review_seed_intent(operations, seed)
    if intent_path.exists() or intent_path.is_symlink():
        if private_json(intent_path) != expected_intent:
            raise ValueError('review-seed-intent-changed')
    else:
        if proof.exists() or proof.is_symlink():
            raise ValueError('review-seed-intent-required')
        observe(after=False)
        atomic_json(intent_path, expected_intent)
    if proof.exists() or proof.is_symlink():
        if private_json(proof) != expected_intent:
            raise ValueError('review-seed-proof-changed')
        observe(after=True)
        return
    if state['status'] == 'unresolved':
        operations.settle_pending_helpers()
        operations.verify_fence()
        state = attempt.state()
        if state['phase'] != 'FINAL_SCHEMA_VERIFIED' or state['status'] != 'unresolved':
            raise ValueError('review-seed-recovery-state-changed')
        atomic_json(attempt.directory / 'state.json', {**state, 'status': 'active'})
    result = operations.image_command(
        worker, 'npx', review_seed_command(seed), network=network,
        predecessor=previous, predecessor_tool='migration', content=review_seed_payload(seed),
    )
    if json.loads(result) != seed:
        raise ValueError('review-seed-result-differs-from-admission')
    observe(after=True)
    atomic_json(proof, expected_intent)
