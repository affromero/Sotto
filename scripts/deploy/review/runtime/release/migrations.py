"""Verify canonical schemas and exact admitted migration progression."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import tempfile
from collections.abc import Callable, Mapping, Sequence
from importlib import import_module
from itertools import pairwise
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, TypedDict, cast

from scripts.deploy.images.metadata import digest, record, source_sha
from scripts.deploy.images.probe import probe_source
from scripts.deploy.review.build_observer import TARGET, bounded_bytes
from scripts.deploy.review.runtime.policy import helper_memory
from scripts.deploy.review.state import (
    atomic_json,
    checksum,
    private_directory,
    private_json,
    sync_directory,
)
from scripts.deploy.review.topology import rows

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations

PRISMA_DIFF = (
    'npx', '--no-install', 'prisma', 'migrate', 'diff',
    '--config=/app/prisma.config.ts', '--from-config-datasource',
    '--to-schema', '/app/apps/web/prisma/schema.prisma',
    '--script', '--exit-code',
)
OUTPUT_LIMIT = 65_536
JSON_LIMIT = 262_144
MIGRATION_PROBE = 'scripts/deploy/images/migration-hashes.cjs'
MIGRATION_PROBE_RUNNER = 'scripts/deploy/images/probe.py'
CATALOG_FILES = {
    'binding.json', 'snapshot.raw', 'database-identity.raw',
    'schema-index.raw', 'schema-preparation.json', 'schema-index.json',
}
ACTIVE_FILES = CATALOG_FILES | {
    'prisma-result.json', 'schema-drift.sql', 'schema-drift.stderr',
    'schema-drift-proof.json',
}
APPLIED_MIGRATION_QUERY = '''SELECT json_agg(json_build_object(
'name',migration_name,'checksum',checksum,'finished',finished_at IS NOT NULL,
'rolledBack',rolled_back_at IS NOT NULL))::text FROM "_prisma_migrations"'''
POSTGRES_CLIENT_QUERY = '''
SELECT count(*)::text AS clients FROM pg_stat_activity
WHERE datname=current_database() AND backend_type='client backend'
AND pid<>pg_backend_pid()
'''


def applied_migration_script(*, require_idle: bool) -> str:
    check = (
        'const sessions=await c.query(' + json.dumps(POSTGRES_CLIENT_QUERY) + ');'
        'if(sessions.rows[0].clients!=="0"){'
        'console.error("Unexpected PostgreSQL client");throw Error("Database not idle");}'
    ) if require_idle else ''
    return (
        'const {Client}=require("pg");'
        'const c=new Client({connectionString:process.env.DATABASE_URL,'
        'connectionTimeoutMillis:5000,query_timeout:5000});'
        '(async()=>{await c.connect();try{'
        'await c.query("BEGIN READ ONLY");' + check +
        'const r=await c.query(' + json.dumps(APPLIED_MIGRATION_QUERY) + ');'
        'console.log(r.rows[0].json_agg);'
        '}finally{await c.query("ROLLBACK");await c.end()}})()'
        '.catch(()=>{console.error("Migration inventory unavailable");'
        'process.exitCode=1});'
    )


class DiffResult(TypedDict):
    status: int
    stdout: bytes
    stderr: bytes


def migration_image_command(
    operations: HostOperations, receipt: Mapping[str, object], entrypoint: str,
    arguments: Sequence[str], *, predecessor: HostOperations | None = None,
    content: bytes | None = None, mounts: Sequence[str] = (),
) -> bytes:
    if predecessor is None:
        return operations.image_command(
            receipt, entrypoint, arguments, content=content, mounts=mounts,
        )
    from scripts.deploy.review.runtime.inventory.environment import (
        retained_inventory_network,
    )
    phase = operations.attempt.state()['phase']
    if phase not in ('BACKED_UP', 'SQL_STARTED', 'FINAL_SCHEMA_VERIFIED'):
        raise ValueError('successor-migration-helper-phase-invalid')
    network = retained_inventory_network(predecessor, operations, phase=phase)

    def verify_network() -> None:
        if retained_inventory_network(predecessor, operations, phase=phase) != network:
            raise ValueError('successor-migration-network-changed')

    def before_start() -> None:
        verify_network()
        if entrypoint == 'npx' and operations.attempt.state()['status'] != 'active':
            raise ValueError('successor-schema-write-not-admitted')

    result = operations.image_command(
        receipt, entrypoint, arguments, content=content, mounts=mounts,
        network=network, predecessor=predecessor, predecessor_tool='migration',
        before_start=before_start,
    )
    verify_network()
    return result


def read_applied_migrations(
    operations: HostOperations, *, predecessor: HostOperations | None = None,
) -> dict[str, str]:
    if predecessor is None:
        topology = record(operations.manifest['topology'], 'topology')
        old = record(record(topology['services'], 'services')['web'], 'web')
        receipt = {'reference': old['imageId'], 'sha': TARGET}
    else:
        receipt = record(operations.manifest['finalWorker'], 'successor worker')
    values = json.loads(migration_image_command(
        operations, receipt, 'node',
        ['-e', applied_migration_script(require_idle=predecessor is not None)],
        predecessor=predecessor,
    ))
    result: dict[str, str] = {}
    for migration in rows(values, 'applied migration'):
        name = migration.get('name')
        if (not isinstance(name, str) or name in result
                or migration.get('finished') is not True
                or migration.get('rolledBack') is not False):
            raise ValueError('unfinished-or-ambiguous-migration')
        result[name] = digest(migration.get('checksum'), 'applied SQL')
    return result


def stage_asset_directory(
    operations: HostOperations, receipt: Mapping[str, object],
) -> Path:
    return operations.root / 'review-stage-assets' / source_sha(receipt['sha'])


def establishment_command(
    operations: HostOperations, stage: Mapping[str, object], *,
    successor: bool,
) -> tuple[list[str], tuple[str, ...]]:
    receipt = record(stage['receipt'], 'stage image')
    helper = (stage_asset_directory(operations, receipt) if successor else
              operations.root / 'review-stage-assets' / cast(str, receipt['sha']))
    source = bounded_bytes(helper / 'queue-lifecycle.cjs')
    if hashlib.sha256(source).hexdigest() != stage['lifecycleSha256']:
        raise ValueError('stage-matched-helper-changed')
    if successor:
        return ['--require', 'tsx/cjs', '-e', canonical_loader(source)], ()
    return (['--require', 'tsx/cjs', '/review-stage/queue-lifecycle.cjs'],
            (f'type=bind,src={helper},dst=/review-stage,readonly',))


def child_transport(
    arguments: Sequence[str], *, timeout_ms: int = 780_000,
    output_limit: int = OUTPUT_LIMIT,
) -> str:
    """Return one bounded envelope after the exact shell-free child closes."""
    return r'''
const {spawn} = require('node:child_process');
const argv = ''' + json.dumps(list(arguments)) + r''';
const limit = ''' + str(output_limit) + r''';
const streams = {stdout: [], stderr: []};
const sizes = {stdout: 0, stderr: 0};
let failure = null, child, timer;
function emit(status) {
  clearTimeout(timer);
  process.stdout.write(JSON.stringify({status, failure,
    stdout: Buffer.concat(streams.stdout).toString('base64'),
    stderr: Buffer.concat(streams.stderr).toString('base64')}));
}
function stop(reason) {
  failure ??= reason;
  if (child.pid) {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { child.kill('SIGKILL'); }
  }
}
try {
  child = spawn(argv[0], argv.slice(1), {
    shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, DIRECT_DATABASE_URL: process.env.DATABASE_URL}
  });
  for (const name of ['stdout', 'stderr']) {
    child[name].on('data', chunk => {
      const remaining = limit - sizes[name];
      streams[name].push(chunk.subarray(0, Math.max(0, remaining)));
      sizes[name] += Math.min(chunk.length, Math.max(0, remaining));
      if (chunk.length > remaining) stop('output-bound');
    });
  }
  child.on('error', () => { failure ??= 'spawn'; });
  child.on('close', (status, signal) => {
    if (signal) failure ??= 'signal';
    emit(status);
  });
  timer = setTimeout(() => stop('timeout'), ''' + str(timeout_ms) + r''');
} catch {
  failure = 'spawn'; emit(null);
}
'''


def strict_json(content: bytes) -> dict[str, object]:
    def unique(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate-verification-json-field')
            result[key] = value
        return result

    def invalid(value: str) -> object:
        raise ValueError('nonfinite-verification-json-' + value)

    if len(content) > JSON_LIMIT:
        raise ValueError('verification-json-output-bound')
    return record(json.loads(content, object_pairs_hook=unique,
                             parse_constant=invalid), 'verification JSON')


def diff_result(content: bytes) -> DiffResult:
    value = strict_json(content)
    if set(value) != {'status', 'failure', 'stdout', 'stderr'}:
        raise ValueError('exact-prisma-transport-envelope-required')
    buffers: dict[str, bytes] = {}
    for name in ('stdout', 'stderr'):
        encoded = value[name]
        if not isinstance(encoded, str) or len(encoded) > JSON_LIMIT:
            raise ValueError('canonical-prisma-base64-required')
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error) as error:
            raise ValueError('canonical-prisma-base64-required') from error
        if (base64.b64encode(raw).decode() != encoded
                or len(raw) > OUTPUT_LIMIT):
            raise ValueError('canonical-bounded-prisma-base64-required')
        buffers[name] = raw
    status = value['status']
    if (value['failure'] is not None or type(status) is not int
            or status not in (0, 2)):
        raise ValueError('prisma-child-comparison-failed')
    return {'status': status, 'stdout': buffers['stdout'],
            'stderr': buffers['stderr']}


def canonical_loader(source: bytes) -> str:
    """Compile source-bound maintenance code without consuming request stdin."""
    encoded = base64.b64encode(source).decode()
    return (
        'const M=require("node:module"),m=new M('
        '"/app/apps/web/review-verification.cjs");'
        'm.filename=m.id;m.paths=M._nodeModulePaths("/app/apps/web");'
        'm._compile(Buffer.from(' + json.dumps(encoded)
        + ',"base64").toString("utf8"),m.id);'
        'm.exports.main().catch(()=>{console.error('
        '"Canonical catalog helper failed");process.exitCode=1});'
    )


def framed_report(content: bytes) -> dict[str, object]:
    if len(content) > JSON_LIMIT:
        raise ValueError('catalog-output-bound')
    prefix = b'SOTTO_DEPLOY_QUEUE='
    reports = [line[len(prefix):] for line in content.splitlines()
               if line.startswith(prefix)]
    if len(reports) != 1:
        raise ValueError('unique-canonical-catalog-report-required')
    result = strict_json(reports[0])
    if (type(result.get('schemaVersion')) is not int
            or result['schemaVersion'] != 1):
        raise ValueError('canonical-catalog-report-version-required')
    digest(result.get('connectionIdentity'), 'catalog connection')
    return result


def measured_identity(value: object) -> dict[str, object]:
    identity = record(value, 'measured database identity')
    strings = {'databaseName', 'databaseOid', 'schemaName', 'serverAddress'}
    if (set(identity) != strings | {'serverPort'}
            or any(not isinstance(identity[key], str) or not identity[key]
                   for key in strings)
            or type(identity['serverPort']) is not int
            or not 1 <= identity['serverPort'] <= 65_535):
        raise ValueError('strict-five-field-database-identity-required')
    return identity


def catalog_preparation(
    operations: HostOperations, reports: Mapping[str, Mapping[str, object]],
) -> dict[str, object]:
    from scripts.deploy.review.runtime.controller import admitted_file

    snapshot = reports['snapshot']
    identity, index = reports['database-identity'], reports['schema-index']
    base = {'schemaVersion', 'connectionIdentity'}
    if (set(snapshot) != base | {'queues'}
            or set(identity) != base | {'databaseIdentity'}
            or set(index) != base | {'indexProof'}):
        raise ValueError('exact-readonly-catalog-report-required')
    queues = rows(snapshot['queues'], 'catalog snapshot queue')
    names: set[str] = set()
    for queue in queues:
        name = queue.get('name')
        if (set(queue) != {'name', 'paused'} or not isinstance(name, str)
                or not name or name in names
                or type(queue['paused']) is not bool):
            raise ValueError('exact-readonly-queue-snapshot-required')
        names.add(name)
    if not 1 <= len(names) <= 100:
        raise ValueError('bounded-readonly-queue-snapshot-required')
    expected = record(operations.manifest['originalQueues'], 'admitted queues')
    connection = digest(expected['connectionIdentity'], 'admitted connection')
    if any(report['connectionIdentity'] != connection
           for report in reports.values()):
        raise ValueError('catalog-database-connection-changed')
    measured = measured_identity(identity['databaseIdentity'])
    attempt = operations.attempt
    evidence = admitted_file(attempt, 'evidence.json', attempt.evidence_hash)
    if checksum(measured, ensure_ascii=False) != digest(
        evidence.get('databaseIdentityHash'), 'admitted database identity',
    ):
        raise ValueError('catalog-database-identity-differs-from-admission')
    return {'applicationConnectionIdentity': connection,
            'databaseIdentity': measured}


def collect_catalog(
    operations: HostOperations, directory: Path, *,
    predecessor: HostOperations | None = None,
) -> None:
    source = bounded_bytes(operations.root / 'scripts/deploy/queue-lifecycle.cjs')
    arguments = ['--require', 'tsx/cjs', '-e', canonical_loader(source)]
    receipt = record(operations.manifest['finalWorker'], 'catalog verifier')
    reports: dict[str, dict[str, object]] = {}
    for command in ('snapshot', 'database-identity', 'schema-index'):
        request: dict[str, object] = {'command': command}
        if command == 'schema-index':
            request['manifest'] = reports['snapshot']
        # These requests deliberately have no transition or role. Snapshot
        # reads queue flags without inspecting current application tables.
        raw = migration_image_command(
            operations, receipt, 'node', arguments,
            content=json.dumps(request).encode(), predecessor=predecessor,
        )
        operations.private_file(directory / (command + '.raw'), raw)
        reports[command] = framed_report(raw)
    preparation = catalog_preparation(operations, reports)
    atomic_json(directory / 'schema-preparation.json', preparation)
    atomic_json(directory / 'schema-index.json', reports['schema-index'])


def verification_binding(
    operations: HostOperations, stage: Mapping[str, object], *, mode: str,
) -> dict[str, object]:
    return {
        'attemptDirectory': str(operations.attempt.directory),
        'manifestSha256': operations.attempt.manifest_hash,
        'evidenceSha256': operations.attempt.evidence_hash,
        'stage': dict(stage), 'mode': mode,
        'verifier': operations.manifest['finalWorker'],
        'tools': record(operations.manifest['tools'], 'verification tools'),
    }


def retained_verification(
    operations: HostOperations, stage: Mapping[str, object],
    retained: Mapping[str, object],
) -> None:
    if (set(retained) != {'verified', 'migrations', 'verificationDirectory',
                          'verificationSha256'}
            or retained['verified'] is not True
            or retained['migrations'] != migration_inventory(stage)):
        raise ValueError('retained-stage-verification-changed')
    name = retained['verificationDirectory']
    if (not isinstance(name, str) or Path(name).name != name
            or not name.startswith('stage-verification-')):
        raise ValueError('retained-stage-verification-directory-required')
    directory = operations.attempt.directory / name
    private_directory(directory)
    raw = bounded_bytes(directory / 'verification.json', private=True)
    if hashlib.sha256(raw).hexdigest() != digest(
        retained['verificationSha256'], 'retained stage verification',
    ):
        raise ValueError('retained-stage-verification-hash-changed')
    proof = private_json(directory / 'verification.json')
    binding = verification_binding(operations, stage, mode='active')
    if (set(proof) != {'verified', 'binding', 'files'}
            or proof['verified'] is not True or proof['binding'] != binding
            or private_json(directory / 'binding.json') != binding):
        raise ValueError('retained-stage-verification-binding-changed')
    files = record(proof['files'], 'retained verification files')
    if set(files) != ACTIVE_FILES:
        raise ValueError('retained-stage-verification-files-required')
    for filename, expected in files.items():
        if hashlib.sha256(bounded_bytes(directory / filename, private=True)) \
                .hexdigest() != digest(expected, 'verification file'):
            raise ValueError('retained-stage-verification-file-changed')
    reports = {command: framed_report(bounded_bytes(
        directory / (command + '.raw'), private=True,
    )) for command in ('snapshot', 'database-identity', 'schema-index')}
    if (private_json(directory / 'schema-preparation.json')
            != catalog_preparation(operations, reports)
            or private_json(directory / 'schema-index.json')
            != reports['schema-index']):
        raise ValueError('retained-stage-catalog-evidence-changed')
    result = diff_result(bounded_bytes(directory / 'prisma-result.json',
                                       private=True))
    if (bounded_bytes(directory / 'schema-drift.sql', private=True)
            != result['stdout']
            or bounded_bytes(directory / 'schema-drift.stderr', private=True)
            != result['stderr']):
        raise ValueError('retained-stage-diff-evidence-changed')
    catalog = cast(Callable[[Path], dict[str, object]], import_module(
        'scripts.deploy.compatibility-review',
    ).schema_catalog)
    if private_json(directory / 'schema-drift-proof.json') != {
        'diffExitCode': result['status'],
        'sdkLimitationVerified': result['status'] == 2,
        'sqlSha256': hashlib.sha256(result['stdout']).hexdigest(),
        'indexProof': catalog(directory),
        'preparationSha256': hashlib.sha256(bounded_bytes(
            directory / 'schema-preparation.json', private=True,
        )).hexdigest(),
    }:
        raise ValueError('retained-stage-canonical-proof-changed')


def verify_stage_schema(
    operations: HostOperations, stage: Mapping[str, object], *,
    retained: Mapping[str, object] | None = None,
    predecessor: HostOperations | None = None,
) -> dict[str, object]:
    """Complete canonical verification before a receipt, or recheck catalogs."""
    operations.verify_tools()
    verifier = record(operations.manifest['finalWorker'], 'catalog verifier')
    if verifier not in rows(operations.manifest['images'], 'admitted image'):
        raise ValueError('admitted-final-verifier-image-required')
    if retained is not None:
        retained_verification(operations, stage, retained)
    mode = 'active' if retained is None else 'catalog-replay'
    directory = Path(tempfile.mkdtemp(
        prefix='stage-verification-', dir=operations.attempt.directory,
    ))
    sync_directory(directory.parent)
    binding = verification_binding(operations, stage, mode=mode)
    if retained is not None:
        binding['completedVerificationSha256'] = retained['verificationSha256']
    atomic_json(directory / 'binding.json', binding)
    result: DiffResult | None = None
    if retained is None:
        raw = migration_image_command(
            operations, record(stage['receipt'], 'stage image'), 'node',
            ['-e', child_transport(PRISMA_DIFF)], predecessor=predecessor,
        )
        operations.private_file(directory / 'prisma-result.json', raw)
        result = diff_result(raw)
        operations.private_file(directory / 'schema-drift.sql', result['stdout'])
        operations.private_file(directory / 'schema-drift.stderr', result['stderr'])
    collect_catalog(operations, directory, predecessor=predecessor)
    guard = import_module('scripts.deploy.compatibility-review')
    if result is None:
        catalog = cast(Callable[[Path], dict[str, object]], guard.schema_catalog)
        catalog(directory)
    else:
        drift = cast(Callable[[str, Path], None], guard.schema_drift)
        drift(str(result['status']), directory)
    files = CATALOG_FILES if result is None else ACTIVE_FILES
    atomic_json(directory / 'verification.json', {
        'verified': True, 'binding': binding, 'files': {
            name: hashlib.sha256(bounded_bytes(directory / name,
                                               private=True)).hexdigest()
            for name in sorted(files)
        },
    })
    return {
        'verificationDirectory': directory.name,
        'verificationSha256': hashlib.sha256(bounded_bytes(
            directory / 'verification.json', private=True,
        )).hexdigest(),
    }


def migration_inventory(stage: Mapping[str, object]) -> dict[str, str]:
    result: dict[str, str] = {}
    for path, value in record(stage['migrations'], 'stage SQL').items():
        if not path.endswith('/migration.sql'):
            continue
        name = PurePosixPath(path).parent.name
        if name in result:
            raise ValueError('duplicate-admitted-migration-name')
        result[name] = digest(value, 'stage SQL')
    return result


def admit_successor_migration(
    predecessor: Mapping[str, object], successor: Mapping[str, object], *,
    observed: tuple[str, Mapping[str, str]],
) -> tuple[dict[str, object], dict[str, object]]:
    """Admit one append-only stage against the completed release and image."""
    previous = rows(predecessor['stages'], 'predecessor SQL stages')
    stages = rows(successor['stages'], 'successor SQL stages')
    if not previous or len(stages) != 1:
        raise ValueError('exact-single-successor-sql-stage-required')
    initial = record(successor['initialStage'], 'successor initial stage')
    final = stages[0]
    if previous[-1]['receipt'] != predecessor['finalWorker'] or initial != previous[-1]:
        raise ValueError('successor-initial-migrations-differ-from-predecessor')
    worker = record(successor['finalWorker'], 'successor worker image')
    web = record(successor['finalWeb'], 'successor web image')
    if (final['receipt'] != worker
            or source_sha(web['sha']) != source_sha(worker['sha'])):
        raise ValueError('successor-migration-image-differs-from-final-release')
    original = record(initial['migrations'], 'predecessor SQL inventory')
    candidate = record(final['migrations'], 'successor SQL inventory')
    image, image_migrations = observed
    if (image != digest(worker['imageId'], 'successor worker image', 'sha256:')
            or candidate != dict(image_migrations)):
        raise ValueError('successor-migration-files-differ-from-image')
    if not original or not original.items() < candidate.items():
        raise ValueError('successor-migration-history-changed')
    if (len(migration_inventory(initial)) != len(original)
            or len(migration_inventory(final)) != len(candidate)):
        raise ValueError('successor-migration-inventory-invalid')
    added = sorted(candidate.keys() - original.keys())
    if added[0] <= max(original):
        raise ValueError('successor-migrations-must-append-in-order')
    # The published migration guard limits the number and shape of new paths.
    guard = import_module('scripts.deploy.compatibility-review')
    guard.published_migration_additions({
        path: {'previousSha256': None, 'candidateSha256': candidate[path]}
        for path in added
    })
    return initial, final


def inspect_successor_worker_migrations(
    operations: HostOperations,
) -> tuple[str, dict[str, str]]:
    """Inspect the admitted worker's SQL files without network or database access."""
    operations.lock.validate()
    operations.verify_tools()
    tools = record(operations.manifest['tools'], 'successor tools')
    digest(tools.get(MIGRATION_PROBE_RUNNER), 'migration probe runner')
    path = operations.root / MIGRATION_PROBE
    expected = digest(tools.get(MIGRATION_PROBE), 'migration inventory probe')
    source = bounded_bytes(path)
    if hashlib.sha256(source).hexdigest() != expected:
        raise ValueError('successor-migration-probe-changed')
    receipt = record(operations.manifest['finalWorker'], 'successor worker image')
    image = digest(receipt['imageId'], 'successor worker image identity', 'sha256:')
    observed = strict_json(probe_source(
        image, source.decode(), path.name,
        memory_bytes=helper_memory(operations.manifest), review_attempt=operations.attempt.manifest_hash,
    ).encode())
    operations.lock.validate()
    return image, {
        name: digest(value, 'candidate image migration SQL')
        for name, value in observed.items()
    }


def stage_progress(
    applied: Mapping[str, str], previous: Mapping[str, str],
    candidate: Mapping[str, str],
) -> bool:
    """Preserve old SQL and order only this transition's new migrations."""
    if not previous.items() <= applied.items() <= candidate.items():
        return False
    additions = sorted(candidate.keys() - previous.keys())
    actual = sorted(applied.keys() - previous.keys())
    return actual == additions[:len(applied) - len(previous)]


def later_stage_progress(
    applied: Mapping[str, str], completed: Mapping[str, str],
    inventories: Sequence[Mapping[str, str]],
) -> bool:
    """Recognize a completed stage or progress in a consecutive later pair."""
    if not completed.items() <= applied.items():
        return False
    for index, inventory in enumerate(inventories):
        if inventory == completed:
            return applied == completed or any(
                stage_progress(applied, previous, candidate)
                for previous, candidate in pairwise(inventories[index:])
            )
    return False
