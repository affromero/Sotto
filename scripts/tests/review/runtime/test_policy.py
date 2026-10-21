"""Bound demo services and every concurrent maintenance helper."""

from __future__ import annotations

import copy
import importlib
import json
import os
import subprocess
import tempfile
import unittest
from collections.abc import Sequence
from pathlib import Path
from typing import cast
from unittest.mock import patch

from scripts.deploy.review.runtime.operations import HostOperations
from scripts.deploy.review.runtime.policy import (
    concurrent_memory,
    helper_arguments,
    helper_memory,
    role_command,
    runtime_policy,
)
from scripts.deploy.review.state import (
    Attempt,
    DeploymentLock,
    checksum,
    private_json,
)
from scripts.tests.review.runtime import admitted_runtime_fixture


class ReviewResourcePolicyTests(unittest.TestCase):
    def test_capacity_preserves_reserve_and_counts_the_concurrent_helper(
        self,
    ) -> None:
        manifest = admitted_runtime_fixture()
        candidate = concurrent_memory(manifest)
        self.assertEqual(candidate, 2048 * 1024 * 1024)
        guard = importlib.import_module('scripts.deploy.stop-workers')
        guard.require_overlap_memory(
            'MemTotal: 8388608 kB\nMemAvailable: 2621440 kB\n', candidate,
        )
        with self.assertRaises(ValueError):
            guard.require_overlap_memory(
                'MemTotal: 8388608 kB\nMemAvailable: 2621439 kB\n',
                candidate,
            )

    def test_role_and_helper_commands_keep_the_canonical_entrypoints(
        self,
    ) -> None:
        manifest = admitted_runtime_fixture()
        policy = runtime_policy(manifest)
        self.assertEqual(role_command(policy, 'web'), [
            'node', '--max-old-space-size=256', 'server.js',
        ])
        self.assertEqual(role_command(policy, 'workers'), [
            'node', '--max-old-space-size=512', '--import', 'tsx',
            'src/workers/index.ts',
        ])
        self.assertEqual(helper_arguments(manifest, 'node', ['-e', '1']),
                         ['--max-old-space-size=192', '-e', '1'])
        self.assertEqual(helper_arguments(manifest, 'npx', ['prisma']),
                         ['prisma'])
        self.assertEqual(helper_memory(manifest), 384 * 1024 * 1024)
        for option in ('--max-old-space-size=999',
                       '--max_old_space_size=999', '--max_old_space_size'):
            with self.subTest(option=option), self.assertRaises(ValueError):
                helper_arguments(manifest, 'node', [option])

    def test_admitted_heap_wins_over_captured_operator_heap_aliases(
        self,
    ) -> None:
        probe = 'require("v8").getHeapStatistics().heap_size_limit'
        baseline = subprocess.run([
            'node', '--max-old-space-size=192', '-p', probe,
        ], env={**os.environ, 'NODE_OPTIONS': ''},
            check=True, capture_output=True, timeout=10).stdout
        for original in ('--max-old-space-size=384',
                         '--max_old_space_size=384'):
            with self.subTest(original=original):
                result = subprocess.run(['node', '-p', probe], env={
                    **os.environ, 'NODE_OPTIONS': original
                    + ' --max-old-space-size=192'},
                    check=True, capture_output=True, timeout=10)
                self.assertEqual(result.stdout, baseline)
        for original in ('--max-old-space-size 384',
                         '--max_old_space_size 384'):
            with self.subTest(original=original):
                result = subprocess.run(['node', '-p', probe], env={
                    **os.environ, 'NODE_OPTIONS': original
                    + ' --max-old-space-size=192'},
                    check=False, capture_output=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b'Error', result.stderr)

    def test_unknown_settings_and_missing_native_cushion_refuse(
        self,
    ) -> None:
        for section, key, value in (
            ('runtimePolicy', 'skipFence', True),
            ('runtimePolicy', 'webHeapMiB', True),
            ('runtimePolicy', 'workerHeapMiB', 1152),
            ('runtimePolicy', 'helperHeapMiB', 384),
            ('runtimePolicy', 'queueConcurrency', 2),
            ('resources', 'helperMemoryBytes', None),
        ):
            with self.subTest(setting=key), self.assertRaises(ValueError):
                manifest = copy.deepcopy(admitted_runtime_fixture())
                cast(dict[str, object], manifest[section])[key] = value
                runtime_policy(manifest)


class HelperResourceBindingTests(unittest.TestCase):
    def test_maintenance_limits_are_journaled_before_create_and_survive_audit(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root.chmod(0o700)
            path = root / 'fixture.lock'
            path.touch(mode=0o600)
            lock = DeploymentLock(path)
            self.addCleanup(lock.close)
            original_environment = {'NODE_OPTIONS':
                                    '--max-old-space-size=384'}
            original: dict[str, object] = {
                'Id': 'b' * 64, 'Image': 'sha256:' + 'c' * 64,
                'Config': {'Env': ['NODE_OPTIONS=' +
                                   original_environment['NODE_OPTIONS']]},
                'State': {'Running': True, 'Pid': 123},
                'Mounts': [{'Source': str(root / 'storage'),
                            'Destination': '/storage', 'RW': True}],
            }
            manifest = {**admitted_runtime_fixture(), 'topology': {
                'services': {'web': {
                    'id': original['Id'], 'imageId': original['Image'],
                    'environmentHash': checksum(original_environment),
                }},
            }}
            attempt = Attempt.create(root, 'rendered-limits', manifest,
                                     'a' * 64)
            operations = HostOperations(attempt, lock)
            helpers: dict[str, dict[str, object]] = {}

            def command(
                arguments: Sequence[str], *, content: bytes | None = None,
                timeout: float | None = 60,
            ) -> bytes:
                del timeout
                lock.validate()
                if arguments[0] == 'sudo':
                    request = json.loads(content or b'{}')
                    return json.dumps({
                        'sources': {source: {'path': source,
                                           'ancestors': [[1, 2]]}
                                    for source in request['sources']},
                        'mounted': {item['key']: [1, 2]
                                    for item in request['mounted']},
                    }).encode()
                action = list(arguments[1:])
                if action[:2] == ['image', 'inspect']:
                    return json.dumps([{'Id': 'sha256:' + 'c' * 64,
                                        'Config': {'Env': []}}]).encode()
                if action == ['ps', '-aq', '--no-trunc']:
                    return ('b' * 64).encode()
                if action[0] == 'inspect':
                    return json.dumps([original if action[1] == 'b' * 64
                                       else helpers[action[1]]]).encode()
                if action[0] == 'create':
                    env_file = Path(action[action.index('--env-file') + 1])
                    values = dict(line.split('=', 1) for line in
                                  env_file.read_text().splitlines())
                    for index, item in enumerate(action):
                        if item == '--env':
                            key, value = action[index + 1].split('=', 1)
                            values[key] = value
                    self.assertEqual(env_file.stat().st_mode & 0o777, 0o600)
                    self.assertEqual(values['NODE_OPTIONS'],
                                     '--max-old-space-size=384 '
                                     '--max-old-space-size=192')
                    entrypoint = action[action.index('--entrypoint') + 1]
                    argv = action[action.index('--entrypoint') + 3:]
                    memory = int(action[action.index('--memory') + 1])
                    self.assertEqual(memory, 384 * 1024 * 1024)
                    self.assertEqual(action[action.index('--memory-swap') + 1],
                                     str(memory))
                    prepared = [private_json(item) for item in
                                attempt.directory.glob('helper-*.json')
                                if private_json(item)['status'] == 'prepared']
                    self.assertEqual(len(prepared), 1)
                    self.assertEqual(prepared[0]['argumentsHash'],
                                     checksum(argv))
                    self.assertEqual(prepared[0]['environmentHash'],
                                     checksum(values))
                    self.assertEqual(prepared[0]['memoryBytes'], memory)
                    identity = ('d' if entrypoint == 'node' else 'e') * 64
                    helpers[identity] = {
                        'Id': identity, 'Image': 'sha256:' + 'c' * 64,
                        'Name': '/' + action[action.index('--name') + 1],
                        'Config': {'Entrypoint': [entrypoint], 'Cmd': argv,
                                   'Labels': {'io.sotto.review-attempt':
                                              attempt.manifest_hash},
                                   'User': '1000', 'Env': [key + '=' + value
                                                         for key, value in
                                                         values.items()]},
                        'HostConfig': {'ReadonlyRootfs': True,
                                       'Privileged': False,
                                       'NetworkMode': 'none',
                                       'Memory': memory, 'MemorySwap': memory},
                        'State': {'Running': False, 'OOMKilled': False,
                                  'ExitCode': 0},
                    }
                    if entrypoint == 'node':
                        self.assertEqual(argv[0], '--max-old-space-size=192')
                    else:
                        self.assertEqual(argv, ['prisma', '--version'])
                    measured = subprocess.run([
                        'node', '-p',
                        'require("v8").getHeapStatistics().heap_size_limit',
                    ], env={**os.environ,
                            'NODE_OPTIONS': values['NODE_OPTIONS']},
                        check=True, capture_output=True, timeout=10)
                    baseline = subprocess.run([
                        'node', '--max-old-space-size=192', '-p',
                        'require("v8").getHeapStatistics().heap_size_limit',
                    ], env={**os.environ, 'NODE_OPTIONS': ''},
                        check=True, capture_output=True, timeout=10)
                    self.assertEqual(measured.stdout, baseline.stdout)
                    return identity.encode()
                if action[:2] == ['start', '-ai']:
                    return b'completed'
                raise AssertionError('Unexpected external command')

            with patch.object(HostOperations, 'command', side_effect=command):
                for entrypoint, argv in (
                    ('node', ['-e', '1']),
                    ('npx', ['prisma', '--version']),
                ):
                    self.assertEqual(operations.image_command(
                        {'reference': 'sha256:' + 'c' * 64,
                         'sha': 'a' * 40}, entrypoint, argv, network='none',
                    ), b'completed')
            journals = [private_json(item) for item in
                        attempt.directory.glob('helper-*.json')]
            self.assertEqual([item['status'] for item in journals],
                             ['settled', 'settled'])
            self.assertEqual(operations.private_environment,
                             original_environment)

    def test_wrong_heap_caps_swap_or_environment_refuse_before_helper_start(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root.chmod(0o700)
            path = root / 'fixture.lock'
            path.touch(mode=0o600)
            lock = DeploymentLock(path)
            self.addCleanup(lock.close)
            attempt = Attempt.create(root, 'resource-binding',
                                     admitted_runtime_fixture(), 'a' * 64)
            operations = HostOperations(attempt, lock)
            arguments = ['--max-old-space-size=192', '-e', '1']
            binding = {
                'entrypoint': 'node', 'argumentsHash': checksum(arguments),
                'memoryBytes': 384 * 1024 * 1024,
                'environmentHash': checksum({'NODE_OPTIONS':
                                             '--max-old-space-size=192'}),
                'network': 'none',
            }
            actual: dict[str, object] = {
                'Id': 'b' * 64, 'Image': 'sha256:' + 'c' * 64,
                'Name': '/sotto-review-tool-fixture',
                'Config': {'Labels': {'io.sotto.review-attempt':
                                      attempt.manifest_hash},
                           'Entrypoint': ['node'], 'Cmd': arguments,
                           'User': '1000', 'Env': [
                               'NODE_OPTIONS=--max-old-space-size=192']},
                'HostConfig': {'ReadonlyRootfs': True, 'Privileged': False,
                               'NetworkMode': 'none',
                               'Memory': 384 * 1024 * 1024,
                               'MemorySwap': 384 * 1024 * 1024},
            }
            with patch.object(HostOperations, 'inspect',
                              return_value=[actual]):
                operations.check_helper('b' * 64,
                                        {'imageId': 'sha256:' + 'c' * 64},
                                        binding, 'sotto-review-tool-fixture')
                for section, key, value in (
                    ('HostConfig', 'Memory', 0),
                    ('HostConfig', 'MemorySwap', -1),
                    ('Config', 'Cmd', ['--max-old-space-size=999']),
                    ('Config', 'Env', ['NODE_OPTIONS=--require=foreign']),
                ):
                    changed = copy.deepcopy(actual)
                    cast(dict[str, object], changed[section])[key] = value
                    with (self.subTest(field=key),
                          patch.object(HostOperations, 'inspect',
                                       return_value=[changed]),
                          self.assertRaises(ValueError)):
                        operations.check_helper(
                            'b' * 64, {'imageId': 'sha256:' + 'c' * 64},
                            binding, 'sotto-review-tool-fixture',
                        )
            self.assertEqual(os.fstat(9).st_ino, path.stat().st_ino)
