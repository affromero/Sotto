"""Keep image receipts and stable caches on trusted publishing paths."""

from __future__ import annotations

import json
import os
import subprocess
import unittest

from images.fixtures import ROOT, ReceiptFixture


class ImageWorkflowTests(ReceiptFixture):
    def test_reruns_download_exact_receipts_and_preserve_attempt_artifacts(
        self,
    ) -> None:
        result = subprocess.run([
            'node', '-e',
            'process.stdout.write(JSON.stringify(require("yaml").parse('
            'require("node:fs").readFileSync(process.argv[1], "utf8")).jobs))',
            str(ROOT / '.github/workflows/deploy.yml'),
        ], cwd=ROOT, text=True, capture_output=True, check=True)
        jobs = json.loads(result.stdout)
        for role in ('showcase', 'personal', 'workers'):
            job = jobs[role]
            upload = next(step for step in job['steps']
                          if step.get('id') == 'metadata')
            self.assertEqual(job['outputs']['metadata-id'],
                             '${{ steps.metadata.outputs.artifact-id }}')
            self.assertEqual(
                upload['with']['name'],
                'production-image-metadata-${{ env.RELEASE_SHA }}-'
                + role + '-${{ github.run_attempt }}')
            self.assertFalse(upload['with'].get('overwrite', False))
        steps = jobs['release-record']['steps']
        selection = next(step for step in steps
                         if step.get('id') == 'receipts')
        self.assertEqual(selection['env'], {
            role.upper() + '_METADATA_ID':
                '${{ needs.' + role + '.outputs.metadata-id }}'
            for role in ('showcase', 'personal', 'workers')
        })
        output = self.root / 'selected-ids'
        for identifiers, admitted in (
            (('101', '102', '103'), True), (('', '102', '103'), False),
            (('101', '101', '103'), False), (('0', '102', '103'), False),
            (('101\n102', '102', '103'), False),
        ):
            with self.subTest(identifiers=identifiers):
                status = subprocess.run(
                    ['bash', '-e', '-o', 'pipefail', '-c', selection['run']],
                    env={**os.environ, 'GITHUB_OUTPUT': str(output),
                         **dict(zip(selection['env'], identifiers))},
                    text=True, capture_output=True,
                )
                self.assertEqual(status.returncode == 0, admitted,
                                 status.stdout + status.stderr)
                if admitted:
                    self.assertEqual(output.read_text(), 'ids=101,102,103\n')
        download = next(step for step in steps if step.get('uses', '')
                        .startswith('actions/download-artifact@'))
        self.assertNotIn('pattern', download['with'])
        self.assertEqual(download['with']['artifact-ids'],
                         '${{ steps.receipts.outputs.ids }}')
        self.assertEqual(download['with']['run-id'], '${{ github.run_id }}')
        self.assertEqual(download['with']['repository'],
                         '${{ github.repository }}')
        self.assertIs(download['with']['merge-multiple'], True)
        final = next(step for step in steps if step.get('uses', '')
                     .startswith('actions/upload-artifact@'))
        self.assertIs(final['with']['overwrite'], True)
        self.assertEqual(final['with']['path'].splitlines(), [
            'delivery/production-release.json',
            'delivery/production-release-metadata.json',
        ])

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
        cleanup = source.index('RUN node /tmp/prune-worker.cjs')
        self.assertLess(cleanup, source.index('# ---- Stage 2:'))

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
