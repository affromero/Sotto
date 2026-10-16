"""Exercise builder receipts through the Docker process boundary."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tarfile
import textwrap

from images.fixtures import (
    PROVENANCE,
    ROOT,
    SHA,
    ReceiptFixture,
    environment,
    image_archive,
    tar_bytes,
)


class ImageCollectorTests(ReceiptFixture):
    reference: str
    image: dict[str, object]
    env: dict[str, str]

    def setUp(self) -> None:
        super().setUp()
        manifest = json.dumps({
            'schemaVersion': 2,
            'config': {'digest': 'sha256:' + 'c' * 64},
            'layers': [],
        }).encode()
        image_id = 'sha256:' + hashlib.sha256(manifest).hexdigest()
        self.reference = 'ghcr.io/affromero/sotto-workers-prod@' + image_id
        self.image = {
            'Id': image_id, 'Os': 'linux', 'Architecture': 'amd64',
            'RepoDigests': [self.reference],
            'Config': {'Labels': {
                'org.opencontainers.image.revision': SHA,
                'org.opencontainers.image.source':
                    'https://github.com/affromero/Sotto',
            }},
        }
        (self.root / 'manifest.json').write_bytes(manifest)
        image_archive(self.root / 'archive.tar', tar_bytes([
            (tarfile.TarInfo('file'), b'x' * 4097),
        ]))
        executable = self.root / 'docker'
        executable.write_text(f'#!{sys.executable}\n' + textwrap.dedent('''
            import json
            import os
            from pathlib import Path
            import shutil
            import sys
            root = Path(os.environ['DOCKER_FIXTURE'])
            args = sys.argv[1:]
            if args[:2] == ['image', 'inspect']:
                print((root / 'inspection.json').read_text())
            elif args[:3] == ['buildx', 'imagetools', 'inspect']:
                sys.stdout.buffer.write((root / 'manifest.json').read_bytes())
            elif args[0] == 'history':
                print('4096')
            elif args[0] == 'save':
                shutil.copyfile(root / 'archive.tar', args[args.index('-o')+1])
            elif args[0] == 'run':
                assert args[args.index('--network')+1] == 'none'
                assert '--read-only' in args and '--pull' in args
                source = args[-1]
                if 'ALL_QUEUE_NAMES' in source:
                    if os.environ.get('FAIL_QUEUE_PROBE') == '1':
                        raise RuntimeError(
                            'Runtime queue module is unavailable')
                    print(json.dumps([
                        'audio-generation', 'class-preparation']))
                elif 'protectedHash' in source:
                    print(json.dumps({'protectedHash': 'f'*64, 'files': {
                        'apps/web/src/lib/queue.ts': 'd'*64}}))
                elif 'Mixed web/worker' in source:
                    print('e'*64)
                else:
                    print('d'*64)
            else:
                raise RuntimeError('Unexpected Docker request: '+repr(args))
        '''))
        executable.chmod(0o700)
        self.env = {
            **environment(), 'DOCKER_FIXTURE': str(self.root),
            'PATH': str(self.root) + os.pathsep + os.environ['PATH'],
            'GITHUB_REPOSITORY': 'affromero/Sotto',
            'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1',
            'SOURCE_RUN_ID': '100',
        }

    def capture(self) -> subprocess.CompletedProcess[str]:
        (self.root / 'inspection.json').write_text(json.dumps([self.image]))
        return subprocess.run([
            sys.executable, '-m', 'scripts.deploy.images.collect',
            '--role', 'workers', '--release-sha', SHA,
            '--reference', self.reference,
            '--output', str(self.root / 'receipt.json'),
        ], cwd=ROOT, env=self.env, text=True, capture_output=True)

    def test_receipt_preserves_actual_id_config_measurements_and_probes(
        self,
    ) -> None:
        result = self.capture()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = json.loads((self.root / 'receipt.json').read_text())
        self.assertEqual(receipt['imageId'], self.image['Id'])
        self.assertEqual(receipt['configDigest'], 'sha256:' + 'c' * 64)
        self.assertEqual(receipt['measurement']['expanded_bytes'], 8192)
        self.assertEqual(receipt['measurement']['layer_file_count'], 1)
        self.assertEqual(receipt['runtime']['queueNames'],
                         ['audio-generation', 'class-preparation'])
        self.assertEqual(receipt['runtime']['rollingContract'], 'e' * 64)
        self.assertEqual(receipt['provenance'], PROVENANCE)

    def test_classic_store_config_id_is_rejected_without_rewriting(
        self,
    ) -> None:
        self.image['Id'] = 'sha256:' + 'c' * 64
        result = self.capture()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('containerd image store', result.stderr)
        self.assertFalse((self.root / 'receipt.json').exists())

    def test_changed_manifest_and_source_cannot_produce_a_receipt(
        self,
    ) -> None:
        (self.root / 'manifest.json').write_text('{}')
        result = self.capture()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('manifest bytes', result.stderr)
        self.image['Architecture'] = 'arm64'
        result = self.capture()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('identity does not match', result.stderr)
        self.assertFalse((self.root / 'receipt.json').exists())

    def test_runtime_probe_failure_never_publishes_partial_metadata(
        self,
    ) -> None:
        self.env['FAIL_QUEUE_PROBE'] = '1'
        result = self.capture()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Runtime queue module is unavailable', result.stderr)
        self.assertFalse((self.root / 'receipt.json').exists())
