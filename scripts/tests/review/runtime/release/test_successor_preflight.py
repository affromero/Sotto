"""Check the successor preflight without touching a running review stack."""

import hashlib
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.deploy.review.runtime.operations import HostOperations
from scripts.deploy.review.runtime.release.fixture import prepare_review_seed
from scripts.deploy.review.runtime.release.migrations import migration_inventory
from scripts.deploy.review.runtime.release.successor import (
    migrate_successor_data,
    preflight_successor,
    prepare_successor_compose,
    prepare_successor_data,
    read_successor_compose,
    reconcile_created_candidates,
    retain_successor_restore_manifest,
    successor_compose_input,
    successor_restore_manifest,
    verify_successor_data,
    verify_successor_workload,
)
from scripts.deploy.review.state import Attempt, DeploymentLock, atomic_json, private_json
from scripts.tests.review.runtime import admitted_runtime_fixture


class SuccessorPreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        lock_path = root / 'review.lock'
        lock_path.touch(mode=0o600)
        lock = DeploymentLock(lock_path)
        self.addCleanup(lock.close)
        files = {}
        for name, filename in (('compose', 'compose.yml'),
                               ('caddyFragment', 'review.caddy'),
                               ('caddyRoot', 'Caddyfile')):
            path = root / filename
            path.write_text(name)
            files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        self.routing = root / 'review.caddy'
        runtime = 'scripts.deploy.review.runtime.'
        self.enterContext(patch(runtime + 'operations.CADDY', self.routing))
        self.enterContext(patch(runtime + 'operations.CADDY_ROOT', root / 'Caddyfile'))
        self.enterContext(patch(runtime + 'operations.HOST_STATE', root))
        self.enterContext(patch(runtime + 'release.successor.DIRECTORY', str(root)))
        self.enterContext(patch(runtime + 'release.successor.sys',
                                SimpleNamespace(platform='linux')))
        self.enterContext(patch.dict(os.environ, {'DOCKER_HOST': 'unix:///var/run/docker.sock'}))
        old = 'apps/web/prisma/migrations/01_previous/migration.sql'
        new = 'apps/web/prisma/migrations/02_candidate/migration.sql'
        self.migrations = {old: 'a' * 64, new: 'b' * 64}
        self.image = 'sha256:' + 'c' * 64
        topology = {'network': {'id': 'retained'}}
        old_worker = {'sha': 'd' * 40}
        new_worker = {'sha': 'e' * 40, 'imageId': self.image}
        self.initial = {'migrations': {old: self.migrations[old]}, 'receipt': old_worker}
        self.final = {'migrations': self.migrations, 'receipt': new_worker}
        self.data = {'schemaVersion': 1, 'tables': [
            {'table': 'Profile', 'columns': ['id'], 'count': 2,
             'bytes': 24, 'sha256': 'f' * 64},
        ], 'totalBytes': 24, 'totalRows': 2}
        baseline = (json.dumps(self.data) + '\n').encode()
        previous = Attempt.create(root, 'previous', {
            'topology': topology, 'stages': [self.initial], 'finalWorker': old_worker,
        }, 'f' * 64)
        successor = Attempt.create(root, 'successor', {
            'topology': topology, 'initialStage': self.initial, 'stages': [self.final],
            'finalWorker': new_worker, 'finalWeb': {'sha': new_worker['sha']},
            'originalFiles': files,
            'retiredBootstrapImage': 'sha256:' + 'd' * 64,
            'originalDataSha256': hashlib.sha256(baseline).hexdigest(),
            'originalQueues': {
                'schemaVersion': 1, 'connectionIdentity': 'b' * 64,
                'queues': [{'name': 'existing', 'paused': True},
                           {'name': 'running', 'paused': False}],
            },
        }, 'a' * 64)
        data_path = successor.directory / 'original-data.json'
        data_path.write_bytes(baseline)
        data_path.chmod(0o600)
        self.previous = HostOperations(previous, lock)
        self.operations = HostOperations(successor, lock)
        self.enterContext(patch(runtime + 'release.successor.bind_predecessor',
                                return_value=self.previous))
        self.enterContext(patch(runtime + 'release.successor.verify_live_predecessor'))
        self.enterContext(patch(runtime + 'release.successor.retained_predecessor_startup'))
        self.enterContext(patch(runtime + 'release.successor.verify_successor_runtime_identity'))
        self.enterContext(patch(runtime + 'release.successor.verify_successor_workload'))
        self.retention_plan = self.enterContext(patch(runtime + 'release.successor.verify_retention_begin'))
        self.enterContext(patch(runtime + 'release.successor.observe_predecessor_environment',
                                return_value=({}, {})))
        self.enterContext(patch.object(self.operations, 'verify_images'))
        self.enterContext(patch.object(self.operations, 'capacity'))
        self.enterContext(patch.object(self.operations, 'verify_tools'))
        self.enterContext(patch(runtime + 'release.successor.inspect_successor_worker_migrations',
                                return_value=(self.image, self.migrations)))

    def test_preflight_admits_exact_stage_while_leaving_the_attempt_unfenced(self) -> None:
        with patch('scripts.deploy.review.runtime.release.successor.successor_compose_document'):
            previous, initial, final = preflight_successor(self.operations)
        self.assertIs(previous, self.previous)
        self.assertEqual((initial, final), (self.initial, self.final))
        self.assertEqual(self.operations.attempt.state()['phase'], 'PRECHECK')
        self.assertEqual(self.operations.attempt.manifest()['retiredBootstrapImage'],
                         'sha256:' + 'd' * 64)
        self.assertFalse((self.operations.attempt.directory.parent / 'unresolved.json').exists())

    def test_preflight_refuses_routing_changed_since_admission(self) -> None:
        self.routing.write_text('changed routing')
        with self.assertRaisesRegex(ValueError, 'successor-precheck-configuration-changed'):
            preflight_successor(self.operations)
        self.assertEqual(self.operations.attempt.state()['phase'], 'PRECHECK')

    def test_preflight_refuses_an_incomplete_retention_plan_without_fencing(self) -> None:
        self.retention_plan.side_effect = ValueError('canonical-review-protection-plan-differs-from-admission')
        with patch('scripts.deploy.review.runtime.release.successor.successor_compose_document'):
            with self.assertRaisesRegex(ValueError, 'protection-plan'):
                preflight_successor(self.operations)
        self.assertEqual(self.operations.attempt.state()['phase'], 'PRECHECK')
        self.assertFalse((self.operations.attempt.directory.parent / 'unresolved.json').exists())
        self.assertFalse((self.operations.attempt.directory / 'retention-begin.json').exists())

    def test_preflight_refuses_a_remote_docker_daemon(self) -> None:
        with (patch.dict(os.environ, {'DOCKER_HOST': 'ssh://foreign.example'}),
              self.assertRaisesRegex(ValueError, 'local-linux-docker-daemon-required')):
            preflight_successor(self.operations)
        self.assertEqual(self.operations.attempt.state()['phase'], 'PRECHECK')

    def test_preflight_requires_the_exact_workload_before_fencing(self) -> None:
        profile = [
            {'id': 'owner', 'preferences': {}, 'existingCourseIds': ['old-course'],
             'fixture': {'native': 'en', 'target': 'es', 'curriculumId': 'seeded'}},
            {'id': 'member', 'preferences': {}, 'existingCourseIds': [], 'fixture': None},
        ]
        inputs = {key: {'expectedOwnerId': 'owner', 'profiles': profile}
                  for key in ('readiness', 'workloads')}
        runtime = 'scripts.deploy.review.runtime.release.successor.services.'
        with (
            patch(runtime + 'private_inputs', return_value=inputs),
            patch(runtime + 'verify_candidate', return_value='captured-worker'),
            patch.object(self.operations, 'command', side_effect=[
                b'{"profiles":2,"active":0}', b'{"profiles":2,"active":1}',
            ]) as command,
        ):
            with self.assertRaisesRegex(ValueError, 'admitted-successor-workload-not-verified'):
                verify_successor_workload(self.previous, self.operations)
            verify_successor_workload(self.previous, self.operations)
            request = json.loads(command.call_args.kwargs['content'])
            self.assertIsNone(request['seed'])
            dispatched = request['profiles']
            self.assertEqual(dispatched[0]['existingCourseIds'], ['old-course'])
            self.assertEqual(dispatched[0]['fixture']['curriculumId'], 'seeded')
        self.assertEqual(self.operations.attempt.state()['phase'], 'PRECHECK')

    def test_restore_preserves_predecessor_flags_and_unpauses_only_new_queues(self) -> None:
        with patch(
            'scripts.deploy.review.runtime.release.successor.successor_queue_policy_names',
            return_value=(['existing', 'running'], ['added', 'existing', 'running']),
        ):
            self.assertEqual(successor_restore_manifest(self.operations), {
                'schemaVersion': 1, 'connectionIdentity': 'b' * 64,
                'queues': [
                    {'name': 'added', 'paused': False},
                    {'name': 'existing', 'paused': True},
                    {'name': 'running', 'paused': False},
                ],
            })

    def test_restore_receipt_refuses_changed_flags_after_candidate_admission(self) -> None:
        runtime = 'scripts.deploy.review.runtime.release.successor.'
        path = self.operations.attempt.directory / 'original-queues.json'
        with (
            patch(runtime + 'verify_successor_candidate_admission') as admit,
            patch(runtime + 'successor_queue_policy_names',
                  return_value=(['existing', 'running'], ['added', 'existing', 'running'])),
            patch.object(self.operations, 'runtime_exchange') as exchange,
        ):
            paused = {
                'schemaVersion': 1, 'connectionIdentity': 'b' * 64,
                'queues': [{'name': name, 'paused': True}
                           for name in ('added', 'existing', 'running')],
            }
            consumers = {
                'consumers': 3, 'queuesPaused': True, 'workerAddress': '172.30.99.11',
            }
            exchange.return_value = {**paused, 'connectionIdentity': 'a' * 64}
            with self.assertRaisesRegex(ValueError, 'successor-candidate-queue-fence-changed'):
                retain_successor_restore_manifest(self.operations)
            self.assertFalse(path.exists())
            exchange.side_effect = [paused, consumers, paused, consumers, paused, consumers]
            original = retain_successor_restore_manifest(self.operations)
            admit.assert_called_with(self.operations, 'web')
            self.assertEqual(retain_successor_restore_manifest(self.operations), original)
            atomic_json(path, {**original, 'queues': []})
            with self.assertRaisesRegex(ValueError, 'successor-adopted-receipt-changed'):
                retain_successor_restore_manifest(self.operations)

    def test_preparation_requires_a_verified_backup_before_advancing(self) -> None:
        attempt = self.operations.attempt
        for phase in ('ADMITTED', 'PREPARED', 'FENCED'):
            attempt.advance(phase)
        runtime = 'scripts.deploy.review.runtime.release.successor.'
        actions: list[str] = []

        def observe(*args: object) -> None:
            actions.append('inventory')
            if actions == ['drain', 'inventory', 'backup', 'inventory']:
                raise ValueError('redis drifted after backup')

        self.enterContext(patch.object(self.operations, 'verify_fence'))
        self.enterContext(patch(runtime + 'quiesce_predecessor',
                                side_effect=lambda *args, **kwargs: actions.append('drain')))
        self.enterContext(patch(runtime + 'observe_retained_inventory', side_effect=observe))
        self.enterContext(patch(runtime + 'services.backup_review',
                                side_effect=lambda *args, **kwargs: actions.append('backup')))
        self.enterContext(patch(runtime + 'services.verify_backups',
                                side_effect=lambda *args, **kwargs: actions.append('verify')))
        with self.assertRaisesRegex(ValueError, 'redis drifted after backup'):
            prepare_successor_data(
                self.previous, self.operations, recover=False, continue_check=lambda: None,
            )
        self.assertEqual(attempt.state()['phase'], 'FENCED')
        self.assertFalse(attempt.state()['sqlMayHaveStarted'])
        attempt.unresolved('fixture-held')
        with self.assertRaisesRegex(ValueError, 'explicit-same-attempt-recovery-required'):
            prepare_successor_data(
                self.previous, self.operations, recover=False, continue_check=lambda: None,
            )
        with patch.object(self.operations, 'settle_pending_helpers'):
            prepare_successor_data(
                self.previous, self.operations, recover=True, continue_check=lambda: None,
            )
        self.assertEqual(attempt.state()['phase'], 'BACKED_UP')
        self.assertEqual(actions[-5:], ['drain', 'inventory', 'backup', 'inventory', 'verify'])

    def test_migration_holds_and_reconciles_only_the_admitted_stage(self) -> None:
        attempt = self.operations.attempt
        for phase in ('ADMITTED', 'PREPARED', 'FENCED', 'QUIESCENT', 'BACKED_UP'):
            attempt.advance(phase)
        runtime = 'scripts.deploy.review.runtime.release.successor.'
        self.enterContext(patch.object(self.operations, 'verify_fence'))
        self.enterContext(patch(runtime + 'services.verify_backups'))
        self.enterContext(patch(runtime + 'observe_retained_inventory'))
        applied = migration_inventory(self.initial)
        self.enterContext(patch(runtime + 'read_applied_migrations', return_value=applied))
        projections: list[str] = []

        def verify_data(previous, operations, *, phase) -> None:
            self.assertIs(previous, self.previous)
            self.assertEqual(operations.attempt.state()['phase'], phase)
            projections.append(phase)

        self.enterContext(patch(runtime + 'verify_successor_data', side_effect=verify_data))

        def run_sql(final, initial, *, predecessor) -> None:
            self.assertEqual((initial, final), (self.initial, self.final))
            self.assertIs(predecessor, self.previous)
            self.assertEqual(attempt.state()['phase'], 'SQL_STARTED')
            self.assertIs(attempt.state()['sqlMayHaveStarted'], True)
            self.assertEqual(attempt.state()['status'], 'active')
            applied.update(migration_inventory(final))
            raise RuntimeError('lost migration response')

        with patch.object(self.operations, 'migrate_stage', side_effect=run_sql):
            with self.assertRaisesRegex(RuntimeError, 'lost migration response'):
                migrate_successor_data(
                    self.previous, self.operations, recover=False, continue_check=lambda: None,
                )
        self.assertEqual(attempt.state()['phase'], 'SQL_STARTED')
        attempt.unresolved('fixture-held')

        def verify_sql(final, initial, *, predecessor) -> None:
            self.assertEqual(attempt.state()['status'], 'active')
            self.assertEqual(applied, migration_inventory(final))

        with patch.object(self.operations, 'migrate_stage', side_effect=verify_sql):
            migrate_successor_data(
                self.previous, self.operations, recover=True, continue_check=lambda: None,
            )
        self.assertEqual(attempt.state()['phase'], 'FINAL_SCHEMA_VERIFIED')
        self.assertEqual(projections, ['BACKED_UP', 'SQL_STARTED'])

    def test_preservation_rejects_changed_predecessor_rows(self) -> None:
        self.enterContext(patch.object(self.operations, 'verify_fence'))
        self.enterContext(patch(
            'scripts.deploy.review.runtime.release.successor.retained_inventory_network',
            return_value='container:retained-postgres',
        ))
        with patch.object(self.operations, 'image_command', side_effect=[
            json.dumps(self.data).encode(),
            json.dumps({**self.data, 'totalRows': 1}).encode(),
        ]) as observe:
            verify_successor_data(self.previous, self.operations, phase='BACKED_UP')
            self.assertEqual(json.loads(observe.call_args.kwargs['content']), [
                {'table': 'Profile', 'columns': ['id']},
            ])
            with self.assertRaisesRegex(ValueError, 'original-review-data-changed'):
                verify_successor_data(self.previous, self.operations, phase='SQL_STARTED')

    def test_seed_retries_a_lost_reply_and_verifies_completed_seed_read_only(self) -> None:
        seed = {
            'nativeLang': 'en', 'targetLang': 'es', 'curriculumId': 'review-en-es-v1',
            'lessons': 14, 'mapped': 3, 'unresolved': 14, 'status': 'PUBLISHED',
            'catalogRevision': {'version': 1, 'hash': 'a' * 64},
        }
        original = self.operations.attempt
        attempt = Attempt.create(original.directory.parent, 'fixture-seed', {
            **original.manifest(), 'predecessor': {}, 'reviewFixtureSeed': seed,
        }, original.evidence_hash)
        atomic = attempt.directory / 'original-data.json'
        atomic.write_bytes((original.directory / atomic.name).read_bytes())
        atomic.chmod(0o600)
        operations = HostOperations(attempt, self.operations.lock)
        for phase in ('ADMITTED', 'PREPARED', 'FENCED', 'QUIESCENT', 'BACKED_UP',
                      'SQL_STARTED', 'FINAL_SCHEMA_VERIFIED'):
            attempt.advance(phase)
        events = []

        def command(image, entrypoint, arguments, **options):
            events.append(entrypoint)
            if entrypoint == 'node':
                return json.dumps(self.data).encode()
            self.assertTrue((attempt.directory / 'review-seed-intent.json').exists())
            self.assertEqual(json.loads(options['content']), seed)
            self.assertEqual(arguments[-1], '--verify-receipt')
            if events == ['node', 'npx']:
                raise OSError('seed reply lost')
            return json.dumps(seed).encode()

        runtime = 'scripts.deploy.review.runtime.release.fixture.'
        with (
            patch.object(operations, 'verify_fence'),
            patch.object(operations, 'image_command', side_effect=command),
            patch.object(operations, 'settle_pending_helpers'),
            patch(runtime + 'retained_inventory_network', return_value='container:retained'),
        ):
            with self.assertRaisesRegex(OSError, 'seed reply lost'):
                prepare_review_seed(self.previous, operations, recover=False)
            attempt.unresolved('seed-reply-lost')
            prepare_review_seed(self.previous, operations, recover=True)
            prepare_review_seed(self.previous, operations, recover=False)
        self.assertEqual(events, ['node', 'npx', 'npx', 'node', 'node'])
        self.assertTrue((attempt.directory / 'review-seed-verified.json').exists())

    def test_reconcile_binds_verified_never_started_compose_result(self) -> None:
        attempt = self.operations.attempt
        for phase in ('ADMITTED', 'PREPARED', 'FENCED', 'QUIESCENT', 'BACKED_UP',
                      'SQL_STARTED', 'FINAL_SCHEMA_VERIFIED', 'EGRESS_GUARDED'):
            attempt.advance(phase)
        attempt.unresolved('lost-create-result')
        document = {'name': 'isolated', 'services': {
            'web': {'container_name': 'exact-candidate', 'image': 'admitted-image'},
        }}
        expected = hashlib.sha256(json.dumps(document, sort_keys=True).encode()).hexdigest()
        intent = attempt.directory / 'candidate-web-intent.json'
        binding = attempt.directory / 'candidate-web.json'
        atomic_json(intent, {'name': 'exact-candidate', 'reference': 'admitted-image',
                             'composeHash': expected})
        runtime = 'scripts.deploy.review.runtime.release.successor.'
        actual = {'Id': 'f' * 64}
        with (
            patch.object(self.operations, 'verify_fence'),
            patch.object(self.operations, 'verify_egress'),
            patch.object(self.operations, 'docker', return_value=actual['Id'].encode()) as docker,
            patch.object(self.operations, 'inspect', return_value=[actual]),
            patch.object(self.operations, 'writer_binding', return_value={'id': actual['Id']}),
            patch(runtime + 'read_successor_compose', return_value=document),
            patch(runtime + 'services.validate_created_candidate') as validate,
        ):
            validate.side_effect = ValueError('unexpected running candidate')
            with self.assertRaisesRegex(ValueError, 'unexpected running candidate'):
                reconcile_created_candidates(self.operations)
            self.assertFalse(binding.exists())
            validate.side_effect = None
            reconcile_created_candidates(self.operations)
            self.assertEqual(private_json(binding), {'id': actual['Id']})
            self.assertEqual(attempt.state()['status'], 'unresolved')
            self.assertTrue(all(call.args[0] == 'ps' for call in docker.call_args_list))

    def test_compose_receipt_pins_exact_secret_values_and_isolates_project(self) -> None:
        manifest = self.operations.manifest
        worker_image = 'ghcr.io/affromero/sotto-workers-prod@' + self.image
        web_image = 'ghcr.io/affromero/sotto-review-web@sha256:' + 'd' * 64
        attempt = Attempt.create(self.operations.attempt.directory.parent, 'compose-fixture', {
            **manifest, **admitted_runtime_fixture(), 'runtimeUid': 1000, 'runtimeGid': 1000,
            'predecessor': {'manifestSha256': self.previous.attempt.manifest_hash},
            'finalWeb': {**manifest['finalWeb'], 'reference': web_image},
            'finalWorker': {**manifest['finalWorker'], 'reference': worker_image},
        }, 'a' * 64)
        operations = HostOperations(attempt, self.operations.lock)
        for phase in ('ADMITTED', 'PREPARED', 'FENCED', 'QUIESCENT', 'BACKED_UP',
                      'SQL_STARTED', 'FINAL_SCHEMA_VERIFIED'):
            attempt.advance(phase)
        runtime = 'scripts.deploy.review.runtime.release.successor.'
        values = {
            'DATABASE_URL': 'postgresql://fixture:literal$field@localhost/fixture',
            'REDIS_URL': 'redis://localhost/0',
            'BYOK_ENCRYPTION_KEY': 'fixture-key',
        }
        self.enterContext(patch.object(operations, 'verify_fence'))
        self.enterContext(patch(runtime + 'verify_retained_network'))
        self.enterContext(patch(runtime + 'admit_successor_environment',
                                return_value=(values, {})))
        self.enterContext(patch(runtime + 'DIRECTORY', '/home/sotto/sotto-review'))
        document = prepare_successor_compose(self.previous, operations)
        self.assertEqual(document['name'], 'sotto-review-compose-fixture-runtime')
        self.assertEqual(read_successor_compose(operations), document)
        self.assertIn(b'literal$field', (attempt.directory / 'candidate-compose.json').read_bytes())
        launched = json.loads(successor_compose_input(document))['services']
        for role in ('web', 'workers'):
            self.assertEqual(launched[role]['environment']['DATABASE_URL'],
                             values['DATABASE_URL'].replace('$', '$$'))
        (attempt.directory / 'candidate-compose.json').write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError, 'successor-compose-receipt-changed'):
            read_successor_compose(operations)
