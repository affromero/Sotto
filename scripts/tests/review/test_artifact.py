"""Exercise isolated review receipts through actual collector commands."""

from __future__ import annotations

import json
import subprocess
import sys
from typing import cast

from images.fixtures import PROVENANCE, ROOT, SHA
from images.test_image_collect import ImageCollectorFixture


class ReviewArtifactTests(ImageCollectorFixture):
    def setUp(self) -> None:
        super().setUp()
        self.reference = (
            'ghcr.io/affromero/sotto-review-web@'
            + cast(str, self.image['Id'])
        )
        self.image['RepoDigests'] = [self.reference]
        config = cast(dict[str, object], self.image['Config'])
        config['User'] = '1000'
        labels = cast(dict[str, object], config['Labels'])
        labels['io.sotto.public-origin'] = 'https://demo.sotto.fm'

    def receipt_command(
        self, operation: str,
    ) -> subprocess.CompletedProcess[str]:
        (self.root / 'inspection.json').write_text(json.dumps([self.image]))
        return subprocess.run([
            sys.executable, '-m', 'scripts.deploy.review.artifact',
            operation, '--release-sha', SHA, '--reference', self.reference,
            '--receipt', str(self.root / 'review.json'),
            '--run-id', '123', '--run-attempt', '1',
            '--source-run-id', '100',
        ], cwd=ROOT, env=self.env, text=True, capture_output=True)

    def test_review_image_has_its_own_origin_bound_receipt(self) -> None:
        result = self.receipt_command('collect')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = json.loads((self.root / 'review.json').read_text())
        self.assertEqual(receipt['purpose'], 'sotto-review-upgrade')
        self.assertEqual(receipt['publicOrigin'], 'https://demo.sotto.fm')
        self.assertEqual(receipt['runtimeUid'], 1000)
        self.assertEqual(receipt['imageId'], self.image['Id'])
        self.assertEqual(receipt['provenance'], PROVENANCE)
        self.assertEqual(receipt['measurement']['expanded_bytes'], 8192)
        self.assertNotIn('role', receipt)
        self.assertNotIn('Env', receipt)
        self.assertNotIn('Labels', receipt)
        verified = self.receipt_command('validate')
        self.assertEqual(verified.returncode, 0,
                         verified.stdout + verified.stderr)

    def test_wrong_build_origin_or_user_cannot_produce_a_receipt(self) -> None:
        config = cast(dict[str, object], self.image['Config'])
        labels = cast(dict[str, object], config['Labels'])
        for origin, user in [
                ('https://sotto.fm', '1000'),
                ('https://demo.sotto.fm', '1001')]:
            with self.subTest(origin=origin, user=user):
                labels['io.sotto.public-origin'] = origin
                config['User'] = user
                result = self.receipt_command('collect')
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / 'review.json').exists())

    def test_receipt_cannot_substitute_actions_identities(self) -> None:
        result = self.receipt_command('collect')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        path = self.root / 'review.json'
        original = path.read_bytes()
        for field in ['runId', 'runAttempt', 'sourceRunId']:
            with self.subTest(field=field):
                receipt = json.loads(original)
                receipt['provenance'][field] = 999
                path.write_text(json.dumps(receipt))
                rejected = self.receipt_command('validate')
                self.assertNotEqual(rejected.returncode, 0)
                self.assertIn('verified Actions runs', rejected.stderr)

    def test_incompatible_receipt_fields_are_rejected(self) -> None:
        result = self.receipt_command('collect')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        path = self.root / 'review.json'
        original = path.read_bytes()
        variants = [
            {'publicOrigin': 'https://sotto.fm'},
            {'runtimeUid': True},
            {'role': 'showcase'},
            {'measurement': {'expanded_bytes': 1}},
            {'revision': 'b' * 40},
            {'configDigest': 'invalid'},
            {'imageId': 'sha256:' + 'b' * 64},
        ]
        for changed in variants:
            with self.subTest(changed=changed):
                receipt = json.loads(original)
                receipt.update(changed)
                path.write_text(json.dumps(receipt))
                self.assertNotEqual(
                    self.receipt_command('validate').returncode, 0,
                )

    def test_production_reference_cannot_be_certified_for_review(self) -> None:
        self.reference = self.reference.replace(
            'sotto-review-web', 'sotto-web-prod',
        )
        result = self.receipt_command('collect')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'review.json').exists())
