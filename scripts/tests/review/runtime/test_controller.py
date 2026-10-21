"""Exercise durable upgrade outcomes with host commands at the boundary."""

from __future__ import annotations

import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import traceback
import unittest
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import cast
from unittest.mock import patch

from scripts.deploy.review.runtime import controller, services
from scripts.deploy.review.runtime.operations import HostOperations
from scripts.deploy.review.state import (
    Attempt,
    DeploymentLock,
    atomic_json,
    private_json,
)


class HostBoundary:
    """Model only the external host's durable state and runtime responses."""

    def __init__(self, attempt: Attempt, lock: DeploymentLock) -> None:
        self.attempt = attempt
        self.lock = lock
        self.manifest = attempt.manifest()
        self.fenced = False
        self.schema_written = False
        self.public = False
        self.finalized = False
        self.worker = False
        self.web = False
        self.restored = False
        self.learning_verified = False
        self.fail_sql = False
        self.lose_prepare = False
        self.lose_restore = False
        self.fail_learning = False
        self.fail_paused_start = False
        self.original = {'owner': 'preserved', 'member': 'preserved'}

    def verify_tools(self) -> None:
        self.lock.validate()

    def preflight(self) -> dict[str, object]:
        if self.schema_written or self.public:
            raise ValueError('original topology unavailable')
        return {'topologyHash': 'a' * 64}

    def runtime_environment(self) -> None:
        self.lock.validate()

    def capacity(self) -> None:
        self.lock.validate()

    def fence(self) -> None:
        marker = self.attempt.directory.parent / 'unresolved.json'
        if marker.exists():
            self.attempt.verify_marker(marker)
        else:
            self.attempt.install_marker(marker)
        self.fenced = True
        self.public = False

    def verify_fence(self) -> None:
        self.lock.validate()
        if not self.fenced:
            raise ValueError('public fence absent')

    def retire_old_web(self) -> None:
        self.verify_fence()

    def verify_empty_redis(self) -> None:
        if self.restored or self.worker:
            raise ValueError('unexpected review Redis activity')

    def backups(self) -> None:
        self.verify_fence()
        atomic_json(self.attempt.directory / 'backups.json', {
            'database': 'retained', 'bothProfiles': self.original,
        })

    def verify_storage(self) -> None:
        self.lock.validate()

    def migrate_stage(self, stage: object, previous: object) -> None:
        if (not self.attempt.state()['sqlMayHaveStarted']
                or not (self.attempt.directory / 'backups.json').exists()):
            raise ValueError('SQL reached before durable fence and backup')
        self.verify_fence()
        self.schema_written = True
        if self.fail_sql:
            raise RuntimeError('actual SQL client lost')

    def install_egress(self) -> None:
        self.verify_fence()

    def verify_egress(self) -> None:
        self.verify_fence()

    def settle_pending_helpers(self) -> None:
        self.lock.validate()

    def runtime_exchange(
        self, mode: str, value: object, *,
        checkpoint: object = None, candidate_id: str | None = None,
    ) -> object:
        queues = self.manifest['originalQueues']
        if mode == 'capture':
            return private_json(self.attempt.directory / 'evidence.json')
        self.verify_fence()
        if mode == 'prepare':
            atomic_json(self.attempt.directory / 'original-queues.json',
                        cast(dict[str, object], queues))
            if self.lose_prepare:
                raise RuntimeError('queue preparation response lost')
            return {'prepared': True, 'manifest': queues,
                    'zeroWork': False, 'pending': 3}
        if mode == 'providers':
            if not self.web or candidate_id != 'web-id':
                raise ValueError('provider request escaped candidate')
            return {
                'credentialValidation': 'verified', 'profileCount': 2,
                'credentialCount': 4, 'modelDiscovery': 'live',
                'modelId': 'codex', 'speechSelectionsPreserved': True,
                'workloadVerification': 'required',
            }
        if mode == 'inspect':
            if self.restored or self.worker:
                raise ValueError('initial inventory used after activation')
            return {'admitted': True, 'zeroWork': False, 'pending': 3}
        if mode == 'consumers':
            if value != {'address': '172.30.99.11', 'paused': True,
                         'count': int(self.worker)}:
                raise ValueError('unexpected actual consumers')
            if self.worker and self.fail_paused_start:
                raise RuntimeError('paused worker startup response lost')
            return {'queuesPaused': True}
        if mode == 'paused-admission':
            if not self.worker or self.restored:
                raise ValueError('paused original immutable proof unavailable')
            return {'admitted': True, 'zeroWork': False, 'pending': 3}
        if mode == 'queues':
            request = cast(dict[str, object], value)
            if request['command'] == 'restore':
                if not self.worker:
                    raise ValueError('worker missing before activation')
                self.restored = True
                if self.lose_restore:
                    raise RuntimeError('queue restore response lost')
            if self.restored:
                return queues
            raise ValueError('actual queues still paused')
        if mode == 'continuation':
            if not self.restored:
                raise ValueError('historical jobs not delivered')
            return {'retained': True, 'zeroWork': False,
                    'pending': 3, 'failed': 3, 'attempts': 2}
        if mode == 'workloads':
            if self.fail_learning:
                raise RuntimeError('actual selected provider failed')
            self.learning_verified = True
            profiles = cast(list[dict[str, object]],
                            cast(dict[str, object], value)['profiles'])
            return {
                'profileCount': 2, 'generatedClasses': 2,
                'syntheticAssessments': 2,
                'humanPronunciationVerified': False,
                'codexWorkload': 'verified',
                'selectedSpeechWorkload': 'verified',
                'speechSelections': [row['selection'] for row in profiles],
                'referenceAudioSha256': ['b' * 64, 'c' * 64],
            }
        raise ValueError('unexpected runtime operation')


class ReviewControllerTests(unittest.TestCase):
    def test_recovery_api_rejects_non_linux_before_process_or_host_access(
        self,
    ) -> None:
        with (patch.object(sys, 'platform', 'darwin'),
              self.assertRaisesRegex(ValueError, 'linux-supervisor-recovery')):
            controller.request_recovery(self.attempt)

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.root.chmod(0o700)
        self.lock_path = self.root / 'fixture.lock'
        self.lock_path.touch(mode=0o600)
        self.lock = DeploymentLock(self.lock_path)
        self.addCleanup(self.lock.close)
        self.controller = controller
        evidence: dict[str, object] = {
            'namespace': 'sotto',
            'jobs': [{'id': f'00000000-0000-4000-8000-00000000000{i}'}
                     for i in range(3)],
        }
        kernel: dict[str, object] = {
            'egressSourceSha256': 'd' * 64,
            'cases': 62, 'unguardedCases': 62,
            'hostPolicyUnchanged': True, 'hostLinksUnchanged': True,
            'outerNamespaceUnchanged': True, 'namespaceOnly': True,
            'unrelatedRulePreserved': True, 'noExternalNetwork': True,
            'fullProofSha256': 'e' * 64, 'scriptSha256': 'f' * 64,
            'renderSha256': 'a' * 64,
        }
        codex: dict[str, object] = {
            'exactResponse': True, 'toolsUsed': False,
            'requestSha256': 'b' * 64, 'eventsSha256': 'c' * 64,
        }
        data: dict[str, object] = {'schemaVersion': 1, 'tables': []}
        self.files = {'evidence.json': evidence, 'kernel-proof.json': kernel,
                      'codex-proof.json': codex, 'original-data.json': data}
        encoded = {name: (json.dumps(value) + '\n').encode()
                   for name, value in self.files.items()}
        hashed = {name: hashlib.sha256(value).hexdigest()
                  for name, value in encoded.items()}
        worker = {'sha': '1' * 40, 'imageId': 'sha256:' + '2' * 64}
        self.inventories = {
            size: {
                f'apps/web/prisma/migrations/migration_{i}/migration.sql':
                hashlib.sha256(str(i).encode()).hexdigest()
                for i in range(size)
            } for size in (11, 13, 28, 31)
        }
        initial: dict[str, object] = {'migrations': self.inventories[11]}
        stages: list[dict[str, object]] = [
            {'receipt': (worker if size == 31 else {'sha': str(size)}),
             'migrations': self.inventories[size]}
            for size in (13, 28, 31)
        ]
        manifest: dict[str, object] = {
            'tools': {'scripts/deploy/review/egress.py': 'd' * 64},
            'kernelProofSha256': hashed['kernel-proof.json'],
            'offserverCodexProofSha256': hashed['codex-proof.json'],
            'originalDataSha256': hashed['original-data.json'],
            'initialStage': initial, 'stages': stages,
            'finalWorker': worker, 'finalWeb': {'sha': '1' * 40},
            'originalQueues': {'schemaVersion': 1,
                               'connectionIdentity': 'private-identity',
                               'queues': [{'name': f'queue-{i}',
                                           'paused': False}
                                          for i in range(27)]},
        }
        self.attempt = Attempt.create(self.root, 'fixture', manifest,
                                      hashed['evidence.json'])
        for name, content in encoded.items():
            path = self.attempt.directory / name
            path.write_bytes(content)
            path.chmod(0o600)
        self.host = HostBoundary(self.attempt, self.lock)
        profile: list[dict[str, object]] = [
            {'id': name, 'preferences': {}, 'selection': {}}
            for name in ('owner', 'member')
        ]
        inputs = {
            'readiness': {'expectedOwnerId': 'owner', 'profiles': profile,
                          'selectedModelId': 'codex'},
            'workloads': {'expectedOwnerId': 'owner', 'profiles': profile},
        }
        self.addCleanup(patch.stopall)
        patch.object(self.controller, 'HOST_STATE', self.root).start()
        patch.object(self.controller, 'HostOperations',
                     return_value=self.host).start()
        for name in ('preserve_data', 'runtime_identity', 'handover_auth'):
            patch.object(services, name).start()
        patch.object(services, 'private_inputs', return_value=inputs).start()
        patch.object(services, 'before_fence').start()
        patch.object(services, 'candidate', side_effect=self.candidate).start()
        patch.object(services, 'verify_candidate',
                     side_effect=self.verify_candidate).start()
        patch.object(services, 'wait_health', side_effect=self.health).start()
        patch.object(services, 'cutover', side_effect=self.cutover).start()
        patch.object(services, 'finalize', side_effect=self.finalize).start()
        patch.object(services, 'verify_completed',
                     side_effect=self.verify_completed).start()
        patch.object(services, 'recover_completed',
                     side_effect=self.recover_completed).start()

    def candidate(self, operations: object, role: str) -> str:
        self.host.verify_fence()
        if not self.host.schema_written:
            raise ValueError('app reached historical database')
        setattr(self.host, 'web' if role == 'web' else 'worker', True)
        if role == 'workers':
            atomic_json(self.attempt.directory / 'candidate-workers.json',
                        {'id': 'workers-id'})
        return role + '-id'

    def verify_candidate(self, operations: object, role: str) -> str:
        if not getattr(self.host, 'web' if role == 'web' else 'worker'):
            raise ValueError('missing admitted runtime')
        return role + '-id'

    def health(self, operations: object, *, public: bool = False) -> None:
        if not self.host.web or (public and not self.host.public):
            raise ValueError('candidate unavailable')

    def cutover(
        self, operations: object, *,
        continue_check: Callable[[], None] | None = None,
    ) -> None:
        if continue_check is not None:
            continue_check()
        if not self.host.learning_verified or not self.host.restored:
            raise ValueError('unverified workload reached public routing')
        self.host.public = True
        self.host.fenced = False

    def finalize(
        self, operations: object, *,
        continue_check: Callable[[], None] | None = None,
    ) -> None:
        if continue_check is not None:
            continue_check()
        if not self.host.public or not self.host.learning_verified:
            raise ValueError('unhealthy release finalized')
        self.host.finalized = True

    def recover_completed(
        self, operations: object, *,
        continue_check: Callable[[], None] | None = None,
    ) -> None:
        if continue_check is not None:
            continue_check()
        if self.host.fenced:
            self.host.public = True
            self.host.fenced = False
        self.verify_completed(operations)

    def verify_completed(self, operations: object) -> None:
        if not self.host.public or not self.host.finalized:
            raise ValueError('actual completed release unavailable')

    def run_upgrade(self, *, recover: bool = False) -> dict[str, object]:
        return self.controller.execute(
            self.attempt, self.lock, recover=recover,
        )

    def test_both_profiles_survive_and_public_routing_requires_actual_work(
        self,
    ) -> None:
        self.assertEqual(self.run_upgrade(), {
            'complete': True, 'browserVerification': 'required',
        })
        self.assertEqual(self.host.original,
                         {'owner': 'preserved', 'member': 'preserved'})
        self.assertTrue(self.host.learning_verified)
        self.assertTrue(self.host.public)
        self.assertTrue(self.host.finalized)
        self.assertFalse((self.root / 'unresolved.json').exists())
        self.assertEqual(self.attempt.state()['status'], 'complete')
        self.lock.validate()

    def test_lost_sql_keeps_the_irreversible_marker_backups_and_lock(
        self,
    ) -> None:
        self.host.fail_sql = True
        with self.assertRaisesRegex(RuntimeError, 'SQL client lost'):
            self.run_upgrade()
        self.assertEqual(self.attempt.state()['phase'], 'SQL_STARTED')
        self.assertTrue(self.attempt.state()['sqlMayHaveStarted'])
        self.assertTrue(self.host.fenced)
        self.assertFalse(self.host.public)
        self.assertTrue((self.attempt.directory / 'backups.json').exists())
        self.attempt.verify_marker(self.root / 'unresolved.json')
        self.lock.validate()
        with self.assertRaisesRegex(ValueError, 'explicit-same-attempt'):
            self.run_upgrade()
        self.host.fail_sql = False
        self.assertTrue(self.run_upgrade(recover=True)['complete'])

    def test_uncertain_queue_preparation_never_resends_the_mutation(
        self,
    ) -> None:
        self.host.lose_prepare = True
        with self.assertRaisesRegex(RuntimeError, 'preparation response lost'):
            self.run_upgrade()
        before = private_json(self.attempt.directory / 'activation.json')
        self.assertTrue(before['prepareIntent'])
        self.assertFalse(before['queuesPrepared'])
        self.host.lose_prepare = False
        with self.assertRaisesRegex(ValueError, 'partial-queue-preparation'):
            self.run_upgrade(recover=True)
        self.assertEqual(private_json(self.attempt.directory
                                      / 'activation.json'), before)
        self.assertFalse(self.host.worker)
        self.assertFalse(self.host.public)
        self.lock.validate()

    def test_lost_restore_response_requires_exact_original_flag_readback(
        self,
    ) -> None:
        self.host.lose_restore = True
        with self.assertRaisesRegex(RuntimeError, 'restore response lost'):
            self.run_upgrade()
        self.assertTrue(self.host.restored)
        self.assertFalse(self.host.public)
        self.host.lose_restore = False
        self.assertTrue(self.run_upgrade(recover=True)['complete'])

    def test_unknown_partial_restore_does_not_resume_more_queue_flags(
        self,
    ) -> None:
        self.host.lose_restore = True
        with self.assertRaisesRegex(RuntimeError, 'restore response lost'):
            self.run_upgrade()
        self.host.restored = False
        self.host.lose_restore = False
        with self.assertRaisesRegex(ValueError, 'actual queues still paused'):
            self.run_upgrade(recover=True)
        self.assertFalse(self.host.restored)
        self.assertTrue(self.host.fenced)
        self.assertFalse(self.host.public)
        retained = private_json(self.attempt.directory / 'activation.json')
        self.assertTrue(retained['restoreIntent'])
        self.assertFalse(retained['queuesRestored'])
        self.lock.validate()

    def test_failed_selected_provider_does_not_cut_over_or_discard_inputs(
        self,
    ) -> None:
        self.host.fail_learning = True
        with self.assertRaisesRegex(RuntimeError, 'selected provider failed'):
            self.run_upgrade()
        self.assertEqual(self.attempt.state()['phase'], 'EGRESS_GUARDED')
        self.assertTrue(self.host.fenced)
        self.assertFalse(self.host.public)
        self.assertFalse(self.host.finalized)
        self.lock.validate()
        self.host.fail_learning = False
        self.assertTrue(self.run_upgrade(recover=True)['complete'])

    def test_paused_worker_dispatch_acknowledgment_can_resume_before_restore(
        self,
    ) -> None:
        self.host.fail_paused_start = True
        with self.assertRaisesRegex(RuntimeError, 'paused worker startup'):
            self.run_upgrade()
        self.assertTrue(self.host.worker)
        self.assertFalse(self.host.restored)
        self.assertTrue(private_json(self.attempt.directory
                                     / 'activation.json')['workerStartIntent'])
        self.host.fail_paused_start = False
        self.assertTrue(self.run_upgrade(recover=True)['complete'])

    def test_completed_status_cannot_clear_fence_when_actual_release_is_down(
        self,
    ) -> None:
        self.run_upgrade()
        self.attempt.install_marker(self.root / 'unresolved.json')
        self.host.public = False
        with self.assertRaisesRegex(ValueError, 'actual completed release'):
            self.run_upgrade(recover=True)
        self.attempt.verify_marker(self.root / 'unresolved.json')
        self.lock.validate()

    def test_oversized_sql_stage_is_rejected_before_public_fence_or_backup(
        self,
    ) -> None:
        original = self.attempt
        manifest = self.attempt.manifest()
        manifest['stages'] = [cast(list[dict[str, object]],
                                   manifest['stages'])[-1]]
        self.attempt = Attempt.create(self.root, 'invalid-stage', manifest,
                                      original.evidence_hash)
        for name in self.files:
            source = original.directory / name
            target = self.attempt.directory / name
            target.write_bytes(source.read_bytes())
            target.chmod(0o600)
        self.host.attempt = self.attempt
        self.host.manifest = manifest
        with self.assertRaisesRegex(ValueError, 'Bounded added migration'):
            self.run_upgrade()
        self.assertEqual(self.attempt.state()['phase'], 'PRECHECK')
        self.assertFalse(self.host.fenced)
        self.assertFalse(self.host.schema_written)
        self.assertFalse((self.attempt.directory / 'backups.json').exists())

    def test_changed_independent_evidence_refuses_before_fencing_or_sql(
        self,
    ) -> None:
        atomic_json(self.attempt.directory / 'evidence.json', {'jobs': []})
        with self.assertRaisesRegex(ValueError, 'admitted-review-evidence'):
            self.run_upgrade()
        self.assertFalse(self.host.fenced)
        self.assertFalse(self.host.schema_written)
        self.assertEqual(self.attempt.state()['phase'], 'PRECHECK')

    def test_completed_attempt_can_clear_only_its_own_leftover_marker(
        self,
    ) -> None:
        self.run_upgrade()
        self.attempt.install_marker(self.root / 'unresolved.json')
        self.assertTrue(self.run_upgrade(recover=True)['complete'])
        self.assertFalse((self.root / 'unresolved.json').exists())
        self.lock.validate()

    def wait_for_supervisor(self, pid: int, status: str) -> None:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            path = self.attempt.directory / 'supervisor.json'
            if path.exists() and private_json(path)['status'] == status:
                return
            exited, result = os.waitpid(pid, os.WNOHANG)
            if exited:
                self.fail(f'supervisor exited before {status}: {result}')
            time.sleep(0.02)
        self.fail(f'supervisor did not reach {status}')

    def assert_contender_blocked(self) -> None:
        result = subprocess.run([
            sys.executable, '-c',
            'import fcntl,sys; f=open(sys.argv[1]); '
            'fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)',
            str(self.lock_path),
        ], capture_output=True, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'BlockingIOError', result.stderr)

    def supervise_recovery_case(
        self, *, failed_diagnostics: bool = False,
    ) -> None:
        resume = self.root / 'permit-sql-recovery'
        migrate = self.host.migrate_stage

        def host_sql(stage: object, previous: object) -> None:
            self.host.fail_sql = not resume.exists()
            if self.host.fail_sql:
                os.kill(os.getpid(), signal.SIGUSR1)
            migrate(stage, previous)

        patch.object(self.host, 'migrate_stage', side_effect=host_sql).start()
        if failed_diagnostics:
            write = atomic_json

            def failure_json(path: Path, value: Mapping[str, object]) -> None:
                if not resume.exists() and (
                    path.name.startswith('supervisor-failure-')
                    or (path.name == 'supervisor.json'
                        and value.get('status') == 'held')
                ):
                    raise OSError('fixture disk full')
                write(path, value)

            patch.object(self.controller, 'atomic_json',
                         side_effect=failure_json).start()
            patch.object(traceback, 'print_exc',
                         side_effect=OSError('fixture closed sink')).start()
        # Only the Linux /proc boundary is mocked on this macOS test host.
        patch.object(self.controller, 'process_identity', side_effect=lambda
                     pid: {'pid': pid, 'startTicks': 'fixture',
                           'executable': sys.executable,
                           'commandLine': []}).start()
        self.lock.close()
        pid = os.fork()
        if pid == 0:
            try:
                output = os.open(self.root / 'supervisor.log',
                                 os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                os.dup2(output, 2)
                os.close(output)
                self.lock = DeploymentLock(self.lock_path)
                self.host.lock = self.lock
                self.controller.supervise(self.attempt, self.lock)
            except BaseException:
                try:
                    traceback.print_exc()
                finally:
                    os._exit(1)
            os._exit(0)
        try:
            if failed_diagnostics:
                deadline = time.monotonic() + 10
                while (self.attempt.state()['phase'] != 'SQL_STARTED'
                       and time.monotonic() < deadline):
                    time.sleep(0.02)
                time.sleep(0.15)
            else:
                self.wait_for_supervisor(pid, 'held')
            self.assertEqual(self.attempt.state()['phase'], 'SQL_STARTED')
            self.attempt.verify_marker(self.root / 'unresolved.json')
            self.assert_contender_blocked()
            for number in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
                os.kill(pid, number)
                time.sleep(0.15)
                self.assert_contender_blocked()
                self.assertEqual(self.attempt.state()['phase'], 'SQL_STARTED')
            resume.touch(mode=0o600)
            os.kill(pid, signal.SIGUSR1)
            self.wait_for_supervisor(pid, 'completed')
            exited, status = os.waitpid(pid, 0)
            self.assertEqual(exited, pid)
            self.assertEqual(status, 0)
            pid = 0
            self.assertEqual(self.attempt.state()['status'], 'complete')
            self.assertFalse((self.root / 'unresolved.json').exists())
        finally:
            if pid:
                try:
                    os.kill(pid, signal.SIGKILL)
                    os.waitpid(pid, 0)
                except ProcessLookupError:
                    pass
            self.lock = DeploymentLock(self.lock_path)
            self.host.lock = self.lock

    def test_failure_and_terminal_signals_keep_lock_until_forward_recovery(
        self,
    ) -> None:
        self.supervise_recovery_case()

    def test_failed_journal_and_stderr_keep_lock_and_fence_until_recovery(
        self,
    ) -> None:
        self.supervise_recovery_case(failed_diagnostics=True)

    def test_partial_first_fence_is_reapplied_before_sql_can_start(
        self,
    ) -> None:
        for phase in ('ADMITTED', 'PREPARED'):
            self.attempt.advance(phase)
        self.attempt.install_marker(self.root / 'unresolved.json')
        operations = cast(HostOperations, self.host)
        self.controller.hold_failure(operations, 'first-fence-failed')
        self.assertTrue(self.host.fenced)
        self.assertFalse(self.host.public)
        self.assertFalse(self.host.schema_written)
        self.assertEqual(self.attempt.state()['status'], 'unresolved')
        self.lock.validate()

    def test_stop_before_cutover_preserves_private_verified_release(
        self,
    ) -> None:
        def stop_after_private_work() -> None:
            if self.host.learning_verified:
                raise self.controller.SupervisorHold('operator-stop')

        with self.assertRaises(self.controller.SupervisorHold):
            self.controller.execute(self.attempt, self.lock,
                                    continue_check=stop_after_private_work)
        self.assertTrue(self.host.learning_verified)
        self.assertFalse(self.host.public)
        self.assertFalse(self.host.finalized)
        self.attempt.verify_marker(self.root / 'unresolved.json')
        self.lock.validate()

    def test_foreign_marker_is_never_replaced_on_supervisor_failure(
        self,
    ) -> None:
        marker = self.root / 'unresolved.json'
        atomic_json(marker, {'attemptDirectory': 'another-attempt'})
        with self.assertRaisesRegex(ValueError, 'does not match'):
            operations = cast(HostOperations, self.host)
            self.controller.hold_failure(operations, 'operation-failed')
        self.assertEqual(private_json(marker),
                         {'attemptDirectory': 'another-attempt'})
        self.assertFalse(self.host.fenced)

    def test_failure_journal_error_still_reapplies_existing_public_fence(
        self,
    ) -> None:
        self.attempt.install_marker(self.root / 'unresolved.json')
        operations = cast(HostOperations, self.host)
        with patch.object(self.controller, 'atomic_json',
                          side_effect=OSError('fixture disk full')):
            with self.assertRaisesRegex(RuntimeError, 'record-unavailable'):
                self.controller.hold_failure(operations, 'operation-failed')
        self.assertTrue(self.host.fenced)
        self.assertFalse(self.host.public)
        self.attempt.verify_marker(self.root / 'unresolved.json')
        self.lock.validate()

    def test_unknown_child_exit_never_executes_upgrade_in_launcher(
        self,
    ) -> None:
        # The subprocess boundary reports a lost launch, with no valid receipt.
        with patch.object(subprocess, 'Popen') as process:
            process.return_value.poll.return_value = 1
            with self.assertRaisesRegex(RuntimeError,
                                        'launch-outcome-unknown'):
                self.controller.launch(self.attempt)
        self.assertEqual(self.attempt.state()['phase'], 'PRECHECK')
        self.assertFalse(self.host.schema_written)
        self.assertFalse(self.host.fenced)
        self.assertFalse((self.root / 'unresolved.json').exists())
        self.assertEqual(len(list(self.attempt.directory.glob(
            'supervisor-output-*.log',
        ))), 1)

    def test_fast_completed_child_waits_for_exact_successful_exit(
        self,
    ) -> None:
        self.run_upgrade()
        path = self.attempt.directory / 'supervisor.json'
        retained: dict[str, object] = {
            'pid': 123, 'startTicks': 'old', 'status': 'completed',
            'manifestSha256': self.attempt.manifest_hash,
            'attemptDirectory': str(self.attempt.directory),
            'operation': 'deploy', 'launchRecover': True,
        }
        atomic_json(path, retained)
        exits = iter((None, None, 0))

        def poll() -> int | None:
            result = next(exits)
            if result is None:
                # First poll observes the previous owner's completed record.
                # Second poll sees completion from the still-running child.
                if retained['pid'] == 456:
                    atomic_json(path, retained)
                retained['pid'] = 456
            return result

        with (patch.object(subprocess, 'Popen') as process,
              patch.object(self.controller, 'process_identity',
                           side_effect=FileNotFoundError)):
            process.return_value.pid = 456
            process.return_value.returncode = 0
            process.return_value.poll.side_effect = poll
            result = self.controller.launch(self.attempt, recover=True)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(self.attempt.state()['status'], 'complete')

    def test_completion_between_launcher_reads_waits_for_same_child_exit(
        self,
    ) -> None:
        self.run_upgrade()
        path = self.attempt.directory / 'supervisor.json'
        receipt: dict[str, object] = {
            'pid': 456, 'status': 'running', 'launchRecover': True,
            'manifestSha256': self.attempt.manifest_hash,
            'attemptDirectory': str(self.attempt.directory),
            'operation': 'deploy', 'ready': True,
        }
        verify = self.controller.verify_supervisor

        def racing_verify(attempt: Attempt) -> dict[str, object]:
            atomic_json(path, {**receipt, 'status': 'completed'})
            return verify(attempt)

        def poll() -> int | None:
            if not path.exists():
                atomic_json(path, receipt)
                return None
            return 0

        with (patch.object(subprocess, 'Popen') as process,
              patch.object(self.controller, 'verify_supervisor',
                           side_effect=racing_verify)):
            process.return_value.pid = 456
            process.return_value.returncode = 0
            process.return_value.poll.side_effect = poll
            result = self.controller.launch(self.attempt, recover=True)
        self.assertEqual(result['status'], 'completed')

    def test_partial_archive_recovery_reaches_cutover_then_finalization(
        self,
    ) -> None:
        archived = self.attempt.directory / 'finalized-imports-fixture'
        archived.mkdir(mode=0o700)
        receipt = archived / 'sotto-review-import-fixture.json'

        def archive_outcome(
            operations: object, *,
            continue_check: Callable[[], None] | None = None,
        ) -> None:
            if not receipt.exists():
                atomic_json(receipt, {'exactCapturedImport': 'preserved'})
                raise RuntimeError('canonical archive acknowledgment lost')
            self.finalize(operations, continue_check=continue_check)

        with patch.object(services, 'finalize', side_effect=archive_outcome):
            with self.assertRaisesRegex(RuntimeError,
                                        'archive acknowledgment lost'):
                self.run_upgrade()
            self.assertEqual(self.attempt.state()['phase'], 'PUBLIC_COMMITTED')
            original = receipt.read_bytes()
            self.controller.hold_failure(cast(HostOperations, self.host),
                                         'archive-outcome-unresolved')
            self.assertFalse(self.host.public)
            # Re-entering any SQL stage would now fail this host boundary.
            self.host.fail_sql = True
            self.assertTrue(self.run_upgrade(recover=True)['complete'])
        self.assertEqual(receipt.read_bytes(), original)
        self.assertTrue(self.host.public)
        self.assertTrue(self.host.finalized)
        self.assertFalse((self.root / 'unresolved.json').exists())


if __name__ == '__main__':
    unittest.main()
