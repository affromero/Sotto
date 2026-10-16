"""Read the runtime's own queue exports without resolving source-host paths."""

from __future__ import annotations

import json
import subprocess

from images.fixtures import ROOT, ReceiptFixture, environment


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
