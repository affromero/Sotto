"""Exercise image runtime probes and worker dependency packaging."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from images.fixtures import ROOT, ReceiptFixture, environment


class WorkerDependencyPackagingTests(ReceiptFixture):
    def dependency(self, relative: str, content: str = 'retained') -> Path:
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        return target

    def prune(self) -> None:
        modules = self.root / 'apps/web/node_modules'
        modules.mkdir(parents=True, exist_ok=True)
        script = ROOT / 'scripts/deploy/images/prune-worker.cjs'
        command = 'require(process.argv[1]).pruneWorker(process.argv[2])'
        result = subprocess.run(
            ['node', '-e', command, str(script), str(self.root)],
            text=True, capture_output=True, env=environment(),
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_preserves_runtime_assets_and_first_party_maps(self) -> None:
        retained = [self.dependency(path) for path in (
            'node_modules/library/index.js',
            'node_modules/library/index.d.ts',
            'node_modules/library/LICENSE',
            'node_modules/library/data.map',
            'apps/web/src/worker.js.map',
            'packages/shared/src/index.js.map',
        )]
        removed = [self.dependency(path) for path in (
            'node_modules/library/index.js.map',
            'node_modules/library/index.d.ts.map',
            'apps/web/node_modules/library/index.mjs.map',
        )]
        self.prune()
        for path in retained:
            self.assertEqual(path.read_text(), 'retained')
        for path in removed:
            self.assertFalse(path.exists())

    def test_excludes_web_framework_and_foreign_native_packages(self) -> None:
        removed = [self.dependency(path) for path in (
            'node_modules/next/server.js',
            'node_modules/@next/swc-linux-x64-gnu/binding.node',
            'node_modules/@img/sharp-libvips-linuxmusl-x64/lib.so',
            'node_modules/@img/sharp-linuxmusl-arm64/binding.node',
            'node_modules/@shiftlabs/markit-linux-x64-musl/binding.node',
            'apps/web/node_modules/@napi-rs/'
            'canvas-linux-arm64-musl/binding.node',
        )]
        retained = [self.dependency(path) for path in (
            'node_modules/@img/sharp-linux-x64/binding.node',
            'node_modules/@shiftlabs/markit-linux-arm64-gnu/binding.node',
            'apps/web/node_modules/@napi-rs/canvas-linux-x64-gnu/binding.node',
            'node_modules/prisma/build/index.js',
        )]
        self.prune()
        for path in removed:
            self.assertFalse(path.exists())
        for path in retained:
            self.assertEqual(path.read_text(), 'retained')

    def test_preserves_workspace_links_and_their_targets(self) -> None:
        outside = self.dependency('packages/shared/next/index.js.map')
        modules = self.root / 'node_modules'
        modules.mkdir()
        link = modules / 'shared'
        link.symlink_to(
            self.root / 'packages/shared', target_is_directory=True,
        )
        self.prune()
        self.assertTrue(link.is_symlink())
        self.assertEqual(outside.read_text(), 'retained')


class ImageRuntimeProbeTests(ReceiptFixture):
    def test_queue_probe_reads_and_sorts_the_image_runtime_exports(
        self,
    ) -> None:
        runtime = self.root / 'apps/web'
        (runtime / 'src/lib').mkdir(parents=True)
        (runtime / 'package.json').write_text('{"type":"commonjs"}')
        (runtime / 'src/lib/queue.ts').write_text(
            'module.exports = {ALL_QUEUE_NAMES: '
            '["waveform-generation","audio-generation","class-preparation"]};'
        )
        result = self.probe()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout), [
            'audio-generation', 'class-preparation', 'waveform-generation',
        ])

    def test_missing_runtime_module_surfaces_without_fallback_output(
        self,
    ) -> None:
        result = self.probe()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertIn('Cannot find module', result.stderr)

    def probe(self) -> subprocess.CompletedProcess[str]:
        source = (ROOT / 'scripts/deploy/images/queue-names.cjs').read_text()
        # Redirect the image's filesystem root to this disposable fixture.
        source = source.replace('/app/', str(self.root) + '/')
        return subprocess.run(
            ['node', '-e', source], text=True, capture_output=True,
            env=environment(),
        )
