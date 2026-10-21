"""Preserve the existing deployment lock through sudo's standard input."""

from __future__ import annotations

import argparse
import hashlib
import os
import stat
import tempfile
from pathlib import Path

from scripts.deploy.images.metadata import digest
from scripts.deploy.review.state import DeploymentLock


def restore_input(
    payload: Path | None, expected_owner: int, expected_hash: str | None,
) -> None:
    """Execute against captured bytes without rereading a checked file."""
    descriptor = os.open('/dev/null', os.O_RDONLY)
    if descriptor != 0:
        os.dup2(descriptor, 0, inheritable=True)
        os.close(descriptor)
    else:
        os.set_inheritable(0, True)
    if payload is None:
        if expected_hash is not None:
            raise ValueError('unexpected-root-input-hash')
        return
    digest(expected_hash, 'private root input')
    metadata = payload.lstat()
    if (not payload.is_absolute() or not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != expected_owner
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_size > 262_144):
        raise ValueError('owned-private-root-input-required')
    descriptor = os.open(payload, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        actual = os.fstat(descriptor)
        if (actual.st_dev, actual.st_ino) != (metadata.st_dev,
                                            metadata.st_ino):
            raise ValueError('private-root-input-identity-changed')
        with os.fdopen(descriptor, 'rb', closefd=False) as source:
            captured = source.read(262_145)
    finally:
        os.close(descriptor)
    if (len(captured) > 262_144
            or hashlib.sha256(captured).hexdigest() != expected_hash):
        raise ValueError('private-root-input-changed')
    # FD0 is already occupied by /dev/null, so closing this anonymous file
    # cannot accidentally close the restored standard-input descriptor.
    with tempfile.TemporaryFile() as source:
        source.write(captured)
        source.flush()
        source.seek(0)
        os.dup2(source.fileno(), 0, inheritable=True)


def handoff(
    lock_path: Path, payload: Path | None, owner: int,
    payload_hash: str | None, arguments: list[str],
) -> None:
    if (not arguments or len(arguments) > 100
            or any(len(argument) > 65_536 for argument in arguments)):
        raise ValueError('bounded-root-command-required')
    lock = DeploymentLock(lock_path, received=0)
    try:
        restore_input(payload, owner, payload_hash)
        os.execvp(arguments[0], arguments)
    finally:
        lock.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lock', type=Path, required=True)
    parser.add_argument('--owner-uid', type=int, required=True)
    parser.add_argument('--payload', type=Path)
    parser.add_argument('--payload-sha256')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if (os.geteuid() != 0 or args.owner_uid <= 0
            or os.environ.get('SUDO_UID') != str(args.owner_uid)):
        raise ValueError('canonical-sudo-caller-required')
    command = args.command
    if command and command[0] == '--':
        command = command[1:]
    handoff(args.lock, args.payload, args.owner_uid,
            args.payload_sha256, command)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError):
        raise SystemExit('Privileged review command refused') from None
