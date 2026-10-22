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

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.build_observer import bounded_bytes
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
CATALOG_FILES = {
    'binding.json', 'snapshot.raw', 'database-identity.raw',
    'schema-index.raw', 'schema-preparation.json', 'schema-index.json',
}
ACTIVE_FILES = CATALOG_FILES | {
    'prisma-result.json', 'schema-drift.sql', 'schema-drift.stderr',
    'schema-drift-proof.json',
}


class DiffResult(TypedDict):
    status: int
    stdout: bytes
    stderr: bytes


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
    operations: HostOperations, directory: Path,
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
        raw = operations.image_command(
            receipt, 'node', arguments, content=json.dumps(request).encode(),
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
        raw = operations.image_command(
            record(stage['receipt'], 'stage image'), 'node',
            ['-e', child_transport(PRISMA_DIFF)],
        )
        operations.private_file(directory / 'prisma-result.json', raw)
        result = diff_result(raw)
        operations.private_file(directory / 'schema-drift.sql', result['stdout'])
        operations.private_file(directory / 'schema-drift.stderr', result['stderr'])
    collect_catalog(operations, directory)
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
