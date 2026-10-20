"""Exercise isolated probes through their standalone Docker boundary."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import textwrap

from images.fixtures import ROOT, ReceiptFixture, environment


class SharedImageProbeTests(ReceiptFixture):
    env: dict[str, str]
    source: Path

    def setUp(self) -> None:
        super().setUp()
        self.source = ROOT / 'scripts/deploy/images/queue-names.cjs'
        executable = self.root / 'docker'
        executable.write_text(f'#!{sys.executable}\n' + textwrap.dedent('''
            import fcntl
            import json
            import os
            import sys
            args = sys.argv[1:]
            required = {
                '--pull': 'never', '--network': 'none',
                '--platform': 'linux/amd64', '--tmpfs': '/tmp',
                '--workdir': '/app/apps/web', '--entrypoint': 'node',
            }
            for option, value in required.items():
                if option not in args or args[args.index(option)+1] != value:
                    raise RuntimeError('Unsafe probe runtime: ' + option)
            if '--read-only' not in args or '--rm' not in args:
                raise RuntimeError('Probe filesystem is not isolated')
            for value in (
                'TSX_DISABLE_CACHE=1',
                'TSX_TSCONFIG_PATH=/app/apps/web/tsconfig.json',
                'DATABASE_URL=postgresql://probe:probe@127.0.0.1:1/probe',
                'REDIS_URL=redis://127.0.0.1:1/15',
            ):
                if value not in args:
                    raise RuntimeError('Probe initialization is incomplete')
            if ('--require' not in args
                    or args[args.index('--require')+1] != 'tsx/cjs'):
                raise RuntimeError('Runtime TypeScript imports are unavailable')
            if os.environ.get('EXPECT_LOCK') == '1':
                os.fstat(9)
                with open(os.environ['PROBE_LOCK'], 'a') as competitor:
                    try:
                        fcntl.flock(competitor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        pass
                    else:
                        raise RuntimeError('Deployment lock was released')
            if os.environ.get('FAIL_PROBE') == '1':
                print('fixture transform failure', file=sys.stderr)
                raise SystemExit(7)
            if os.environ.get('EMPTY_PROBE') != '1':
                print(json.dumps(['audio-generation', 'class-preparation']))
        '''))
        executable.chmod(0o700)
        self.env = {
            **environment(),
            'PATH': str(self.root) + os.pathsep + os.environ['PATH'],
        }

    def run_probe(
        self, locked: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        arguments = [
            str(ROOT / 'scripts/deploy/images/probe.py'),
            '--reference', 'fixture/worker@sha256:' + 'a' * 64,
            '--source', str(self.source), '--tsx',
        ]
        if locked:
            launcher = textwrap.dedent('''
                import fcntl
                import os
                import sys
                descriptor = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT, 0o600)
                fcntl.flock(descriptor, fcntl.LOCK_EX)
                os.dup2(descriptor, 9)
                os.set_inheritable(9, True)
                if descriptor != 9:
                    os.close(descriptor)
                os.execv(sys.executable, [sys.executable, *sys.argv[2:]])
            ''')
            lock = self.root / 'production.lock'
            self.env.update(EXPECT_LOCK='1', PROBE_LOCK=str(lock))
            arguments = ['-c', launcher, str(lock), *arguments]
        return subprocess.run(
            [sys.executable, *arguments], cwd=self.root, env=self.env,
            text=True, capture_output=True,
        )

    def test_standalone_probe_works_outside_checkout_with_full_isolation(
        self,
    ) -> None:
        result = self.run_probe()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout), [
            'audio-generation', 'class-preparation',
        ])

    def test_deployment_lock_remains_held_through_python_and_docker_children(
        self,
    ) -> None:
        result = self.run_probe(locked=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(json.loads(result.stdout))

    def test_probe_failure_surfaces_stderr_without_queue_output(self) -> None:
        self.env['FAIL_PROBE'] = '1'
        result = self.run_probe()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertIn('fixture transform failure', result.stderr)

    def test_empty_probe_output_cannot_be_admitted_as_evidence(self) -> None:
        self.env['EMPTY_PROBE'] = '1'
        result = self.run_probe()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertIn('no evidence', result.stderr)
