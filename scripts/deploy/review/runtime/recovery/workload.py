"""Bind compatible post-SQL review tools and a single workload continuation."""

from __future__ import annotations

import hashlib
import json
import re
import stat
import time
from collections.abc import Mapping
from pathlib import Path

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.build_observer import bounded_bytes
from scripts.deploy.review.state import Attempt, checksum, private_file, private_json


RECOVERY_ROOT = Path('/var/lib/sotto-review-recovery')
BUDGET_SECONDS = 900
READBACK_SECONDS = 360
CHECKPOINT = 'workload-checkpoint.json'
BEFORE = 'workload-checkpoint-before-recovery.json'
CONSUMED = 'workload-recovery-budget.json'
MUTABLE_TOOLS = frozenset({
    'scripts/deploy/review/runtime/controller.py',
    'scripts/deploy/review/runtime/operations.py',
    'scripts/deploy/review/runtime/recovery/workload.py',
    'scripts/deploy/review/runtime/release/successor.py',
    'scripts/deploy/review/runtime/workload.ts',
})


def file_sha(path: Path, *, private: bool = True) -> str:
    return hashlib.sha256(bounded_bytes(path, private=private)).hexdigest()


def reviewed_source(root: Path, attempt: Attempt) -> dict[str, object] | None:
    """Use the root-managed continuation only for its bound post-SQL attempt."""
    if not root.is_relative_to(RECOVERY_ROOT):
        return None
    directory = root.parent
    if (root.name != 'source' or directory.parent != RECOVERY_ROOT
            or not re.fullmatch('[a-f0-9]{40}', directory.name)):
        raise ValueError('exact-review-recovery-source-required')
    for path in (root, directory, RECOVERY_ROOT, *RECOVERY_ROOT.parents):
        mode = path.lstat()
        if mode.st_uid != 0 or not stat.S_ISDIR(mode.st_mode) or mode.st_mode & 0o022:
            raise ValueError('root-owned-review-recovery-source-required')
    scripts = root / 'scripts'
    for entry in (scripts, *scripts.rglob('*')):
        mode = entry.lstat()
        if (mode.st_uid != 0 or mode.st_mode & 0o022
                or not (stat.S_ISDIR(mode.st_mode) or stat.S_ISREG(mode.st_mode))):
            raise ValueError('protected-review-recovery-script-tree-required')
    path = directory / 'authorization.json'
    mode = path.lstat()
    if mode.st_uid != 0 or not stat.S_ISREG(mode.st_mode) or mode.st_mode & 0o022:
        raise ValueError('root-owned-review-recovery-authorization-required')
    authorization = record(json.loads(bounded_bytes(path)), 'reviewed recovery authorization')
    if (set(authorization) != {
        'version', 'source', 'attemptDirectory', 'manifestSha256', 'tools',
        'priorToolsSha256', 'checkpointSha256', 'failure', 'backupsSha256', 'supervisorSha256',
        'storageRecoverySha256', 'stitchRetrySha256',
    } or type(authorization['version']) is not int or authorization['version'] != 1
            or authorization['source'] != directory.name
            or authorization['attemptDirectory'] != str(attempt.directory)
            or authorization['manifestSha256'] != attempt.manifest_hash):
        raise ValueError('review-recovery-authorization-does-not-bind-attempt')
    if attempt.state()['phase'] not in {
        'EGRESS_GUARDED', 'CANDIDATE_READY', 'PUBLIC_COMMITTED', 'COMPLETE',
    }:
        raise ValueError('recovery-source-cannot-enter-earlier-deployment-phase')
    return authorization


def effective_tool_manifest(
    root: Path, attempt: Attempt, manifest: Mapping[str, object],
) -> Mapping[str, object]:
    """Leave the sealed manifest intact and restrict the approved runtime diff."""
    authorization = reviewed_source(root, attempt)
    if authorization is None:
        return manifest
    prior = record(manifest['tools'], 'sealed tools')
    proposed = record(authorization['tools'], 'recovery tools')
    changed = {path for path in proposed if prior.get(path) != proposed[path]}
    if (authorization['priorToolsSha256'] != checksum(prior)
            or not prior.keys() <= proposed.keys() or not changed
            or not changed <= MUTABLE_TOOLS):
        raise ValueError('recovery-runtime-tools-out-of-scope')
    return {**manifest, 'tools': proposed}


def verify_recovery_history(attempt: Attempt, authorization: Mapping[str, object]) -> None:
    """Bind the settled helper failure and exact operator repair to this run."""
    directory = attempt.directory
    failure = record(authorization['failure'], 'prior workload failure')
    name = failure.get('file')
    if (set(failure) != {'file', 'sha256'} or not isinstance(name, str)
            or not re.fullmatch(r'runtime-failure-[0-9]+\.json', name)):
        raise ValueError('exact-prior-workload-failure-required')
    bindings = {
        name: failure['sha256'],
        'backups.json': authorization['backupsSha256'],
        'supervisor-before-workload-recovery.json': authorization['supervisorSha256'],
        'settled-legacy-storage-gate-recovery.json': authorization['storageRecoverySha256'],
        'synthetic-stitch-retry.json': authorization['stitchRetrySha256'],
    }
    for filename, expected in bindings.items():
        if file_sha(directory / filename) != digest(expected, filename):
            raise ValueError('review-recovery-history-changed')
    supervisor = private_json(directory / 'supervisor-before-workload-recovery.json')
    if (private_json(directory / name).get('mode') != 'workloads'
            or supervisor.get('status') != 'held' or supervisor.get('operation') != 'deploy'
            or supervisor.get('manifestSha256') != attempt.manifest_hash):
        raise ValueError('prior-review-workload-failure-required')
    storage = private_json(directory / 'settled-legacy-storage-gate-recovery.json')
    retry = private_json(directory / 'synthetic-stitch-retry.json')
    if (storage.get('applied') is not True or storage.get('executionRetained') is not True
            or type(storage.get('storageObjectsTouched')) is not int
            or storage['storageObjectsTouched'] != 0
            or storage.get('serializedBySdkBackendLock') is not True
            or retry.get('retried') is not True
            or any(not isinstance(retry.get(key), str) or not retry[key]
                   for key in ('jobId', 'previousJobId', 'episodeId'))
            or retry.get('jobId') == retry.get('previousJobId')):
        raise ValueError('completed-metadata-and-stitch-recovery-required')


def recovery_workload_input(
    root: Path, attempt: Attempt, checkpoint: dict[str, object] | None,
) -> dict[str, object] | None:
    """Start the approved window once and retain readback after completion."""
    authorization = reviewed_source(root, attempt)
    if authorization is None:
        return checkpoint
    state = attempt.state()
    if (state['phase'] != 'EGRESS_GUARDED' or state['status'] != 'active'
            or state['sqlMayHaveStarted'] is not True or checkpoint is None):
        raise ValueError('exact-post-sql-workload-recovery-phase-required')
    verify_recovery_history(attempt, authorization)
    directory = attempt.directory
    archive = directory / BEFORE
    budget_path = directory / CONSUMED
    now = int(time.time() * 1000)
    expected = digest(authorization['checkpointSha256'], 'original workload checkpoint')
    if not archive.exists() and not archive.is_symlink():
        raw = bounded_bytes(directory / CHECKPOINT, private=True)
        if hashlib.sha256(raw).hexdigest() != expected or json.loads(raw) != checkpoint:
            raise ValueError('authorized-original-workload-checkpoint-required')
        private_file(archive, raw)
    if file_sha(archive) != expected:
        raise ValueError('original-workload-checkpoint-changed')
    prior = private_json(archive)
    budget_binding = {'authorizationSha256': checksum(authorization), 'checkpointSha256': expected}
    if not budget_path.exists() and not budget_path.is_symlink():
        if prior != checkpoint:
            raise ValueError('original-checkpoint-required-to-start-recovery-budget')
        budget = {**budget_binding, 'expiresAt': now + BUDGET_SECONDS * 1000}
        private_file(budget_path, json.dumps(budget, sort_keys=True).encode() + b'\n')
    budget = private_json(budget_path)
    end = budget.get('expiresAt')
    if (budget != {**budget_binding, 'expiresAt': end}
            or type(end) is not int or end > now + BUDGET_SECONDS * 1000):
        raise ValueError('review-workload-recovery-budget-changed')
    verified_path = directory / 'workloads-verified.json'
    readback = verified_path.exists() or verified_path.is_symlink()
    if readback:
        verified = private_json(verified_path)
        if (type(verified.get('syntheticAssessments')) is not int
                or verified['syntheticAssessments'] != 1
                or verified.get('selectedSpeechWorkload') != 'verified'):
            raise ValueError('completed-review-workload-proof-required')
    elif end <= now:
        raise ValueError('review-workload-recovery-budget-expired')
    retry = private_json(directory / 'synthetic-stitch-retry.json')
    return {
        'checkpoint': checkpoint,
        'recovery': {
            'expiresAt': now + READBACK_SECONDS * 1000 if readback else end,
            'startedAt': end - BUDGET_SECONDS * 1000,
            'readbackOnly': readback, 'prior': prior, 'episodeId': retry['episodeId'],
        },
    }
