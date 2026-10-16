"""Keep image receipts and stable caches on trusted publishing paths."""

from __future__ import annotations

import json
import subprocess
import unittest

from images.fixtures import ROOT, ReceiptFixture


class ImageWorkflowTests(ReceiptFixture):
    def test_production_collects_all_smoked_images_in_matching_stores(
        self,
    ) -> None:
        source = (ROOT / '.github/workflows/deploy.yml').read_text()
        for role in ('showcase', 'personal', 'workers'):
            start = source.index(f'\n  {role}:\n')
            # Job names have exactly two spaces. Step indentation is deeper.
            end = next((index for index in range(start + 5, len(source))
                        if source.startswith('\n  ', index)
                        and source[index + 3] != ' '), len(source))
            job = source[start:end]
            self.assertIn('containerd-snapshotter', job)
            self.assertLess(job.index('smoke-'), job.index('images.collect'))
            self.assertIn(f'--role {role}', job)
            self.assertIn('SOURCE_RUN_ID:', job)
            self.assertIn('type=registry', job)
            self.assertNotIn('type=gha', job)
        self.assertIn('delivery/production-release-metadata.json', source)
        self.assertIn('merge-multiple: true', source)

    def test_release_identity_does_not_precede_worker_filesystem_layers(
        self,
    ) -> None:
        source = (ROOT / 'apps/web/Dockerfile.workers').read_text()
        metadata = source.index('ARG COMMIT_SHA=')
        self.assertGreater(metadata, source.rfind('\nRUN '))
        self.assertGreater(metadata, source.rfind('\nCOPY '))
        self.assertIn('ENV COMMIT_SHA=${COMMIT_SHA}', source[metadata:])

    def test_browser_cache_input_tracks_only_exact_locked_version(
        self,
    ) -> None:
        result = subprocess.run([
            'node', str(ROOT / 'scripts/deploy/images/playwright-version.cjs'),
        ], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        lock = json.loads((ROOT / 'package-lock.json').read_text())
        version = lock['packages']['node_modules/playwright']['version']
        self.assertEqual(result.stdout.strip(), version)
        base = (ROOT / 'apps/web/Dockerfile.workers-base').read_text()
        self.assertNotIn('COPY package-lock.json', base)
        for workflow in ('deploy.yml', 'oss-image.yml'):
            source = (ROOT / '.github/workflows' / workflow).read_text()
            self.assertIn('PLAYWRIGHT_VERSION=${{ env.PLAYWRIGHT_VERSION }}',
                          source)
            self.assertIn('playwright-version.cjs', source)


if __name__ == '__main__':
    unittest.main()
