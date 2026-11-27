"""Admission for the App Review successor and its retained predecessor."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import sys
from collections.abc import Callable
from pathlib import Path
from typing import TYPE_CHECKING, Literal, cast

from scripts.deploy.images.metadata import digest, positive_integer, record
from scripts.deploy.images.probe import probe_source
from scripts.deploy.review.build_observer import bounded_bytes
from scripts.deploy.review.runtime import services
from scripts.deploy.review.runtime.inventory.backup import predecessor_backup_binding
from scripts.deploy.review.runtime.inventory.environment import (
    admit_successor_environment,
    observe_predecessor_environment,
    retained_inventory_network,
)
from scripts.deploy.review.runtime.inventory.network import verify_retained_network
from scripts.deploy.review.runtime.inventory.predecessor import bind_predecessor
from scripts.deploy.review.runtime.inventory.quiescence import quiesce_predecessor
from scripts.deploy.review.runtime.inventory.retained import observe_retained_inventory
from scripts.deploy.review.runtime.inventory.storage import verify_running_completed_storage
from scripts.deploy.review.runtime.policy import (
    helper_arguments,
    helper_memory,
    retain_queue_intent,
    runtime_policy,
    successor_queue_policy_names,
)
from scripts.deploy.review.runtime.release import (
    retained_predecessor_startup,
    verify_completed_records,
    verify_retention_begin,
    verify_startup_unit,
)
from scripts.deploy.review.runtime.release.fixture import (
    admitted_review_seed,
    prepare_review_seed,
    review_seed_intent,
)
from scripts.deploy.review.runtime.release.migrations import (
    admit_successor_migration,
    inspect_successor_worker_migrations,
    migration_inventory,
    read_applied_migrations,
    stage_progress,
)
from scripts.deploy.review.topology import (
    DIRECTORY,
    PRESERVED_ENVIRONMENT,
    PROJECT,
    candidate_compose,
    rows,
)
from scripts.deploy.review.state import atomic_json, checksum, private_json

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations


WORKLOAD_PREFLIGHT = r'''
const assert = require('node:assert/strict');
const {Client} = require('pg');
const {profiles,seed} = JSON.parse(require('node:fs').readFileSync(0));
const database = new Client({connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000, query_timeout: 5000});
(async () => {
 await database.connect();
 try {
  await database.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await database.query("SET LOCAL statement_timeout='5000ms'");
  assert.equal((await database.query('SHOW transaction_read_only')).rows[0].transaction_read_only,'on');
  let active = 0, seedProfiles = 0;
  for (const profile of profiles) {
   const courses = (await database.query(
     'SELECT id, "nativeLang", "targetLang" FROM "Course" WHERE "userId"=$1 LIMIT 1001',
     [profile.id])).rows;
   assert(courses.length <= 1000);
   assert.deepEqual(courses.map(row => row.id).sort(), [...profile.existingCourseIds].sort());
   if (profile.fixture === null) continue;
   const {native, target, curriculumId} = profile.fixture;
   assert(!courses.some(row => row.nativeLang === native && row.targetLang === target));
   const curricula = (await database.query(
     'SELECT id, source FROM "Curriculum" WHERE "nativeLang"=$1 AND "targetLang"=$2',
     [native, target])).rows;
   if(seed&&native===seed.nativeLang&&target===seed.targetLang){
    assert.equal(curriculumId,seed.curriculumId);
    assert.deepEqual(curricula,[]);
    seedProfiles++;
   }else assert.deepEqual(curricula,[{id:curriculumId,source:'seeded'}]);
   active++;
  }
  assert.equal(seedProfiles,seed?1:0);
  if(seed){
   const {rows}=await database.query(
    'SELECT EXISTS (SELECT 1 FROM "Curriculum" WHERE id=$1) OR EXISTS (SELECT 1 FROM "LearningMapRevision" WHERE "targetLang"=$2) OR EXISTS (SELECT 1 FROM "LearningNodeIdentity" WHERE "targetLang"=$2) AS occupied',
    [seed.curriculumId,seed.targetLang]);
   assert.deepEqual(rows,[{occupied:false}]);
  }
  console.log(JSON.stringify({profiles:profiles.length,active}));
 } finally {
  await database.query('ROLLBACK');
  await database.end();
 }
})().catch(() => { console.error('Admitted review workload unavailable'); process.exitCode = 1; });
'''


def preflight_successor(
    operations: HostOperations, *, recover: bool = False,
) -> tuple[HostOperations, dict[str, object], dict[str, object]]:
    """Admit exact running and candidate releases before installing a fence."""
    from scripts.deploy.review.runtime.operations import CADDY, CADDY_ROOT, HOST_STATE

    operations.lock.validate()
    endpoint = os.environ.get('DOCKER_HOST') or operations.docker(
        'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}',
    ).decode().strip()
    if (endpoint not in {'unix:///var/run/docker.sock', 'unix:///run/docker.sock'}
            or not sys.platform.startswith('linux')):
        raise ValueError('local-linux-docker-daemon-required')
    operations.verify_tools()
    attempt = operations.attempt
    state = attempt.state()
    if state['phase'] != 'PRECHECK' or (
        state['status'] != 'active' and not recover
    ):
        raise ValueError('active-successor-precheck-required')
    if operations.manifest != attempt.manifest():
        raise ValueError('successor-precheck-manifest-changed')
    for marker in (
        HOST_STATE / 'unresolved.json',
        HOST_STATE.parent / 'sotto-deploy' / 'unresolved.json',
    ):
        if marker.exists() or marker.is_symlink():
            raise ValueError('existing-unresolved-deployment')
    previous = bind_predecessor(operations)
    if operations.manifest['topology'] != previous.manifest['topology']:
        raise ValueError('successor-physical-topology-changed')
    verify_live_predecessor(previous, operations)
    files = record(operations.manifest['originalFiles'], 'successor original files')
    for name, path in (
        ('compose', Path(DIRECTORY) / 'compose.yml'),
        ('caddyFragment', CADDY),
        ('caddyRoot', CADDY_ROOT),
    ):
        if hashlib.sha256(bounded_bytes(path)).hexdigest() != digest(files[name], name):
            raise ValueError('successor-precheck-configuration-changed')
    retained_predecessor_startup(operations)
    values, _ = observe_predecessor_environment(previous)
    successor_compose_document(operations, values)
    operations.verify_images()
    operations.successor_helper_capacity(previous=previous)
    verify_successor_workload(previous, operations)
    verify_successor_runtime_identity(operations)
    initial, final = admit_successor_migration(
        previous.manifest, operations.manifest,
        observed=inspect_successor_worker_migrations(operations),
    )
    verify_retention_begin(operations)
    operations.lock.validate()
    return previous, initial, final


def verify_live_predecessor(previous: HostOperations, successor: HostOperations) -> None:
    """Verify the current release using its actual writers and retained mount roots."""
    previous.verify_tools()
    previous.verify_images(require_imports=False, final_only=True)
    routing = record(successor.attempt.manifest()['originalFiles'], 'admitted routing')
    verify_completed_records(
        previous, active_fragment_sha256=digest(routing['caddyFragment'], 'live Caddy fragment'),
        successor=successor,
    )
    verify_startup_unit(previous)
    verify_running_completed_storage(previous, successor)
    services.wait_health(previous, public=True)


def verify_successor_workload(previous: HostOperations, operations: HostOperations) -> None:
    """Prove the candidate fixture is available before fencing the review site."""
    from scripts.deploy.review.runtime.controller import admitted_workload_inputs

    _, workload, active = admitted_workload_inputs(services.private_inputs(operations))
    profiles = [
        {name: profile[name] for name in ('id', 'existingCourseIds', 'fixture')}
        for profile in rows(workload['profiles'], 'review workload profiles')
    ]
    identity = services.verify_candidate(previous, 'workers')
    data = operations.command(
        ['docker', 'exec', '-i', '-w', '/app/apps/web', identity,
         'node', *helper_arguments(operations.manifest, 'node', ['-e', WORKLOAD_PREFLIGHT])],
        content=json.dumps({'profiles': profiles, 'seed': admitted_review_seed(operations)}).encode(),
        timeout=25,
    )
    if json.loads(data) != {'profiles': 2, 'active': active}:
        raise ValueError('admitted-successor-workload-not-verified')
    if services.verify_candidate(previous, 'workers') != identity:
        raise ValueError('successor-workload-predecessor-changed')


def verify_successor_runtime_identity(operations: HostOperations) -> None:
    """Verify both candidate images can own the shared runtime files."""
    manifest = operations.attempt.manifest()
    expected = {'uid': manifest['runtimeUid'], 'gid': manifest['runtimeGid']}
    if expected != {'uid': 1000, 'gid': 1000}:
        raise ValueError('successor-runtime-ownership-not-admitted')
    source = 'console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid()}))'
    for role in ('finalWeb', 'finalWorker'):
        image = record(manifest[role], 'candidate image')
        identity = digest(image['imageId'], 'candidate image identity', 'sha256:')
        if json.loads(probe_source(
            identity, source, 'successor runtime UID',
            memory_bytes=helper_memory(manifest), review_attempt=operations.attempt.manifest_hash,
        )) != expected:
            raise ValueError('actual-final-runtime-ownership-changed')
    _adopt_receipt(operations.attempt.directory / 'runtime-ownership.json', expected)


def prepare_successor_data(
    previous: HostOperations, operations: HostOperations, *,
    recover: bool,
    continue_check: Callable[[], None],
) -> None:
    """Preserve the stopped predecessor before allowing a schema transition."""
    attempt = operations.attempt
    continue_check()
    operations.verify_fence()
    state = attempt.state()
    phase = state['phase']
    if phase not in ('FENCED', 'QUIESCENT', 'BACKED_UP'):
        raise ValueError('successor-backup-phase-invalid')
    if state['status'] != 'active' and not recover:
        raise ValueError('explicit-same-attempt-recovery-required')
    if phase == 'FENCED':
        if state['status'] == 'unresolved':
            operations.settle_pending_helpers()
            operations.verify_fence()
            atomic_json(attempt.directory / 'state.json', {**state, 'status': 'active'})
        quiesce_predecessor(previous, operations, continue_check=continue_check)
        continue_check()
        observe_retained_inventory(previous, operations)
        services.backup_review(operations, predecessor=previous)
        continue_check()
        observe_retained_inventory(previous, operations)
        attempt.advance('QUIESCENT')
        phase = 'QUIESCENT'
    continue_check()
    operations.verify_fence()
    services.verify_backups(
        operations, binding=predecessor_backup_binding(previous, operations),
    )
    if phase == 'QUIESCENT':
        attempt.advance('BACKED_UP')


def migrate_successor_data(
    previous: HostOperations, operations: HostOperations, *,
    recover: bool,
    continue_check: Callable[[], None],
) -> None:
    """Allow SQL only after backup, idle database and image inventory agree."""
    attempt = operations.attempt
    continue_check()
    operations.verify_fence()
    state = attempt.state()
    phase = state['phase']
    if phase not in ('BACKED_UP', 'SQL_STARTED', 'FINAL_SCHEMA_VERIFIED'):
        raise ValueError('successor-migration-phase-invalid')
    if state['status'] != 'active' and not recover:
        raise ValueError('explicit-same-attempt-recovery-required')
    services.verify_backups(
        operations, binding=predecessor_backup_binding(previous, operations),
    )
    operations.verify_images()
    initial, final = admit_successor_migration(
        previous.attempt.manifest(), attempt.manifest(),
        observed=inspect_successor_worker_migrations(operations),
    )
    continue_check()
    observe_retained_inventory(previous, operations)
    original = migration_inventory(initial)
    candidate = migration_inventory(final)
    applied = read_applied_migrations(operations, predecessor=previous)
    if phase == 'FINAL_SCHEMA_VERIFIED':
        if applied != candidate:
            raise ValueError('successor-final-schema-changed')
        if not (attempt.directory / 'review-seed-intent.json').exists():
            verify_successor_data(previous, operations, phase='FINAL_SCHEMA_VERIFIED')
        return
    continue_check()
    operations.verify_fence()
    if phase == 'BACKED_UP':
        if applied != original:
            raise ValueError('successor-initial-schema-changed')
        verify_successor_data(previous, operations, phase='BACKED_UP')
    elif not stage_progress(applied, original, candidate):
        raise ValueError('actual-sql-is-not-an-admitted-stage-prefix')
    operations.capacity()
    if phase == 'BACKED_UP':
        attempt.advance('SQL_STARTED')
    elif state['status'] == 'unresolved':
        atomic_json(attempt.directory / 'state.json', {**state, 'status': 'active'})
    continue_check()
    operations.verify_fence()
    operations.migrate_stage(final, initial, predecessor=previous)
    continue_check()
    observe_retained_inventory(previous, operations)
    verify_successor_data(previous, operations, phase='SQL_STARTED')
    continue_check()
    attempt.advance('FINAL_SCHEMA_VERIFIED')


def successor_preservation_input(operations: HostOperations) -> tuple[bytes, dict[str, object]]:
    from scripts.deploy.review.runtime.controller import admitted_file

    retained = admitted_file(
        operations.attempt, 'original-data.json', operations.manifest['originalDataSha256'],
    )
    selected = [
        {'table': item['table'], 'columns': item['columns']}
        for item in rows(retained['tables'], 'original table')
    ]
    return json.dumps(selected).encode(), retained


def verify_successor_data(
    previous: HostOperations, operations: HostOperations, *,
    phase: Literal['BACKED_UP', 'SQL_STARTED', 'FINAL_SCHEMA_VERIFIED'],
) -> None:
    """Compare admitted predecessor row projections across the additive SQL."""
    operations.verify_fence()
    content, expected = successor_preservation_input(operations)
    worker = record(operations.attempt.manifest()['finalWorker'], 'successor worker')
    result = record(json.loads(operations.image_command(
        worker, 'node', ['-e', services.PRESERVATION_OBSERVER], content=content,
        network=retained_inventory_network(previous, operations, phase=phase),
        predecessor=previous, predecessor_tool='migration',
    )), 'protected data observation')
    if result != expected:
        raise ValueError('original-review-data-changed')
    operations.verify_fence()


def prepare_successor_queue_policy(
    previous: HostOperations, operations: HostOperations, *, recover: bool,
) -> None:
    """Bind both generations' policy while the new candidate is still stopped."""
    operations.verify_fence()
    state = operations.attempt.state()
    if state['phase'] != 'FINAL_SCHEMA_VERIFIED':
        raise ValueError('successor-queue-policy-phase-invalid')
    if state['status'] != 'active' and not recover:
        raise ValueError('explicit-same-attempt-recovery-required')
    prior, _ = successor_queue_policy_names(operations)
    original = record(operations.attempt.manifest()['originalQueues'], 'original queues')
    path = operations.attempt.directory / 'queue-policy-intent.json'
    retained = private_json(path) if path.exists() or path.is_symlink() else None
    if retained is not None:
        retain_queue_intent(operations, retained)
    else:
        observe_retained_inventory(previous, operations)
    if state['status'] == 'unresolved':
        operations.settle_pending_helpers()
        verify_retained_network(previous, operations, phase='FINAL_SCHEMA_VERIFIED')
        atomic_json(operations.attempt.directory / 'state.json', {**state, 'status': 'active'})
    result = operations.runtime_exchange('prepare-successor-queue-policy', {
        'previousQueues': prior,
        'connectionIdentity': original['connectionIdentity'],
        'policyIntent': retained,
    }, predecessor=previous)
    if private_json(path) != result:
        raise ValueError('successor-queue-policy-result-changed')
    retain_queue_intent(operations, record(result, 'successor queue policy'))
    operations.verify_fence()
    atomic_json(operations.attempt.directory / 'successor-queue-policy-verified.json', {
        'manifestSha256': operations.attempt.manifest_hash,
        'policyIntentSha256': checksum(result),
    })


def prepare_successor_compose(
    previous: HostOperations, operations: HostOperations,
) -> dict[str, object]:
    operations.verify_fence()
    attempt = operations.attempt
    if attempt.state()['phase'] != 'FINAL_SCHEMA_VERIFIED':
        raise ValueError('successor-compose-phase-invalid')
    verify_retained_network(previous, operations, phase='FINAL_SCHEMA_VERIFIED')
    values, _ = admit_successor_environment(previous, operations, phase='FINAL_SCHEMA_VERIFIED')
    document = successor_compose_document(operations, values)
    path = attempt.directory / 'candidate-compose.json'
    encoded = json.dumps(document, sort_keys=True).encode()
    if path.exists() or path.is_symlink():
        if bounded_bytes(path, private=True) != encoded:
            raise ValueError('successor-compose-content-changed')
    else:
        operations.private_file(path, encoded)
    receipt = attempt.directory / 'successor-compose-verified.json'
    _adopt_receipt(receipt, _compose_binding(operations, encoded))
    operations.verify_fence()
    return document


def successor_compose_document(
    operations: HostOperations, values: dict[str, str],
) -> dict[str, object]:
    attempt = operations.attempt
    manifest = attempt.manifest()
    web = record(manifest['finalWeb'], 'candidate web')
    workers = record(manifest['finalWorker'], 'candidate worker')
    if web['sha'] != workers['sha']:
        raise ValueError('one-admitted-final-source-required')
    resources = record(manifest['resources'], 'candidate resources')
    document = candidate_compose(
        attempt_id=attempt.directory.name,
        web_reference=str(web['reference']),
        worker_reference=str(workers['reference']),
        final_source=str(web['sha']),
        original_environment={name: value for name, value in values.items()
                              if name in PRESERVED_ENVIRONMENT},
        original_image_environment={},
        auth_source=DIRECTORY + '/auth/codex',
        runtime_uid=positive_integer(manifest['runtimeUid'], 'candidate runtime UID'),
        runtime_gid=positive_integer(manifest['runtimeGid'], 'candidate runtime GID'),
        web_memory=positive_integer(resources['webMemoryBytes'], 'candidate web memory'),
        worker_memory=positive_integer(resources['workerMemoryBytes'], 'candidate worker memory'),
        egress_network=PROJECT + '_egress',
        runtime_policy=runtime_policy(manifest),
        isolate_project=True,
    )
    for service in record(document['services'], 'candidate services').values():
        record(service, 'candidate service')['labels'] = {
            'io.sotto.review-attempt': attempt.manifest_hash,
        }
    return document


def _compose_binding(operations: HostOperations, encoded: bytes) -> dict[str, object]:
    attempt = operations.attempt
    predecessor = record(attempt.manifest()['predecessor'], 'compose predecessor')
    return {
        'manifestSha256': attempt.manifest_hash,
        'predecessorManifestSha256': predecessor['manifestSha256'],
        'composeSha256': hashlib.sha256(encoded).hexdigest(),
    }


def read_successor_compose(operations: HostOperations) -> dict[str, object]:
    attempt = operations.attempt
    path = attempt.directory / 'candidate-compose.json'
    encoded = bounded_bytes(path, private=True)
    proof = private_json(attempt.directory / 'successor-compose-verified.json')
    document = private_json(path)
    if (json.dumps(document, sort_keys=True).encode() != encoded
            or proof != _compose_binding(operations, encoded)):
        raise ValueError('successor-compose-receipt-changed')
    return document


def successor_compose_input(document: dict[str, object]) -> bytes:
    """Escape Compose interpolation without altering the admitted environment."""
    services = record(document['services'], 'candidate services')
    escaped = {}
    for role, item in services.items():
        service = record(item, 'candidate service')
        environment = record(service['environment'], 'candidate environment')
        if any(not isinstance(value, str) for value in environment.values()):
            raise ValueError('invalid-candidate-environment-value')
        escaped[role] = {
            **service, 'environment': {
                name: str(value).replace('$', '$$') for name, value in environment.items()
            },
        }
    return json.dumps({**document, 'services': escaped}, sort_keys=True).encode()


def prepare_successor_activation(
    previous: HostOperations, operations: HostOperations, *,
    recover: bool,
    continue_check: Callable[[], None],
) -> None:
    """Prepare the sealed candidate and adopt the established auth and guard."""
    continue_check()
    prepare_successor_compose(previous, operations)
    prepare_review_seed(previous, operations, recover=recover)
    continue_check()
    verify_retained_network(previous, operations, phase='FINAL_SCHEMA_VERIFIED')
    previous.verify_egress()
    attempt = operations.attempt
    directory = attempt.directory
    old = previous.attempt.directory
    guard = private_json(old / 'egress.json')
    _adopt_receipt(directory / 'egress.json', guard)
    operations.verify_egress()
    auth = private_json(old / 'auth-handover.json')
    home = Path(DIRECTORY) / 'auth/codex'
    metadata = home.lstat()
    manifest = attempt.manifest()
    if (auth.get('home') != str(home)
            or auth.get('identity') != [metadata.st_dev, metadata.st_ino]
            or not stat.S_ISDIR(metadata.st_mode)
            or stat.S_IMODE(metadata.st_mode) != 0o700
            or metadata.st_uid != manifest['runtimeUid']
            or metadata.st_gid != manifest['runtimeGid']):
        raise ValueError('successor-shared-codex-home-changed')
    services.private_inputs(operations)
    _adopt_receipt(directory / 'auth-handover.json', {
        **auth, 'inputsSha256': manifest['inputsSha256'],
    })
    services.handover_auth(operations)
    operations.verify_storage()
    continue_check()
    prepare_successor_queue_policy(previous, operations, recover=recover)
    continue_check()
    operations.verify_fence()
    attempt.advance('EGRESS_GUARDED')


INHERITED_PROVIDER_CHECKPOINT = 'inherited-provider-checkpoint.json'
PROVIDER_CHECKPOINT = 'provider-checkpoint.json'


def verify_complete_provider_checkpoint(
    checkpoint: dict[str, object], readiness: dict[str, object],
) -> None:
    credentials = rows(checkpoint.get('credentials'), 'retained credentials')
    profiles = rows(readiness['profiles'], 'admitted readiness profiles')
    expected = {(profile['id'], endpoint) for profile in profiles
                for endpoint in ('ai-keys', 'byok')}
    operation_ids: set[str] = set()
    targets: set[tuple[str, str]] = set()
    for item in credentials:
        command = record(item.get('command'), 'retained credential command')
        identity, profile, endpoint = (
            command.get('operationId'), item.get('profileId'), item.get('endpoint'),
        )
        if (not isinstance(identity, str) or not identity
                or not isinstance(profile, str) or not isinstance(endpoint, str)
                or command.get('provider') != readiness['speechProvider']
                or command.get('expectedRevision') is not None):
            raise ValueError('invalid-retained-provider-command')
        operation_ids.add(identity)
        targets.add((profile, endpoint))
    if (set(checkpoint) != {'credentials', 'modelChangePrepared'}
            or checkpoint['modelChangePrepared'] is not True
            or len(expected) != 4 or len(credentials) != 4
            or len(operation_ids) != 4 or targets != expected):
        raise ValueError('complete-retained-provider-checkpoint-required')


def inherited_provider_checkpoint(
    operations: HostOperations, readiness: dict[str, object],
) -> dict[str, object]:
    """Read an established provider checkpoint without attributing its writes anew."""
    previous = bind_predecessor(operations)
    if services.private_inputs(previous)['readiness'] != readiness:
        raise ValueError('retained-provider-readiness-inputs-changed')
    sources = [previous.attempt.directory / name
               for name in (PROVIDER_CHECKPOINT, INHERITED_PROVIDER_CHECKPOINT)]
    existing = [path for path in sources if path.exists() or path.is_symlink()]
    if len(existing) != 1:
        raise ValueError('one-completed-predecessor-provider-checkpoint-required')
    source = existing[0]
    raw = bounded_bytes(source, private=True)
    retained = private_json(source)
    if json.loads(raw) != retained:
        raise ValueError('retained-provider-checkpoint-changed')
    if source.name == INHERITED_PROVIDER_CHECKPOINT:
        if (set(retained) != {'manifestSha256', 'predecessor', 'source', 'sourceSha256', 'checkpoint'}
                or retained.get('manifestSha256') != previous.attempt.manifest_hash
                or retained.get('predecessor') != previous.manifest.get('predecessor')
                or retained.get('source') not in (PROVIDER_CHECKPOINT, INHERITED_PROVIDER_CHECKPOINT)):
            raise ValueError('retained-provider-receipt-attempt-mismatch')
        digest(retained['sourceSha256'], 'previous provider checkpoint')
        checkpoint = record(retained.get('checkpoint'), 'predecessor provider checkpoint')
    else:
        checkpoint = retained
    verify_complete_provider_checkpoint(checkpoint, readiness)
    receipt = {
        'manifestSha256': operations.attempt.manifest_hash,
        'predecessor': operations.manifest['predecessor'],
        'source': source.name,
        'sourceSha256': hashlib.sha256(raw).hexdigest(),
        'checkpoint': checkpoint,
    }
    operations.lock.validate()
    path = operations.attempt.directory / INHERITED_PROVIDER_CHECKPOINT
    if (path.exists() or path.is_symlink()) and private_json(path) != receipt:
        raise ValueError('inherited-provider-checkpoint-changed')
    return receipt


def _adopt_receipt(path: Path, value: dict[str, object]) -> None:
    if path.exists() or path.is_symlink():
        if private_json(path) != value:
            raise ValueError('successor-adopted-receipt-changed')
        return
    atomic_json(path, value)


def verify_successor_candidate_admission(
    operations: HostOperations, role: str,
) -> None:
    operations.verify_fence()
    attempt = operations.attempt
    state = attempt.state()
    if state['phase'] != 'EGRESS_GUARDED' or state['status'] != 'active':
        raise ValueError('successor-candidate-phase-invalid')
    directory = attempt.directory
    intent = private_json(directory / 'queue-policy-intent.json')
    retain_queue_intent(operations, intent)
    if private_json(directory / 'successor-queue-policy-verified.json') != {
        'manifestSha256': attempt.manifest_hash,
        'policyIntentSha256': checksum(intent),
    }:
        raise ValueError('successor-candidate-queue-policy-unverified')
    seed = admitted_review_seed(operations)
    if seed is not None and private_json(directory / 'review-seed-verified.json') != \
            review_seed_intent(operations, seed):
        raise ValueError('successor-candidate-review-seed-unverified')
    if role == 'workers':
        activation = private_json(directory / 'activation.json')
        if (activation.get('workerStartIntent') is not True
                or not (directory / 'initial-inspect.json').exists()):
            raise ValueError('successor-worker-admission-unverified')


def successor_restore_manifest(operations: HostOperations) -> dict[str, object]:
    """Extend the exact predecessor flags to the admitted candidate queues."""
    _, candidate = successor_queue_policy_names(operations)
    original = record(operations.attempt.manifest()['originalQueues'], 'original queues')
    declared = rows(original['queues'], 'original queue')
    identity = digest(original.get('connectionIdentity'), 'queue connection identity')
    if (set(original) != {'schemaVersion', 'connectionIdentity', 'queues'}
            or type(original['schemaVersion']) is not int
            or original['schemaVersion'] != 1
            or any(set(flag) != {'name', 'paused'}
                   or type(flag['paused']) is not bool for flag in declared)):
        raise ValueError('invalid-successor-predecessor-queue-flags')
    pause_flags = {flag['name']: flag['paused'] for flag in declared}
    return {
        'schemaVersion': 1,
        'connectionIdentity': identity,
        'queues': [{'name': name, 'paused': pause_flags.get(name, False)}
                   for name in candidate],
    }


def retain_successor_restore_manifest(
    operations: HostOperations,
) -> dict[str, object]:
    """Bind restoration to the policy acknowledged before candidate activation."""
    verify_successor_candidate_admission(operations, 'web')
    original = successor_restore_manifest(operations)
    flags = rows(original['queues'], 'candidate queue')
    paused = {**original, 'queues': [
        {'name': item['name'], 'paused': True} for item in flags
    ]}
    if operations.runtime_exchange('queues', {'command': 'snapshot'}) != paused:
        raise ValueError('successor-candidate-queue-fence-changed')
    consumers = operations.runtime_exchange('consumers', {
        'address': '172.30.99.11', 'paused': True, 'count': 0,
    })
    if consumers != {
        'consumers': len(flags), 'queuesPaused': True, 'workerAddress': '172.30.99.11',
    }:
        raise ValueError('successor-preactivation-consumers-changed')
    _adopt_receipt(operations.attempt.directory / 'original-queues.json', original)
    return original


def create_bound_candidate(
    operations: HostOperations, document: dict[str, object], compose: Path,
    role: str, *, project: str | None,
) -> None:
    if project is None:
        operations.command(['docker', 'compose', '-f', str(compose), 'create',
                            '--no-build', '--pull', 'never', role])
        return
    operations.verify_storage()
    operations.verify_fence()
    services = record(document['services'], 'successor candidate services')
    if any('depends_on' in record(service, 'successor candidate service')
           for service in services.values()):
        raise ValueError('independent-successor-compose-service-required')
    operations.command(
        ['docker', 'compose', '--project-name', project, '--project-directory',
         str(operations.attempt.directory), '-f', '-', 'create',
         '--no-build', '--pull', 'never', '--no-recreate', role],
        content=successor_compose_input(document),
    )


def reconcile_created_candidates(operations: HostOperations) -> None:
    """Adopt an exact never-started Compose result after a lost create reply."""
    operations.verify_fence()
    operations.verify_egress()
    attempt = operations.attempt
    directory = attempt.directory
    if attempt.state()['phase'] != 'EGRESS_GUARDED':
        raise ValueError('successor-candidate-recovery-phase-invalid')
    document = read_successor_compose(operations)
    encoded = json.dumps(document, sort_keys=True).encode()
    compose_hash = hashlib.sha256(encoded).hexdigest()
    definitions = record(document['services'], 'successor candidate services')
    for role in ('web', 'workers'):
        intent_path = directory / ('candidate-' + role + '-intent.json')
        binding = directory / ('candidate-' + role + '.json')
        if (binding.exists() or binding.is_symlink()
                or not (intent_path.exists() or intent_path.is_symlink())):
            continue
        desired = record(definitions[role], 'successor candidate')
        name = cast(str, desired['container_name'])
        if private_json(intent_path) != {
            'name': name, 'reference': desired['image'], 'composeHash': compose_hash,
        }:
            raise ValueError('unresolved-review-candidate-intent')
        ids = operations.docker(
            'ps', '-aq', '--no-trunc', '--filter', 'name=^/' + name + '$',
        ).decode().split()
        if not ids:
            continue
        if len(ids) != 1:
            raise ValueError('unique-attempt-candidate-required')
        inspected = operations.inspect(ids[0])
        if len(inspected) != 1 or inspected[0].get('Id') != ids[0]:
            raise ValueError('successor-candidate-recovery-identity-changed')
        actual = inspected[0]
        image = record(attempt.manifest()['finalWeb' if role == 'web' else 'finalWorker'],
                       'successor candidate image')
        services.validate_created_candidate(
            operations, actual, desired, image, project=str(document['name']),
        )
        operations.verify_fence()
        atomic_json(binding, operations.writer_binding(actual))
