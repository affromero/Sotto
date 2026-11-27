"""Move a completed attempt's startup unit to its reviewed recovery source."""

from __future__ import annotations

import stat
from collections.abc import Callable
from pathlib import Path

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.build_observer import bounded_bytes
from scripts.deploy.review.runtime.operations import HOST_STATE, HostOperations
from scripts.deploy.review.runtime.recovery.workload import (
    RECOVERY_ROOT,
    reviewed_source,
)
from scripts.deploy.review.runtime.release import (
    STARTUP_UNIT,
    startup_binding,
    startup_unit,
    verify_completed_records,
    verify_startup_enabled,
    verify_startup_unit,
)
from scripts.deploy.review.state import atomic_json, checksum, private_json


def recover_startup_source(
    operations: HostOperations, *,
    continue_check: Callable[[], None] | None = None,
) -> None:
    """Rebind only a root-authorized completed attempt, under its existing fence."""
    attempt = operations.attempt
    authorization = reviewed_source(operations.root, attempt)
    if authorization is None or 'startup' not in authorization:
        return
    plan = record(authorization['startup'], 'authorized startup recovery')
    source = plan.get('sourceRoot')
    if (set(plan) != {'sourceRoot', 'receiptSha256'} or not isinstance(source, str)
            or not Path(source).is_relative_to(RECOVERY_ROOT)
            or Path(source).resolve() != Path(source)
            or Path(source) == operations.root):
        raise ValueError('exact-prior-startup-source-required')
    operations.lock.validate()
    state = attempt.state()
    if state['status'] != 'complete' or state['phase'] != 'COMPLETE':
        raise ValueError('held-completed-startup-recovery-required')
    attempt.verify_marker(HOST_STATE / 'unresolved.json')
    operations.verify_fence()
    verify_completed_records(operations, fenced=True)
    previous = HostOperations(attempt, operations.lock)
    previous.root = Path(source)
    previous.verify_tools()
    old_binding, new_binding = startup_binding(previous), startup_binding(operations)
    old_receipt = {**old_binding, 'enabled': True}
    new_receipt = {**new_binding, 'enabled': True}
    if checksum(old_receipt) != digest(plan['receiptSha256'], 'prior startup receipt'):
        raise ValueError('prior-startup-receipt-changed')
    before, after = startup_unit(previous), startup_unit(operations)
    if before.replace(f'\nWorkingDirectory={source}\n'.encode(),
                      f'\nWorkingDirectory={operations.root}\n'.encode(), 1) != after:
        raise ValueError('startup-recovery-changes-unit-semantics')

    directory = attempt.directory
    journal = directory / 'startup-source-recovery.json'
    intent = directory / 'startup-unit-intent.json'
    receipt = directory / 'startup-unit.json'
    binding = {'manifestSha256': attempt.manifest_hash,
               'previous': old_receipt, 'next': new_receipt}
    if journal.exists() or journal.is_symlink():
        if (private_json(journal) != binding
                or private_json(intent) not in (old_binding, new_binding)
                or private_json(receipt) not in (old_receipt, new_receipt)):
            raise ValueError('startup-source-recovery-journal-changed')
    else:
        verify_startup_unit(previous)
        atomic_json(journal, binding)
    metadata = STARTUP_UNIT.lstat()
    installed = bounded_bytes(STARTUP_UNIT)
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0
            or stat.S_IMODE(metadata.st_mode) != 0o644 or installed not in (before, after)):
        raise ValueError('pending-startup-source-recovery-unit-changed')

    if continue_check is not None:
        continue_check()
    operations.verify_fence()
    if installed != after:
        staging = STARTUP_UNIT.with_name('.' + STARTUP_UNIT.name + '-' + checksum(binding))
        operations.command([
            'sudo', '-n', 'install', '-o', 'root', '-g', 'root', '-m', '0644',
            '/dev/stdin', str(staging),
        ], content=after)
        operations.command(['sudo', '-n', 'sync', str(staging)])
        operations.command(['sudo', '-n', 'mv', '-T', str(staging), str(STARTUP_UNIT)])
    operations.command(['sudo', '-n', 'sync', str(STARTUP_UNIT.parent)])
    operations.command(['sudo', '-n', 'systemctl', 'daemon-reload'])
    if operations.command([
        'systemctl', 'show', '--property=NeedDaemonReload', '--value', STARTUP_UNIT.name,
    ]).strip() != b'no':
        raise ValueError('completed-startup-unit-needs-reload')
    verify_startup_enabled(operations)
    atomic_json(intent, new_binding)
    atomic_json(receipt, new_receipt)
    verify_startup_unit(operations)
