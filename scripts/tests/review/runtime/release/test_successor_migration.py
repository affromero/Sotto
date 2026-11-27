"""Exercise successor SQL admission with the observed worker image inventory."""

import unittest

from scripts.deploy.review.runtime.release.migrations import admit_successor_migration


class SuccessorMigrationAdmissionTests(unittest.TestCase):
    def setUp(self) -> None:
        def migration(number: int) -> str:
            return f'apps/web/prisma/migrations/{number:02d}_fixture/migration.sql'

        previous_worker = {'sha': 'a' * 40}
        self.image = 'sha256:' + 'c' * 64
        final_worker = {'sha': 'b' * 40, 'imageId': self.image}
        original = {migration(number): f'{number:064x}' for number in range(1, 32)}
        self.candidate = {
            **original, **{migration(number): f'{number:064x}' for number in range(32, 53)},
        }
        self.initial = {'migrations': original, 'receipt': previous_worker}
        self.final = {'migrations': self.candidate, 'receipt': final_worker}
        self.previous = {'stages': [self.initial], 'finalWorker': previous_worker}
        self.successor = {
            'initialStage': dict(self.initial), 'stages': [self.final],
            'finalWorker': final_worker, 'finalWeb': {'sha': final_worker['sha']},
        }

    def test_accepts_the_exact_image_inventory_with_21_appended_migrations(self) -> None:
        self.assertEqual(
            admit_successor_migration(
                self.previous, self.successor, observed=(self.image, self.candidate),
            ),
            (self.initial, self.final),
        )

    def test_refuses_an_image_with_an_unadmitted_migration(self) -> None:
        extra = 'apps/web/prisma/migrations/53_fixture/migration.sql'
        with self.assertRaisesRegex(ValueError, 'migration-files-differ-from-image'):
            admit_successor_migration(
                self.previous, self.successor,
                observed=(self.image, {**self.candidate, extra: 'f' * 64}),
            )

    def test_runtime_only_requires_the_exact_predecessor_inventory(self) -> None:
        original = dict(self.initial['migrations'])
        final = {**self.final, 'migrations': original}
        same_inventory = {**self.successor, 'stages': [final]}
        with self.assertRaisesRegex(ValueError, 'migration-history-changed'):
            admit_successor_migration(
                self.previous, same_inventory, observed=(self.image, original),
            )
        self.assertEqual(
            admit_successor_migration(
                self.previous, {**same_inventory, 'runtimeOnly': True, 'predecessor': {}},
                observed=(self.image, original),
            ),
            (self.initial, final),
        )
        with self.assertRaisesRegex(ValueError, 'runtime-only-migration-inventory-changed'):
            admit_successor_migration(
                self.previous, {**self.successor, 'runtimeOnly': True, 'predecessor': {}},
                observed=(self.image, self.candidate),
            )

    def test_refuses_an_inventory_observed_on_another_worker_image(self) -> None:
        with self.assertRaisesRegex(ValueError, 'migration-files-differ-from-image'):
            admit_successor_migration(
                self.previous, self.successor,
                observed=('sha256:' + 'f' * 64, self.candidate),
            )

    def test_refuses_initial_receipt_from_another_predecessor(self) -> None:
        self.successor['initialStage'] = {**self.initial, 'receipt': {'sha': 'd' * 40}}
        with self.assertRaisesRegex(ValueError, 'initial-migrations-differ-from-predecessor'):
            admit_successor_migration(
                self.previous, self.successor,
                observed=(self.image, self.candidate),
            )

    def test_refuses_a_rewritten_predecessor_migration_in_the_candidate(self) -> None:
        self.candidate[next(iter(self.candidate))] = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'migration-history-changed'):
            admit_successor_migration(
                self.previous, self.successor, observed=(self.image, self.candidate),
            )

    def test_refuses_an_addition_before_the_published_migration_history(self) -> None:
        self.candidate['apps/web/prisma/migrations/00_fixture/migration.sql'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'migrations-must-append-in-order'):
            admit_successor_migration(
                self.previous, self.successor, observed=(self.image, self.candidate),
            )
