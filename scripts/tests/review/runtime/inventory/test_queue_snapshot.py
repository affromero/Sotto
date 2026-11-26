"""Exercise the predecessor queue snapshot against the Docker boundary."""

import json
import unittest
from importlib import import_module
from unittest.mock import patch

from scripts.deploy.review.runtime.inventory.predecessor import capture_predecessor
from scripts.deploy.review.runtime.inventory.queue_snapshot import (
    capture_predecessor_queue_snapshot,
)
from scripts.deploy.review.state import private_json
from scripts.deploy.review.topology import NETWORK, PROJECT


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
        self.after_observation = None
        self.enterContext(patch.object(self.successor, 'command', side_effect=self.command))

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
        self.assertEqual(json.loads(options['content']), {'command': 'snapshot'})
        self.assertEqual(options['timeout'], 25)
        if self.after_observation is not None:
            self.after_observation()
        return self.output

    def test_retains_exact_queue_flags_under_the_fence(self) -> None:
        receipt = capture_predecessor_queue_snapshot(self.previous, self.successor)
        self.assertEqual(receipt, private_json(self.path))
        self.assertEqual(receipt['workerId'], self.worker['Id'])
        self.assertEqual(receipt['originalQueues'], self.original)
        self.assertEqual(capture_predecessor_queue_snapshot(self.previous, self.successor), receipt)

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
