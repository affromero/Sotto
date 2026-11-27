"""Rehearse the stopped predecessor backup at the archive boundaries."""

import hashlib
import io
import tarfile
import unittest
from importlib import import_module
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.review.runtime import services
from scripts.deploy.review.runtime.inventory.predecessor import (
    capture_predecessor,
    prepare_predecessor_stop,
)
from scripts.deploy.review.state import private_json
from scripts.deploy.review.topology import NETWORK
from scripts.tests.review.runtime import admitted_runtime_fixture


class PredecessorBackupTests(unittest.TestCase):
    def setUp(self) -> None:
        fixture_type = import_module(
            'scripts.tests.review.runtime.inventory.test_network',
        ).ReviewNetworkFixture
        network = fixture_type('runTest')
        network.prepare_network()
        self.addCleanup(network.doCleanups)
        self.previous, self.successor = network.previous, network.successor
        fixture = network.fixture
        environment_type = import_module(
            'scripts.tests.review.runtime.inventory.test_environment',
        ).SuccessorEnvironmentTests
        environment = environment_type('runTest')
        environment.fixture = fixture
        environment.previous, environment.successor = self.previous, self.successor
        environment.prepare_environment()
        capture_predecessor(self.previous, self.successor)
        self.web = fixture.fixture.candidates['web']['Id']
        self.postgres = fixture.storage.ids['postgres']
        self.redis = fixture.storage.ids['redis']
        for role, address in (('web', '10'), ('workers', '11')):
            prepare_predecessor_stop(self.previous, self.successor, role=role)
            container = fixture.fixture.candidates[role]
            container['State'].update({
                'Running': False, 'Status': 'exited', 'ExitCode': 0,
                'FinishedAt': '2026-10-26T01:23:00Z',
            })
            container['NetworkSettings']['Networks'][NETWORK]['IPAMConfig'] = {
                'IPv4Address': '172.30.99.' + address,
            }
            fixture.confirm_stop(role)
        self.successor.manifest.update(admitted_runtime_fixture())
        self.directory = self.successor.attempt.directory
        self.receipt = self.directory / 'backups.json'
        root = fixture.fixture.review
        self.compose = b'retained backing services'
        self.caddy = b'retained public routing'
        (root / 'compose.yml').write_bytes(self.compose)
        self.successor.private_file(self.directory / 'original-caddy.conf', self.caddy)
        self.previous.manifest['originalFiles'] = {
            **self.previous.manifest['originalFiles'],
            'compose': hashlib.sha256(self.compose).hexdigest(),
        }
        self.successor.manifest['originalFiles'] = {
            'caddyFragment': hashlib.sha256(self.caddy).hexdigest(),
        }
        self.enterContext(patch(
            'scripts.deploy.review.runtime.inventory.backup.DIRECTORY', str(root),
        ))
        self.enterContext(patch.object(self.successor, 'successor_helper_capacity'))
        self.enterContext(patch.object(services, 'verify_database_backup'))
        self.enterContext(patch.object(services, 'stream_backup', side_effect=self.dump))
        self.enterContext(patch.object(services, 'backup_archive', side_effect=self.archive))
        self.saved = b'OK\n'
        docker = self.successor.docker

        def command(*arguments: str) -> bytes:
            if arguments == ('exec', self.redis, 'redis-cli', 'SAVE'):
                return self.saved
            return docker(*arguments)

        self.enterContext(patch.object(self.successor, 'docker', side_effect=command))

    def dump(self, operations, name, arguments, *, limit, content) -> Path:
        self.assertIs(operations, self.successor)
        self.assertGreater(limit, 0)
        self.assertEqual(arguments[-2:], ['--container', self.postgres])
        self.assertEqual(content, b'postgresql://fixture/secret')
        path = self.directory / name
        self.successor.private_file(path, b'synthetic database archive')
        return path

    def archive(self, operations, name, container, image, source, limit) -> Path:
        self.assertIs(operations, self.successor)
        self.assertGreater(limit, 0)
        self.assertEqual(container, self.redis if source == '/data' else self.web)
        self.assertEqual(image, self.previous.manifest['finalWeb']['imageId'])
        path = self.directory / (name + '.tar')
        with tarfile.open(path, 'w') as archive:
            member = tarfile.TarInfo('synthetic.txt')
            member.size = len(source)
            archive.addfile(member, io.BytesIO(source.encode()))
        path.chmod(0o600)
        return path

    def test_backs_up_bound_configuration_and_rechecks_the_same_receipt(self) -> None:
        services.backup_review(self.successor, predecessor=self.previous)
        observed = private_json(self.receipt)
        directory = self.directory / observed['directory']
        previous = self.previous.attempt.directory
        self.assertEqual((directory / 'compose.backup').read_bytes(), self.compose)
        self.assertEqual((directory / 'caddy.backup').read_bytes(), self.caddy)
        self.assertEqual((directory / 'candidate.backup').read_bytes(),
                         (previous / 'candidate-compose.json').read_bytes())
        self.assertEqual((directory / 'environment.backup').read_bytes(),
                         (previous / 'original.env').read_bytes())
        services.backup_review(self.successor, predecessor=self.previous)
        self.assertEqual(private_json(self.receipt), observed)
        with self.assertRaisesRegex(ValueError, 'retained-backup-predecessor-changed'):
            services.verify_backups(self.successor)

    def test_refuses_redis_save_error_without_a_backup_receipt(self) -> None:
        self.saved = b'ERR save failed'
        with self.assertRaisesRegex(ValueError, 'review-redis-backup-save-failed'):
            services.backup_review(self.successor, predecessor=self.previous)
        self.assertFalse(self.receipt.exists())

    def test_refuses_changed_public_routing_capture_before_archiving(self) -> None:
        (self.directory / 'original-caddy.conf').write_bytes(b'changed routing')
        with self.assertRaisesRegex(ValueError, 'predecessor-backup-configuration-changed'):
            services.backup_review(self.successor, predecessor=self.previous)
        self.assertFalse(list(self.directory.glob('backup-*')))
