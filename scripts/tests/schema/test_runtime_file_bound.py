"""Review complete relocated runtime assets without weakening byte proofs."""

from copy import deepcopy
import hashlib
import json
import os
import subprocess
import unittest
from unittest.mock import patch

import test_deploy_processes as process_tests

REVIEW = process_tests.REVIEW


class CompleteRuntimeFileReviewTests(unittest.TestCase):
    def setUp(self):
        self.case = process_tests.CompatibilityReviewTests()
        self.case.setUp()
        self.addCleanup(self.case.tearDown)
        self.fixture = self.case.legacy_continuity_fixture()
        self.old = {'protectedHash': '1' * 64, 'files': {}}
        self.candidate = {'protectedHash': '2' * 64, 'files': {}}
        self.pairs = self.fixture['review']['providerActivation'][
            'reviewedRuntimeFiles'
        ]

    def exact_inventory(self, count):
        self.pairs.clear()
        self.old['files'].clear()
        self.candidate['files'].clear()
        for index in range(count):
            path = f'node_modules/thesidedoor-core/dist/p{index:04}.js'
            before = hashlib.sha256(f'previous:{index}'.encode()).hexdigest()
            after = hashlib.sha256(f'candidate:{index}'.encode()).hexdigest()
            if index % 3 != 0:
                self.old['files'][path] = before
            if index % 3 != 1:
                self.candidate['files'][path] = after
            self.pairs[path] = {
                'previousSha256': self.old['files'].get(path),
                'candidateSha256': self.candidate['files'].get(path),
            }
        self.fixture['save_review']()

    def docker(self, arguments, **options):
        if arguments[:2] == ['docker', 'run']:
            reference = arguments[-3]
            if reference == self.case.image:
                value = self.old
            elif reference == self.case.environment['SOTTO_WORKERS_IMAGE_REF']:
                value = self.candidate
            else:
                raise AssertionError('Unreviewed immutable image')
            return subprocess.CompletedProcess(
                arguments, 0, json.dumps(value).encode()
            )
        return self.fixture['docker'](arguments, **options)

    def validate(self):
        with patch.dict(os.environ, self.case.environment), patch.object(
            REVIEW.subprocess, 'run', side_effect=self.docker
        ):
            REVIEW.existing_continuity(self.fixture['bound'], 'blue')

    def test_full_reviews_preserve_additions_removals_and_changes(self):
        for count in [513, 531, 1024]:
            with self.subTest(paths=count):
                self.exact_inventory(count)
                self.assertLess(
                    self.fixture['bound'].stat().st_size, 262144
                )
                self.validate()

    def test_over_1024_paths_rejects_below_raw_byte_cap(self):
        self.exact_inventory(1025)
        self.assertLess(self.fixture['bound'].stat().st_size, 262144)
        with self.assertRaisesRegex(ValueError, 'Bounded exact runtime'):
            self.validate()

    def test_missing_extra_and_wrong_pairs_reject_real_inventory(self):
        self.exact_inventory(531)
        complete = deepcopy(self.pairs)
        for kind in ['missing', 'extra', 'wrong_previous', 'wrong_candidate']:
            self.pairs.clear()
            self.pairs.update(deepcopy(complete))
            path = 'node_modules/thesidedoor-core/dist/p0002.js'
            if kind == 'missing':
                del self.pairs[path]
            elif kind == 'extra':
                self.pairs['node_modules/unobserved.js'] = {
                    'previousSha256': None, 'candidateSha256': 'f' * 64,
                }
            else:
                field = ('previousSha256' if kind == 'wrong_previous'
                         else 'candidateSha256')
                self.pairs[path][field] = 'f' * 64
            self.fixture['save_review']()
            with self.subTest(kind=kind), self.assertRaisesRegex(
                ValueError, 'Runtime changes differ from exact reviewed files'
            ):
                self.validate()

    def test_large_review_rejects_wildcards_and_incomplete_pairs(self):
        self.exact_inventory(531)
        complete = deepcopy(self.pairs)
        for invalid in ['wildcard', 'missing_digest', 'invalid_digest']:
            self.pairs.clear()
            self.pairs.update(deepcopy(complete))
            path = 'node_modules/thesidedoor-core/dist/p0002.js'
            if invalid == 'wildcard':
                self.pairs['node_modules/*'] = self.pairs.pop(path)
            elif invalid == 'missing_digest':
                del self.pairs[path]['previousSha256']
            else:
                self.pairs[path]['candidateSha256'] = 'not-a-hash'
            self.fixture['save_review']()
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                self.validate()

    def test_original_raw_file_and_inventory_byte_caps_remain(self):
        self.exact_inventory(531)
        bound = self.fixture['bound']
        raw = bound.read_bytes()
        bound.write_bytes(raw + b' ' * (262145 - len(raw)))
        with self.assertRaisesRegex(ValueError, 'bounded regular file'):
            self.validate()
        for name in ['review', 'evidence']:
            path = self.case.root / (name + '.json')
            path.write_bytes(b'{}' + b' ' * 262143)
            path.chmod(0o600)
            with self.subTest(file=name), self.assertRaisesRegex(
                ValueError, 'bounded regular file'
            ):
                REVIEW.read_bytes(path, private=True)
        bound.write_bytes(raw)
        self.candidate['padding'] = 'x' * 262144
        with self.assertRaisesRegex(
            ValueError, 'Runtime inventory size bound'
        ):
            self.validate()

    def test_large_review_retains_four_exact_runtime_bindings(self):
        self.exact_inventory(531)
        previous = self.fixture['review'][
            'providerActivation'
        ]['previousRuntimes']
        for service, runtime in previous.items():
            original = runtime['containerId']
            runtime['containerId'] = 'f' * 64
            self.fixture['save_review']()
            with self.subTest(service=service), self.assertRaisesRegex(
                ValueError, 'Captured previous runtime differs from review'
            ):
                self.validate()
            runtime['containerId'] = original
