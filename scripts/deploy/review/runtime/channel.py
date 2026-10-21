"""Acknowledge runtime changes only after host checks and durable writes."""

from __future__ import annotations

import json
import os
import selectors
import subprocess
import tempfile
import time
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.state import atomic_json

PREFIX = b'SOTTO_REVIEW_IPC='
MAX_LINE = 262_144


def exchange(
    command: Sequence[str], initial: Mapping[str, object], *,
    directory: Path, assert_fence: Callable[[], None],
    queue_manifest: Callable[[Mapping[str, object]], None],
    timeout: float,
) -> object:
    """Keep secrets on stdin and retain uncertain credential operations."""
    if initial.get('mode') not in {
        'inspect', 'prepare', 'providers', 'queues', 'capture',
        'continuation', 'consumers', 'workloads', 'paused-admission',
    } or not 0 < timeout <= (3330 if initial.get('mode') == 'workloads'
                            else 330):
        raise ValueError('bounded-runtime-exchange-required')
    encoded = json.dumps(initial, separators=(',', ':')).encode() + b'\n'
    if len(encoded) > MAX_LINE:
        raise ValueError('runtime-input-bound-exceeded')
    deadline = time.monotonic() + timeout
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(
            command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=errors, pass_fds=(9,),
        )
        assert process.stdin is not None and process.stdout is not None
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        os.set_blocking(process.stdin.fileno(), False)
        selector.register(process.stdin, selectors.EVENT_WRITE)
        pending = encoded
        buffer = b''
        total = 0
        sequence = 0
        result: object = None
        completed = False
        try:
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError('review-runtime-exchange-timeout')
                ready = selector.select(remaining)
                if not ready:
                    raise TimeoutError('review-runtime-exchange-timeout')
                for key, _ in ready:
                    if key.fileobj is process.stdin:
                        pending = pending[os.write(
                            process.stdin.fileno(), pending,
                        ):]
                        if not pending:
                            selector.unregister(process.stdin)
                if not any(key.fileobj is process.stdout
                           for key, _ in ready):
                    continue
                chunk = os.read(process.stdout.fileno(), 65_536)
                if not chunk:
                    selector.unregister(process.stdout)
                    break
                total += len(chunk)
                buffer += chunk
                if total > 2_097_152:
                    raise ValueError('runtime-output-bound-exceeded')
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    if len(line) > MAX_LINE:
                        raise ValueError('runtime-line-bound-exceeded')
                    if not line.startswith(PREFIX):
                        # Framework diagnostics remain private. Never echo
                        # runtime output into the controller's public report.
                        continue
                    if completed:
                        raise ValueError('runtime-message-after-result')
                    message = record(json.loads(line[len(PREFIX):]),
                                     'runtime event')
                    kind = message.get('type')
                    if kind == 'result':
                        if set(message) != {'type', 'value'}:
                            raise ValueError('invalid-runtime-result')
                        result = message['value']
                        completed = True
                        if process.stdin.fileno() in selector.get_map():
                            selector.unregister(process.stdin)
                        process.stdin.close()
                        continue
                    sequence += 1
                    if (sequence > 100 or message.get('id') != sequence
                            or type(message.get('id')) is not int):
                        raise ValueError('runtime-ack-sequence-changed')
                    if kind == 'fence':
                        if set(message) != {'type', 'id'}:
                            raise ValueError('invalid-runtime-fence-event')
                        assert_fence()
                    elif kind == 'queueManifest':
                        if (initial['mode'] != 'prepare'
                                or set(message) != {'type', 'id', 'value'}):
                            raise ValueError('unexpected-runtime-queue-event')
                        assert_fence()
                        queue_manifest(record(message['value'],
                                              'original queue manifest'))
                    elif kind == 'checkpoint':
                        if (initial['mode'] != 'providers'
                                or set(message) != {'type', 'id', 'value'}):
                            raise ValueError('unexpected-runtime-checkpoint')
                        assert_fence()
                        checkpoint = record(message['value'], 'checkpoint')
                        if set(checkpoint) != {
                            'credentials', 'modelChangePrepared',
                        }:
                            raise ValueError('invalid-runtime-checkpoint')
                        atomic_json(directory / 'provider-checkpoint.json',
                                    checkpoint)
                    elif kind == 'workloadCheckpoint':
                        if (initial['mode'] != 'workloads'
                                or set(message) != {'type', 'id', 'value'}):
                            raise ValueError('unexpected-workload-checkpoint')
                        assert_fence()
                        checkpoint = record(message['value'],
                                            'workload checkpoint')
                        if (set(checkpoint) != {
                            'version', 'inputHash', 'startedAt', 'profiles',
                        } or type(checkpoint['version']) is not int
                                or checkpoint['version'] != 1
                                or type(checkpoint['startedAt']) is not int
                                or checkpoint['startedAt'] < 0
                                or not isinstance(checkpoint['profiles'], list)
                                or len(checkpoint['profiles']) != 2):
                            raise ValueError('invalid-workload-checkpoint')
                        digest(checkpoint['inputHash'], 'workload input')
                        atomic_json(directory / 'workload-checkpoint.json',
                                    checkpoint)
                    else:
                        raise ValueError('unknown-runtime-event')
                    pending += json.dumps({
                        'type': 'ack', 'id': sequence,
                    }).encode() + b'\n'
                    if process.stdin.fileno() not in selector.get_map():
                        selector.register(process.stdin,
                                          selectors.EVENT_WRITE)
                if len(buffer) > MAX_LINE:
                    raise ValueError('runtime-line-bound-exceeded')
            if buffer or not completed:
                raise ValueError('runtime-result-unresolved')
            outcome = process.wait(timeout=max(0.1, deadline
                                               - time.monotonic()))
            if outcome:
                raise ValueError('runtime-helper-failed')
            return result
        finally:
            if not process.stdin.closed:
                process.stdin.close()
            if process.poll() is None:
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
            process.stdout.close()
            selector.close()
            errors.seek(0)
            diagnostic = errors.read(65_537)
            if diagnostic:
                path = directory / (
                    'runtime-diagnostics-' + str(time.time_ns()) + '.bin'
                )
                descriptor = os.open(
                    path, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                    | os.O_NOFOLLOW, 0o600,
                )
                with os.fdopen(descriptor, 'wb') as output:
                    output.write(diagnostic[:65_536])
                    output.flush()
                    os.fsync(output.fileno())
