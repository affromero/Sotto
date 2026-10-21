"""Exercise admitted bytes and SSH/container boundaries without a live host."""

from __future__ import annotations

import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.images.metadata import record
from scripts.deploy.review.build_observer import (
    BUILDER,
    SOURCE,
    TARGET,
    historical_lock,
    sha,
)
from scripts.deploy.review.preflight import observe

ROOT = Path(__file__).resolve().parents[3]
CONTAINER = 'e' * 64
IMAGE = 'sha256:' + 'f' * 64


class PreflightTransportTests(unittest.TestCase):
    temporary: tempfile.TemporaryDirectory[str]
    root: Path
    bundle: Path
    receipt: Path
    config: Path
    output: Path
    original: bytes
    evidence: dict[str, object]

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(
            prefix='review-transport-'
        )
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bundle, self.receipt = (
            self.root / 'observer.cjs',
            self.root / 'receipt.json',
        )
        self.config, self.output = (
            self.root / 'transport.json',
            self.root / 'result.json',
        )
        self.original = b'/* independently admitted observer bytes */'
        self.bundle.write_bytes(self.original)
        self.bundle.chmod(0o600)
        lock, sdk = historical_lock(ROOT)
        packages = record(
            record(json.loads(lock), 'lock')['packages'], 'packages'
        )
        zod = record(packages['node_modules/zod'], 'zod')
        self.evidence = {
            'schemaVersion': 1,
            'purpose': 'sotto-review-readonly-observer',
            'targetSource': TARGET,
            'targetLockSha256': sha(lock),
            'toolRevision': 'a' * 40,
            'sourceCommitted': True,
            'observerSourceSha256': sha((ROOT / SOURCE).read_bytes()),
            'builderSourceSha256': sha((ROOT / BUILDER).read_bytes()),
            'bundleSha256': sha(self.original),
            'sdkVersion': sdk['version'],
            'sdkIntegrity': sdk['integrity'],
            'zodVersion': zod['version'],
            'zodIntegrity': zod['integrity'],
            'externals': {
                name: record(packages['node_modules/' + name], name)['version']
                for name in ['pg', 'ioredis']
            },
            'sdkArchiveSha256': 'b' * 64,
            'zodArchiveSha256': 'c' * 64,
            'esbuildExecutableSha256': 'd' * 64,
            'inputs': {
                'project/' + str(SOURCE): sha((ROOT / SOURCE).read_bytes())
            },
        }
        self.receipt.write_text(json.dumps(self.evidence))
        self.receipt.chmod(0o600)
        self.config.write_text(
            json.dumps(
                {
                    'root': str(self.root),
                    'identity': IMAGE + ' true /app/apps/web',
                    'readOnly': True,
                    'replaceBundle': False,
                }
            )
        )
        fake = self.root / 'ssh'
        fake.write_text(
            '#!'
            + sys.executable
            + '\n'
            + """
import json,os,sys
from pathlib import Path
config=json.loads(Path(os.environ['REVIEW_TRANSPORT_FIXTURE']).read_text())
root=Path(config['root'])
with (root/'calls.jsonl').open('a') as log:
 log.write(json.dumps(sys.argv[1:])+'\\n')
if 'docker inspect ' in sys.argv[-1]:
 if config['replaceBundle']:
  (root/'observer.cjs').write_text('UNADMITTED REPLACEMENT')
 print(config['identity'])
else:
 (root/'executed.bin').write_bytes(sys.stdin.buffer.read())
 print(json.dumps({'schemaVersion':1,'purpose':'sotto-review-readonly-preflight',
 'namespace':'sotto-platform-v2','database':{'readOnly':config['readOnly']}}))
"""
        )
        fake.chmod(0o700)

    def invoke(self) -> None:
        def committed(_root: Path, _operation: str, identity: str) -> bytes:
            return (
                ROOT / (SOURCE if identity.endswith(str(SOURCE)) else BUILDER)
            ).read_bytes()

        with (
            patch.dict(
                os.environ,
                {
                    'PATH': str(self.root) + os.pathsep + os.environ['PATH'],
                    'REVIEW_TRANSPORT_FIXTURE': str(self.config),
                },
            ),
            patch('scripts.deploy.review.preflight.git', committed),
        ):
            observe(
                ROOT,
                self.bundle,
                self.receipt,
                'a' * 40,
                sha(self.original),
                CONTAINER,
                IMAGE,
                self.output,
            )

    def test_only_captured_runtime_receives_validated_bytes_and_private_output(
        self,
    ) -> None:
        config = json.loads(self.config.read_text())
        config['replaceBundle'] = True
        self.config.write_text(json.dumps(config))
        self.invoke()
        executed = (self.root / 'executed.bin').read_bytes()
        self.assertTrue(executed.endswith(self.original))
        self.assertNotIn(b'UNADMITTED', executed)
        self.assertIn(TARGET.encode(), executed)
        self.assertIn(b'process.getuid()!==1000', executed)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
        calls = [
            json.loads(line)
            for line in (self.root / 'calls.jsonl').read_text().splitlines()
        ]
        self.assertEqual(len(calls), 2)
        self.assertIn(CONTAINER, calls[0][-1])
        self.assertIn(
            'docker exec -i -w /app/apps/web ' + CONTAINER + ' node -',
            calls[1][-1],
        )

    def test_changed_bundle_and_matching_self_asserted_receipt_are_rejected(
        self,
    ) -> None:
        self.bundle.write_bytes(b'unadmitted code')
        self.evidence['bundleSha256'] = sha(self.bundle.read_bytes())
        self.receipt.write_text(json.dumps(self.evidence))
        with self.assertRaisesRegex(ValueError, 'independently admitted'):
            self.invoke()
        self.assertFalse((self.root / 'calls.jsonl').exists())

    def test_changed_container_image_or_stopped_runtime_receives_no_observer(
        self,
    ) -> None:
        for identity in [
            IMAGE + ' false /app/apps/web',
            'sha256:' + '0' * 64 + ' true /app/apps/web',
        ]:
            with self.subTest(identity=identity):
                config = json.loads(self.config.read_text())
                config['identity'] = identity
                self.config.write_text(json.dumps(config))
                with self.assertRaisesRegex(ValueError, 'identity changed'):
                    self.invoke()
                self.assertFalse((self.root / 'executed.bin').exists())
                self.assertFalse(self.output.exists())

    def test_output_without_readonly_connection_proof_is_rejected(
        self,
    ) -> None:
        config = json.loads(self.config.read_text())
        config['readOnly'] = False
        self.config.write_text(json.dumps(config))
        with self.assertRaisesRegex(ValueError, 'read-only connection'):
            self.invoke()
        self.assertFalse(self.output.exists())
