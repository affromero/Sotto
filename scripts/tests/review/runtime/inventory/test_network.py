"""Exercise retained-network inspection at its Docker boundary."""

import copy
import json
import unittest
from importlib import import_module
from unittest.mock import patch

from scripts.deploy.review.runtime import release
from scripts.deploy.review.runtime.inventory.network import (
    verify_retained_network,
    verify_running_predecessor_network,
)
from scripts.deploy.review.runtime.inventory.predecessor import (
    capture_predecessor,
    prepare_predecessor_stop,
)
from scripts.deploy.review.state import Attempt, atomic_json, checksum, private_json
from scripts.deploy.review.topology import NETWORK, PROJECT, exact_mounts

class ReviewNetworkFixture(unittest.TestCase):
    def setUp(self) -> None:
        self.prepare_network()
        capture_predecessor(self.previous, self.successor)

    def prepare_network(self, *, original_queues: dict[str, object] | None = None) -> None:
        fixture_type = import_module(
            'scripts.tests.review.runtime.inventory.test_predecessor',
        ).PredecessorCaptureTests
        self.fixture = fixture_type('runTest')
        self.fixture.prepare_predecessor(original_queues=original_queues)
        self.addCleanup(self.fixture.doCleanups)
        self.previous = self.fixture.previous
        self.successor = self.fixture.successor
        self.databases = {}
        members = {}
        manifest = copy.deepcopy(self.previous.attempt.manifest())
        topology = manifest['topology']
        review_id = self.fixture.storage.network_ids['review']
        egress_id = self.fixture.storage.network_ids['egress']
        topology['network']['subnet'] = '172.30.99.0/24'
        for role, address, destination in (('postgres', '3', '/var/lib/postgresql/data'),
                                           ('redis', '2', '/data')):
            identity = self.fixture.storage.ids[role]
            name = '/sotto-review-' + role + '-1'
            ip = '172.30.99.' + address
            mount = {'Type': 'volume', 'Name': PROJECT + '_' + role,
                     'Source': str(self.fixture.storage.paths[role]),
                     'Destination': destination, 'RW': True}
            host = {'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0},
                    'Memory': 1024, 'LogConfig': {'Type': 'json-file'}}
            container = self.fixture.storage.objects[identity]
            container.update({'Name': name,
                              'Config': {'Env': ['USER=test'], 'User': '1000'},
                              'HostConfig': host, 'Mounts': [mount],
                              'NetworkSettings': {'Ports': {}, 'Networks': {NETWORK: {
                                  'NetworkID': review_id, 'IPAddress': ip,
                                  'GlobalIPv6Address': '',
                              }}}})
            self.databases[identity] = container
            topology['services'][role] = {
                'id': identity, 'imageId': container['Image'], 'name': name,
                'user': '1000', 'environmentHash': checksum({'USER': 'test'}),
                'mounts': exact_mounts(role, [mount]), 'network': {
                    'id': review_id, 'address': ip,
                }, 'restartPolicy': host['RestartPolicy'], 'memory': 1024,
                'logging': host['LogConfig'],
            }
            members[identity] = {'Name': name.lstrip('/'),
                                 'IPv4Address': ip + '/24', 'IPv6Address': ''}
        self.networks = [
            {'Id': review_id, 'Name': NETWORK, 'Containers': members},
            {'Id': egress_id, 'Name': PROJECT + '_egress', 'Containers': {}},
        ]
        actual_docker = self.previous.docker
        def docker(*args):
            if args == ('network', 'inspect', review_id, egress_id):
                return json.dumps(self.networks).encode()
            return actual_docker(*args)
        self.enterContext(patch.object(self.previous, 'docker', side_effect=docker))
        directory = self.previous.attempt.directory
        binding = private_json(directory / 'binding.json')
        binding['manifestSha256'] = checksum(manifest)
        atomic_json(directory / 'manifest.json', manifest)
        atomic_json(directory / 'binding.json', binding)
        state = private_json(directory / 'state.json')
        atomic_json(directory / 'state.json', {**state, 'manifestSha256': binding['manifestSha256']})
        self.previous.attempt = Attempt(directory)
        self.previous.manifest = manifest
        _, images = release.retention_context(self.previous)
        atomic_json(self.fixture.fixture.retention / (PROJECT + '.json'),
                    {'protected_images': sorted(images)})
        atomic_json(self.previous.attempt.directory / 'release-record.json',
                    release.read_completed_record(self.previous, fenced=True))


class RetainedNetworkTests(ReviewNetworkFixture):
    def setUp(self) -> None:
        super().setUp()
        prepare_predecessor_stop(self.previous, self.successor, role='web')
        prepare_predecessor_stop(self.previous, self.successor, role='workers')
        for role, address in (('web', '10'), ('workers', '11')):
            container = self.fixture.fixture.candidates[role]
            container['State'].update({'Running': False, 'Status': 'exited', 'ExitCode': 0,
                                       'FinishedAt': '2026-10-26T01:23:00Z'})
            container['NetworkSettings']['Networks'][NETWORK]['IPAMConfig'] = {
                'IPv4Address': '172.30.99.' + address,
            }
            self.fixture.confirm_stop(role)

    def test_exact_stopped_topology_is_accepted(self) -> None:
        verify_retained_network(self.previous, self.successor)

    def test_unknown_member_is_rejected(self) -> None:
        self.networks[0]['Containers']['other'] = {}
        with self.assertRaisesRegex(ValueError, 'unexpected-review-network-member'):
            verify_retained_network(self.previous, self.successor)

    def test_changed_service_user_is_rejected(self) -> None:
        self.databases[self.fixture.storage.ids['redis']]['Config']['User'] = '0'
        with self.assertRaisesRegex(ValueError, 'retained-review-service-changed'):
            verify_retained_network(self.previous, self.successor)

    def test_mismatched_endpoint_is_rejected(self) -> None:
        self.networks[0]['Containers'][self.fixture.storage.ids['redis']]['IPv4Address'] = '172.30.99.9/24'
        with self.assertRaisesRegex(ValueError, 'review-network-endpoint-changed'):
            verify_retained_network(self.previous, self.successor)

    def test_late_unknown_member_is_rejected(self) -> None:
        boundary = self.previous.docker.side_effect
        calls = 0
        def docker(*args):
            nonlocal calls
            if args == ('network', 'inspect', self.fixture.storage.network_ids['review'],
                        self.fixture.storage.network_ids['egress']):
                calls += 1
                if calls == 2:
                    self.networks[0]['Containers']['late'] = {}
            return boundary(*args)
        self.previous.docker.side_effect = docker
        with self.assertRaisesRegex(ValueError, 'unexpected-review-network-member'):
            verify_retained_network(self.previous, self.successor)

    def test_published_database_port_is_rejected(self) -> None:
        self.databases[self.fixture.storage.ids['postgres']]['NetworkSettings']['Ports'] = {
            '5432/tcp': [{'HostPort': '5432'}],
        }
        with self.assertRaisesRegex(ValueError, 'retained-review-service-changed'):
            verify_retained_network(self.previous, self.successor)

    def test_egress_attachment_is_rejected(self) -> None:
        self.networks[1]['Containers']['other'] = {}
        with self.assertRaisesRegex(ValueError, 'unexpected-review-network-member'):
            verify_retained_network(self.previous, self.successor)

    def test_worker_restart_is_rejected(self) -> None:
        self.fixture.fixture.candidates['workers']['RestartCount'] = 1
        with self.assertRaisesRegex(ValueError, 'stop-not-proven'):
            verify_retained_network(self.previous, self.successor)

    def test_paused_redis_without_health_check_is_rejected(self) -> None:
        self.databases[self.fixture.storage.ids['redis']]['State']['Paused'] = True
        with self.assertRaises(ValueError):
            verify_retained_network(self.previous, self.successor)


class RunningPredecessorNetworkTests(ReviewNetworkFixture):
    def setUp(self) -> None:
        self.prepare_running_network()
        capture_predecessor(self.previous, self.successor)

    def prepare_running_network(self, *, original_queues: dict[str, object] | None = None) -> None:
        self.prepare_network(original_queues=original_queues)
        for role, address, egress in (('web', '10', '2'), ('workers', '11', '3')):
            container = self.fixture.fixture.candidates[role]
            attachments = container['NetworkSettings']['Networks']
            name = container['Name'].lstrip('/')
            for index, network, ip, prefix in (
                (0, NETWORK, '172.30.99.' + address, 24),
                (1, PROJECT + '_egress', '172.29.0.' + egress, 16),
            ):
                attachments[network].update({
                    'IPAddress': ip, 'IPPrefixLen': prefix, 'GlobalIPv6Address': '',
                })
                self.networks[index]['Containers'][container['Id']] = {
                    'Name': name, 'IPv4Address': f'{ip}/{prefix}', 'IPv6Address': '',
                }

    def test_exact_running_topology_is_accepted(self) -> None:
        verify_running_predecessor_network(self.previous, self.successor)

    def test_queue_drain_after_confirmed_web_stop_requires_only_worker(self) -> None:
        with self.assertRaisesRegex(ValueError, 'expected-predecessor-web-stopped'):
            verify_running_predecessor_network(
                self.previous, self.successor, web_stopped=True,
            )

        prepare_predecessor_stop(self.previous, self.successor, role='web')
        web = self.fixture.fixture.candidates['web']
        web['State'].update({'Running': False, 'Status': 'exited', 'ExitCode': 0,
                             'FinishedAt': '2026-10-26T01:23:00Z'})
        endpoint = web['NetworkSettings']['Networks'][NETWORK]
        endpoint['IPAMConfig'] = {'IPv4Address': endpoint['IPAddress']}
        self.fixture.confirm_stop('web')
        for network in self.networks:
            network['Containers'].pop(web['Id'])

        verify_running_predecessor_network(
            self.previous, self.successor, web_stopped=True,
        )
        with self.assertRaisesRegex(ValueError, 'expected-predecessor-web-running'):
            verify_running_predecessor_network(self.previous, self.successor)

        for network in self.networks:
            with self.subTest(network=network['Name']):
                members = network['Containers']
                members[web['Id']] = {}
                with self.assertRaisesRegex(ValueError, 'unexpected-review-network-member'):
                    verify_running_predecessor_network(
                        self.previous, self.successor, web_stopped=True,
                    )
                del members[web['Id']]

    def test_unknown_peer_on_either_network_is_rejected(self) -> None:
        for network in self.networks:
            with self.subTest(network=network['Name']):
                members = network['Containers']
                members['unexpected'] = {}
                with self.assertRaisesRegex(ValueError, 'unexpected-review-network-member'):
                    verify_running_predecessor_network(self.previous, self.successor)
                del members['unexpected']

    def test_egress_endpoint_must_match_the_captured_writer(self) -> None:
        worker = self.fixture.fixture.candidates['workers']
        self.networks[1]['Containers'][worker['Id']]['IPv4Address'] = '172.29.0.9/16'
        with self.assertRaisesRegex(ValueError, 'review-network-endpoint-changed'):
            verify_running_predecessor_network(self.previous, self.successor)

    def test_rejects_coordinated_egress_address_drift_during_observation(self) -> None:
        worker = self.fixture.fixture.candidates['workers']
        boundary = self.previous.docker.side_effect
        review_id = self.fixture.storage.network_ids['review']
        egress_id = self.fixture.storage.network_ids['egress']

        def docker(*args: str) -> bytes:
            result = boundary(*args)
            if args == ('network', 'inspect', review_id, egress_id):
                worker['NetworkSettings']['Networks'][PROJECT + '_egress']['IPAddress'] = (
                    '172.29.0.9'
                )
                self.networks[1]['Containers'][worker['Id']]['IPv4Address'] = '172.29.0.9/16'
            return result

        self.previous.docker.side_effect = docker
        with self.assertRaisesRegex(ValueError, 'predecessor-network-evidence-changed'):
            verify_running_predecessor_network(self.previous, self.successor)

    def test_running_writer_binding_must_match_the_completed_release(self) -> None:
        worker = self.fixture.fixture.candidates['workers']
        worker['Config']['Env'] = ['UNADMITTED=fixture']
        with self.assertRaisesRegex(ValueError, 'candidate-changed|writer-changed'):
            verify_running_predecessor_network(self.previous, self.successor)

    def test_running_members_are_required_for_queue_preflight(self) -> None:
        worker = self.fixture.fixture.candidates['workers']
        del self.networks[0]['Containers'][worker['Id']]
        with self.assertRaisesRegex(ValueError, 'unexpected-review-network-member'):
            verify_running_predecessor_network(self.previous, self.successor)


if __name__ == '__main__':
    unittest.main()
