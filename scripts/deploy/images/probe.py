"""Run the same isolated image runtime probes during CI and deployment."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys


def inherited_lock() -> tuple[int, ...]:
    try:
        os.fstat(9)
    except OSError:
        return ()
    return (9,)


def probe(reference: str, path: Path, tsx: bool = False) -> str:
    return probe_source(reference, path.read_text(), path.name, tsx)


def probe_source(
    reference: str, source: str, label: str, tsx: bool = False,
    *, memory_bytes: int | None = None, review_attempt: str | None = None,
) -> str:
    command = [
        'docker', 'run', '--rm', '--pull', 'never', '--network', 'none',
        '--platform', 'linux/amd64', '--read-only', '--tmpfs', '/tmp',
        '--workdir', '/app/apps/web', '--env', 'TSX_DISABLE_CACHE=1',
        '--env', 'TSX_TSCONFIG_PATH=/app/apps/web/tsconfig.json',
        '--env', 'DATABASE_URL=postgresql://probe:probe@127.0.0.1:1/probe',
        '--env', 'REDIS_URL=redis://127.0.0.1:1/15', '--entrypoint', 'node',
    ]
    if memory_bytes is not None:
        if type(memory_bytes) is not int or memory_bytes <= 0:
            raise ValueError('Positive probe memory limit required')
        command.extend(['--memory', str(memory_bytes), '--memory-swap', str(memory_bytes)])
    if review_attempt is not None:
        command.extend(['--label', 'io.sotto.review-attempt=' + review_attempt])
    command.append(reference)
    if tsx:
        command.extend(['--require', 'tsx/cjs'])
    command.extend(['-e', source])
    try:
        output = subprocess.check_output(
            command, text=True, stderr=subprocess.PIPE, timeout=120,
            pass_fds=inherited_lock(),
        ).strip()
    except subprocess.CalledProcessError as error:
        detail = error.stderr.strip() or f'exit status {error.returncode}'
        raise ValueError(
            f'{label}: runtime probe failed: {detail}'
        ) from None
    if not output:
        raise ValueError(f'{label}: runtime probe returned no evidence')
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--tsx', action='store_true')
    args = parser.parse_args()
    try:
        print(probe(args.reference, args.source, args.tsx))
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
