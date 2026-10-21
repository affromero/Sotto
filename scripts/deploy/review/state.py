"""Private attempt records and continuous shared-lock ownership."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
from collections.abc import Callable, Mapping, Sequence
from importlib import import_module
from pathlib import Path
from typing import cast

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.build_observer import bounded_bytes

PHASES = (
    'PRECHECK', 'ADMITTED', 'PREPARED', 'FENCED', 'QUIESCENT',
    'BACKED_UP', 'SQL_STARTED', 'FINAL_SCHEMA_VERIFIED',
    'EGRESS_GUARDED', 'CANDIDATE_READY', 'PUBLIC_COMMITTED', 'COMPLETE',
)


def checksum(value: object) -> str:
    return hashlib.sha256(json.dumps(
        value, sort_keys=True, separators=(',', ':'),
    ).encode()).hexdigest()


def atomic_json(path: Path, value: Mapping[str, object]) -> None:
    """Use the existing deployment writer, including directory fsync."""
    writer = cast(
        Callable[[Path, Mapping[str, object], int], None],
        import_module('scripts.deploy.compatibility-review').atomic_json,
    )
    writer(path, value, 0o600)


def private_json(path: Path) -> dict[str, object]:
    metadata = path.lstat()
    if metadata.st_uid != os.geteuid():
        raise ValueError('Private deployment input has a different owner')
    content = bounded_bytes(path, private=True)
    if len(content) > 262_144:
        raise ValueError('Deployment input exceeds its bound')
    return record(json.loads(content), 'private deployment input')


def private_directory(path: Path, *, create: bool = False) -> None:
    if create:
        path.mkdir(mode=0o700)
    metadata = path.lstat()
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_mode & 0o077
        or metadata.st_uid != os.geteuid()
    ):
        raise ValueError('Expected an owned private attempt directory')


class Attempt:
    directory: Path
    manifest_hash: str
    evidence_hash: str

    def __init__(self, directory: Path) -> None:
        private_directory(directory)
        self.directory = directory
        binding = private_json(directory / 'binding.json')
        if set(binding) != {'manifestSha256', 'evidenceSha256'}:
            raise ValueError('Exact attempt binding required')
        self.manifest_hash = digest(binding['manifestSha256'], 'manifest')
        self.evidence_hash = digest(binding['evidenceSha256'], 'evidence')
        self.manifest()

    @classmethod
    def create(
        cls, root: Path, identity: str,
        manifest: Mapping[str, object], evidence_hash: str,
    ) -> Attempt:
        private_directory(root)
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', identity):
            raise ValueError('Invalid review attempt identity')
        digest(evidence_hash, 'independent evidence')
        directory = root / identity
        private_directory(directory, create=True)
        manifest_hash = checksum(manifest)
        atomic_json(directory / 'manifest.json', manifest)
        atomic_json(directory / 'binding.json', {
            'manifestSha256': manifest_hash,
            'evidenceSha256': evidence_hash,
        })
        atomic_json(directory / 'state.json', {
            'phase': 'PRECHECK', 'status': 'active',
            'manifestSha256': manifest_hash,
            'sqlMayHaveStarted': False,
        })
        return cls(directory)

    def manifest(self) -> dict[str, object]:
        value = private_json(self.directory / 'manifest.json')
        if checksum(value) != self.manifest_hash:
            raise ValueError('Attempt manifest changed')
        return value

    def state(self) -> dict[str, object]:
        self.manifest()
        value = private_json(self.directory / 'state.json')
        if (
            value.get('phase') not in PHASES
            or value.get('status') not in {'active', 'unresolved', 'complete'}
            or value.get('manifestSha256') != self.manifest_hash
            or type(value.get('sqlMayHaveStarted')) is not bool
        ):
            raise ValueError('Invalid durable attempt state')
        if (
            value['sqlMayHaveStarted']
            != (PHASES.index(str(value['phase']))
                >= PHASES.index('SQL_STARTED'))
            or (value['status'] == 'complete')
            != (value['phase'] == 'COMPLETE')
        ):
            raise ValueError('Irreversible schema marker is missing')
        return value

    def advance(self, phase: str, **details: object) -> None:
        previous = self.state()
        if (
            phase not in PHASES
            or previous['status'] == 'complete'
            or PHASES.index(phase) != PHASES.index(str(previous['phase'])) + 1
            or set(details) & set(previous)
        ):
            raise ValueError('Attempt phases must advance exactly once')
        atomic_json(self.directory / 'state.json', {
            **previous, **details, 'phase': phase,
            'status': 'complete' if phase == 'COMPLETE' else 'active',
            'sqlMayHaveStarted': previous['sqlMayHaveStarted']
            or phase == 'SQL_STARTED',
        })

    def unresolved(self, reason: str) -> None:
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,79}', reason):
            raise ValueError('Use a sanitized failure category')
        previous = self.state()
        if previous['status'] == 'complete':
            raise ValueError('A completed attempt cannot become unresolved')
        atomic_json(self.directory / 'state.json', {
            **previous, 'status': 'unresolved', 'reason': reason,
        })

    def install_marker(self, marker: Path) -> None:
        private_directory(marker.parent)
        temporary = self.directory / 'marker.json'
        atomic_json(temporary, {
            'attemptDirectory': str(self.directory),
            'manifestSha256': self.manifest_hash,
            'evidenceSha256': self.evidence_hash,
        })
        try:
            os.link(temporary, marker, follow_symlinks=False)
        except FileExistsError as error:
            raise ValueError(
                'An unresolved deployment marker exists',
            ) from error
        finally:
            temporary.unlink()
        sync_directory(marker.parent)

    def verify_marker(self, marker: Path) -> None:
        if private_json(marker) != {
            'attemptDirectory': str(self.directory),
            'manifestSha256': self.manifest_hash,
            'evidenceSha256': self.evidence_hash,
        }:
            raise ValueError('Recovery marker does not match this attempt')

    def clear_marker(self, marker: Path) -> None:
        self.verify_marker(marker)
        if self.state()['status'] != 'complete':
            raise ValueError('Only a completed attempt clears its marker')
        marker.unlink()
        sync_directory(marker.parent)


def sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


class DeploymentLock:
    path: Path
    descriptor: int

    def __init__(self, path: Path, received: int | None = None) -> None:
        self.path = path
        descriptor = received if received is not None else os.open(
            path, os.O_RDONLY | os.O_NOFOLLOW,
        )
        accepted = False
        try:
            self.validate(descriptor)
            if descriptor != 9:
                try:
                    os.fstat(9)
                except OSError:
                    pass
                else:
                    raise ValueError('Deployment FD9 is already occupied')
                os.dup2(descriptor, 9, inheritable=True)
            else:
                os.set_inheritable(9, True)
            self.descriptor = 9
            accepted = True
        finally:
            if descriptor != 9 or not accepted:
                os.close(descriptor)

    def validate(self, descriptor: int = 9) -> None:
        actual = os.fstat(descriptor)
        expected = self.path.stat(follow_symlinks=False)
        if (
            not stat.S_ISREG(actual.st_mode)
            or not stat.S_ISREG(expected.st_mode)
            or (actual.st_dev, actual.st_ino)
            != (expected.st_dev, expected.st_ino)
        ):
            raise ValueError('Shared lock file identity changed')
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def run(
        self, arguments: Sequence[str], *,
        content: bytes | None = None, timeout: float | None = None,
    ) -> subprocess.CompletedProcess[bytes]:
        self.validate()
        return subprocess.run(
            arguments, input=content, capture_output=True,
            pass_fds=(9,), timeout=timeout, check=False,
        )

    def close(self) -> None:
        os.close(self.descriptor)
