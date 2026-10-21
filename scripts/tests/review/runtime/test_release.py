"""Recover exact review import records and interrupted public routing."""

from __future__ import annotations

import configparser
import hashlib
import json
import os
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from importlib import import_module
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.images.metadata import record
from scripts.deploy.review.runtime import release
from scripts.deploy.review.runtime.operations import HostOperations
from scripts.deploy.review.state import (
    PHASES,
    Attempt,
    DeploymentLock,
    atomic_json,
    private_json,
)
from scripts.deploy.review.topology import NETWORK, PROJECT
from scripts.tests.review.runtime import admitted_runtime_fixture


class ReleaseRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        previous_umask = os.umask(0o077)
        self.addCleanup(os.umask, previous_umask)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.root.chmod(0o700)
        self.retention = self.root / 'retention'
        self.retention.mkdir(mode=0o700)
        self.host = self.root / 'host-state'
        self.host.mkdir(mode=0o700)
        self.caddy = self.root / 'review.conf'
        self.original = b'demo.sotto.fm { reverse_proxy 172.30.99.10:3000 }\n'
        self.caddy.write_bytes(self.original)
        self.path = self.root / 'shared.lock'
        self.path.touch(mode=0o600)
        self.lock = DeploymentLock(self.path)
        self.addCleanup(self.lock.close)
        self.images: dict[str, dict[str, object]] = {}
        receipts: list[dict[str, object]] = []
        for index, role in enumerate(('web', 'workers'), 1):
            reference = 'ghcr.io/fixture/' + role + '@sha256:' + str(index)*64
            identity = 'sha256:' + str(index)*64
            receipt: dict[str, object] = {
                'reference': reference, 'imageId': identity, 'sha': 'a' * 40,
            }
            receipts.append(receipt)
            self.images[reference] = {
                'Id': identity, 'Os': 'linux', 'Architecture': 'amd64',
                'RepoDigests': [reference],
                'Config': {'User': '1000', 'Labels': {
                    'org.opencontainers.image.revision': 'a' * 40,
                }},
            }
            name = ('sotto-review-import-' + 'a'*40 + '-'
                    + reference.rsplit(':', 1)[1] + '.json')
            atomic_json(self.retention / name, {
                'protected_images': [identity], 'image_ref': reference,
                'release_sha': 'a'*40, 'state': 'verified',
            })
        manifest: dict[str, object] = {
            **admitted_runtime_fixture(),
            'images': receipts, 'finalWeb': receipts[0],
            'finalWorker': receipts[1],
            'runtimeUid': os.geteuid(), 'runtimeGid': os.getegid(),
            'inputsSha256': '9'*64,
            'topology': {'network': {'id': 'review-network'},
                         'services': {'web': {'imageId': 'sha256:'+'3'*64}}},
            'originalFiles': {'caddyFragment': hashlib.sha256(
                self.original).hexdigest()},
        }
        source = os.environ.get('SOTTO_REVIEW_IMPORT_FINALIZER')
        if source:
            assets = self.root / 'review-stage-assets'
            assets.mkdir(mode=0o700)
            asset = assets / 'finalizer.py'
            shutil.copyfile(source, asset)
            manifest['importFinalizer'] = {
                'relativePath': 'review-stage-assets/finalizer.py',
                'sha256': hashlib.sha256(asset.read_bytes()).hexdigest(),
            }
        attempt = Attempt.create(self.host, 'release-fixture', manifest,
                                 'a' * 64)
        self.operations = HostOperations(attempt, self.lock)
        self.operations.root = self.root
        atomic_json(attempt.directory / 'egress.json',
                    {'networkId': 'egress-network'})
        self.candidates: dict[str, dict[str, object]] = {}
        for index, role in enumerate(('web', 'workers')):
            container: dict[str, object] = {
                'Id': role, 'Image': receipts[index]['imageId'],
                'Name': '/review-' + role, 'Config': {}, 'HostConfig': {},
                'Mounts': [],
                'State': {'Running': True, 'Status': 'running'},
                'NetworkSettings': {'Networks': {
                    NETWORK: {'NetworkID': 'review-network',
                              'IPAddress': '172.30.99.'+str(10+index)},
                    PROJECT+'_egress': {'NetworkID': 'egress-network'},
                }, 'Ports': {}},
            }
            self.candidates[role] = container
            atomic_json(attempt.directory / ('candidate-'+role+'.json'),
                        self.operations.writer_binding(container))
        self.serving = False
        self.fail_reload = False
        self.started: list[str] = []
        self.queue_concurrency = 1
        runtime_boundary = patch.object(
            HostOperations, 'runtime_exchange', side_effect=self.runtime,
        )
        runtime_boundary.start()
        self.addCleanup(runtime_boundary.stop)
        self.unit = self.root / 'systemd/sotto-review-start.service'
        self.unit.parent.mkdir(mode=0o700)
        self.drop_ins = ''
        self.command_history: list[list[str]] = []
        self.lost_startup_result = ''
        unit_boundary = patch.object(release, 'STARTUP_UNIT', self.unit)
        unit_boundary.start()
        self.addCleanup(unit_boundary.stop)
        real_lstat = Path.lstat

        def installed_lstat(path: Path) -> os.stat_result:
            metadata = real_lstat(path)
            if path in {self.unit, self.unit.parent
                        / 'docker.service.wants' / self.unit.name}:
                values = list(metadata)
                values[4] = 0
                return os.stat_result(values)
            return metadata

        metadata_boundary = patch.object(Path, 'lstat', installed_lstat)
        metadata_boundary.start()
        self.addCleanup(metadata_boundary.stop)
        command_boundary = patch.object(HostOperations, 'command',
                                        side_effect=self.command)
        command_boundary.start()
        self.addCleanup(command_boundary.stop)
        for name, value in (('RETENTION', self.retention),
                            ('HOST_STATE', self.host), ('CADDY', self.caddy)):
            boundary = patch('scripts.deploy.review.runtime.operations.'
                             + name, value)
            boundary.start()
            self.addCleanup(boundary.stop)
        docker = patch.object(HostOperations, 'docker',
                              side_effect=self.docker)
        docker.start()
        self.addCleanup(docker.stop)

    def runtime(self, mode: str, value: object) -> dict[str, object]:
        if mode != 'queue-policy':
            raise AssertionError('Unadmitted runtime boundary request')
        return {'queueCount': 27, 'concurrency': self.queue_concurrency,
                'privacyContactEmail': record(value, 'policy')
                ['privacyContactEmail']}

    def command(self, arguments: list[str]) -> bytes:
        self.command_history.append(arguments)
        if arguments[2:4] == ['install', '-o']:
            destination = Path(arguments[-1])
            if destination not in {self.caddy, self.unit}:
                raise AssertionError('Unadmitted fixture install target')
            if destination == self.unit:
                self.assertEqual(private_json(
                    self.operations.attempt.directory
                    / 'startup-unit-intent.json',
                ), release.startup_binding(self.operations))
            destination.write_bytes(Path(arguments[-2]).read_bytes())
            destination.chmod(0o644)
            if destination == self.unit and self.lost_startup_result \
                    == 'install':
                self.lost_startup_result = ''
                raise OSError('fixture lost startup install result')
        elif arguments[-3:] == ['systemctl', 'reload', 'caddy']:
            self.serving = self.caddy.read_bytes() == self.original
        elif arguments[:2] == ['systemctl', 'show']:
            return (f'FragmentPath={self.unit}\n'
                    f'DropInPaths={self.drop_ins}\n').encode()
        elif arguments[:2] == ['systemctl', 'is-enabled']:
            return b'enabled\n'
        elif arguments[-3:] == ['systemctl', 'enable', self.unit.name]:
            relation = (self.unit.parent / 'docker.service.wants'
                        / self.unit.name)
            relation.parent.mkdir(mode=0o700, exist_ok=True)
            if not relation.is_symlink():
                relation.symlink_to(self.unit)
            if self.lost_startup_result == 'enable':
                self.lost_startup_result = ''
                raise OSError('fixture lost startup enable result')
        return b''

    def docker(self, *arguments: str) -> bytes:
        if arguments[:2] == ('image', 'inspect'):
            return json.dumps([self.images[arguments[-1]]]).encode()
        if arguments[0] == 'inspect':
            return json.dumps([self.candidates[arguments[1]]]).encode()
        if arguments[0] == 'start':
            identity = arguments[1]
            container = self.candidates[identity]
            record(container['State'], 'state').update({
                'Running': True, 'Status': 'running',
            })
            settings = record(container['NetworkSettings'], 'settings')
            networks = record(settings['Networks'], 'networks')
            own = record(networks[NETWORK], 'review')
            own['IPAddress'] = record(own['IPAMConfig'], 'IPAM') \
                ['IPv4Address']
            self.started.append(identity)
            return identity.encode()
        raise AssertionError('Unadmitted fixture Docker operation')

    def canonical_docker(self, *arguments: str) -> str:
        if arguments[:2] == ('image', 'inspect'):
            return str(self.images[arguments[-1]]['Id'])
        if arguments[:2] == ('ps', '-aq'):
            return 'original' if arguments[-1].endswith('='+PROJECT) else ''
        if arguments[0] == 'inspect':
            return 'sha256:'+'3'*64
        raise AssertionError('Unadmitted canonical Docker operation')

    def record_archive_intent(
        self, archive: Path, captured: dict[str, object],
    ) -> None:
        atomic_json(self.operations.attempt.directory / (
            'archive-intent-'+archive.name+'.json'
        ), {'directory': archive.name, 'records': {
            name: record(value, 'captured')['sha256']
            for name, value in captured.items()
        }})

    def test_completed_unit_uses_verified_entry_without_starting_services(
        self,
    ) -> None:
        configuration = configparser.ConfigParser(interpolation=None)
        configuration.read_string(release.startup_unit(
            self.operations).decode())
        self.assertEqual(configuration['Unit']['Requires'],
                         'docker.service sotto-review-egress.service')
        self.assertEqual(configuration['Unit']['After'],
                         configuration['Unit']['Requires'])
        self.assertEqual(configuration['Unit']['PartOf'], 'docker.service')
        service = configuration['Service']
        self.assertEqual(service['Type'], 'oneshot')
        self.assertEqual(service['RemainAfterExit'], 'yes')
        self.assertEqual(service['TimeoutStartSec'], '0')
        self.assertEqual(service['User'], 'sotto')
        self.assertEqual(service['UMask'], '0077')
        self.assertNotIn('ExecStop', service)
        self.assertEqual(shlex.split(service['ExecStart'])[1:], [
            '-m', 'scripts.deploy.review.runtime.controller',
            '--start-completed', '--attempt',
            str(self.operations.attempt.directory),
        ])
        self.assertEqual(configuration['Install']['WantedBy'],
                         'docker.service')
        release.install_startup_unit(self.operations)
        release.verify_startup_unit(self.operations)
        self.assertEqual(self.unit.read_bytes(),
                         release.startup_unit(self.operations))
        self.assertTrue(all('--now' not in arguments
                            for arguments in self.command_history))
        self.assertFalse(any('start' in arguments or 'restart' in arguments
                             for arguments in self.command_history))
        self.assertEqual(self.started, [])

    def test_release_and_services_can_load_in_either_fresh_process_order(
        self,
    ) -> None:
        for names in (('release', 'services'), ('services', 'release')):
            with self.subTest(first=names[0]):
                result = subprocess.run([
                    sys.executable, '-c',
                    'from scripts.deploy.review.runtime import '
                    + ', '.join(names)
                    + '; assert services.finalize is release.finalize',
                ], cwd=Path(__file__).resolve().parents[4],
                    capture_output=True, text=True, timeout=10, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)

    def check_lost_startup_result(self, stage: str) -> None:
        self.lost_startup_result = stage
        directory = self.operations.attempt.directory
        with self.assertRaisesRegex(OSError, 'lost startup'):
            release.install_startup_unit(self.operations)
        self.assertTrue((directory / 'startup-unit-intent.json').exists())
        self.assertFalse((directory / 'startup-unit.json').exists())
        self.assertEqual(self.unit.read_bytes(),
                         release.startup_unit(self.operations))
        release.install_startup_unit(self.operations)
        release.verify_startup_unit(self.operations)

    def test_lost_install_result_replays_only_the_owned_identical_unit(
        self,
    ) -> None:
        self.check_lost_startup_result('install')

    def test_lost_enable_result_reconciles_the_same_completed_relation(
        self,
    ) -> None:
        self.check_lost_startup_result('enable')

    def test_foreign_existing_startup_unit_is_preserved_and_refused(
        self,
    ) -> None:
        self.unit.write_bytes(b'foreign service')
        with self.assertRaisesRegex(ValueError, 'foreign-existing'):
            release.install_startup_unit(self.operations)
        self.assertEqual(self.unit.read_bytes(), b'foreign service')
        self.assertEqual(self.command_history, [])

    def test_foreign_drop_in_refuses_completion_without_a_receipt(
        self,
    ) -> None:
        self.drop_ins = '/etc/systemd/system/sotto-review-start.d/foreign.conf'
        with self.assertRaisesRegex(ValueError, 'unit-overridden'):
            release.install_startup_unit(self.operations)
        self.assertFalse((self.operations.attempt.directory
                          / 'startup-unit.json').exists())
        self.assertEqual(self.started, [])

    def test_changed_unit_or_enable_relation_refuses_verified_startup(
        self,
    ) -> None:
        release.install_startup_unit(self.operations)
        self.unit.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'unit-changed'):
            release.verify_startup_unit(self.operations)
        self.unit.chmod(0o644)
        relation = self.unit.parent / 'docker.service.wants' / self.unit.name
        relation.unlink()
        relation.symlink_to(self.caddy)
        with self.assertRaisesRegex(ValueError, 'relation-changed'):
            release.verify_startup_unit(self.operations)
        self.assertTrue(stat.S_ISREG(self.unit.lstat().st_mode))

    def test_lost_begin_result_still_captures_exact_import_records(
        self,
    ) -> None:
        canonical = import_module('scripts.deploy.production-retention')
        with patch.object(canonical, 'docker',
                          side_effect=self.canonical_docker):
            release.before_fence(self.operations)
            path = self.operations.attempt.directory / 'admitted-imports.json'
            expected = path.read_bytes()
            path.unlink()
            release.before_fence(self.operations)
            self.assertEqual(private_json(path), json.loads(expected))

    def test_begin_intent_before_dispatch_resumes_only_unchanged_protection(
        self,
    ) -> None:
        canonical = import_module('scripts.deploy.production-retention')
        with patch.object(canonical, 'docker', side_effect=OSError('fixture')):
            with self.assertRaises(OSError):
                release.before_fence(self.operations)
        with patch.object(canonical, 'docker',
                          side_effect=self.canonical_docker):
            release.before_fence(self.operations)
        self.assertTrue((self.operations.attempt.directory
                         / 'admitted-imports.json').exists())

    @unittest.skipUnless(
        os.environ.get('SOTTO_REVIEW_IMPORT_FINALIZER'),
        'Requires the explicitly admitted unchanged canonical finalizer',
    )
    def test_partial_and_lost_archive_results_retain_every_exact_record(
        self,
    ) -> None:
        captured: dict[str, object] = {}
        archive = self.operations.attempt.directory / 'finalized-imports-prior'
        archive.mkdir(mode=0o700)
        originals = sorted(self.retention.glob('sotto-review-import-*'))
        for path in originals:
            raw = path.read_bytes()
            captured[path.name] = {'sha256': hashlib.sha256(raw).hexdigest(),
                                   'record': json.loads(raw)}
            (archive / path.name).write_bytes(raw)
            (archive / path.name).chmod(0o600)
        # Model a process loss after one canonical unlink. All copies remain.
        self.record_archive_intent(archive, captured)
        originals[0].unlink()
        real_open = os.open

        def fixture_open(
            name: str | Path, flags: int, mode: int = 0o777,
            *, dir_fd: int | None = None,
        ) -> int:
            if Path(name) == Path('/home/sotto/.local/state/'
                                  'production-image-retention'):
                name = self.retention
            return real_open(name, flags, mode, dir_fd=dir_fd)

        with patch('os.open', side_effect=fixture_open):
            release.archive_imports(self.operations, captured)
            # A lost caller result reconciles existing exact copies.
            release.archive_imports(self.operations, captured)
        index = private_json(self.operations.attempt.directory
                             / 'import-archive-index.json')
        self.assertEqual(set(index), set(captured))
        for name, relative in index.items():
            self.assertFalse((self.retention / name).exists())
            self.assertEqual(hashlib.sha256((self.operations.attempt.directory
                             / str(relative)).read_bytes()).hexdigest(),
                             record(captured[name], 'captured')['sha256'])
        self.assertTrue(archive.exists())
        self.assertEqual(len(list(self.operations.attempt.directory.glob(
            'finalized-imports-*',
        ))), 2)

    def test_changed_archive_refuses_without_removing_remaining_heads(
        self,
    ) -> None:
        path = next(self.retention.glob('sotto-review-import-*'))
        captured: dict[str, object] = {path.name: {'sha256': hashlib.sha256(
            path.read_bytes()).hexdigest(), 'record': private_json(path)}}
        archive = self.operations.attempt.directory / 'finalized-imports-prior'
        archive.mkdir(mode=0o700)
        (archive / path.name).write_bytes(b'changed')
        (archive / path.name).chmod(0o600)
        self.record_archive_intent(archive, captured)
        with self.assertRaisesRegex(ValueError, 'archive-changed'):
            release.archive_imports(self.operations, captured)
        self.assertTrue(path.exists())

    def prepare_completed_records(self) -> None:
        directory = self.operations.attempt.directory
        self.review = self.root / 'review'
        parent = self.review / 'auth'
        parent.mkdir(mode=0o700, parents=True)
        target = parent / 'codex'
        target.mkdir(mode=0o700)
        for name in ('auth.json', 'config.toml'):
            self.operations.private_file(target / name, b'fixture-session')
        metadata = target.stat()
        atomic_json(directory / 'auth-handover.json', {
            'identity': [metadata.st_dev, metadata.st_ino],
            'uid': os.geteuid(), 'gid': os.getegid(), 'inputsSha256': '9'*64,
        })
        self.operations.private_file(directory / 'original-caddy.conf',
                                     self.original)
        atomic_json(directory / 'workloads-verified.json', {
            'profileCount': 2, 'humanPronunciationVerified': False,
        })
        captured: dict[str, object] = {}
        archive = directory / 'finalized-imports-completed'
        archive.mkdir(mode=0o700)
        for path in sorted(self.retention.glob('sotto-review-import-*')):
            raw = path.read_bytes()
            captured[path.name] = {'sha256': hashlib.sha256(raw).hexdigest(),
                                   'record': json.loads(raw)}
            self.operations.private_file(archive / path.name, raw)
            path.unlink()
        atomic_json(directory / 'admitted-imports.json', captured)
        self.record_archive_intent(archive, captured)
        release.archive_imports(self.operations, captured)
        _, identities = release.retention_context(self.operations)
        atomic_json(self.retention / (PROJECT+'.json'),
                    {'protected_images': sorted(identities)})
        release.install_startup_unit(self.operations)

    def test_completed_evidence_retains_rotated_auth_and_rejects_changed_copy(
        self,
    ) -> None:
        self.prepare_completed_records()
        with patch('scripts.deploy.review.runtime.release.DIRECTORY',
                   str(self.review)):
            expected = release.read_completed_record(self.operations)
            atomic_json(self.operations.attempt.directory
                        / 'release-record.json', expected)
            release.verify_completed_records(self.operations)
            # Auth rotates in the same canonical home. Its initial bytes do
            # not constrain the active refresh session after handover.
            (self.review / 'auth/codex/auth.json').write_bytes(b'rotated')
            release.verify_completed_records(self.operations)
            index = private_json(self.operations.attempt.directory
                                 / 'import-archive-index.json')
            archived = self.operations.attempt.directory / str(
                next(iter(index.values())),
            )
            archived.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'archive-changed'):
                release.verify_completed_records(self.operations)

    def test_completed_evidence_rejects_replacement_shared_auth_directory(
        self,
    ) -> None:
        self.prepare_completed_records()
        with patch('scripts.deploy.review.runtime.release.DIRECTORY',
                   str(self.review)):
            expected = release.read_completed_record(self.operations)
            atomic_json(self.operations.attempt.directory
                        / 'release-record.json', expected)
            target = self.review / 'auth/codex'
            target.rename(target.with_name('retained-original'))
            target.mkdir(mode=0o700)
            with self.assertRaisesRegex(ValueError, 'shared-auth-home'):
                release.verify_completed_records(self.operations)

    @unittest.skipUnless(
        os.environ.get('SOTTO_REVIEW_IMPORT_FINALIZER'),
        'Requires the explicitly admitted unchanged canonical finalizer',
    )
    def test_partial_archive_without_index_reaches_cutover_and_finalization(
        self,
    ) -> None:
        self.prepare_completed_records()
        directory = self.operations.attempt.directory
        index = private_json(directory / 'import-archive-index.json')
        (directory / 'import-archive-index.json').unlink()
        restored = sorted(index)[-1]
        self.operations.private_file(self.retention / restored,
            (directory / str(index[restored])).read_bytes())
        for phase in PHASES[1:]:
            self.operations.attempt.advance(phase)
            if phase == 'PUBLIC_COMMITTED':
                break
        real_open = os.open

        def fixture_open(
            name: str | Path, flags: int, mode: int = 0o777,
            *, dir_fd: int | None = None,
        ) -> int:
            if Path(name) == Path('/home/sotto/.local/state/'
                                  'production-image-retention'):
                name = self.retention
            return real_open(name, flags, mode, dir_fd=dir_fd)

        def command(arguments: list[str]) -> bytes:
            return self.command(arguments)

        def public_get(_: str) -> tuple[int, bytes]:
            if not self.serving:
                return 503, b'Review upgrade in progress.'
            return 200, json.dumps({'status': 'healthy',
                                    'version': 'a'*40}).encode()

        with (patch('scripts.deploy.review.runtime.release.DIRECTORY',
                    str(self.review)),
              patch.object(HostOperations, 'command', side_effect=command),
              patch.object(HostOperations, 'verify_storage'),
              patch.object(HostOperations, 'verify_egress'),
              patch.object(HostOperations, 'public_get',
                           side_effect=public_get),
              patch('os.open', side_effect=fixture_open)):
            self.operations.fence()
            release.cutover(self.operations)
            # Routing recovery only reads mixed import evidence.
            self.assertTrue((self.retention / restored).exists())
            self.assertFalse((directory
                              / 'import-archive-index.json').exists())
            release.finalize(self.operations)
            release.verify_completed_records(self.operations)
        self.assertEqual(list(self.retention.glob(
            'sotto-review-import-*',
        )), [])

    def stopped_release(self) -> None:
        self.prepare_completed_records()
        expected = release.read_completed_record(self.operations)
        atomic_json(self.operations.attempt.directory / 'release-record.json',
                    expected)
        for phase in PHASES[1:]:
            self.operations.attempt.advance(phase)
        for container in self.candidates.values():
            record(container['State'], 'state').update({
                'Running': False, 'Status': 'exited',
            })
            networks = record(record(container['NetworkSettings'], 'settings')
                              ['Networks'], 'networks')
            own = record(networks[NETWORK], 'review')
            own['IPAMConfig'] = {'IPv4Address': own['IPAddress']}
            own['IPAddress'] = ''

    def test_completed_start_uses_only_stopped_bound_ids_without_import_heads(
        self,
    ) -> None:
        with patch('scripts.deploy.review.runtime.release.DIRECTORY',
                   str(self.root / 'review')):
            self.stopped_release()
            with (patch.object(HostOperations, 'verify_tools'),
                  patch.object(HostOperations, 'verify_storage'),
                  patch.object(HostOperations, 'verify_egress'),
                  patch.object(HostOperations, 'public_get', return_value=(
                      200, json.dumps({'status': 'healthy',
                                       'version': 'a'*40}).encode(),
                  ))):
                release.start_completed(self.operations)
            self.assertEqual(self.started, ['web', 'workers'])
            self.assertEqual(list(self.retention.glob(
                'sotto-review-import-*',
            )), [])

    def test_changed_stopped_candidate_refuses_before_starting_either_id(
        self,
    ) -> None:
        with patch('scripts.deploy.review.runtime.release.DIRECTORY',
                   str(self.root / 'review')):
            self.stopped_release()
            record(self.candidates['workers']['HostConfig'], 'host') \
                ['Privileged'] = True
            with (patch.object(HostOperations, 'verify_tools'),
                  patch.object(HostOperations, 'verify_storage'),
                  patch.object(HostOperations, 'verify_egress'),
                  self.assertRaisesRegex(ValueError, 'candidate-changed')):
                release.start_completed(self.operations)
        self.assertEqual(self.started, [])

    def test_changed_queue_policy_refuses_before_either_stopped_service_starts(
        self,
    ) -> None:
        with patch('scripts.deploy.review.runtime.release.DIRECTORY',
                   str(self.root / 'review')):
            self.stopped_release()
            self.queue_concurrency = 2
            with (patch.object(HostOperations, 'verify_tools'),
                  patch.object(HostOperations, 'verify_storage'),
                  patch.object(HostOperations, 'verify_egress'),
                  self.assertRaisesRegex(ValueError, 'queue-policy-changed')):
                release.start_completed(self.operations)
        self.assertEqual(self.started, [])

    def test_original_fragment_with_lost_reload_is_reloaded_and_verified(
        self,
    ) -> None:
        def command(arguments: list[str]) -> bytes:
            if arguments[2:4] == ['install', '-o']:
                self.caddy.write_bytes(Path(arguments[-2]).read_bytes())
            elif arguments[-3:] == ['systemctl', 'reload', 'caddy']:
                self.serving = self.caddy.read_bytes() == self.original
            return b''

        def public_get(_: str) -> tuple[int, bytes]:
            if not self.serving:
                raise AssertionError('Public health read before actual reload')
            return 200, json.dumps({'status': 'healthy',
                                    'version': 'a'*40}).encode()

        with (patch.object(HostOperations, 'command', side_effect=command),
              patch.object(HostOperations, 'public_get',
                           side_effect=public_get)):
            release.install_public_routing(self.operations, self.original)
        self.assertTrue(self.serving)

    def test_reload_failure_retains_maintenance_and_same_attempt_can_resume(
        self,
    ) -> None:
        from scripts.deploy.review.runtime.operations import MAINTENANCE

        self.fail_reload = True

        def command(arguments: list[str]) -> bytes:
            if arguments[2:4] == ['install', '-o']:
                self.caddy.write_bytes(Path(arguments[-2]).read_bytes())
            elif arguments[-3:] == ['systemctl', 'reload', 'caddy']:
                if self.fail_reload:
                    self.fail_reload = False
                    raise OSError('fixture result lost before reload')
                self.serving = self.caddy.read_bytes() == self.original
            return b''

        def public_get(_: str) -> tuple[int, bytes]:
            if not self.serving:
                return 503, b'Review upgrade in progress.'
            return 200, json.dumps({'status': 'healthy',
                                    'version': 'a'*40}).encode()

        with (patch.object(HostOperations, 'command', side_effect=command),
              patch.object(HostOperations, 'public_get',
                           side_effect=public_get)):
            with self.assertRaisesRegex(OSError, 'result lost'):
                release.install_public_routing(self.operations,
                                               self.original)
            self.assertEqual(self.caddy.read_bytes(), MAINTENANCE)
            self.operations.attempt.verify_marker(self.host/'unresolved.json')
            release.install_public_routing(self.operations, self.original)
        self.assertEqual(self.caddy.read_bytes(), self.original)
        self.assertTrue(self.serving)
