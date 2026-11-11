"""Verify the exact stopped predecessor without treating it as a full fence."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import datetime
from typing import Literal

from scripts.deploy.images.metadata import record

TIMESTAMP = re.compile(
    r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z',
)


def timestamp(value: object) -> tuple[datetime, int]:
    if not isinstance(value, str) or not (match := TIMESTAMP.fullmatch(value)):
        raise ValueError('predecessor-timestamp-invalid')
    seconds = datetime.strptime(match[1], '%Y-%m-%dT%H:%M:%S')
    nanos = int((match[2] or '').ljust(9, '0'))
    return seconds, nanos


def capture_running_writer(
    container: Mapping[str, object], binding: Mapping[str, object], *,
    role: Literal['web', 'workers'],
) -> dict[str, object]:
    """Inspect a running instance; the caller must fence and persist it."""
    from scripts.deploy.review.runtime.operations import HostOperations

    if role not in ('web', 'workers'):
        raise ValueError('predecessor-role-invalid')
    if HostOperations.writer_binding(container) != dict(binding):
        raise ValueError('predecessor-writer-binding-changed')
    state = record(container.get('State'), 'predecessor state')
    host = record(container.get('HostConfig'), 'predecessor host')
    started = state.get('StartedAt')
    count = container.get('RestartCount')
    if (state.get('Status') != 'running'
            or state.get('Running') is not True
            or state.get('Paused') is not False
            or state.get('Restarting') is not False
            or state.get('OOMKilled') is not False
            or state.get('Dead') is not False
            or state.get('Error') != ''
            or host.get('RestartPolicy')
            != {'Name': 'no', 'MaximumRetryCount': 0}
            or type(count) is not int or count < 0):
        raise ValueError('predecessor-running-instance-not-proven')
    timestamp(started)
    return {'id': container['Id'], 'role': role, 'startedAt': started,
            'restartCount': count}


def inspect_stopped_writer(
    container: Mapping[str, object], binding: Mapping[str, object], *,
    role: Literal['web', 'workers'], baseline: Mapping[str, object],
    previous: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """Bind a clean stop to a captured running instance and detect restarts.

    The caller must persist the baseline before stopping and independently
    verify the deployment lock, maintenance marker, network clients, storage
    and all provider and queue activity.
    """
    from scripts.deploy.review.runtime.operations import HostOperations

    if role not in ('web', 'workers'):
        raise ValueError('predecessor-role-invalid')
    if HostOperations.writer_binding(container) != dict(binding):
        raise ValueError('predecessor-writer-binding-changed')
    if (set(baseline) != {'id', 'role', 'startedAt', 'restartCount'}
            or baseline.get('id') != container.get('Id')
            or baseline.get('role') != role):
        raise ValueError('predecessor-baseline-changed')
    started_at = baseline['startedAt']
    restart_count = baseline['restartCount']
    state = record(container.get('State'), 'predecessor state')
    host = record(container.get('HostConfig'), 'predecessor host')
    restart = record(host.get('RestartPolicy'), 'predecessor restart policy')
    actual_start, finished = state.get('StartedAt'), state.get('FinishedAt')
    if (type(restart_count) is not int or restart_count < 0
            or actual_start != started_at
            or type(container.get('RestartCount')) is not int
            or container['RestartCount'] != restart_count
            or restart != {'Name': 'no', 'MaximumRetryCount': 0}
            or state.get('Status') != 'exited'
            or state.get('Running') is not False
            or state.get('Paused') is not False
            or state.get('Restarting') is not False
            or state.get('OOMKilled') is not False
            or state.get('Dead') is not False
            or state.get('Error') != ''
            or type(state.get('ExitCode')) is not int
            or state['ExitCode'] not in ((0,) if role == 'workers' else (0, 143))
            or timestamp(finished) <= timestamp(started_at)):
        raise ValueError('predecessor-stop-not-proven')
    result = {'id': container['Id'], 'role': role, 'startedAt': started_at,
              'finishedAt': finished, 'restartCount': restart_count,
              'exitCode': state['ExitCode']}
    if previous is not None and dict(previous) != result:
        raise ValueError('predecessor-stop-evidence-changed')
    return result
