"""Exercise completed review startup recovery against durable local receipts."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from collections.abc import Sequence
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.review.runtime import release
from scripts.deploy.review.runtime.operations import HostOperations
from scripts.deploy.review.runtime.recovery import startup
from scripts.deploy.review.state import Attempt, DeploymentLock, atomic_json, checksum, private_json


class CompletedStartupRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(dir='/tmp')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.attempt = Attempt.create(self.root, 'attempt', {}, 'a' * 64)
        atomic_json(self.attempt.directory / 'state.json', {
            'phase': 'COMPLETE', 'status': 'complete', 'sqlMayHaveStarted': True,
            'manifestSha256': self.attempt.manifest_hash,
        })
        lock_path = self.root / 'lock'
        lock_path.touch(mode=0o600)
        lock = DeploymentLock(lock_path)
        self.addCleanup(lock.close)
        self.attempt.install_marker(self.root / 'unresolved.json')
        self.old = HostOperations(self.attempt, lock)
        self.new = HostOperations(self.attempt, lock)
        self.old.root = self.root / 'previous'
        self.new.root = self.root / 'reviewed'
        self.unit = self.root / 'sotto-review-start.service'
        self.intent = self.attempt.directory / 'startup-unit-intent.json'
        self.receipt = self.attempt.directory / 'startup-unit.json'
        self.addCleanup(patch.stopall)
        patch('scripts.deploy.review.runtime.operations.HOST_STATE', self.root).start()
        patch.object(sys, 'executable', '/usr/bin/python3').start()
        patch.object(startup, 'HOST_STATE', self.root).start()
        patch.object(startup, 'RECOVERY_ROOT', self.root).start()
        patch.object(startup, 'STARTUP_UNIT', self.unit).start()
        patch.object(release, 'STARTUP_UNIT', self.unit).start()
        patch.object(HostOperations, 'verify_fence').start()
        patch.object(HostOperations, 'verify_tools').start()
        patch.object(startup, 'verify_completed_records').start()
        patch.object(HostOperations, 'command', side_effect=self.systemd).start()
        wants = self.root / 'docker.service.wants'
        wants.mkdir()
        relation = wants / self.unit.name
        relation.symlink_to(self.unit)
        real_lstat = Path.lstat

        def system_lstat(path: Path) -> os.stat_result:
            metadata = real_lstat(path)
            if path not in (self.unit, relation):
                return metadata
            values = list(metadata)
            values[4] = 0
            return os.stat_result(values)

        patch.object(Path, 'lstat', system_lstat).start()
        self.unit.write_bytes(release.startup_unit(self.old))
        self.unit.chmod(0o644)
        old = release.startup_binding(self.old)
        atomic_json(self.intent, old)
        atomic_json(self.receipt, {**old, 'enabled': True})
        self.plan = {'sourceRoot': str(self.old.root), 'receiptSha256': checksum(private_json(self.receipt))}
        patch.object(startup, 'reviewed_source', return_value={'startup': self.plan}).start()
        self.lose_reload = False

    def systemd(self, arguments: Sequence[str], *, content: bytes | None = None) -> bytes:
        if list(arguments[:3]) == ['sudo', '-n', 'install']:
            self.assertEqual(list(arguments[3:-1]), [
                '-o', 'root', '-g', 'root', '-m', '0644', '/dev/stdin',
            ])
            assert content is not None
            staging = Path(arguments[-1])
            self.assertEqual(staging.parent, self.unit.parent)
            self.assertTrue(staging.name.startswith('.' + self.unit.name + '-'))
            staging.write_bytes(content)
            staging.chmod(0o644)
        elif list(arguments[:3]) == ['sudo', '-n', 'sync']:
            self.assertTrue(Path(arguments[-1]).exists())
        elif list(arguments[:4]) == ['sudo', '-n', 'mv', '-T']:
            self.assertEqual(Path(arguments[-1]), self.unit)
            Path(arguments[-2]).replace(self.unit)
        elif list(arguments) == ['sudo', '-n', 'systemctl', 'daemon-reload']:
            if self.lose_reload:
                raise RuntimeError('reload interrupted')
        elif '--property=NeedDaemonReload' in arguments:
            return b'no\n'
        elif arguments[:2] == ['systemctl', 'show']:
            return f'FragmentPath={self.unit}\nDropInPaths=\n'.encode()
        elif arguments[:2] == ['systemctl', 'is-enabled']:
            return b'enabled\n'
        else:
            self.fail(f'Unexpected systemd mutation {arguments}')
        return b''

    def test_completes_interrupted_reload_with_exact_startup_and_receipts(self) -> None:
        self.lose_reload = True
        with self.assertRaisesRegex(RuntimeError, 'reload interrupted'):
            startup.recover_startup_source(self.new)
        installed = self.unit.read_bytes()
        self.assertEqual(installed, release.startup_unit(self.new))
        self.assertEqual(checksum(private_json(self.receipt)), self.plan['receiptSha256'])
        self.lose_reload = False
        startup.recover_startup_source(self.new)
        release.verify_startup_unit(self.new)
        self.assertEqual(self.unit.read_bytes(), installed)
        self.assertEqual(private_json(self.intent), release.startup_binding(self.new))
        self.attempt.verify_marker(self.root / 'unresolved.json')

    def test_refuses_an_installed_unit_with_a_foreign_override(self) -> None:
        foreign = self.unit.read_bytes().replace(b'User=sotto', b'User=other')
        self.unit.write_bytes(foreign)
        with self.assertRaisesRegex(ValueError, 'completed-startup-unit-changed'):
            startup.recover_startup_source(self.new)
        self.assertEqual(self.unit.read_bytes(), foreign)
        self.assertEqual(checksum(private_json(self.receipt)), self.plan['receiptSha256'])
