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
from pathlib import Path
from typing import ClassVar
from unittest.mock import patch
from urllib.parse import urlsplit, urlunsplit

from scripts.deploy.images.metadata import record
from scripts.deploy.review.build_observer import (
    BUILDER,
    SOURCE,
    TARGET,
    build,
    historical_lock,
    sha,
    unpack,
)
from scripts.deploy.review.preflight import validate_bundle

ROOT = Path(__file__).resolve().parents[3]
SDK_ENV = 'SOTTO_REVIEW_SDK_ARCHIVE'
ZOD_ENV = 'SOTTO_REVIEW_ZOD_ARCHIVE'
IMAGE = (
    'sha256:26e0fdba3b42264324a11ede14d000de0355b8873c8537c78bd50b8e7ae88f61'
)


class ObserverIntegrityTests(unittest.TestCase):
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
                name,
            ],
            input=(self.root / 'fixture.cjs').read_text(),
            text=True,
            capture_output=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        value = record(json.loads(result.stdout), 'test result')
        self.assertTrue(value['readOnly'])
        self.assertTrue(value['unchanged'])
        return value

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
