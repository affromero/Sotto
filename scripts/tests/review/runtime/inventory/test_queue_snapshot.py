"""Exercise the predecessor queue snapshot against the Docker boundary."""

import hashlib
import json
import unittest
from collections.abc import Callable
from importlib import import_module
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.review.runtime.inventory.predecessor import capture_predecessor
from scripts.deploy.review.runtime.inventory.queue_snapshot import (
    capture_predecessor_queue_snapshot,
    observe_predecessor_queue_drain,
    pause_predecessor_queues,
)
from scripts.deploy.review.runtime.inventory.quiescence import quiesce_predecessor
from scripts.deploy.review.runtime.inventory.retained import observe_retained_inventory
from scripts.deploy.review.state import atomic_json, private_json
from scripts.deploy.review.topology import NETWORK, PROJECT
from scripts.tests.review.runtime import admitted_runtime_fixture


class PredecessorQueueSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original = {
            'schemaVersion': 1, 'connectionIdentity': 'a' * 64,
            'queues': [{'name': 'learning-writing', 'paused': False},
                       {'name': 'worksheet-pdf', 'paused': True}],
        }
        network = import_module(
            'scripts.tests.review.runtime.inventory.test_network',
        ).RunningPredecessorNetworkTests('runTest')
        network.prepare_running_network(original_queues=self.original)
        self.addCleanup(network.doCleanups)
        self.previous, self.successor = network.previous, network.successor
        self.network = network
        environment = import_module(
            'scripts.tests.review.runtime.inventory.test_environment',
        ).SuccessorEnvironmentTests('runTest')
        environment.fixture = network.fixture
        environment.previous, environment.successor = self.previous, self.successor
        environment.prepare_environment()
        capture_predecessor(self.previous, self.successor)
        self.worker = network.fixture.fixture.candidates['workers']
        self.path = self.successor.attempt.directory / 'predecessor-queues.json'
        self.boundary = self.successor.command
        self.output = self.response(self.original)
        self.expected_request = {'command': 'snapshot'}
        self.after_observation: Callable[[], None] | None = None
        self.refuse_maintenance = False
        self.responses: list[tuple[dict[str, object], bytes | BaseException]] | None = None
        self.enterContext(patch.object(self.successor, 'command', side_effect=self.command))
        self.enterContext(patch.object(self.successor, 'image_command',
                                     side_effect=self.maintenance_command))

    @staticmethod
    def response(value: object) -> bytes:
        return b'SOTTO_DEPLOY_QUEUE=' + json.dumps(value).encode() + b'\n'

    def command(self, arguments: list[str], **options: object) -> bytes:
        if arguments[:2] != ['docker', 'exec']:
            return self.boundary(arguments, **options)
        self.assertEqual(arguments[2:9], [
            '-i', '--workdir', '/app/apps/web', '--env', 'NODE_OPTIONS=',
            self.worker['Id'], 'node',
        ])
        request = json.loads(options['content'])
        self.assertEqual(options['timeout'], 25)
        if self.responses is not None:
            return self.queued_response(request)
        self.assertEqual(request, self.expected_request)
        if self.after_observation is not None:
            self.after_observation()
        return self.output

    def queued_response(self, request: dict[str, object]) -> bytes:
        expected, output = self.responses.pop(0)
        self.assertEqual(request, expected)
        if isinstance(output, BaseException):
            raise output
        return output

    def maintenance_command(self, receipt: dict[str, object], entrypoint: str,
                            arguments: list[str], **options: object) -> bytes:
        self.assertEqual(receipt, self.previous.attempt.manifest()['finalWorker'])
        self.assertEqual(entrypoint, 'node')
        self.assertEqual(arguments[0:2], ['--import', 'tsx'])
        self.assertEqual(options['network'], 'container:' + self.worker['Id'])
        self.assertIs(options['predecessor'], self.previous)
        if self.refuse_maintenance:
            raise RuntimeError('helper capacity refused')
        options['before_start']()
        self.assertTrue((self.path.parent / 'predecessor-queue-pause-intent.json').exists())
        request = json.loads(options['content'])
        self.assertEqual(request['command'], 'pause')
        return self.queued_response(request)

    def test_retains_exact_queue_flags_under_the_fence(self) -> None:
        receipt = capture_predecessor_queue_snapshot(self.previous, self.successor)
        self.assertEqual(receipt, private_json(self.path))
        self.assertEqual(receipt['workerId'], self.worker['Id'])
        self.assertEqual(receipt['originalQueues'], self.original)
        self.assertEqual(capture_predecessor_queue_snapshot(self.previous, self.successor), receipt)

    def test_retained_inventory_binds_delivered_jobs_and_refuses_changed_data(self) -> None:
        evidence = {'jobs': [{'id': str(number), 'delivered': True} for number in range(3)]}
        path = self.path.parent / 'evidence.json'
        atomic_json(path, evidence)
        evidence_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        self.successor.attempt.evidence_hash = evidence_hash
        marker = self.network.fixture.fixture.host / 'unresolved.json'
        atomic_json(marker, {**private_json(marker), 'evidenceSha256': evidence_hash})
        observed = {'server': 'a' * 64, 'fingerprint': 'b' * 64,
                    'jobsFingerprint': 'c' * 64, 'keys': 15, 'queues': 2,
                    'completed': 1, 'failed': 3}
        with patch.object(self.successor, 'runtime_exchange', return_value=observed) as runtime:
            self.assertEqual(observe_retained_inventory(self.previous, self.successor), observed)
            runtime.assert_called_once_with(
                'retained-single-client',
                {'evidence': evidence, 'queues': ['learning-writing', 'worksheet-pdf']},
                predecessor=self.previous,
            )
            runtime.return_value = {**observed, 'fingerprint': 'd' * 64}
            with self.assertRaisesRegex(ValueError, 'retained-review-inventory-changed'):
                observe_retained_inventory(self.previous, self.successor)
        retained = private_json(self.path.parent / 'retained-redis.json')
        self.assertEqual(retained['observation'], observed)
        self.assertEqual(retained['successorEvidenceSha256'], evidence_hash)

    def paused_flags(self) -> dict[str, object]:
        return {
            **self.original,
            'queues': [{**queue, 'paused': True} for queue in self.original['queues']],
        }

    def test_journals_the_pause_and_rechecks_the_result_without_dispatching_again(self) -> None:
        paused = self.response(self.paused_flags())
        self.responses = [
            ({'command': 'snapshot'}, self.response(self.original)),
            ({'command': 'pause', 'manifest': self.original}, paused),
            ({'command': 'snapshot'}, paused),
            ({'command': 'snapshot'}, paused),
        ]
        pause_predecessor_queues(self.previous, self.successor)
        result = self.path.parent / 'predecessor-queue-pause-result.json'
        evidence = result.read_bytes()
        pause_predecessor_queues(self.previous, self.successor)
        self.assertEqual(result.read_bytes(), evidence)
        self.assertFalse(self.responses)

    def test_unconfirmed_pause_requires_full_readback_and_never_reissues_pause(self) -> None:
        paused = self.response(self.paused_flags())
        self.responses = [
            ({'command': 'snapshot'}, self.response(self.original)),
            ({'command': 'pause', 'manifest': self.original}, TimeoutError('lost reply')),
            ({'command': 'snapshot'}, self.response(self.original)),
            ({'command': 'snapshot'}, paused),
        ]
        result = self.path.parent / 'predecessor-queue-pause-result.json'
        with self.assertRaisesRegex(TimeoutError, 'lost reply'):
            pause_predecessor_queues(self.previous, self.successor)
        self.assertFalse(result.exists())
        with self.assertRaisesRegex(ValueError, 'queue-pause-unresolved'):
            pause_predecessor_queues(self.previous, self.successor)
        self.assertFalse(result.exists())
        pause_predecessor_queues(self.previous, self.successor)
        self.assertTrue(result.exists())
        self.assertFalse(self.responses)

    def test_helper_preflight_failure_leaves_pause_dispatch_retryable(self) -> None:
        paused = self.response(self.paused_flags())
        self.responses = [
            ({'command': 'snapshot'}, self.response(self.original)),
            ({'command': 'snapshot'}, self.response(self.original)),
            ({'command': 'pause', 'manifest': self.original}, paused),
            ({'command': 'snapshot'}, paused),
        ]
        self.refuse_maintenance = True
        with self.assertRaisesRegex(RuntimeError, 'helper capacity refused'):
            pause_predecessor_queues(self.previous, self.successor)
        self.assertFalse((self.path.parent / 'predecessor-queue-pause-intent.json').exists())
        self.refuse_maintenance = False
        pause_predecessor_queues(self.previous, self.successor)
        self.assertTrue((self.path.parent / 'predecessor-queue-pause-result.json').exists())

    def test_predecessor_helper_reuses_bound_environment_in_a_read_only_container(self) -> None:
        self.successor.manifest.update(admitted_runtime_fixture())
        image = self.previous.attempt.manifest()['finalWorker']
        with patch.object(self.successor, 'capacity'):
            command = self.successor.tool_command(
                image, 'node', ['--eval', 'fixture'],
                container_name='sotto-review-tool-fixture',
                network='container:' + self.worker['Id'],
                predecessor=self.previous,
            )
        self.assertEqual(command[:2], ['docker', 'create'])
        self.assertIn('--read-only', command)
        self.assertEqual(command[command.index('--network') + 1],
                         'container:' + self.worker['Id'])
        environment = Path(command[command.index('--env-file') + 1])
        self.assertEqual(environment.stat().st_mode & 0o777, 0o600)
        self.assertIn('DATABASE_URL=postgresql://fixture/secret\n',
                      environment.read_text())
        self.assertNotIn('--fixture', environment.read_text())

    def prepare_drain(self, *, jobs: int = 0, workers: int = 0,
                      synchronous: int = 0) -> dict[str, object]:
        capture_predecessor_queue_snapshot(self.previous, self.successor)
        self.expected_request = {'command': 'drained-all', 'manifest': self.original}
        return {
            **self.paused_flags(),
            'activeJobs': jobs,
            'executions': {'inspected': 2 + workers + synchronous, 'settled': 2,
                           'workerActive': workers, 'synchronousActive': synchronous},
            'drained': jobs == workers == synchronous == 0,
        }

    def test_reads_paused_queue_drain_using_unchanged_original_flags(self) -> None:
        self.output = self.response(self.prepare_drain())
        original_bytes = self.path.read_bytes()
        self.assertTrue(observe_predecessor_queue_drain(self.previous, self.successor))
        self.assertEqual(self.path.read_bytes(), original_bytes)

    def test_quiescence_rechecks_drain_after_web_stops_and_keeps_stop_proof(self) -> None:
        drained_result = self.prepare_drain()
        drained = self.response(drained_result)
        busy = self.response({**drained_result, 'activeJobs': 1, 'drained': False})
        drain = {'command': 'drained-all', 'manifest': self.original}
        paused = self.response(self.paused_flags())
        self.responses = [
            ({'command': 'snapshot'}, self.response(self.original)),
            ({'command': 'pause', 'manifest': self.original}, paused),
            ({'command': 'snapshot'}, paused),
            (drain, busy),
            ({'command': 'snapshot'}, paused),
            (drain, drained),
            (drain, drained),
        ]
        stopped = []

        def command(arguments: list[str], **options: object) -> bytes:
            if arguments[1:3] != ['-I', '-']:
                return self.command(arguments, **options)
            operation, identity = arguments[3:]
            role = {'stop-web': 'web', 'stop': 'workers'}[operation]
            self.assertEqual(len(self.responses), 1 if role == 'web' else 0)
            container = self.network.fixture.fixture.candidates[role]
            self.assertEqual(identity, container['Id'])
            container['State'].update({
                'Running': False, 'Status': 'exited', 'ExitCode': 0,
                'FinishedAt': '2026-10-26T01:23:00Z',
            })
            endpoint = container['NetworkSettings']['Networks'][NETWORK]
            endpoint['IPAMConfig'] = {'IPv4Address': endpoint['IPAddress']}
            for network in self.network.networks:
                network['Containers'].pop(identity)
            stopped.append(role)
            return b''

        with patch.object(self.successor, 'command', side_effect=command), patch.object(
            self.successor, 'inspect', side_effect=self.previous.inspect,
        ):
            with patch('scripts.deploy.review.runtime.inventory.quiescence.time') as clock:
                clock.monotonic.side_effect = [0, 120]
                with self.assertRaisesRegex(TimeoutError, 'predecessor-workload-drain-unresolved'):
                    quiesce_predecessor(self.previous, self.successor, continue_check=lambda: None)
            quiesce_predecessor(self.previous, self.successor, continue_check=lambda: None)
            quiesce_predecessor(self.previous, self.successor, continue_check=lambda: None)
        self.assertEqual(stopped, ['web', 'workers'])
        self.assertEqual(set(private_json(self.path.parent / 'predecessor-stopped.json')),
                         {'web', 'workers'})
        atomic_json(self.path.parent / 'predecessor-queue-pause-result.json', {})
        with self.assertRaisesRegex(ValueError, 'predecessor-queue-pause-result-changed'):
            quiesce_predecessor(self.previous, self.successor, continue_check=lambda: None)

    def test_quiescence_leaves_writers_running_while_work_is_active(self) -> None:
        busy = self.response(self.prepare_drain(synchronous=1))
        paused = self.response(self.paused_flags())
        self.responses = [
            ({'command': 'snapshot'}, self.response(self.original)),
            ({'command': 'pause', 'manifest': self.original}, paused),
            ({'command': 'snapshot'}, paused),
            ({'command': 'drained-all', 'manifest': self.original}, busy),
        ]
        with patch('scripts.deploy.review.runtime.inventory.quiescence.time') as clock:
            clock.monotonic.side_effect = [0, 120]
            with self.assertRaisesRegex(TimeoutError, 'predecessor-workload-drain-unresolved'):
                quiesce_predecessor(self.previous, self.successor, continue_check=lambda: None)
        self.assertFalse(self.responses)
        for role, container in self.network.fixture.fixture.candidates.items():
            self.assertTrue(container['State']['Running'])
            self.assertFalse((self.path.parent / f'predecessor-stop-intent-{role}.json').exists())

    def test_each_kind_of_active_work_prevents_a_drain_result(self) -> None:
        first = self.prepare_drain(jobs=1)
        self.output = self.response(first)
        self.assertFalse(observe_predecessor_queue_drain(self.previous, self.successor))
        for kind in ('workerActive', 'synchronousActive'):
            with self.subTest(kind=kind):
                self.output = self.response({
                    **first, 'activeJobs': 0,
                    'executions': {'inspected': 1, 'settled': 0, 'workerActive': 0,
                                   'synchronousActive': 0, kind: 1},
                })
                self.assertFalse(observe_predecessor_queue_drain(self.previous, self.successor))

    def test_refuses_a_claim_of_drain_with_active_work(self) -> None:
        self.output = self.response({**self.prepare_drain(jobs=1), 'drained': True})
        with self.assertRaisesRegex(ValueError, 'queue-drain-result-invalid'):
            observe_predecessor_queue_drain(self.previous, self.successor)

    def test_refuses_a_drain_result_when_a_queue_is_unpaused(self) -> None:
        drifted = self.prepare_drain()
        drifted['queues'] = self.original['queues']
        self.output = self.response(drifted)
        with self.assertRaisesRegex(ValueError, 'queue-drain-inventory-changed'):
            observe_predecessor_queue_drain(self.previous, self.successor)

    def test_refuses_a_drain_without_the_original_queue_receipt(self) -> None:
        with self.assertRaisesRegex(ValueError, 'exact-retained-predecessor-queue-snapshot-required'):
            observe_predecessor_queue_drain(self.previous, self.successor)

    def test_refuses_a_changed_pause_flag(self) -> None:
        changed = json.loads(json.dumps(self.original))
        changed['queues'][0]['paused'] = True
        self.output = self.response(changed)
        with self.assertRaisesRegex(ValueError, 'queue-snapshot-changed'):
            capture_predecessor_queue_snapshot(self.previous, self.successor)
        self.assertFalse(self.path.exists())

    def test_refuses_multiple_snapshot_results(self) -> None:
        self.output *= 2
        with self.assertRaisesRegex(ValueError, 'unique-bounded'):
            capture_predecessor_queue_snapshot(self.previous, self.successor)
        self.assertFalse(self.path.exists())

    def test_refuses_after_a_writer_changes_networks(self) -> None:
        def detach() -> None:
            del self.worker['NetworkSettings']['Networks'][PROJECT + '_egress']
            del self.network.networks[1]['Containers'][self.worker['Id']]

        self.after_observation = detach
        with self.assertRaisesRegex(ValueError, 'candidate-network-membership-changed'):
            capture_predecessor_queue_snapshot(self.previous, self.successor)
        self.assertFalse(self.path.exists())

    def test_refuses_if_a_retained_service_gains_an_unadmitted_attachment(self) -> None:
        redis = self.network.databases[self.network.fixture.storage.ids['redis']]
        redis['NetworkSettings']['Networks']['extra'] = (
            redis['NetworkSettings']['Networks'][NETWORK]
        )
        with self.assertRaisesRegex(ValueError, 'retained-review-service-changed'):
            capture_predecessor_queue_snapshot(self.previous, self.successor)
        self.assertFalse(self.path.exists())
