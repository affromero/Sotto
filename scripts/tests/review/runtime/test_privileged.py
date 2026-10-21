"""Verify standard-input lock handoff and immutable privileged input."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.deploy.review.state import DeploymentLock


class PrivilegedHandoffTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.root.chmod(0o700)
        self.path = self.root / 'fixture.lock'
        self.path.touch(mode=0o600)
        self.lock = DeploymentLock(self.path)
        self.addCleanup(self.lock.close)
        self.payload = self.root / 'payload.json'
        self.original = b'{"ownedFixture":true}'
        self.payload.write_bytes(self.original)
        self.payload.chmod(0o600)
        self.expected = hashlib.sha256(self.original).hexdigest()

    def command(
        self, payload: Path | None, expected: str | None,
        owner: int | None = None,
    ) -> list[str]:
        target = '''import hashlib,json,os,stat,sys,time
from pathlib import Path
print('READY',flush=True)
deadline=time.monotonic()+5
while not Path(GATE).exists():
 if time.monotonic()>deadline: raise RuntimeError('Fixture release expired')
 time.sleep(.01)
metadata=os.fstat(9)
print(json.dumps({'sha256':hashlib.sha256(sys.stdin.buffer.read()).hexdigest(),
 'device':metadata.st_dev,'inode':metadata.st_ino,
 'regular':stat.S_ISREG(metadata.st_mode),
 'stdinInheritable':os.get_inheritable(0)}))
'''.replace('GATE', repr(str(self.root / 'release')))
        body = '''from pathlib import Path
from scripts.deploy.review.runtime.privileged import handoff
try:
 handoff(LOCK,PAYLOAD,OWNER,HASH,[EXECUTABLE,'-c',TARGET])
except (ValueError,OSError) as error:
 print(type(error).__name__)
'''
        for key, value in {
            'LOCK': f'Path({str(self.path)!r})',
            'PAYLOAD': ('None' if payload is None
                        else f'Path({str(payload)!r})'),
            'OWNER': repr(os.geteuid() if owner is None else owner),
            'HASH': repr(expected),
            'EXECUTABLE': repr(sys.executable),
            'TARGET': repr(target),
        }.items():
            body = body.replace(key, value)
        return [sys.executable, '-u', '-c', body]

    def test_captures_payload_before_exec_and_retains_inheritable_lock(
        self,
    ) -> None:
        process = subprocess.Popen(
            self.command(self.payload, self.expected), stdin=9,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        assert process.stdout is not None
        try:
            self.assertEqual(process.stdout.readline(), 'READY\n')
            self.payload.write_bytes(b'changed after verified exec')
            (self.root / 'release').touch()
            output, error = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 0, error)
            result = json.loads(output)
            identity = os.fstat(9)
            self.assertEqual(result, {
                'sha256': self.expected, 'device': identity.st_dev,
                'inode': identity.st_ino, 'regular': True,
                'stdinInheritable': True,
            })
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()

    def test_null_input_restores_open_inheritable_standard_descriptor(
        self,
    ) -> None:
        (self.root / 'release').touch()
        result = subprocess.run(
            self.command(None, None), stdin=9, text=True,
            capture_output=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout.splitlines()[1])
        self.assertEqual(output['sha256'], hashlib.sha256(b'').hexdigest())
        self.assertTrue(output['stdinInheritable'])
        self.assertTrue(output['regular'])

    def test_changed_hash_owner_permissions_and_symlink_refuse_exec(
        self,
    ) -> None:
        link = self.root / 'payload-link'
        link.symlink_to(self.payload)
        for path, expected, owner, permissions in [
            (self.payload, '0' * 64, os.geteuid(), 0o600),
            (self.payload, self.expected, os.geteuid() + 1, 0o600),
            (self.payload, self.expected, os.geteuid(), 0o644),
            (link, self.expected, os.geteuid(), 0o600),
        ]:
            self.payload.chmod(permissions)
            with self.subTest(path=path, owner=owner,
                              permissions=permissions):
                result = subprocess.run(
                    self.command(path, expected, owner), stdin=9,
                    capture_output=True, text=True, timeout=10,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, 'ValueError\n')

    def test_root_entrypoint_rejects_unprivileged_execution(self) -> None:
        if os.geteuid() == 0:
            self.skipTest('This boundary needs an unprivileged test process')
        result = subprocess.run(
            [sys.executable, '-m',
             'scripts.deploy.review.runtime.privileged',
             '--lock', str(self.path), '--owner-uid', str(os.geteuid()),
             '--', sys.executable, '-c', 'print("must not execute")'],
            stdin=9, capture_output=True, text=True, timeout=10,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr,
                         'Privileged review command refused\n')
