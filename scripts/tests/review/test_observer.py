"""Exercise historical observer integrity and actual old-image SQL reads."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import subprocess
import tarfile
import tempfile
import unittest
import uuid
from pathlib import Path
from typing import ClassVar
from unittest.mock import patch
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from scripts.deploy.images.metadata import record
from scripts.deploy.review.build_observer import (
    BUILDER,
    SOURCE,
    SHARED_TARGET,
    TARGET,
    build,
    git,
    historical_lock,
    sha,
    unpack,
)
from scripts.deploy.review.preflight import validate_bundle
from scripts.deploy.review.runtime.channel import exchange
from scripts.deploy.review.runtime.services import PRESERVATION_OBSERVER
from scripts.deploy.review.state import DeploymentLock
from scripts.deploy.review.topology import rows

ROOT = Path(__file__).resolve().parents[3]
SDK_ENV = 'SOTTO_REVIEW_SDK_ARCHIVE'
ZOD_ENV = 'SOTTO_REVIEW_ZOD_ARCHIVE'
IMAGE = (
    'sha256:26e0fdba3b42264324a11ede14d000de0355b8873c8537c78bd50b8e7ae88f61'
)


class ObserverIntegrityTests(unittest.TestCase):
    def test_shared_predecessor_uses_its_own_locked_sdk(self) -> None:
        old_lock, old_sdk = historical_lock(ROOT)
        shared_lock, shared_sdk = historical_lock(ROOT, SHARED_TARGET)
        self.assertEqual(old_sdk['version'], '0.3.4')
        self.assertEqual(shared_sdk['version'], '0.5.7')
        self.assertNotEqual(sha(old_lock), sha(shared_lock))
        with self.assertRaisesRegex(ValueError, 'Unreviewed historical source'):
            historical_lock(ROOT, 'a' * 40)

    def test_shared_observer_cannot_be_admitted_for_another_predecessor(
        self,
    ) -> None:
        lock, sdk = historical_lock(ROOT, SHARED_TARGET)
        packages = record(
            record(json.loads(lock), 'lock')['packages'], 'packages'
        )
        zod = record(packages['node_modules/zod'], 'zod')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle, receipt = root / 'observer.cjs', root / 'receipt.json'
            bundle.write_bytes(b'shared observer')
            bundle.chmod(0o600)
            source = (ROOT / SOURCE).read_bytes()
            builder = (ROOT / BUILDER).read_bytes()
            evidence = {
                'schemaVersion': 1,
                'purpose': 'sotto-review-readonly-observer',
                'targetSource': SHARED_TARGET,
                'targetLockSha256': sha(lock),
                'toolRevision': 'a' * 40,
                'sourceCommitted': True,
                'observerSourceSha256': sha(source),
                'builderSourceSha256': sha(builder),
                'bundleSha256': sha(bundle.read_bytes()),
                'sdkVersion': sdk['version'],
                'sdkIntegrity': sdk['integrity'],
                'zodVersion': zod['version'],
                'zodIntegrity': zod['integrity'],
                'sdkArchiveSha256': 'b' * 64,
                'zodArchiveSha256': 'c' * 64,
                'esbuildExecutableSha256': 'd' * 64,
                'externals': {
                    name: record(packages['node_modules/' + name], name)[
                        'version'
                    ] for name in ['pg', 'ioredis']
                },
                'inputs': {'project/' + str(SOURCE): sha(source)},
            }
            receipt.write_text(json.dumps(evidence))
            receipt.chmod(0o600)

            def git_file(_root: Path, _show: str, identity: str) -> bytes:
                return source if identity.endswith(str(SOURCE)) else builder

            with patch('scripts.deploy.review.preflight.git', git_file):
                validate_bundle(
                    ROOT, bundle, receipt, 'a' * 40,
                    sha(bundle.read_bytes()), SHARED_TARGET,
                )
                with self.assertRaisesRegex(ValueError, 'differs'):
                    validate_bundle(
                        ROOT, bundle, receipt, 'a' * 40,
                        sha(bundle.read_bytes()), TARGET,
                    )

    def test_archive_must_match_lock_and_cannot_escape_extraction(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, kind in [
                ('package/../../escape', 'file'),
                ('package/link', 'symlink'),
            ]:
                with self.subTest(name=name):
                    archive = root / 'sdk.tgz'
                    with tarfile.open(archive, 'w:gz') as packed:
                        entry = tarfile.TarInfo(name)
                        entry.type = (
                            tarfile.SYMTYPE
                            if kind == 'symlink'
                            else tarfile.REGTYPE
                        )
                        entry.linkname = '/etc/passwd'
                        packed.addfile(entry, io.BytesIO())
                    integrity = (
                        'sha512-'
                        + base64.b64encode(
                            hashlib.sha512(archive.read_bytes()).digest()
                        ).decode()
                    )
                    with self.assertRaisesRegex(ValueError, 'integrity'):
                        unpack(archive, root / 'bad', 'sha512-wrong')
                    with self.assertRaisesRegex(ValueError, 'archive entry'):
                        unpack(archive, root / 'stage', integrity)
                    self.assertFalse((root.parent / 'escape').exists())

    def test_changed_bundle_source_or_target_cannot_be_admitted(self) -> None:
        lock, sdk = historical_lock(ROOT)
        packages = record(
            record(json.loads(lock), 'lock')['packages'], 'packages'
        )
        zod = record(packages['node_modules/zod'], 'zod')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle, receipt = root / 'observer.cjs', root / 'receipt.json'
            bundle.write_bytes(b'fixture observer')
            bundle.chmod(0o600)
            source, builder = (
                (ROOT / SOURCE).read_bytes(),
                (ROOT / BUILDER).read_bytes(),
            )
            value = {
                'schemaVersion': 1,
                'purpose': 'sotto-review-readonly-observer',
                'targetSource': TARGET,
                'targetLockSha256': sha(lock),
                'toolRevision': 'a' * 40,
                'sourceCommitted': True,
                'observerSourceSha256': sha(source),
                'builderSourceSha256': sha(builder),
                'bundleSha256': sha(bundle.read_bytes()),
                'sdkVersion': sdk['version'],
                'sdkIntegrity': sdk['integrity'],
                'zodVersion': zod['version'],
                'zodIntegrity': zod['integrity'],
                'externals': {
                    name: record(packages['node_modules/' + name], name)[
                        'version'
                    ]
                    for name in ['pg', 'ioredis']
                },
                'sdkArchiveSha256': 'b' * 64,
                'zodArchiveSha256': 'c' * 64,
                'esbuildExecutableSha256': 'd' * 64,
                'inputs': {'project/' + str(SOURCE): sha(source)},
            }

            def git_file(_root: Path, _show: str, identity: str) -> bytes:
                return source if identity.endswith(str(SOURCE)) else builder

            with patch('scripts.deploy.review.preflight.git', git_file):
                receipt.write_text(json.dumps(value))
                receipt.chmod(0o600)
                expected_digest = sha(bundle.read_bytes())
                validate_bundle(
                    ROOT, bundle, receipt, 'a' * 40, expected_digest
                )
                changes: list[dict[str, object]] = [
                    {'targetSource': 'b' * 40},
                    {'sourceCommitted': False},
                    {'observerSourceSha256': '0' * 64},
                    {'builderSourceSha256': '0' * 64},
                    {'bundleSha256': '0' * 64},
                    {'externals': {'pg': 'wrong'}},
                ]
                for change in changes:
                    with self.subTest(change=change):
                        receipt.write_text(json.dumps(value | change))
                        with self.assertRaises(ValueError):
                            validate_bundle(
                                ROOT,
                                bundle,
                                receipt,
                                'a' * 40,
                                expected_digest,
                            )
                receipt.write_text(json.dumps(value))
                receipt.chmod(0o644)
                with self.assertRaisesRegex(ValueError, 'private'):
                    validate_bundle(
                        ROOT, bundle, receipt, 'a' * 40, expected_digest
                    )


@unittest.skipUnless(
    all(os.environ.get(name) for name in (
        'SOTTO_SHARED_REVIEW_SDK_ARCHIVE',
        'SOTTO_SHARED_REVIEW_ZOD_ARCHIVE',
        'SOTTO_SHARED_REVIEW_DATABASE_URL',
        'SOTTO_SHARED_REVIEW_REDIS_URL',
    )),
    'requires isolated shared-review predecessor fixtures',
)
class SharedPredecessorObserverTests(unittest.TestCase):
    def test_real_bundle_reads_retained_jobs_without_writing(self) -> None:
        database = os.environ['SOTTO_SHARED_REVIEW_DATABASE_URL']
        redis = os.environ['SOTTO_SHARED_REVIEW_REDIS_URL']
        database_url, redis_url = urlsplit(database), urlsplit(redis)
        if (database_url.hostname not in {'localhost', '127.0.0.1'}
                or database_url.path != '/demo_before'
                or redis_url.hostname not in {'localhost', '127.0.0.1'}
                or redis_url.path != '/15'):
            raise ValueError('Isolated local review fixtures are required')
        with tempfile.TemporaryDirectory(prefix='review-shared-observer-') as tmp:
            output = Path(tmp) / 'output'
            receipt = build(
                ROOT, Path(os.environ['SOTTO_SHARED_REVIEW_SDK_ARCHIVE']),
                Path(os.environ['SOTTO_SHARED_REVIEW_ZOD_ARCHIVE']),
                output, SHARED_TARGET,
            )
            self.assertEqual(receipt['targetSource'], SHARED_TARGET)
            self.assertEqual(receipt['sdkVersion'], '0.5.7')
            environment = dict(os.environ, DATABASE_URL=database, REDIS_URL=redis,
                               NODE_PATH=str(ROOT / 'node_modules'))
            observations = []
            for _ in range(2):
                result = subprocess.run(
                    ['node', str(output / 'observer.cjs')], cwd=ROOT,
                    env=environment, capture_output=True, timeout=90, check=True,
                )
                observations.append(json.loads(result.stdout))
            self.assertEqual(observations[0], observations[1])
            self.assertIs(observations[0]['database']['readOnly'], True)
            statuses = [job['status'] for job in observations[0]['jobs']]
            self.assertEqual(statuses.count('pending'), 3)
            self.assertEqual(statuses.count('complete'), 110)
            self.assertFalse(observations[0]['zeroWork'])


@unittest.skipUnless(
    os.environ.get('SOTTO_REVIEW_OBSERVER_INTEGRATION') == '1',
    'Requires explicitly selected local historical fixtures',
)
class HistoricalObserverTests(unittest.TestCase):
    temporary: ClassVar[tempfile.TemporaryDirectory[str]]
    root: ClassVar[Path]
    receipt: ClassVar[dict[str, object]]
    env_file: ClassVar[Path]

    @classmethod
    def setUpClass(cls) -> None:
        cls.temporary = tempfile.TemporaryDirectory(
            prefix='sotto-observer-test-'
        )
        cls.root = Path(cls.temporary.name)
        archive, zod_archive = (
            Path(os.environ[SDK_ENV]),
            Path(os.environ[ZOD_ENV]),
        )
        cls.receipt = build(ROOT, archive, zod_archive, cls.root / 'output')
        repeated = build(ROOT, archive, zod_archive, cls.root / 'repeated')
        if cls.receipt['bundleSha256'] != repeated['bundleSha256']:
            raise AssertionError(
                'Historical observer build is not reproducible'
            )
        lock, sdk = historical_lock(ROOT)
        packages = record(
            record(json.loads(lock), 'lock')['packages'], 'packages'
        )
        zod = record(packages['node_modules/zod'], 'zod')
        unpack(archive, cls.root / 'sdk', str(sdk['integrity']))
        unpack(
            zod_archive,
            cls.root / 'zod',
            str(zod['integrity']),
            'zod',
            str(zod['version']),
        )
        package = json.loads(
            (cls.root / 'sdk/package/package.json').read_text()
        )
        aliases = {'zod': str(cls.root / 'zod/package/index.js')}
        for name in [
            'access',
            'runtime/outbox',
            'storage/instance',
            'storage',
            'storage/optimistic',
            'storage/sql',
            'configuration/owned-credentials',
            'configuration/credential-sharing',
        ]:
            aliases['thesidedoor-core/' + name] = str(
                cls.root
                / 'sdk/package'
                / package['exports']['./' + name]['import']
            )
        options = {
            'entryPoints': [
                str(ROOT / 'scripts/tests/review/observer_fixture.ts')
            ],
            'bundle': True,
            'platform': 'node',
            'format': 'cjs',
            'target': 'node22',
            'external': ['pg', 'ioredis'],
            'alias': aliases,
            'define': {
                'import.meta.url': '"file:///app/apps/web/observer.cjs"'
            },
            'outfile': str(cls.root / 'fixture.cjs'),
        }
        script = """const esbuild=require('esbuild');
const options=JSON.parse(require('fs').readFileSync(0,'utf8'));
options.plugins=[{name:'unused-access',setup(b){
b.onResolve({filter:/^(@simplewebauthn\\/server|readline\\/promises)$/},
a=>({path:a.path,external:true,sideEffects:false}));}}];
esbuild.build(options).catch(()=>process.exit(1));"""
        compiled = subprocess.run(
            ['node', '-e', script],
            cwd=ROOT,
            input=json.dumps(options),
            text=True,
            capture_output=True,
        )
        if compiled.returncode:
            raise AssertionError(compiled.stdout + compiled.stderr)
        env_lines = []
        for key in ['DATABASE_URL', 'REDIS_URL']:
            url = urlsplit(os.environ[key])
            if url.hostname not in ['localhost', '127.0.0.1'] or not url.port:
                raise ValueError(
                    'Integration fixtures must be explicit loopback services'
                )
            user = (url.username or '') + (
                ':' + url.password if url.password else ''
            )
            authority = (
                (user + '@' if user else '')
                + 'host.docker.internal:'
                + str(url.port)
            )
            env_lines.append(
                key + '=' + urlunsplit(url._replace(netloc=authority))
            )
        cls.env_file = cls.root / 'fixture.env'
        cls.env_file.write_text('\n'.join(env_lines) + '\n')
        cls.env_file.chmod(0o600)
        inspected = subprocess.run(
            [
                'docker',
                'image',
                'inspect',
                IMAGE,
                '--format',
                '{{index .Config.Labels "org.opencontainers.image.revision"}}',
            ],
            text=True,
            capture_output=True,
            check=True,
        )
        if inspected.stdout.strip() != TARGET:
            raise ValueError('Historical image source differs')

    @classmethod
    def tearDownClass(cls) -> None:
        cls.temporary.cleanup()

    def scenario(self, name: str) -> dict[str, object]:
        script = """let s='';process.stdin.on('data',d=>s+=d);
process.stdin.on('end',()=>{
const Module=require('module'),m=new Module('/app/apps/web/observer.cjs');
m.filename=m.id;m.paths=Module._nodeModulePaths('/app/apps/web');m._compile(s,m.id);
m.exports.runScenario(process.argv[1],s).then(r=>console.log(JSON.stringify(r)))
.catch(e=>{console.error(e);process.exitCode=1});});"""
        value = self.run_fixture(script, name)
        self.assertTrue(value['readOnly'])
        self.assertTrue(value['unchanged'])
        return value

    def run_fixture(
        self, script: str, argument: str, *, argument_stdin: bool = False,
    ) -> dict[str, object]:
        bundle = (self.root / 'fixture.cjs').read_text()
        payload = (
            json.dumps({'bundle': bundle, 'argument': json.loads(argument)})
            if argument_stdin else bundle
        )
        result = subprocess.run(
            [
                'docker',
                'run',
                '--rm',
                '-i',
                '--platform',
                'linux/amd64',
                '--read-only',
                '--cap-drop',
                'ALL',
                '--security-opt',
                'no-new-privileges',
                '--user',
                '1000',
                '--workdir',
                '/app/apps/web',
                '--env-file',
                str(self.env_file),
                '--entrypoint',
                'node',
                IMAGE,
                '-e',
                script,
                *([] if argument_stdin else [argument]),
            ],
            input=payload,
            text=True,
            capture_output=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return record(json.loads(result.stdout), 'test result')

    def test_old_worksheet_records_fail_safely_in_final_runtime(self) -> None:
        schema = 'review_worksheet_' + uuid.uuid4().hex
        root = self.root / schema
        root.mkdir(mode=0o700)
        storage = root / 'storage'
        storage.mkdir()
        (storage / 'worksheets').mkdir()
        retained = storage / 'worksheets/retained-fixture.pdf'
        retained.write_bytes(b'%PDF-1.4 retained worksheet fixture')
        sources = [
            TARGET,
            '67086a302f409824bb22606a049888ff86a77348',
            'e43d88acf5457b0d0061275be91e4176b28ed7a6',
            git(ROOT, 'rev-parse', 'HEAD').decode().strip(),
        ]
        script = """let s='';process.stdin.on('data',d=>s+=d);
process.stdin.on('end',()=>{
const Module=require('module'),m=new Module('/app/apps/web/observer.cjs');
m.filename=m.id;m.paths=Module._nodeModulePaths('/app/apps/web');
const payload=JSON.parse(s);m._compile(payload.bundle,m.id);const input=payload.argument;
m.exports[input.operation](input.options).then(r=>console.log(JSON.stringify(r)))
.catch(e=>{console.error(e);process.exitCode=1});});"""
        previous: dict[str, str] = {}
        seed: dict[str, object] = {}
        stages: list[dict[str, object]] = []
        capture_output = ''
        channel_capture: object = None
        protected_inventory: dict[str, object] | None = None

        def preserve_original_data() -> dict[str, object]:
            values = dict(line.split('=', 1) for line in
                          self.env_file.read_text().splitlines())
            url = urlsplit(values['DATABASE_URL'])
            query = dict(parse_qsl(url.query))
            query['options'] = '-c search_path=' + schema
            values['DATABASE_URL'] = urlunsplit(url._replace(
                query=urlencode(query),
            ))
            env_file = root / 'preservation.env'
            env_file.write_text(''.join(name+'='+value+'\n'
                                       for name, value in values.items()))
            env_file.chmod(0o600)
            selected = None if protected_inventory is None else [
                {'table': row['table'], 'columns': row['columns']}
                for row in rows(protected_inventory['tables'], 'old table')
            ]
            result = subprocess.run([
                'docker', 'run', '--rm', '-i', '--platform', 'linux/amd64',
                '--read-only', '--cap-drop', 'ALL', '--security-opt',
                'no-new-privileges', '--user', '1000', '--workdir',
                '/app/apps/web', '--env-file', str(env_file),
                '--entrypoint', 'node', IMAGE, '-e', PRESERVATION_OBSERVER,
            ], input=json.dumps(selected), text=True, capture_output=True,
                timeout=65)
            self.assertEqual(result.returncode, 0,
                             result.stdout + result.stderr)
            return record(json.loads(result.stdout), 'preserved old data')

        def run_runtime(mode: str) -> subprocess.CompletedProcess[str]:
            fixture = root / 'fixture.json'
            fixture.write_text(json.dumps(seed))
            fixture.chmod(0o600)
            result = subprocess.run(
                [
                    'npx', '--no-install', 'vitest', 'run',
                    'tests/lib/deployment/review-worksheet-admission.test.ts',
                    '--reporter=verbose',
                ],
                cwd=ROOT / 'apps/web',
                env={
                    **os.environ,
                    'SOTTO_REVIEW_WORKSHEET_FIXTURE': str(fixture),
                    'SOTTO_REVIEW_WORKSHEET_MODE': mode,
                },
                text=True,
                capture_output=True,
                timeout=90,
            )
            self.assertEqual(result.returncode, 0,
                             result.stdout + result.stderr)
            return result

        try:
            for index, source in enumerate(sources):
                paths = git(
                    ROOT, 'ls-tree', '-r', '--name-only', source, '--',
                    'apps/web/prisma/migrations',
                ).decode().splitlines()
                migrations = {
                    path: git(ROOT, 'show', source + ':' + path)
                    for path in paths if path.endswith('/migration.sql')
                }
                inventory = {
                    path: sha(content) for path, content in migrations.items()
                }
                self.assertTrue(all(
                    inventory.get(path) == digest
                    for path, digest in previous.items()
                ), 'Published migration bytes changed')
                added = sorted(set(migrations) - set(previous))
                self.assertTrue(added, 'Historical stage must add migrations')
                if index == 0:
                    self.assertLessEqual(len(added), 16)
                for offset in range(0, len(added), 16):
                    batch = added[offset:offset + 16]
                    options: dict[str, object] = {
                        'schema': schema,
                        'migrations': [migrations[path].decode() for path in batch],
                        'storageRoot': str(storage),
                    }
                    value = self.run_fixture(script, json.dumps({
                        'operation': (
                            'seedWorksheetScenario' if index == 0
                            else 'migrateWorksheetScenario'
                        ),
                        'options': options,
                    }), argument_stdin=True)
                    actual_inventory = preserve_original_data()
                    if protected_inventory is None:
                        protected_inventory = actual_inventory
                    else:
                        self.assertEqual(actual_inventory, protected_inventory)
                    if index != 0:
                        self.assertEqual(value['preserved'], seed['before'])
                if index == 0:
                    seed = value
                    capture_result = run_runtime('capture')
                    capture_output = (capture_result.stdout
                                      + capture_result.stderr)
                    prefix = 'SOTTO_REVIEW_FIRST_WORKER_CAPTURE='
                    captures = [line[len(prefix):]
                                for line in capture_result.stdout.splitlines()
                                if line.startswith(prefix)]
                    self.assertEqual(len(captures), 1, capture_output)
                    seed['evidence'] = record(json.loads(captures[0]),
                                              'captured evidence')
                    raw_jobs = seed['jobs']
                    if not isinstance(raw_jobs, list):
                        self.fail('Historical fixture job identities missing')
                    references = [
                        {'id': record(job, 'historical job')['id']}
                        for job in raw_jobs
                    ]
                    references.sort(key=lambda item: str(item['id']))
                    node = (
                        'const load=require("node:module").createRequire('
                        + json.dumps(str(ROOT / 'apps/web/package.json'))
                        + ');const {PrismaPg}=load("@prisma/adapter-pg");'
                        'const {PrismaClient}=load('
                        '"./src/generated/prisma/client.ts");'
                        'global.prisma=new PrismaClient({adapter:new PrismaPg('
                        '{connectionString:process.env.'
                        'SIDEDOOR_TEST_DATABASE_URL,options:'
                        + json.dumps('-c search_path=' + schema + ',public')
                        + '},{schema:' + json.dumps(schema) + '})});'
                        'require('
                        + json.dumps(str(ROOT / (
                            'scripts/deploy/review/runtime/channel.ts'
                        )))
                        + ').main().catch(e=>{console.error(e);'
                        'process.exitCode=1});'
                    )
                    lock_path = root / 'channel.lock'
                    lock_path.touch(mode=0o600)
                    lock = DeploymentLock(lock_path)
                    try:
                        with patch.dict(os.environ, {
                            'TSX_TSCONFIG_PATH': str(
                                ROOT / 'apps/web/tsconfig.json'
                            ),
                        }):
                            channel_capture = exchange(
                                ['node', '--require', 'tsx/cjs', '-e', node],
                                {'mode': 'capture', 'input': {
                                    'namespace': 'sotto-platform-v2',
                                    'jobs': references,
                                }}, directory=root, timeout=30,
                                assert_fence=lambda: self.fail(
                                    'Read-only capture requested a fence'
                                ),
                                queue_manifest=lambda value: self.fail(
                                    'Read-only capture requested queue writes'
                                ),
                            )
                    except Exception as error:
                        diagnostics = ''.join(
                            path.read_text(errors='replace')
                            for path in root.glob('runtime-diagnostics-*.bin')
                        )
                        self.fail(str(error) + '\n' + diagnostics)
                    finally:
                        lock.close()
                    self.assertEqual(channel_capture, seed['evidence'])
                    unchanged = self.run_fixture(script, json.dumps({
                        'operation': 'migrateWorksheetScenario',
                        'options': {'schema': schema, 'migrations': []},
                    }), argument_stdin=True)
                    self.assertEqual(unchanged['preserved'], seed['before'])
                else:
                    self.assertEqual(value['preserved'], seed['before'])
                stages.append({'source': source, 'migrations': inventory})
                previous = inventory
            result = run_runtime('execute')
            self.assertEqual(retained.read_bytes(),
                             b'%PDF-1.4 retained worksheet fixture')
            self.assertEqual(sorted(
                str(path.relative_to(storage))
                for path in storage.rglob('*')
            ), ['worksheets', 'worksheets/retained-fixture.pdf'])
            (root / 'stages.json').write_text(json.dumps(stages))
            sdk_path = Path(subprocess.check_output(
                ['node', '-p',
                 "require.resolve('thesidedoor-core/runtime/outbox')"],
                cwd=ROOT / 'apps/web', text=True,
            ).strip()).parents[2] / 'package.json'
            print(json.dumps({
                'worksheetProof': {
                    'stages': [{
                        'source': stage['source'],
                        'migrationInventorySha256': sha(json.dumps(
                            stage['migrations'], sort_keys=True,
                        ).encode()),
                        'migrationCount': len(record(
                            stage['migrations'], 'stage inventory'
                        )),
                    } for stage in stages],
                    'targetSdkVersion': json.loads(
                        sdk_path.read_text()
                    )['version'],
                    'targetSdkPackageSha256': sha(sdk_path.read_bytes()),
                    'targetLockSha256': sha(
                        (ROOT / 'package-lock.json').read_bytes()
                    ),
                    'historicalSdkIntegrity': self.receipt['sdkIntegrity'],
                    'historicalSdkArchiveSha256':
                        self.receipt['sdkArchiveSha256'],
                    'historicalLockSha256':
                        self.receipt['targetLockSha256'],
                    'fixtureSourceSha256': sha((
                        ROOT / 'scripts/tests/review/observer_fixture.ts'
                    ).read_bytes()),
                    'fixtureBundleSha256': sha((
                        self.root / 'fixture.cjs'
                    ).read_bytes()),
                    'captureBeforeSql': True,
                    'actualPythonNodeCapture': channel_capture is not None,
                    'allOriginalTablesPreserved': True,
                    'originalTableInventorySha256': sha(json.dumps(
                        protected_inventory, sort_keys=True,
                    ).encode()),
                    'toolSourceSha256': {
                        name: sha((ROOT / name).read_bytes()) for name in (
                            'scripts/deploy/review/first-worker.ts',
                            'scripts/deploy/review/readiness.ts',
                            'scripts/deploy/review/runtime/channel.ts',
                            'scripts/deploy/review/runtime/channel.py',
                            'scripts/deploy/review/runtime/operations.py',
                            'scripts/deploy/review/runtime/release/'
                            'migrations.py',
                            'scripts/deploy/review/runtime/services.py',
                            'apps/web/tests/lib/deployment/'
                            'review-worksheet-admission.test.ts',
                            'scripts/tests/review/test_observer.py',
                        )
                    },
                    'capturedEvidenceSha256': sha(json.dumps(
                        seed['evidence'], sort_keys=True,
                    ).encode()),
                    'captureOutput': capture_output,
                    'runtimeOutput': result.stdout + result.stderr,
                },
            }))
        finally:
            cleanup = """const {Client}=require('pg');
const c=new Client({connectionString:process.env.DATABASE_URL});
(async()=>{await c.connect();try{await c.query(
  'DROP SCHEMA IF EXISTS "'+process.argv[1]+'" CASCADE');
}finally{await c.end()}})().catch(e=>{console.error(e);process.exitCode=1});"""
            removed = subprocess.run(
                ['node', '-e', cleanup, schema],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
                timeout=20,
            )
            self.assertEqual(removed.returncode, 0,
                             removed.stdout + removed.stderr)

    def test_pending_and_delivered_jobs_still_block_first_worker(self) -> None:
        self.assertFalse(self.scenario('pending')['zeroWork'])

    def test_canonical_completed_receipts_allow_empty_backlog(self) -> None:
        self.scenario('complete')

    def test_active_execution_blocks_first_worker(self) -> None:
        self.assertFalse(self.scenario('active')['zeroWork'])

    def test_corrupt_payload_is_classified_without_exposing_it(self) -> None:
        self.assertFalse(self.scenario('invalid')['zeroWork'])

    def test_streamed_node_entrypoint_checks_its_own_readonly_connection(
        self,
    ) -> None:
        self.assertFalse(self.scenario('cli')['zeroWork'])

    def test_stalled_redis_terminates_streamed_observer_without_writes(
        self,
    ) -> None:
        self.assertFalse(self.scenario('stalled-redis')['zeroWork'])

    def test_incomplete_jobs_without_indexes_still_block_first_worker(
        self,
    ) -> None:
        self.assertFalse(self.scenario('orphan')['zeroWork'])

    def test_oversized_historical_state_is_rejected_before_materialization(
        self,
    ) -> None:
        self.assertFalse(self.scenario('oversized')['zeroWork'])

    def test_matching_deletion_proof_does_not_admit_pending_jobs(self) -> None:
        self.assertFalse(self.scenario('deletion-matching')['zeroWork'])

    def test_wrong_generation_is_explicitly_inconsistent(self) -> None:
        self.assertFalse(self.scenario('deletion-generation')['zeroWork'])

    def test_tombstone_without_cleanup_fails_the_observation(self) -> None:
        self.assertFalse(self.scenario('deletion-missing')['zeroWork'])

    def test_tombstone_with_malformed_cleanup_fails_the_observation(
        self,
    ) -> None:
        self.assertFalse(self.scenario('deletion-malformed')['zeroWork'])

    def test_erased_receipt_does_not_read_removed_payload(self) -> None:
        self.assertFalse(self.scenario('erased')['zeroWork'])
