"""Exercise host command delivery while retaining the actual shared lock."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.review.egress import TABLE, semantic_policy
from scripts.deploy.review.runtime.operations import HostOperations
from scripts.deploy.review.state import (
    Attempt,
    DeploymentLock,
    atomic_json,
    checksum,
)
from scripts.deploy.review.topology import NETWORK


class HostCommandTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.root.chmod(0o700)
        self.path = self.root / 'fixture.lock'
        self.path.touch(mode=0o600)
        self.lock = DeploymentLock(self.path)
        self.addCleanup(self.lock.close)
        repository = Path(__file__).resolve().parents[4]
        tools = {
            str(path.relative_to(repository)):
            hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (repository / 'scripts/deploy').rglob('*')
            if path.is_file() and path.suffix in {'.py', '.ts', '.cjs'}
        }
        attempt = Attempt.create(self.root, 'fixture', {'tools': tools},
                                 'a' * 64)
        self.operations = HostOperations(attempt, self.lock)

    def test_standard_input_handoff_runs_exact_command_with_same_lock(
        self,
    ) -> None:
        # The system boundary emulates sudo's descriptor closure. The actual
        # bootstrap handoff and final process execute without substitution.
        sudo = self.root / 'sudo'
        sudo.write_text('#!' + sys.executable + '\n' + '''
import os,sys
from pathlib import Path
from scripts.deploy.review.runtime.privileged import handoff
args=sys.argv[1:]
assert args[:4]==['-n','/usr/bin/python3','-m',
                 'scripts.deploy.review.runtime.privileged']
split=args.index('--')
options=dict(zip(args[4:split:2],args[5:split:2]))
os.close(9)
handoff(Path(options['--lock']),Path(options['--payload'])
        if '--payload' in options else None,
        int(options['--owner-uid']),options.get('--payload-sha256'),
        args[split+1:])
''')
        sudo.chmod(0o700)
        target = '''import hashlib,json,os,sys
metadata=os.fstat(9)
print(json.dumps({'device':metadata.st_dev,'inode':metadata.st_ino,
 'sha256':hashlib.sha256(sys.stdin.buffer.read()).hexdigest(),
 'stdinInheritable':os.get_inheritable(0)}))
'''
        for content in (None, b'private fixture input'):
            with self.subTest(contentPresent=content is not None), patch.dict(
                os.environ,
                {'PATH': str(self.root) + ':' + os.environ['PATH']},
            ):
                result = json.loads(self.operations.command(
                    ['sudo', '-n', sys.executable, '-c', target],
                    content=content,
                ))
                metadata = os.fstat(9)
                self.assertEqual(result, {
                    'device': metadata.st_dev, 'inode': metadata.st_ino,
                    'sha256': hashlib.sha256(content or b'').hexdigest(),
                    'stdinInheritable': True,
                })
                self.lock.validate()

    def test_multiple_command_failures_preserve_every_diagnostic(
        self,
    ) -> None:
        for message in ('first fixture failure', 'second fixture failure'):
            with self.assertRaisesRegex(RuntimeError, 'review-command-failed'):
                self.operations.command([
                    sys.executable, '-c',
                    'import sys;sys.stderr.write(' + repr(message)
                    + ');sys.exit(17)',
                ])
        failures = [json.loads(path.read_text()) for path in
                    self.operations.attempt.directory.glob(
                        'command-failure-*.json',
                    )]
        self.assertEqual(len(failures), 2)
        self.assertEqual({item['stderr'] for item in failures}, {
            'first fixture failure', 'second fixture failure',
        })
        self.assertTrue(all(item['exitCode'] == 17 for item in failures))

    def test_changed_bound_runtime_source_refuses_before_root_command(
        self,
    ) -> None:
        tools = self.operations.manifest['tools']
        assert isinstance(tools, dict)
        tools['scripts/deploy/review/runtime/channel.py'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'runtime-tool-changed'):
            self.operations.command([
                'sudo', '-n', sys.executable, '-c',
                'raise RuntimeError("must not execute")',
            ])
        self.assertEqual(list(self.operations.attempt.directory.glob(
            'root-input-*',
        )), [])

    def test_missing_auth_and_activation_source_binding_refuses_root_work(
        self,
    ) -> None:
        tools = self.operations.manifest['tools']
        assert isinstance(tools, dict)
        for name in ('services.py', 'release/__init__.py'):
            retained = tools.pop('scripts/deploy/review/runtime/' + name)
            with self.subTest(source=name), self.assertRaisesRegex(
                ValueError, 'complete-runtime-source',
            ):
                self.operations.command([
                    'sudo', '-n', sys.executable, '-c',
                    'raise RuntimeError("must not execute")',
                ])
            tools['scripts/deploy/review/runtime/' + name] = retained

    def test_guard_rejects_changed_bridge_identity_or_missing_policy_family(
        self,
    ) -> None:
        self.operations.manifest['topology'] = {
            'network': {'id': 'a' * 64},
        }
        networks: list[dict[str, object]] = [
            {'Name': NETWORK, 'Id': 'a' * 64, 'Options': {}},
            {'Name': 'sotto-review_egress', 'Id': 'b' * 64, 'Options': {}},
        ]
        families = {family: {'nftables': [
            {'table': {'family': family, 'name': TABLE}},
            {'rule': {'family': family, 'table': TABLE,
                      'chain': 'forward', 'expr': [{'drop': None}]}},
        ]} for family in ('inet', 'bridge')}
        combined = {'nftables': [entry for policy in families.values()
                                for entry in policy['nftables']]}
        rules = self.root / 'guard.nft'
        rules.write_bytes(b'exact-admitted-rules')
        atomic_json(self.operations.attempt.directory / 'egress.json', {
            'networkId': 'b' * 64,
            'bridges': ['br-' + 'a' * 12, 'br-' + 'b' * 12],
            'policyHash': checksum(semantic_policy(combined)),
            'rulesHash': hashlib.sha256(rules.read_bytes()).hexdigest(),
        })

        def nft(arguments: list[str]) -> bytes:
            return json.dumps(families[arguments[-2]]).encode()

        with (patch('scripts.deploy.review.runtime.operations.RULES_PATH',
                    str(rules)),
              patch.object(HostOperations, 'command', side_effect=nft),
              patch.object(HostOperations, 'docker', side_effect=lambda *args:
                           json.dumps(networks).encode())):
            self.operations.verify_egress()
            original = copy.deepcopy(families['bridge'])
            families['bridge'] = {'nftables': []}
            with self.assertRaisesRegex(ValueError, 'Exactly inet and bridge'):
                self.operations.verify_egress()
            families['bridge'] = original
            networks[1]['Id'] = 'c' * 64
            with self.assertRaisesRegex(ValueError, 'network-identity'):
                self.operations.verify_egress()
