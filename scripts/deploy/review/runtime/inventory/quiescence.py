"""Drain and stop the captured App Review predecessor under the successor fence."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import TYPE_CHECKING

from scripts.deploy.review.runtime.inventory.network import verify_retained_network
from scripts.deploy.review.runtime.inventory.predecessor import (
    capture_predecessor,
    inspect_predecessor,
    stop_predecessor,
)
from scripts.deploy.review.runtime.inventory.queue_snapshot import (
    observe_predecessor_queue_drain,
    pause_predecessor_queues,
    verify_predecessor_queue_pause,
)

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations


def quiesce_predecessor(
    previous: HostOperations, successor: HostOperations, *,
    continue_check: Callable[[], None],
) -> None:
    """Confirm queue drain around the web stop, then stop the exact worker."""
    continue_check()
    running = successor.attempt.directory / 'predecessor-running.json'
    if not running.exists() and not running.is_symlink():
        capture_predecessor(previous, successor)
    states = inspect_predecessor(previous, successor)
    if states['web'] == 'running':
        if states['workers'] != 'running':
            raise ValueError('predecessor-worker-stopped-before-web')
        pause_predecessor_queues(previous, successor)
    verify_predecessor_queue_pause(successor)

    def drain(web_stopped: bool) -> None:
        deadline = time.monotonic() + 120
        while True:
            continue_check()
            if observe_predecessor_queue_drain(
                previous, successor, web_stopped=web_stopped,
            ):
                return
            if time.monotonic() >= deadline:
                raise TimeoutError('predecessor-workload-drain-unresolved')
            time.sleep(2)

    if states['web'] == 'running':
        states = stop_predecessor(
            previous, successor, role='web', verify_drained=lambda: drain(False),
        )
    if states['workers'] == 'running':
        stop_predecessor(
            previous, successor, role='workers', verify_drained=lambda: drain(True),
        )
    continue_check()
    verify_retained_network(previous, successor)
