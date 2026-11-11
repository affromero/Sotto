"""Filesystem and Docker boundaries for completed review storage tests."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.review.egress import TABLE, semantic_policy
from scripts.deploy.review.runtime import release
from scripts.deploy.review.runtime.inventory import storage
from scripts.deploy.review.runtime.operations import HostOperations
from scripts.deploy.review.state import Attempt, atomic_json, checksum, private_json
from scripts.deploy.review.topology import NETWORK, PROJECT
from scripts.tests.review.runtime.test_release import ReleaseRecoveryTests


class StorageHost:
    def __init__(
        self, case: unittest.TestCase, base: ReleaseRecoveryTests,
        previous: HostOperations, successor: HostOperations,
    ) -> None:
        self.root = base.root
        case.enterContext(patch.object(storage, 'DIRECTORY', str(base.review)))
        auth = base.review / 'auth/codex'
        self.paths = {name: self.root / ('mounted-' + name)
                      for name in ('storage', 'exec', 'postgres', 'redis')}
        self.paths['auth'] = auth
        for name, path in self.paths.items():
            if name != 'auth':
                path.mkdir()
        self.ids = {'old': 'a' * 64, 'postgres': 'b' * 64, 'redis': 'c' * 64,
                    'web': 'd' * 64, 'workers': 'e' * 64}
        network_ids = {'review': '1' * 64, 'egress': '2' * 64}
        self.network_ids = network_ids
        destinations = {'storage': storage.STORAGE, 'exec': storage.EXECUTIONS,
                        'postgres': '/var/lib/postgresql/data', 'redis': '/data',
                        'auth': storage.AUTH_HOME}
        roles = {'postgres': ['postgres'], 'redis': ['redis'],
                 'web': ['storage', 'exec', 'auth'], 'workers': ['storage', 'exec', 'auth']}
        self.objects: dict[str, dict[str, object]] = {}
        for role in ('web', 'workers'):
            candidate = base.candidates[role]
            candidate['Id'] = self.ids[role]
            candidate['State']['Pid'] = os.getpid()
            candidate['NetworkSettings']['Networks'][NETWORK]['NetworkID'] = network_ids['review']
            candidate['NetworkSettings']['Networks'][PROJECT + '_egress']['NetworkID'] = network_ids['egress']
            candidate['Mounts'] = [{'Source': str(self.paths[name]),
                                    'Destination': destinations[name], 'RW': True}
                                   for name in roles[role]]
            atomic_json(previous.attempt.directory / ('candidate-' + role + '.json'),
                        previous.writer_binding(candidate))
            self.objects[self.ids[role]] = candidate
        for role in ('postgres', 'redis'):
            self.objects[self.ids[role]] = {
                'Id': self.ids[role], 'Image': 'sha256:' + ('1' if role == 'postgres' else '2') * 64,
                'Name': '/' + role, 'Config': {'Env': []}, 'HostConfig': {},
                'State': {'Status': 'running', 'Running': True, 'Paused': False,
                          'Restarting': False, 'OOMKilled': False, 'Dead': False,
                          'Error': '', 'Pid': os.getpid()},
                'Mounts': [{'Source': str(self.paths[role]),
                            'Destination': destinations[role], 'RW': True}],
            }
        manifest = copy.deepcopy(previous.attempt.manifest())
        manifest['topology']['network']['id'] = network_ids['review']
        manifest['topology']['services'] = {
            role: {'id': self.ids['old' if role == 'web' else role],
                   'imageId': 'sha256:' + ('3' if role == 'web' else
                                           '1' if role == 'postgres' else '2') * 64,
                   'mounts': [{'Destination': destinations[name]} for name in
                              (['storage', 'exec'] if role == 'web' else [role])]}
            for role in ('web', 'postgres', 'redis')
        }
        repository = Path(__file__).resolve().parents[5]
        source = repository / 'scripts/deploy'
        destination = self.root / 'scripts/deploy'
        shutil.copytree(source, destination, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        manifest['tools'] = {
            str(path.relative_to(self.root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in destination.rglob('*')
            if path.is_file() and path.suffix in {'.py', '.ts', '.cjs'}
        }
        directory = previous.attempt.directory
        binding = private_json(directory / 'binding.json')
        binding['manifestSha256'] = checksum(manifest)
        atomic_json(directory / 'manifest.json', manifest)
        atomic_json(directory / 'binding.json', binding)
        state = private_json(directory / 'state.json')
        atomic_json(directory / 'state.json', {**state, 'manifestSha256': binding['manifestSha256']})
        previous.attempt = Attempt(directory)
        previous.manifest = manifest
        original: dict[str, object] = {}
        for role, names in (('old', ['storage', 'exec']), ('postgres', ['postgres']),
                            ('redis', ['redis'])):
            for name in names:
                path = self.paths[name]
                original[self.ids[role] + ':' + destinations[name]] = {
                    'source': str(path), 'identity': [path.stat().st_dev, path.stat().st_ino],
                }
        atomic_json(directory / 'original-mount-objects.json', original)
        handover = private_json(directory / 'auth-handover.json')
        atomic_json(directory / 'auth-handover.json', {**handover, 'home': str(auth)})
        _, images = release.retention_context(previous)
        atomic_json(base.retention / (PROJECT + '.json'),
                    {'protected_images': sorted(images)})
        rules = self.root / 'guard.nft'
        rules.write_bytes(b'exact-review-fixture-rules')
        case.enterContext(patch('scripts.deploy.review.runtime.operations.RULES_PATH', str(rules)))
        families = {family: {'nftables': [
            {'table': {'family': family, 'name': TABLE}},
            {'rule': {'family': family, 'table': TABLE,
                      'chain': 'forward', 'expr': [{'drop': None}]}},
        ]} for family in ('inet', 'bridge')}
        combined = {'nftables': [entry for value in families.values()
                                 for entry in value['nftables']]}
        atomic_json(directory / 'egress.json', {
            'networkId': network_ids['egress'],
            'bridges': ['br-' + network_ids['review'][:12],
                        'br-' + network_ids['egress'][:12]],
            'policyHash': checksum(semantic_policy(combined)),
            'rulesHash': hashlib.sha256(rules.read_bytes()).hexdigest(),
        })
        networks = [
            {'Name': NETWORK, 'Id': network_ids['review'], 'Options': {}},
            {'Name': PROJECT + '_egress', 'Id': network_ids['egress'], 'Options': {}},
        ]
        original_docker = previous.docker

        def docker(*args: str) -> bytes:
            if args[:3] == ('ps', '-aq', '--no-trunc'):
                return ' '.join(self.objects).encode()
            if args[0] == 'inspect':
                return json.dumps([self.objects[item] for item in args[1:]]).encode()
            if args[:2] == ('network', 'inspect'):
                return json.dumps(networks).encode()
            return original_docker(*args)

        case.enterContext(patch.object(previous, 'docker', side_effect=docker))
        original_command = previous.command

        def prior_command(args: list[str]) -> bytes:
            if args[:3] == ['sudo', '-n', '/usr/sbin/nft']:
                return json.dumps(families[args[-2]]).encode()
            return original_command(args)

        case.enterContext(patch.object(previous, 'command', side_effect=prior_command))

        def probe_command(args: list[str], *, content: bytes | None = None,
                          timeout: float | None = 60) -> bytes:
            del args, timeout
            request = json.loads(content or b'{}')
            sources = {}
            for source in request['sources']:
                resolved = Path(source).resolve(strict=True)
                sources[source] = {'path': str(resolved), 'ancestors': [
                    [path.stat().st_dev, path.stat().st_ino] for path in [resolved, *resolved.parents]
                ]}
            mounted = {}
            for entry in request['mounted']:
                container = self.objects[entry['id']]
                mount = next(m for m in container['Mounts'] if m['Destination'] == entry['destination'])
                metadata = Path(mount['Source']).stat()
                mounted[entry['key']] = [metadata.st_dev, metadata.st_ino]
            return json.dumps({'sources': sources, 'mounted': mounted}).encode()

        case.enterContext(patch.object(successor, 'command', side_effect=probe_command))
        atomic_json(directory / 'release-record.json',
                    release.read_completed_record(previous, fenced=True))
