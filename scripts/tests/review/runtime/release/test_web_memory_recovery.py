"""Exercise the guarded same-container memory adjustment and crash recovery."""

from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from scripts.deploy.review.runtime.operations import HostOperations
from scripts.deploy.review.runtime.recovery import web_memory
from scripts.deploy.review.state import Attempt, atomic_json, checksum, private_json


MiB = 1024 * 1024


class WebMemoryRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        root.chmod(0o700)
        manifest = {'finalWeb': {'imageId': 'sha256:' + 'b' * 64}}
        self.attempt = Attempt.create(root, 'attempt', manifest, 'c' * 64)
        self.directory = self.attempt.directory
        atomic_json(self.directory / 'state.json', {
            'phase': 'EGRESS_GUARDED', 'status': 'unresolved', 'sqlMayHaveStarted': True,
            'manifestSha256': self.attempt.manifest_hash,
        })
        self.id = 'a' * 64
        self.host: dict[str, object] = {
            'Memory': 512 * MiB, 'MemorySwap': 512 * MiB,
            'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0},
        }
        self.state: dict[str, object] = {
            'StartedAt': 'second-start', 'FinishedAt': 'second-stop', 'Status': 'exited',
            'Running': False, 'Restarting': False, 'OOMKilled': True, 'ExitCode': 137,
        }
        self.container = {
            'Id': self.id, 'Image': 'sha256:' + 'b' * 64, 'Name': '/web',
            'HostConfig': self.host, 'State': self.state,
            'Config': {'Image': 'review-web', 'Env': ['PRIVATE=placeholder']},
            'Mounts': [{'Source': '/existing', 'Destination': '/store'}],
        }
        self.binding = HostOperations.writer_binding(self.container)
        atomic_json(self.directory / 'candidate-web.json', self.binding)
        path = self.directory / web_memory.OOM
        atomic_json(path, {
            'containerId': self.id, 'imageId': self.binding['imageId'],
            'memoryBytes': 512 * MiB, 'sameReleaseCodexCatalog': True,
            'catalogPeakRssBytes': 338 * MiB, 'nextPeakRssBytes': 300 * MiB,
            'secondStartedAt': 'second-start', 'secondFinishedAt': 'second-stop',
            'firstKernelSha256': 'd' * 64, 'secondKernelSha256': 'e' * 64,
            'catalogProofSha256': 'f' * 64,
        })
        self.plan = {
            'bindingSha256': checksum(self.binding), 'oomEvidenceSha256': web_memory.file_sha(path),
            'priorBytes': 512 * MiB, 'bytes': 768 * MiB,
        }
        self.ops = Mock(spec=HostOperations)
        self.ops.attempt = self.attempt
        self.ops.root = root
        self.ops.manifest = manifest
        self.ops.lock = Mock()
        self.ops.inspect.side_effect = lambda _: [copy.deepcopy(self.container)]
        self.ops.writer_binding.side_effect = HostOperations.writer_binding
        self.ops.docker.side_effect = self.docker
        self.mutations: list[tuple[str, ...]] = []
        self.fail_reply: str | None = None
        self.fail_before_start = False
        self.addCleanup(patch.stopall)
        patch.object(web_memory, 'web_memory_plan', return_value=self.plan).start()
        patch.object(web_memory, 'recovery_capacity').start()
        patch.object(web_memory, 'current_memory_proof', side_effect=self.memory_proof).start()

    def memory_proof(self, operations: HostOperations, identity: str, cap: int) -> dict[str, object]:
        self.assertEqual(identity, self.id)
        if self.state['Running'] is not True or self.host['Memory'] != cap:
            raise ValueError('actual cgroup is not running at its admitted cap')
        return {'id': identity, 'startedAt': self.state['StartedAt'], 'limitBytes': cap,
                'peakBytes': 650 * MiB}

    def docker(self, *args: str) -> bytes:
        if args[0] == 'ps':
            return b''
        self.mutations.append(args)
        if args[0] == 'update':
            self.assertEqual(args, ('update', '--memory', str(768 * MiB),
                                    '--memory-swap', str(768 * MiB), self.id))
            self.host.update(Memory=768 * MiB, MemorySwap=768 * MiB)
        elif args == ('start', self.id):
            if self.fail_before_start:
                raise RuntimeError('Docker never started the candidate')
            self.state.update(Running=True, OOMKilled=False, Status='running', StartedAt='new-start')
        else:
            raise AssertionError(args)
        if args[0] == self.fail_reply:
            raise RuntimeError('canonical Docker response lost')
        return self.id.encode()

    def test_only_the_admitted_web_cap_changes_and_its_original_binding_is_retained(self) -> None:
        web_memory.recover_web_memory(self.ops)
        web_memory.record_recovered_web_memory(self.ops)
        proof = private_json(self.directory / web_memory.PROOF)
        intent = private_json(self.directory / web_memory.INTENT)
        self.assertEqual(intent['before'], self.binding)
        self.assertNotEqual(intent['before'], intent['after'])
        self.assertEqual(private_json(self.directory / 'candidate-web.json'), intent['after'])
        self.assertEqual(self.attempt.manifest(), self.ops.manifest)
        self.assertEqual(proof['limitBytes'], 768 * MiB)
        self.assertEqual(proof['startedAt'], 'new-start')

    def test_retries_read_back_a_lost_config_response_without_repeating_the_update(self) -> None:
        self.fail_reply = 'update'
        with self.assertRaisesRegex(RuntimeError, 'canonical Docker response lost'):
            web_memory.recover_web_memory(self.ops)
        self.fail_reply = None
        web_memory.recover_web_memory(self.ops)
        self.assertEqual([args[0] for args in self.mutations], ['update', 'start'])

    def test_a_start_intent_can_retry_when_exact_docker_state_proves_it_never_started(self) -> None:
        self.fail_before_start = True
        with self.assertRaisesRegex(RuntimeError, 'Docker never started the candidate'):
            web_memory.recover_web_memory(self.ops)
        self.fail_before_start = False
        web_memory.recover_web_memory(self.ops)
        self.assertEqual(self.state['StartedAt'], 'new-start')
        self.assertEqual([args[0] for args in self.mutations], ['update', 'start', 'start'])

    def test_retries_read_back_a_lost_start_response_and_refuse_a_second_start_after_oom(self) -> None:
        self.fail_reply = 'start'
        with self.assertRaisesRegex(RuntimeError, 'canonical Docker response lost'):
            web_memory.recover_web_memory(self.ops)
        self.fail_reply = None
        web_memory.recover_web_memory(self.ops)
        self.state.update(Running=False, OOMKilled=True, Status='exited')
        with self.assertRaisesRegex(ValueError, 'review-web-memory-start-unresolved'):
            web_memory.recover_web_memory(self.ops)
        self.assertEqual([args[0] for args in self.mutations], ['update', 'start'])

    def test_rejects_drift_in_other_container_resources_before_mutation(self) -> None:
        self.host['PidsLimit'] = 75
        with self.assertRaisesRegex(ValueError, 'unexpected-web-config-change'):
            web_memory.recover_web_memory(self.ops)
        self.assertEqual(self.mutations, [])
