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
    command = [
        'docker', 'run', '--rm', '--pull', 'never', '--network', 'none',
        '--platform', 'linux/amd64', '--read-only', '--tmpfs', '/tmp',
        '--workdir', '/app/apps/web', '--env', 'TSX_DISABLE_CACHE=1',
        '--env', 'TSX_TSCONFIG_PATH=/app/apps/web/tsconfig.json',
        '--env', 'DATABASE_URL=postgresql://probe:probe@127.0.0.1:1/probe',
        '--env', 'REDIS_URL=redis://127.0.0.1:1/15', '--entrypoint', 'node',
        reference,
    ]
    if tsx:
        command.extend(['--require', 'tsx/cjs'])
    command.extend(['-e', path.read_text()])
    try:
        output = subprocess.check_output(
            command, text=True, stderr=subprocess.PIPE, timeout=120,
            pass_fds=inherited_lock(),
        ).strip()
    except subprocess.CalledProcessError as error:
        detail = error.stderr.strip() or f'exit status {error.returncode}'
        raise ValueError(
            f'{path.name}: runtime probe failed: {detail}'
        ) from None
    if not output:
        raise ValueError(f'{path.name}: runtime probe returned no evidence')
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
