"""Recover exact review import records and interrupted public routing."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
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


class ReleaseRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
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
        attempt = Attempt.create(self.root, 'release-fixture', manifest,
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
            if arguments[2:4] == ['install', '-o']:
                self.caddy.write_bytes(Path(arguments[-2]).read_bytes())
            elif arguments[-3:] == ['systemctl', 'reload', 'caddy']:
                self.serving = self.caddy.read_bytes() == self.original
            return b''

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
