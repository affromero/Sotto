"""Check that rollback cannot outlive its pre-SQL evidence."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.deploy.review.runtime.release import rollback
from scripts.deploy.review.state import PHASES, ROLLBACK_COMPLETE, Attempt, atomic_json


class PreSqlRollbackTests(unittest.TestCase):
    def attempt_at(self, phase: str, *, predecessor: bool = True) -> Attempt:
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        root.chmod(0o700)
        attempt = Attempt.create(root, 'review', {'predecessor': {}} if predecessor else {}, 'a' * 64)
        for index in range(1, PHASES.index(phase) + 1):
            attempt.advance(PHASES[index])
        return attempt

    def test_held_fenced_attempt_can_roll_back_before_sql(self) -> None:
        for phase in ('FENCED', 'QUIESCENT', 'BACKED_UP'):
            with self.subTest(phase=phase):
                attempt = self.attempt_at(phase)
                attempt.unresolved('runtime-deadline')
                self.assertEqual(rollback.require_pre_sql(attempt), attempt.state())

    def test_rollback_rejects_an_active_attempt_or_a_sql_intent(self) -> None:
        active = self.attempt_at('FENCED')
        with self.assertRaisesRegex(ValueError, 'fenced-pre-sql-review-rollback-required'):
            rollback.require_pre_sql(active)
        sql = self.attempt_at('SQL_STARTED')
        sql.unresolved('runtime-deadline')
        with self.assertRaisesRegex(ValueError, 'fenced-pre-sql-review-rollback-required'):
            rollback.require_pre_sql(sql)

    def test_rollback_refuses_an_initial_release_or_any_activation_receipt(self) -> None:
        initial = self.attempt_at('FENCED', predecessor=False)
        initial.unresolved('runtime-deadline')
        with self.assertRaisesRegex(ValueError, 'completed-review-predecessor-required'):
            rollback.require_pre_sql(initial)
        successor = self.attempt_at('FENCED')
        successor.unresolved('runtime-deadline')
        atomic_json(successor.directory / 'candidate-compose.json', {})
        with self.assertRaisesRegex(ValueError, 'successor-activation-already-recorded'):
            rollback.require_pre_sql(successor)

    def test_marker_release_can_resume_after_disposition_without_replacing_it(self) -> None:
        attempt = self.attempt_at('FENCED')
        attempt.unresolved('runtime-deadline')
        state = (attempt.directory / 'state.json').read_bytes()
        root = attempt.directory.parent
        marker = root / 'unresolved.json'
        attempt.install_marker(marker)
        result = {'manifestSha256': attempt.manifest_hash, 'restored': True}
        disposition = attempt.directory / ROLLBACK_COMPLETE
        atomic_json(disposition, result)
        with patch.object(rollback, 'HOST_STATE', root):
            rollback.release_rollback_marker(attempt, result)
            rollback.release_rollback_marker(attempt, result)
            self.assertFalse(marker.exists())
            with self.assertRaisesRegex(ValueError, 'rollback-disposition-changed'):
                rollback.release_rollback_marker(attempt, {**result, 'restored': False})
        self.assertEqual((attempt.directory / 'state.json').read_bytes(), state)

    def test_foreign_marker_prevents_rollback_commit(self) -> None:
        attempt = self.attempt_at('FENCED')
        root = attempt.directory.parent
        other = Attempt.create(root, 'other', {}, 'a' * 64)
        marker = root / 'unresolved.json'
        other.install_marker(marker)
        with patch.object(rollback, 'HOST_STATE', root):
            with self.assertRaisesRegex(ValueError, 'marker does not match'):
                rollback.release_rollback_marker(attempt, {'restored': True})
        self.assertFalse((attempt.directory / ROLLBACK_COMPLETE).exists())
        other.verify_marker(marker)
