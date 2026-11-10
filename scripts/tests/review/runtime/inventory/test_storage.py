"""Exercise historical-root mapping against real temporary directories."""

import copy
import json
import os
import tempfile
import unittest
from importlib import import_module
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.review.runtime.operations import HostOperations
from scripts.deploy.review.runtime import release
from scripts.deploy.review.runtime.inventory import storage as module
from scripts.deploy.review.runtime.inventory.network import verify_retained_network
from scripts.deploy.review.runtime.inventory.predecessor import (
    capture_predecessor, prepare_predecessor_stop,
)
from scripts.deploy.review.state import Attempt, atomic_json, checksum, private_json
from scripts.deploy.review.topology import NETWORK, PROJECT, exact_mounts

class CompletedStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.enterContext(patch.object(module, 'DIRECTORY', str(self.root)))
        self.paths = {name: self.root / name for name in ('storage', 'exec', 'pg', 'redis')}
        self.paths['auth'] = self.root / 'auth/codex'
        for path in self.paths.values():
            path.mkdir(parents=True)
        self.ids = {'old': 'a' * 64, 'postgres': 'b' * 64, 'redis': 'c' * 64,
                    'web': 'd' * 64, 'workers': 'e' * 64}
        self.destinations = {'storage': module.STORAGE, 'exec': module.EXECUTIONS,
                             'pg': '/var/lib/postgresql/data', 'redis': '/data',
                             'auth': module.AUTH_HOME}
        self.roles = {'postgres': ['pg'], 'redis': ['redis'],
                      'web': ['storage', 'exec', 'auth'],
                      'workers': ['storage', 'exec', 'auth']}
        self.containers = []
        for role, names in self.roles.items():
            self.containers.append({
                'Id': self.ids[role], 'Image': 'sha256:' + 'f' * 64,
                'Name': '/' + role, 'Config': {'Env': []},
                'HostConfig': {'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0}},
                'State': {'Status': 'running', 'Running': True,
                          'Paused': False, 'Restarting': False,
                          'OOMKilled': False, 'Dead': False, 'Error': '',
                          'ExitCode': 0, 'Pid': os.getpid(),
                          'StartedAt': '2026-10-26T01:22:11.143667407Z',
                          'FinishedAt': '0001-01-01T00:00:00Z'},
                'RestartCount': 0,
                'Mounts': [{'Source': str(self.paths[name]),
                            'Destination': self.destinations[name], 'RW': True}
                           for name in names],
            })
        self.bindings = {role: HostOperations.writer_binding(self.by_role(role))
                         for role in ('web', 'workers')}
        self.topology = {'services': {
            role: {'id': self.ids['old' if role == 'web' else role],
                   'mounts': [{'Destination': self.destinations[name]}
                              for name in (['storage', 'exec'] if role == 'web'
                                           else self.roles[role])]}
            for role in ('web', 'postgres', 'redis')
        }}
        self.original = {}
        for role, names in (('old', ['storage', 'exec']), ('postgres', ['pg']),
                            ('redis', ['redis'])):
            for name in names:
                path = self.paths[name]
                self.original[self.ids[role] + ':' + self.destinations[name]] = {
                    'source': str(path), 'identity': [path.stat().st_dev, path.stat().st_ino],
                }
        auth = self.paths['auth']
        self.handover = {'home': str(auth), 'identity': [auth.stat().st_dev, auth.stat().st_ino]}

    def by_role(self, role):
        return next(container for container in self.containers if container['Id'] == self.ids[role])

    def probe(self, content):
        request = json.loads(content)
        sources = {}
        for source in request['sources']:
            resolved = Path(source).resolve(strict=True)
            sources[source] = {'path': str(resolved), 'ancestors': [
                [path.stat().st_dev, path.stat().st_ino] for path in [resolved, *resolved.parents]
            ]}
        mounted = {}
        for entry in request['mounted']:
            container = next(c for c in self.containers if c['Id'] == entry['id'])
            mount = next(m for m in container['Mounts'] if m['Destination'] == entry['destination'])
            stat = Path(mount['Source']).stat()
            mounted[entry['key']] = [stat.st_dev, stat.st_ino]
        return json.dumps({'sources': sources, 'mounted': mounted}).encode()

    def inspect(self, previous=None):
        return module.inspect_completed_storage(
            self.containers, self.topology, self.original, self.bindings, self.handover,
            probe=self.probe, previous=previous,
        )

    def test_absent_original_with_both_mounted_candidates_preserves_roots(self) -> None:
        proof = self.inspect()
        self.by_role('web')['State'] = {'Running': False, 'Pid': 0}
        self.assertEqual(self.inspect(proof), proof)

    def test_stopped_candidate_without_live_proof_is_refused(self) -> None:
        self.by_role('workers')['State'] = {'Running': False, 'Pid': 0}
        with self.assertRaisesRegex(ValueError, 'running-candidate-mount-proof'):
            self.inspect()

    def test_changed_inode_is_refused(self) -> None:
        proof = self.inspect()
        self.paths['storage'].rename(self.root / 'old-storage')
        self.paths['storage'].mkdir()
        with self.assertRaisesRegex(ValueError, 'retained-storage-object'):
            self.inspect(proof)

    def test_foreign_writable_alias_is_refused(self) -> None:
        child = self.paths['storage'] / 'child'
        child.mkdir()
        self.containers.append({'Id': 'f' * 64, 'State': {'Running': True, 'Pid': os.getpid()},
                                'Mounts': [{'Source': str(child), 'Destination': '/foreign', 'RW': True}]})
        with self.assertRaisesRegex(ValueError, 'physical-review-storage-alias'):
            self.inspect()

    def test_missing_candidate_mount_is_refused_even_if_rebound(self) -> None:
        web = self.by_role('web')
        web['Mounts'].pop()
        self.bindings['web'] = HostOperations.writer_binding(web)
        with self.assertRaisesRegex(ValueError, 'retained-storage-object'):
            self.inspect()

    def test_candidate_binding_change_is_refused(self) -> None:
        self.by_role('web')['Config']['User'] = '0'
        with self.assertRaisesRegex(ValueError, 'storage-candidate-changed'):
            self.inspect()

class CompletedStorageWrapperTests(unittest.TestCase):
    def setUp(self) -> None:
        fixture_type = import_module(
            'scripts.tests.review.runtime.inventory.test_predecessor',
        ).PredecessorCaptureTests
        self.fixture = fixture_type('runTest')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.previous = self.fixture.previous
        self.successor = self.fixture.successor
        host = self.fixture.storage
        self.root = host.root
        self.paths = host.paths
        self.objects = host.objects
        self.ids = host.ids

    def test_running_proof_is_durable_and_same_stopped_instance_is_accepted(self) -> None:
        module.verify_completed_storage(self.previous, self.successor)
        path = self.successor.attempt.directory / 'predecessor-mounted-storage.json'
        self.assertTrue(path.is_file())
        web = self.objects[self.ids['web']]
        web['State'].update({'Status': 'exited', 'Running': False, 'Pid': 0,
                             'ExitCode': 0, 'FinishedAt': '2026-10-26T01:23:00Z'})
        web['NetworkSettings']['Networks'][NETWORK]['IPAMConfig'] = {
            'IPv4Address': '172.30.99.10',
        }
        module.verify_completed_storage(self.previous, self.successor)

    def test_missing_receipt_with_stopped_candidate_is_refused(self) -> None:
        web = self.objects[self.ids['web']]
        web['State'].update({'Status': 'exited', 'Running': False, 'Pid': 0,
                             'ExitCode': 0, 'FinishedAt': '2026-10-26T01:23:00Z'})
        web['NetworkSettings']['Networks'][NETWORK]['IPAMConfig'] = {
            'IPv4Address': '172.30.99.10',
        }
        with self.assertRaisesRegex(ValueError, 'running-candidate-mount-proof'):
            module.verify_completed_storage(self.previous, self.successor)

    def test_changed_release_or_auth_and_stopped_database_are_refused(self) -> None:
        directory = self.previous.attempt.directory
        receipt_path = directory / 'release-record.json'
        receipt = private_json(receipt_path)
        atomic_json(receipt_path, {**receipt, 'source': 'changed'})
        with self.assertRaisesRegex(ValueError, 'release-receipt-changed'):
            module.verify_completed_storage(self.previous, self.successor)
        atomic_json(receipt_path, receipt)
        handover_path = directory / 'auth-handover.json'
        handover = private_json(handover_path)
        atomic_json(handover_path, {**handover, 'identity': [0, 0]})
        with self.assertRaises(ValueError):
            module.verify_completed_storage(self.previous, self.successor)
        atomic_json(handover_path, handover)
        self.objects[self.ids['postgres']]['State']['Running'] = False
        with self.assertRaisesRegex(ValueError, 'storage-service-unavailable'):
            module.verify_completed_storage(self.previous, self.successor)

    def test_changed_startup_or_missing_fence_cannot_create_receipt(self) -> None:
        unit = self.fixture.fixture.unit
        original = unit.read_bytes()
        unit.write_bytes(original + b'\n')
        with self.assertRaises(ValueError):
            module.verify_completed_storage(self.previous, self.successor)
        unit.write_bytes(original)
        (self.fixture.fixture.host / 'unresolved.json').unlink()
        with self.assertRaises(OSError):
            module.verify_completed_storage(self.previous, self.successor)
        self.assertFalse((self.successor.attempt.directory
                          / 'predecessor-mounted-storage.json').exists())

    def test_restart_during_mount_probe_cannot_create_receipt(self) -> None:
        original = self.successor.command.side_effect

        def command(*args, **kwargs):
            result = original(*args, **kwargs)
            self.objects[self.ids['web']]['State']['StartedAt'] = '2026-10-26T01:22:12Z'
            return result

        with patch.object(self.successor, 'command', side_effect=command):
            with self.assertRaises(ValueError):
                module.verify_completed_storage(self.previous, self.successor)
        self.assertFalse((self.successor.attempt.directory
                          / 'predecessor-mounted-storage.json').exists())

    def test_new_writable_alias_during_probe_cannot_create_receipt(self) -> None:
        child = self.paths['storage'] / 'child'
        child.mkdir()
        original = self.successor.command.side_effect

        def command(*args, **kwargs):
            result = original(*args, **kwargs)
            self.objects['f' * 64] = {
                'Id': 'f' * 64, 'State': {'Running': True, 'Pid': os.getpid()},
                'Mounts': [{'Source': str(child), 'Destination': '/foreign', 'RW': True}],
            }
            return result

        with patch.object(self.successor, 'command', side_effect=command):
            with self.assertRaisesRegex(ValueError, 'container-inventory-changed'):
                module.verify_completed_storage(self.previous, self.successor)
        self.assertFalse((self.successor.attempt.directory
                          / 'predecessor-mounted-storage.json').exists())

    def test_stopped_foreign_container_starting_during_probe_is_refused(self) -> None:
        source = self.root / 'foreign-storage'
        source.mkdir()
        foreign = {
            'Id': 'f' * 64, 'State': {'Running': False, 'Pid': 0},
            'Mounts': [{'Source': str(source), 'Destination': '/foreign', 'RW': True}],
        }
        self.objects[foreign['Id']] = foreign
        original = self.successor.command.side_effect

        def command(*args, **kwargs):
            result = original(*args, **kwargs)
            foreign['State'].update({'Running': True, 'Pid': os.getpid()})
            return result

        with patch.object(self.successor, 'command', side_effect=command):
            with self.assertRaisesRegex(ValueError, 'mount-inventory-changed'):
                module.verify_completed_storage(self.previous, self.successor)
        self.assertFalse((self.successor.attempt.directory
                          / 'predecessor-mounted-storage.json').exists())

    def test_restart_then_stop_cannot_reuse_running_mount_receipt(self) -> None:
        module.verify_completed_storage(self.previous, self.successor)
        web = self.objects[self.ids['web']]
        web['State'].update({'Status': 'exited', 'Running': False, 'Pid': 0,
                             'ExitCode': 0, 'StartedAt': '2026-10-26T01:22:12Z',
                             'FinishedAt': '2026-10-26T01:23:00Z'})
        web['NetworkSettings']['Networks'][NETWORK]['IPAMConfig'] = {
            'IPv4Address': '172.30.99.10',
        }
        with self.assertRaisesRegex(ValueError, 'stop-not-proven'):
            module.verify_completed_storage(self.previous, self.successor)

    def test_network_observation_refuses_storage_replacement_between_checks(self) -> None:
        manifest = copy.deepcopy(self.previous.attempt.manifest())
        manifest['topology']['network']['subnet'] = '172.30.99.0/24'
        review_id = self.fixture.storage.network_ids['review']
        egress_id = self.fixture.storage.network_ids['egress']
        network_members = {}
        for role, suffix in (('postgres', '3'), ('redis', '2')):
            actual = self.objects[self.ids[role]]
            ip = '172.30.99.' + suffix
            actual['Config'] = {'Env': ['USER=fixture'], 'User': '1000'}
            actual['HostConfig'] = {
                'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0},
                'Memory': 1024, 'LogConfig': {'Type': 'json-file'},
            }
            actual['Mounts'][0].update({'Type': 'volume', 'Name': PROJECT + '_' + role})
            actual['NetworkSettings'] = {'Ports': {}, 'Networks': {NETWORK: {
                'NetworkID': review_id, 'IPAddress': ip, 'GlobalIPv6Address': '',
            }}}
            manifest['topology']['services'][role].update({
                'name': actual['Name'], 'user': '1000',
                'environmentHash': checksum({'USER': 'fixture'}),
                'mounts': exact_mounts(role, actual['Mounts']),
                'network': {'id': review_id, 'address': ip},
                'restartPolicy': actual['HostConfig']['RestartPolicy'],
                'memory': 1024, 'logging': {'Type': 'json-file'},
            })
            network_members[self.ids[role]] = {
                'Name': role, 'IPv4Address': ip + '/24', 'IPv6Address': '',
            }
        directory = self.previous.attempt.directory
        binding = private_json(directory / 'binding.json')
        binding['manifestSha256'] = checksum(manifest)
        atomic_json(directory / 'manifest.json', manifest)
        atomic_json(directory / 'binding.json', binding)
        state = private_json(directory / 'state.json')
        atomic_json(directory / 'state.json', {**state, 'manifestSha256': binding['manifestSha256']})
        self.previous.attempt = Attempt(directory)
        self.previous.manifest = manifest
        atomic_json(directory / 'release-record.json',
                    release.read_completed_record(self.previous, fenced=True))
        networks = [
            {'Id': review_id, 'Name': NETWORK, 'Containers': network_members},
            {'Id': egress_id, 'Name': PROJECT + '_egress', 'Containers': {}},
        ]
        old_docker = self.previous.docker.side_effect
        calls = 0

        def docker(*args):
            nonlocal calls
            if args == ('network', 'inspect', review_id, egress_id):
                calls += 1
                result = json.dumps(networks).encode()
                if calls == 1:
                    self.paths['storage'].rename(self.root / 'retired-storage')
                    self.paths['storage'].mkdir()
                return result
            return old_docker(*args)

        capture_predecessor(self.previous, self.successor)
        for role, address in (('web', '10'), ('workers', '11')):
            prepare_predecessor_stop(self.previous, self.successor, role=role)
            candidate = self.objects[self.ids[role]]
            candidate['State'].update({
                'Status': 'exited', 'Running': False, 'Pid': 0, 'ExitCode': 0,
                'FinishedAt': '2026-10-26T01:23:00Z',
            })
            candidate['NetworkSettings']['Networks'][NETWORK]['IPAMConfig'] = {
                'IPv4Address': '172.30.99.' + address,
            }
            self.fixture.confirm_stop(role)
        with patch.object(self.previous, 'docker', side_effect=docker):
            with self.assertRaisesRegex(ValueError, 'retained-storage-object'):
                verify_retained_network(self.previous, self.successor)


if __name__ == '__main__':
    unittest.main()
