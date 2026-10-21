"""Preserve the existing review isolation and original storage identities."""

from __future__ import annotations

import copy
import json
import unittest
from typing import cast

from scripts.deploy.review.build_observer import TARGET
from scripts.deploy.review.topology import (
    DIRECTORY,
    EXECUTIONS,
    NETWORK,
    PROJECT,
    PUBLIC_ENVIRONMENT,
    STORAGE,
    candidate_compose,
    capture,
    classified_environment,
    verify_capture,
)
from scripts.tests.review.runtime import admitted_runtime_fixture


class ReviewTopologyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.network: dict[str, object] = {
            'Id': 'a' * 64, 'Name': NETWORK, 'Driver': 'bridge',
            'Internal': True, 'EnableIPv6': False,
            'IPAM': {'Config': [{'Subnet': '172.30.99.0/24',
                                 'Gateway': '172.30.99.1'}]},
            'Containers': {},
        }
        self.private = {
            **PUBLIC_ENVIRONMENT, 'COMMIT_SHA': TARGET,
            'DATABASE_URL': 'postgresql://review:fixture@postgres/review',
            'REDIS_URL': 'redis://redis:6379/0',
            'BYOK_ENCRYPTION_KEY': 'PRIVATE-FIXTURE-KEY',
        }
        self.containers: list[dict[str, object]] = []
        for service, token, address in (
            ('web', 'b', '172.30.99.10'),
            ('postgres', 'c', '172.30.99.3'),
            ('redis', 'd', '172.30.99.2'),
        ):
            mounts: list[dict[str, object]] = []
            if service == 'web':
                mounts.append({'Type': 'bind', 'Name': None,
                               'Source': DIRECTORY + '/storage',
                               'Destination': STORAGE, 'RW': True})
            volume = ('executions' if service == 'web' else service)
            destination = {'web': EXECUTIONS, 'redis': '/data',
                           'postgres': '/var/lib/postgresql/data'}[service]
            mounts.append({
                'Type': 'volume', 'Name': PROJECT + '_' + volume,
                'Source': '/var/lib/docker/volumes/' + volume + '/_data',
                'Destination': destination, 'RW': True,
            })
            self.containers.append({
                'Id': token * 64, 'Image': 'sha256:' + token * 64,
                'Name': '/' + PROJECT + '-' + service + '-1',
                'Config': {
                    'User': '1000' if service == 'web' else '',
                    'Env': [key + '=' + value
                            for key, value in self.private.items()]
                    if service == 'web' else [],
                    'Labels': {
                        'com.docker.compose.service': service,
                        'com.docker.compose.project': PROJECT,
                        'com.docker.compose.project.config_files':
                        DIRECTORY + '/compose.yml',
                        'com.docker.compose.project.working_dir': DIRECTORY,
                    },
                },
                'HostConfig': {'Privileged': False, 'NetworkMode': NETWORK,
                               'PidMode': '', 'Binds': [], 'CapAdd': None,
                               'Devices': [], 'Memory': 536_870_912,
                               'RestartPolicy': {'Name': 'unless-stopped'},
                               'LogConfig': {'Type': 'json-file'}},
                'State': {'Running': True, 'OOMKilled': False},
                'Mounts': mounts,
                'NetworkSettings': {
                    'Networks': {NETWORK: {
                        'NetworkID': 'a' * 64, 'IPAddress': address,
                        'GlobalIPv6Address': '',
                    }},
                    'Ports': {'3000/tcp': None},
                },
            })
        self.network['Containers'] = {
            str(container['Id']): {} for container in self.containers
        }

    def observe(self) -> dict[str, object]:
        return capture(self.containers, self.network, self.containers,
                       original_image_environment={})

    def test_snapshot_binds_secret_identity_without_disclosing_values(
        self,
    ) -> None:
        original = self.observe()
        self.assertNotIn('PRIVATE-FIXTURE-KEY', json.dumps(original))
        verify_capture(original, self.observe())
        config = cast(dict[str, object], self.containers[0]['Config'])
        entries = cast(list[str], config['Env'])
        entries[entries.index('BYOK_ENCRYPTION_KEY=PRIVATE-FIXTURE-KEY')] = (
            'BYOK_ENCRYPTION_KEY=CHANGED-FIXTURE-KEY'
        )
        with self.assertRaisesRegex(ValueError, 'topology changed'):
            verify_capture(original, self.observe())

    def test_unknown_network_attachment_or_storage_writer_is_rejected(
        self,
    ) -> None:
        original = copy.deepcopy(self.network)
        attached = cast(dict[str, object], self.network['Containers'])
        attached['e' * 64] = {}
        with self.assertRaisesRegex(ValueError, 'unknown container'):
            self.observe()
        self.network = original
        other = copy.deepcopy(self.containers[0])
        other['Id'] = 'e' * 64
        other['Config'] = {'Labels': {}}
        with self.assertRaisesRegex(ValueError, 'write review storage'):
            capture(self.containers, self.network, [*self.containers, other],
                    original_image_environment={})
        other['Mounts'] = [{'Type': 'bind', 'Source': '/home/sotto',
                            'Destination': '/data', 'RW': True}]
        with self.assertRaisesRegex(ValueError, 'write review storage'):
            capture(self.containers, self.network, [*self.containers, other],
                    original_image_environment={})

    def test_published_port_or_production_network_cannot_pass_preflight(
        self,
    ) -> None:
        settings = cast(dict[str, object],
                        self.containers[0]['NetworkSettings'])
        settings['Ports'] = {'3000/tcp': [{'HostPort': '3000'}]}
        with self.assertRaisesRegex(ValueError, 'published on the host'):
            self.observe()
        settings['Ports'] = {}
        networks = cast(dict[str, object], settings['Networks'])
        networks['sotto-network'] = {}
        with self.assertRaisesRegex(ValueError, 'another network'):
            self.observe()

    def test_unclassified_or_operator_changed_image_settings_fail_closed(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, 'Unreviewed existing'):
            classified_environment(
                {**self.private, 'UNREVIEWED_PROVIDER_CONFIG': 'retained'}, {},
            )
        with self.assertRaisesRegex(ValueError, 'image-default'):
            classified_environment(
                {**self.private, 'PATH': '/custom-provider/bin'},
                {'PATH': '/usr/local/bin:/usr/bin'},
            )
        preserved = classified_environment({
            **self.private, 'SIDEDOOR_PASSWORD_ORIGINS': 'https://demo.sotto.fm',
            'NODE_OPTIONS': '--max-old-space-size=384',
            'PATH': '/usr/local/bin:/usr/bin',
        }, {'PATH': '/usr/local/bin:/usr/bin'})
        self.assertEqual(preserved['SIDEDOOR_PASSWORD_ORIGINS'],
                         'https://demo.sotto.fm')
        self.assertEqual(preserved['NODE_OPTIONS'],
                         '--max-old-space-size=384')
        self.assertNotIn('PATH', preserved)

    def test_candidate_keeps_db_keys_storage_and_one_shared_auth_home(
        self,
    ) -> None:
        original = copy.deepcopy(self.private)
        result = candidate_compose(
            attempt_id='release-a',
            web_reference=(
                'ghcr.io/affromero/sotto-review-web@sha256:' + 'a' * 64
            ),
            worker_reference=(
                'ghcr.io/affromero/sotto-workers-prod@sha256:' + 'b' * 64
            ),
            final_source='e' * 40, original_environment=self.private,
            original_image_environment={},
            auth_source=DIRECTORY + '/auth/codex',
            runtime_uid=1000, runtime_gid=1000,
            web_memory=536_870_912, worker_memory=1_073_741_824,
            egress_network=PROJECT + '_egress',
            runtime_policy=cast(dict[str, object],
                                admitted_runtime_fixture()['runtimePolicy']),
        )
        services = cast(dict[str, dict[str, object]], result['services'])
        self.assertEqual(set(services), {'web', 'workers'})
        self.assertEqual(services['web']['volumes'],
                         services['workers']['volumes'])
        for service in services.values():
            private = cast(dict[str, str], service['environment'])
            for key in ('DATABASE_URL', 'REDIS_URL', 'BYOK_ENCRYPTION_KEY'):
                self.assertEqual(private[key], self.private[key])
            self.assertEqual(private['CODEX_HOME'], '/home/sotto/.codex')
            self.assertEqual(private['SOTTO_PRIVACY_CONTACT_EMAIL'],
                             'me@afromero.co')
            self.assertEqual(service['restart'], 'no')
            self.assertNotIn('ports', service)
            self.assertEqual(service['pull_policy'], 'never')
        network = cast(dict[str, dict[str, str]], services['web']['networks'])
        self.assertEqual(network['review']['ipv4_address'], '172.30.99.10')
        worker = cast(dict[str, str], services['workers']['environment'])
        self.assertEqual(worker['WORKER_PROFILE'], 'all')
        self.assertEqual(worker['WORKER_PRESET'], 'full')
        self.assertEqual(worker['WORKER_QUEUES'], '')
        self.assertEqual(self.private, original)
        self.assertEqual(services['web']['command'],
                         ['node', '--max-old-space-size=256', 'server.js'])
        self.assertEqual(services['workers']['command'], [
            'node', '--max-old-space-size=512', '--import', 'tsx',
            'src/workers/index.ts',
        ])
        for service in services.values():
            self.assertEqual(service['memswap_limit'], service['mem_limit'])


if __name__ == '__main__':
    unittest.main()
