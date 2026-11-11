"""A predecessor cannot be accepted after an ambiguous stop or restart."""

from __future__ import annotations

import copy
import unittest
from collections.abc import Mapping
from typing import cast

from scripts.deploy.review.runtime.inventory.stopped_writer import (
    capture_running_writer,
    inspect_stopped_writer,
)
from scripts.deploy.review.runtime.operations import HostOperations


class StoppedWriterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.started = '2026-10-26T01:22:11.143667407Z'
        self.container: dict[str, object] = {
            'Id': 'a' * 64,
            'Image': 'sha256:' + 'b' * 64,
            'Name': '/review-worker',
            'Config': {'User': '1000:1000', 'Env': ['RETAINED=value']},
            'HostConfig': {
                'OomKillDisable': False,
                'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0},
            },
            'Mounts': [{'Type': 'bind', 'Source': '/retained',
                        'Destination': '/data', 'RW': True}],
            'RestartCount': 0,
            'State': {
                'Status': 'exited', 'Running': False, 'Paused': False,
                'Restarting': False, 'OOMKilled': False, 'Dead': False,
                'Error': '', 'ExitCode': 0, 'StartedAt': self.started,
                'FinishedAt': '2026-10-26T01:23:00.1Z',
            },
        }
        self.binding = HostOperations.writer_binding(self.container)
        self.running = copy.deepcopy(self.container)
        running_state = cast(dict[str, object], self.running['State'])
        running_state.update({'Status': 'running', 'Running': True})
        self.baseline = capture_running_writer(
            self.running, self.binding, role='workers',
        )

    def inspect(
        self, container: dict[str, object] | None = None, *,
        previous: Mapping[str, object] | None = None,
    ) -> dict[str, object]:
        return inspect_stopped_writer(
            container or self.container, self.binding, role='workers',
            baseline=self.baseline, previous=previous,
        )

    def test_accepts_a_clean_stop_and_requires_identical_later_evidence(self) -> None:
        observed = self.inspect()
        self.assertEqual(observed['id'], 'a' * 64)
        self.assertEqual(self.inspect(previous=observed), observed)
        changed = copy.deepcopy(self.container)
        cast(dict[str, object], changed['State'])['FinishedAt'] = '2026-10-26T01:23:01Z'
        with self.assertRaisesRegex(ValueError, 'evidence-changed'):
            self.inspect(changed, previous=observed)

    def test_refuses_running_or_uncertain_exits(self) -> None:
        for field, value in (
            ('Status', 'running'), ('Running', True), ('Paused', True),
            ('Restarting', True), ('OOMKilled', True), ('Dead', True),
            ('Error', 'unknown'), ('ExitCode', 137), ('ExitCode', True),
            ('FinishedAt', '0001-01-01T00:00:00Z'),
        ):
            changed = copy.deepcopy(self.container)
            cast(dict[str, object], changed['State'])[field] = value
            with self.subTest(field=field, value=value):
                with self.assertRaises(ValueError):
                    self.inspect(changed)

    def test_sigterm_exit_is_accepted_only_for_web(self) -> None:
        changed = copy.deepcopy(self.container)
        cast(dict[str, object], changed['State'])['ExitCode'] = 143
        with self.assertRaises(ValueError):
            self.inspect(changed)
        observed = inspect_stopped_writer(
            changed, self.binding, role='web', baseline={
                **self.baseline, 'role': 'web',
            },
        )
        self.assertEqual(observed['role'], 'web')
        clean_web = inspect_stopped_writer(
            self.container, self.binding, role='web', baseline={
                **self.baseline, 'role': 'web',
            },
        )
        with self.assertRaisesRegex(ValueError, 'evidence-changed'):
            self.inspect(previous=clean_web)

    def test_refuses_restarted_or_reconfigured_containers(self) -> None:
        changed = copy.deepcopy(self.container)
        cast(dict[str, object], changed['State'])['StartedAt'] = (
            '2026-10-26T01:22:12Z'
        )
        with self.assertRaisesRegex(ValueError, 'stop-not-proven'):
            self.inspect(changed)
        changed = copy.deepcopy(self.container)
        changed['RestartCount'] = 1
        with self.assertRaisesRegex(ValueError, 'stop-not-proven'):
            self.inspect(changed)
        for section, field, value in (
            ('Config', 'User', '0'),
            ('HostConfig', 'RestartPolicy', {'Name': 'always', 'MaximumRetryCount': 0}),
        ):
            changed = copy.deepcopy(self.container)
            cast(dict[str, object], changed[section])[field] = value
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, 'binding-changed'):
                    self.inspect(changed)
        changed = copy.deepcopy(self.container)
        cast(list[dict[str, object]], changed['Mounts'])[0]['Source'] = '/other'
        with self.assertRaisesRegex(ValueError, 'binding-changed'):
            self.inspect(changed)

    def test_refuses_automatic_restart_even_when_it_was_in_the_original_binding(self) -> None:
        changed = copy.deepcopy(self.container)
        cast(dict[str, object], changed['HostConfig'])['RestartPolicy'] = {
            'Name': 'unless-stopped', 'MaximumRetryCount': 0,
        }
        with self.assertRaisesRegex(ValueError, 'stop-not-proven'):
            inspect_stopped_writer(
                changed, HostOperations.writer_binding(changed),
                role='workers', baseline=self.baseline,
            )

    def test_baseline_requires_the_bound_running_instance(self) -> None:
        with self.assertRaisesRegex(ValueError, 'running-instance-not-proven'):
            capture_running_writer(self.container, self.binding, role='workers')
        for field, value in (
            ('Paused', True), ('Restarting', True), ('OOMKilled', True),
            ('Error', 'unknown'), ('StartedAt', ''),
        ):
            changed = copy.deepcopy(self.running)
            cast(dict[str, object], changed['State'])[field] = value
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    capture_running_writer(changed, self.binding, role='workers')
        with self.assertRaisesRegex(ValueError, 'baseline-changed'):
            inspect_stopped_writer(
                self.container, self.binding, role='workers',
                baseline={**self.baseline, 'id': 'c' * 64},
            )

    def test_orders_nanosecond_timestamps_and_rejects_invalid_values(self) -> None:
        changed = copy.deepcopy(self.container)
        state = cast(dict[str, object], changed['State'])
        state['FinishedAt'] = '2026-10-26T01:22:11.143667408Z'
        self.assertEqual(self.inspect(changed)['finishedAt'], state['FinishedAt'])
        for value in ('2026-10-26T01:22:11.143667406Z', '2026-02-30T01:23:00Z', ''):
            state['FinishedAt'] = value
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    self.inspect(changed)


if __name__ == '__main__':
    unittest.main()
