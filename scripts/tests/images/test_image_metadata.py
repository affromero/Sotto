"""Reject image receipts that cannot safely drive production admission."""

from __future__ import annotations

from images.fixtures import PROVENANCE, SHA, ReceiptFixture, field, receipt


class ImageMetadataTests(ReceiptFixture):
    def test_rerun_preserves_successful_receipts_from_earlier_attempts(
        self,
    ) -> None:
        field(self.receipts['workers'], 'provenance')['runAttempt'] = 2
        status, output, metadata = self.aggregate(attempt=2)
        self.assertEqual(status, 0, output)
        assert metadata is not None
        self.assertEqual(metadata['provenance'],
                         {**PROVENANCE, 'runAttempt': 2})
        self.assertEqual(metadata['images'], self.receipts)
        # Repeating final aggregation retains original image evidence.
        status, output, metadata = self.aggregate(attempt=3)
        self.assertEqual(status, 0, output)
        assert metadata is not None
        self.assertEqual(metadata['images'], self.receipts)

    def test_rerun_rejects_future_attempts_and_different_source_or_runs(
        self,
    ) -> None:
        for key, value in (
            ('runAttempt', 3), ('runAttempt', 0), ('runAttempt', True),
            ('runId', 124), ('sourceRunId', 101),
            ('repository', 'other/Sotto'),
            ('workflow', '.github/workflows/oss-image.yml'),
        ):
            with self.subTest(key=key, value=value):
                self.receipts['showcase'] = receipt('showcase')
                field(self.receipts['showcase'], 'provenance')[key] = value
                status, output, _ = self.aggregate(attempt=2)
                self.assertNotEqual(status, 0, output)

    def test_three_role_metadata_preserves_actual_budgets_and_identity(
        self,
    ) -> None:
        status, output, metadata = self.aggregate()
        self.assertEqual(status, 0, output)
        self.assertIsNotNone(metadata)
        assert metadata is not None
        self.assertEqual(metadata['sha'], SHA)
        self.assertEqual(metadata['provenance'], PROVENANCE)
        self.assertEqual(metadata['images'], self.receipts)

    def test_source_platform_role_digest_and_run_substitution_are_rejected(
        self,
    ) -> None:
        for key, value in (
            ('sha', 'd' * 40), ('revision', 'd' * 40),
            ('source', 'https://example.test/other'),
            ('platform', 'linux/arm64'), ('role', 'workers'),
            ('reference', receipt('workers')['reference']),
            ('imageId', 'sha256:' + 'c' * 64), ('schemaVersion', True),
            ('configDigest', 'not-a-digest'),
            ('provenance', {**PROVENANCE, 'runId': 999}),
        ):
            with self.subTest(key=key):
                self.receipts['showcase'] = {**receipt('showcase'), key: value}
                status, output, _ = self.aggregate()
                self.assertNotEqual(status, 0, output)

    def test_missing_role_or_measurement_never_produces_metadata(self) -> None:
        del self.receipts['workers']
        status, output, _ = self.aggregate()
        self.assertNotEqual(status, 0, output)
        self.receipts['workers'] = receipt('workers')
        del field(self.receipts['showcase'], 'measurement')['archive_bytes']
        status, output, _ = self.aggregate()
        self.assertNotEqual(status, 0, output)

    def test_zero_boolean_and_underreported_bounds_are_rejected(self) -> None:
        for key, value in (
            ('expanded_bytes', 0), ('compressed_bytes', 1),
            ('layer_file_count', True), ('expanded_bytes', 8192),
        ):
            with self.subTest(key=key, value=value):
                self.receipts['showcase'] = receipt('showcase')
                field(self.receipts['showcase'], 'measurement')[key] = value
                status, output, _ = self.aggregate()
                self.assertNotEqual(status, 0, output)

    def test_runtime_requires_complete_sorted_canonical_evidence(self) -> None:
        for key, value in (
            ('schemaHash', ''), ('rollingContract', 'z' * 64),
            ('queueNames', ['class-preparation', 'audio-generation']),
            ('queueNames', ['audio-generation', 'audio-generation']),
            ('providerAssets', {'protectedHash': 'f' * 64, 'files': {}}),
            ('providerAssets', {'protectedHash': 'f' * 64,
                                'files': {'../outside': 'd' * 64}}),
        ):
            with self.subTest(key=key):
                self.receipts['workers'] = receipt('workers')
                field(self.receipts['workers'], 'runtime')[key] = value
                status, output, _ = self.aggregate()
                self.assertNotEqual(status, 0, output)

    def test_old_release_record_shape_is_preserved(self) -> None:
        self.release['extra'] = 'unexpected'
        status, output, _ = self.aggregate()
        self.assertNotEqual(status, 0, output)
