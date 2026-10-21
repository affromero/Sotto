"""Durable fences and inherited shared locks for review upgrades."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.deploy.review.state import (
    PHASES,
    Attempt,
    atomic_json,
    private_json,
)

ROOT = Path(__file__).resolve().parents[3]


class DurableAttemptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.root.chmod(0o700)
        self.attempt = Attempt.create(
            self.root, 'upgrade-a', {'source': 'a' * 40}, 'b' * 64,
        )
        self.marker = self.root / 'unresolved.json'

    def test_sql_fence_survives_process_loss_and_only_exact_completion_clears(
        self,
    ) -> None:
        self.attempt.install_marker(self.marker)
        for phase in PHASES[1:PHASES.index('SQL_STARTED') + 1]:
            self.attempt.advance(phase)
        reopened = Attempt(self.attempt.directory)
        reopened.verify_marker(self.marker)
        self.assertTrue(reopened.state()['sqlMayHaveStarted'])
        reopened.unresolved('migration-failed')
        with self.assertRaisesRegex(ValueError, 'completed attempt'):
            reopened.clear_marker(self.marker)
        for phase in PHASES[PHASES.index('SQL_STARTED') + 1:]:
            reopened.advance(phase)
        reopened.clear_marker(self.marker)
        self.assertFalse(self.marker.exists())
        self.assertEqual(reopened.state()['status'], 'complete')
        self.assertEqual(
            stat.S_IMODE((reopened.directory / 'state.json').stat().st_mode),
            0o600,
        )

    def test_existing_or_foreign_marker_is_never_replaced_or_cleared(
        self,
    ) -> None:
        self.attempt.install_marker(self.marker)
        original = self.marker.read_bytes()
        other = Attempt.create(
            self.root, 'upgrade-b', {'source': 'c' * 40}, 'd' * 64,
        )
        with self.assertRaisesRegex(ValueError, 'marker exists'):
            other.install_marker(self.marker)
        with self.assertRaisesRegex(ValueError, 'does not match'):
            other.clear_marker(self.marker)
        self.assertEqual(self.marker.read_bytes(), original)
        self.assertFalse((other.directory / 'marker.json').exists())

    def test_changed_manifest_or_missing_irreversible_marker_fails_closed(
        self,
    ) -> None:
        original = self.attempt.manifest()
        atomic_json(self.attempt.directory / 'manifest.json', {'other': True})
        with self.assertRaisesRegex(ValueError, 'manifest changed'):
            self.attempt.state()
        atomic_json(self.attempt.directory / 'manifest.json', original)
        value = self.attempt.state()
        value['phase'] = 'SQL_STARTED'
        atomic_json(self.attempt.directory / 'state.json', value)
        with self.assertRaisesRegex(ValueError, 'schema marker'):
            self.attempt.state()

    def test_phase_skips_and_secret_failure_text_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, 'advance exactly once'):
            self.attempt.advance('SQL_STARTED')
        with self.assertRaisesRegex(ValueError, 'sanitized failure category'):
            self.attempt.unresolved('password=private')
        self.assertEqual(self.attempt.state()['phase'], 'PRECHECK')

    def test_public_or_symlinked_inputs_are_rejected(self) -> None:
        binding = self.attempt.directory / 'binding.json'
        binding.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'private input'):
            Attempt(self.attempt.directory)
        binding.chmod(0o600)
        link = self.root / 'link.json'
        link.symlink_to(binding)
        with self.assertRaises(OSError):
            private_json(link)


class InheritedLockTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.lock = self.root / 'shared.lock'
        self.lock.touch(mode=0o644)

    def run_child(self, script: str) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [sys.executable, '-c', script, str(self.lock)],
            cwd=ROOT, env={**os.environ, 'PYTHONPATH': str(ROOT)},
            capture_output=True, text=True, timeout=10, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def test_mutating_child_inherits_same_open_description_without_lock_gap(
        self,
    ) -> None:
        result = self.run_child('''
import fcntl,json,os,subprocess,sys
from pathlib import Path
from scripts.deploy.review.state import DeploymentLock
path=Path(sys.argv[1]); lock=DeploymentLock(path)
code=''' + repr('''
import fcntl,json,os,sys
from pathlib import Path
from scripts.deploy.review.state import DeploymentLock
lock=DeploymentLock(Path(sys.argv[1]),9)
fd=os.open(sys.argv[1],os.O_RDONLY)
try:
 fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 raise RuntimeError('overlapping writer acquired the lock')
except BlockingIOError:
 print(json.dumps({'inherited':True,'fd':lock.descriptor}))
finally:
 os.close(fd)
''') + '''
result=lock.run([sys.executable,'-c',code,str(path)],timeout=5)
sys.stdout.buffer.write(result.stdout);sys.stderr.buffer.write(result.stderr)
lock.close();sys.exit(result.returncode)
''')
        self.assertEqual(
            json.loads(result.stdout), {'inherited': True, 'fd': 9},
        )

    def test_replaced_lock_path_and_symlink_cannot_authorize_children(
        self,
    ) -> None:
        self.run_child('''
import os,sys
from pathlib import Path
from scripts.deploy.review.state import DeploymentLock
path=Path(sys.argv[1]);lock=DeploymentLock(path)
path.rename(path.with_suffix('.old'));path.touch()
try:
 lock.run([sys.executable,'-c','raise RuntimeError("must not run")'])
 raise RuntimeError('changed lock was accepted')
except ValueError:
 pass
finally:
 lock.close()
path.unlink();path.symlink_to(path.with_suffix('.old'))
try:
 DeploymentLock(path)
 raise RuntimeError('symlink lock was accepted')
except OSError:
 pass
''')


if __name__ == '__main__':
    unittest.main()
