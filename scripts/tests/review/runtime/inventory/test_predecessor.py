"""A successor captures only the completed release's running writers."""

from __future__ import annotations

import copy
import unittest
from importlib import import_module
from unittest.mock import patch

from scripts.deploy.review.runtime import release
from scripts.deploy.review.runtime.inventory.predecessor import (
    capture_predecessor,
    inspect_predecessor,
)
from scripts.deploy.review.runtime.operations import HostOperations, MAINTENANCE
from scripts.deploy.review.state import Attempt, atomic_json, private_json
from scripts.deploy.review.topology import NETWORK


class PredecessorCaptureTests(unittest.TestCase):
    def setUp(self) -> None:
        fixture_type = import_module(
            'scripts.tests.review.runtime.test_release',
        ).ReleaseRecoveryTests
        self.fixture = fixture_type('runTest')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.prepare_completed_records()
        self.previous = self.fixture.operations
        self.enterContext(patch(
            'scripts.deploy.review.runtime.release.DIRECTORY',
            str(self.fixture.review),
        ))
        release_record = release.read_completed_record(self.previous)
        atomic_json(self.previous.attempt.directory / 'release-record.json',
                    release_record)
        state = self.previous.attempt.state()
        atomic_json(self.previous.attempt.directory / 'state.json', {
            **state, 'phase': 'COMPLETE', 'status': 'complete',
            'sqlMayHaveStarted': True,
        })
        for role, container in self.fixture.candidates.items():
            container['RestartCount'] = 0
            container['HostConfig'] = {
                'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0},
            }
            container['State'] = {
                'Status': 'running', 'Running': True, 'Paused': False,
                'Restarting': False, 'OOMKilled': False, 'Dead': False,
                'Error': '', 'ExitCode': 0,
                'StartedAt': '2026-10-26T01:22:11.143667407Z',
                'FinishedAt': '0001-01-01T00:00:00Z',
            }
            atomic_json(self.previous.attempt.directory
                        / ('candidate-' + role + '.json'),
                        self.previous.writer_binding(container))
        attempt = Attempt.create(self.fixture.host, 'successor', {}, 'b' * 64)
        for phase in ('ADMITTED', 'PREPARED', 'FENCED'):
            attempt.advance(phase)
        attempt.install_marker(self.fixture.host / 'unresolved.json')
        self.fixture.caddy.write_bytes(MAINTENANCE)
        self.successor = HostOperations(attempt, self.fixture.lock)
        self.enterContext(patch.object(
            HostOperations, 'public_get',
            return_value=(503, b'Review upgrade in progress.'),
        ))
        # These guards consult the host's tool files, mounts and firewall.
        # Their own tests exercise those boundaries and rejection behavior.
        for name in ('verify_tools', 'verify_storage', 'verify_egress'):
            self.enterContext(patch.object(self.previous, name))

    def test_persists_both_completed_release_writers_under_the_fence(self) -> None:
        result = capture_predecessor(self.previous, self.successor)
        self.assertEqual(set(result['writers']), {'web', 'workers'})
        self.assertEqual(
            private_json(self.successor.attempt.directory
                         / 'predecessor-running.json'), result,
        )
        self.assertEqual(capture_predecessor(self.previous, self.successor), result)
        self.assertEqual(self.fixture.started, [])

    def test_refuses_restart_and_retains_the_original_receipt(self) -> None:
        original = capture_predecessor(self.previous, self.successor)
        worker = self.fixture.candidates['workers']
        worker['RestartCount'] = 1
        with self.assertRaisesRegex(ValueError, 'evidence-changed'):
            capture_predecessor(self.previous, self.successor)
        self.assertEqual(private_json(self.successor.attempt.directory
                                     / 'predecessor-running.json'), original)

    def test_refuses_stopped_changed_or_unfenced_predecessors(self) -> None:
        original = copy.deepcopy(self.fixture.candidates['workers'])
        self.fixture.candidates['workers']['State']['Running'] = False
        with self.assertRaises(ValueError):
            capture_predecessor(self.previous, self.successor)
        self.fixture.candidates['workers'] = original
        self.fixture.caddy.write_bytes(self.fixture.original)
        with self.assertRaises(ValueError):
            capture_predecessor(self.previous, self.successor)
        self.assertFalse((self.successor.attempt.directory
                          / 'predecessor-running.json').exists())

    def test_refuses_unresolved_successor_and_changed_startup_source(self) -> None:
        path = self.successor.attempt.directory / 'state.json'
        state = self.successor.attempt.state()
        atomic_json(path, {**state, 'status': 'unresolved'})
        with self.assertRaisesRegex(ValueError, 'fenced-successor-required'):
            capture_predecessor(self.previous, self.successor)
        atomic_json(path, state)
        self.previous.root = self.fixture.host
        with self.assertRaisesRegex(ValueError, 'source-root-changed'):
            capture_predecessor(self.previous, self.successor)
        self.assertFalse((self.successor.attempt.directory
                          / 'predecessor-running.json').exists())

    def test_cannot_recapture_after_one_writer_has_stopped(self) -> None:
        original = capture_predecessor(self.previous, self.successor)
        state = self.fixture.candidates['web']['State']
        state.update({'Running': False, 'Status': 'exited'})
        with self.assertRaises(ValueError):
            capture_predecessor(self.previous, self.successor)
        self.assertEqual(private_json(self.successor.attempt.directory
                                     / 'predecessor-running.json'), original)

    def test_recovery_remembers_a_partial_stop_and_refuses_changed_exit(self) -> None:
        capture_predecessor(self.previous, self.successor)
        web = self.fixture.candidates['web']
        web['State'].update({
            'Running': False, 'Status': 'exited', 'ExitCode': 143,
            'FinishedAt': '2026-10-26T01:23:00Z',
        })
        web['NetworkSettings']['Networks'][NETWORK]['IPAMConfig'] = {
            'IPv4Address': '172.30.99.10',
        }
        self.assertEqual(inspect_predecessor(self.previous, self.successor), {
            'web': 'stopped', 'workers': 'running',
        })
        self.assertEqual(inspect_predecessor(self.previous, self.successor), {
            'web': 'stopped', 'workers': 'running',
        })
        web['State']['FinishedAt'] = '2026-10-26T01:23:01Z'
        with self.assertRaisesRegex(ValueError, 'stop-evidence-changed'):
            inspect_predecessor(self.previous, self.successor)

    def test_recovery_refuses_a_restarted_predecessor(self) -> None:
        capture_predecessor(self.previous, self.successor)
        self.fixture.candidates['workers']['RestartCount'] = 1
        with self.assertRaisesRegex(ValueError, 'running-evidence-changed'):
            inspect_predecessor(self.previous, self.successor)

    def test_recovery_retains_both_stops_during_an_unresolved_attempt(self) -> None:
        capture_predecessor(self.previous, self.successor)
        for role, address in (('web', '10'), ('workers', '11')):
            container = self.fixture.candidates[role]
            container['State'].update({
                'Running': False, 'Status': 'exited', 'ExitCode': 0,
                'FinishedAt': '2026-10-26T01:23:00Z',
            })
            container['NetworkSettings']['Networks'][NETWORK]['IPAMConfig'] = {
                'IPv4Address': '172.30.99.' + address,
            }
        path = self.successor.attempt.directory / 'state.json'
        atomic_json(path, {**self.successor.attempt.state(),
                           'status': 'unresolved'})
        self.assertEqual(inspect_predecessor(self.previous, self.successor), {
            'web': 'stopped', 'workers': 'stopped',
        })
        stops = private_json(self.successor.attempt.directory
                             / 'predecessor-stopped.json')
        self.assertEqual(set(stops), {'web', 'workers'})

    def test_recovery_refuses_worker_sigterm_exit(self) -> None:
        capture_predecessor(self.previous, self.successor)
        worker = self.fixture.candidates['workers']
        worker['State'].update({
            'Running': False, 'Status': 'exited', 'ExitCode': 143,
            'FinishedAt': '2026-10-26T01:23:00Z',
        })
        worker['NetworkSettings']['Networks'][NETWORK]['IPAMConfig'] = {
            'IPv4Address': '172.30.99.11',
        }
        with self.assertRaisesRegex(ValueError, 'stop-not-proven'):
            inspect_predecessor(self.previous, self.successor)
        self.assertFalse((self.successor.attempt.directory
                          / 'predecessor-stopped.json').exists())

    def test_recovery_requires_unchanged_running_and_release_receipts(self) -> None:
        with self.assertRaises(FileNotFoundError):
            inspect_predecessor(self.previous, self.successor)
        baseline = capture_predecessor(self.previous, self.successor)
        path = self.successor.attempt.directory / 'predecessor-running.json'
        atomic_json(path, {**baseline, 'predecessorManifestSha256': 'c' * 64})
        with self.assertRaisesRegex(ValueError, 'running-evidence-changed'):
            inspect_predecessor(self.previous, self.successor)
        atomic_json(path, baseline)
        release_path = self.previous.attempt.directory / 'release-record.json'
        receipt = private_json(release_path)
        atomic_json(release_path, {**receipt, 'source': 'changed'})
        with self.assertRaisesRegex(ValueError, 'release-receipt-changed'):
            inspect_predecessor(self.previous, self.successor)

    def test_recovery_does_not_record_a_stop_after_fence_loss(self) -> None:
        capture_predecessor(self.previous, self.successor)
        web = self.fixture.candidates['web']
        web['State'].update({
            'Running': False, 'Status': 'exited', 'ExitCode': 0,
            'FinishedAt': '2026-10-26T01:23:00Z',
        })
        web['NetworkSettings']['Networks'][NETWORK]['IPAMConfig'] = {
            'IPv4Address': '172.30.99.10',
        }
        with patch.object(HostOperations, 'public_get', side_effect=[
            (503, b'Review upgrade in progress.'), (200, b'public'),
        ]):
            with self.assertRaisesRegex(ValueError, 'fence-not-established'):
                inspect_predecessor(self.previous, self.successor)
        self.assertFalse((self.successor.attempt.directory
                          / 'predecessor-stopped.json').exists())


if __name__ == '__main__':
    unittest.main()
