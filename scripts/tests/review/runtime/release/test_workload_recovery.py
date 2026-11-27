"""Exercise the immutable tool and checkpoint boundaries of forward recovery."""

from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.review.runtime.recovery import workload
from scripts.deploy.review.state import Attempt, atomic_json, checksum


class WorkloadForwardRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        root.chmod(0o700)
        self.root = root
        self.source = root / 'source'
        self.mutable = 'scripts/deploy/review/runtime/workload.ts'
        self.protected = 'scripts/deploy/review/runtime/privileged.py'
        self.tools = {self.mutable: 'a' * 64, self.protected: 'b' * 64}
        self.attempt = Attempt.create(root, 'review', {'tools': self.tools}, 'c' * 64)
        self.directory = self.attempt.directory
        atomic_json(self.directory / 'state.json', {
            'phase': 'EGRESS_GUARDED', 'status': 'active', 'sqlMayHaveStarted': True,
            'manifestSha256': self.attempt.manifest_hash,
        })
        self.checkpoint: dict[str, object] = {'inputHash': 'course-record', 'startedAt': 100_000}
        atomic_json(self.directory / workload.CHECKPOINT, self.checkpoint)
        self.checkpoint_bytes = (self.directory / workload.CHECKPOINT).read_bytes()
        failure = 'runtime-failure-1.json'
        files = {
            failure: {'mode': 'workloads'},
            'supervisor-before-workload-recovery.json': {
                'operation': 'deploy', 'status': 'held', 'manifestSha256': self.attempt.manifest_hash,
            },
            'backups.json': {'backup': 'verified'},
            'settled-legacy-storage-gate-recovery.json': {
                'applied': True, 'executionRetained': True, 'storageObjectsTouched': 0,
                'serializedBySdkBackendLock': True,
            },
            'synthetic-stitch-retry.json': {
                'retried': True, 'jobId': 'current', 'previousJobId': 'old', 'episodeId': 'episode',
            },
        }
        for name, value in files.items():
            atomic_json(self.directory / name, value)
        self.authorization: dict[str, object] = {
            'tools': {**self.tools, self.mutable: 'd' * 64},
            'priorToolsSha256': checksum(self.tools),
            'checkpointSha256': hashlib.sha256(self.checkpoint_bytes).hexdigest(),
            'failure': {'file': failure, 'sha256': workload.file_sha(self.directory / failure)},
            'backupsSha256': workload.file_sha(self.directory / 'backups.json'),
            'supervisorSha256': workload.file_sha(
                self.directory / 'supervisor-before-workload-recovery.json',
            ),
            'storageRecoverySha256': workload.file_sha(
                self.directory / 'settled-legacy-storage-gate-recovery.json',
            ),
            'stitchRetrySha256': workload.file_sha(self.directory / 'synthetic-stitch-retry.json'),
        }

    def test_sealed_tool_manifest_remains_unchanged_outside_recovery_source(self) -> None:
        manifest = self.attempt.manifest()
        self.assertEqual(workload.effective_tool_manifest(self.source, self.attempt, manifest), manifest)
        self.assertEqual(workload.recovery_workload_input(self.source, self.attempt, self.checkpoint),
                         self.checkpoint)

    def test_recovery_tools_cannot_replace_privileged_code_or_drop_a_sealed_hash(self) -> None:
        manifest = self.attempt.manifest()
        with patch.object(workload, 'reviewed_source', return_value=self.authorization):
            self.assertEqual(workload.effective_tool_manifest(self.source, self.attempt, manifest),
                             {'tools': {**self.tools, self.mutable: 'd' * 64}})
            for replacement in ({self.mutable: 'd' * 64},
                                {**self.tools, self.protected: 'd' * 64}):
                self.authorization['tools'] = replacement
                with self.assertRaisesRegex(ValueError, 'recovery-runtime-tools-out-of-scope'):
                    workload.effective_tool_manifest(self.source, self.attempt, manifest)
        self.assertEqual(self.attempt.manifest(), manifest)

    def test_only_explicit_recovery_increases_the_attached_web_capacity(self) -> None:
        prior = 512 * 1024 * 1024
        resources = {'webMemoryBytes': prior}
        attempt = Attempt.create(self.root, 'memory', {'resources': resources}, 'e' * 64)
        self.assertEqual(workload.web_memory_delta(self.source, attempt), 0)
        self.authorization['webMemory'] = {
            'bindingSha256': 'b' * 64, 'oomEvidenceSha256': 'c' * 64,
            'priorBytes': prior, 'bytes': 768 * 1024 * 1024,
        }
        with patch.object(workload, 'reviewed_source', return_value=self.authorization):
            self.assertEqual(workload.web_memory_delta(self.source, attempt), 256 * 1024 * 1024)
        self.assertEqual(attempt.manifest()['resources'], resources)

    def test_resume_retains_the_original_workload_and_never_renews_the_budget(self) -> None:
        with (patch.object(workload, 'reviewed_source', return_value=self.authorization),
              patch.object(workload.time, 'time', return_value=2_000) as clock):
            initial = workload.recovery_workload_input(self.source, self.attempt, self.checkpoint)
            self.assertEqual(initial, {'checkpoint': self.checkpoint, 'recovery': {
                'expiresAt': 2_900_000, 'startedAt': 2_000_000, 'readbackOnly': False,
                'prior': self.checkpoint, 'episodeId': 'episode',
            }})
            self.assertEqual((self.directory / workload.BEFORE).read_bytes(), self.checkpoint_bytes)
            self.assertEqual((self.directory / workload.CHECKPOINT).read_bytes(), self.checkpoint_bytes)
            clock.return_value = 2_500
            self.assertEqual(workload.recovery_workload_input(self.source, self.attempt, self.checkpoint),
                             initial)
            clock.return_value = 2_901
            with self.assertRaisesRegex(ValueError, 'review-workload-recovery-budget-expired'):
                workload.recovery_workload_input(self.source, self.attempt, self.checkpoint)
            atomic_json(self.directory / 'workloads-verified.json', {
                'selectedSpeechWorkload': 'verified', 'syntheticAssessments': 1,
            })
            self.assertEqual(workload.recovery_workload_input(self.source, self.attempt, self.checkpoint),
                             {'checkpoint': self.checkpoint, 'recovery': {
                                 'expiresAt': 3_261_000, 'startedAt': 2_000_000,
                                 'readbackOnly': True, 'prior': self.checkpoint, 'episodeId': 'episode',
                             }})

    def test_changed_original_workload_or_retry_proof_cannot_consume_the_budget(self) -> None:
        with patch.object(workload, 'reviewed_source', return_value=self.authorization):
            with self.assertRaisesRegex(ValueError, 'authorized-original-workload-checkpoint'):
                workload.recovery_workload_input(self.source, self.attempt, {})
            atomic_json(self.directory / 'synthetic-stitch-retry.json', {'retried': False})
            with self.assertRaisesRegex(ValueError, 'review-recovery-history-changed'):
                workload.recovery_workload_input(self.source, self.attempt, self.checkpoint)
        self.assertFalse((self.directory / workload.CONSUMED).exists())
