"""Run the admitted historical observer without changing services."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import subprocess
import tempfile
from pathlib import Path

from scripts.deploy.images.metadata import digest, record, source_sha
from scripts.deploy.review.build_observer import (
    BUILDER,
    SOURCE,
    TARGET,
    bounded_bytes,
    git,
    historical_lock,
    sha,
)


def validate_bundle(
    root: Path,
    bundle: Path,
    receipt: Path,
    revision: str,
    expected_bundle_sha256: str,
) -> tuple[dict[str, object], bytes]:
    """Require reviewed tool identity and exact historical dependencies."""
    source_sha(revision)
    digest(expected_bundle_sha256, 'independently retained bundle hash')
    content = bounded_bytes(bundle, private=True)
    if sha(content) != expected_bundle_sha256:
        raise ValueError('Bundle differs from independently admitted build')
    evidence = record(
        json.loads(bounded_bytes(receipt, private=True)), 'observer receipt'
    )
    lock, sdk = historical_lock(root)
    packages = record(record(json.loads(lock), 'lock')['packages'], 'packages')
    zod = record(packages['node_modules/zod'], 'zod')
    expected: dict[str, object] = {
        'schemaVersion': 1,
        'purpose': 'sotto-review-readonly-observer',
        'targetSource': TARGET,
        'targetLockSha256': sha(lock),
        'toolRevision': revision,
        'sourceCommitted': True,
        'observerSourceSha256': sha(
            git(root, 'show', revision + ':' + str(SOURCE))
        ),
        'builderSourceSha256': sha(
            git(root, 'show', revision + ':' + str(BUILDER))
        ),
        'bundleSha256': expected_bundle_sha256,
        'sdkVersion': sdk['version'],
        'sdkIntegrity': sdk['integrity'],
        'zodVersion': zod['version'],
        'zodIntegrity': zod['integrity'],
        'externals': {
            name: record(packages['node_modules/' + name], name)['version']
            for name in ['pg', 'ioredis']
        },
    }
    if type(evidence.get('schemaVersion')) is not int or any(
        evidence.get(key) != value for key, value in expected.items()
    ):
        raise ValueError(
            'Observer differs from reviewed source or historical lock'
        )
    if evidence.get('sourceCommitted') is not True:
        raise ValueError('Observer source must be committed')
    for key in [
        'sdkArchiveSha256',
        'zodArchiveSha256',
        'esbuildExecutableSha256',
    ]:
        digest(evidence.get(key), key)
    inputs = record(evidence.get('inputs'), 'build inputs')
    if (
        not inputs
        or len(inputs) > 10_000
        or inputs.get('project/' + str(SOURCE))
        != expected['observerSourceSha256']
    ):
        raise ValueError('Observer input inventory is incomplete')
    for name, value in inputs.items():
        if not name.startswith(('project/', 'historical-sdk/')):
            raise ValueError('Unexpected observer input')
        digest(value, 'input hash')
    return evidence, content


def observe(
    root: Path,
    bundle: Path,
    receipt: Path,
    revision: str,
    expected_bundle_sha256: str,
    container: str,
    image: str,
    output: Path,
) -> None:
    evidence, content = validate_bundle(
        root, bundle, receipt, revision, expected_bundle_sha256
    )
    if not re.fullmatch(r'[0-9a-f]{64}', container):
        raise ValueError('A complete existing container identity is required')
    digest(image, 'captured historical image', 'sha256:')
    inspection = subprocess.run(
        [
            'ssh',
            '-o',
            'BatchMode=yes',
            '-o',
            'ConnectTimeout=10',
            'sotto-prod',
            shlex.join(
                [
                    'docker',
                    'inspect',
                    '--format',
                    '{{.Image}} {{.State.Running}} {{.Config.WorkingDir}}',
                    container,
                ]
            ),
        ],
        capture_output=True,
        timeout=20,
        check=True,
    )
    if inspection.stdout.decode().strip() != image + ' true /app/apps/web':
        raise ValueError('Captured running historical web identity changed')
    prelude = (
        'if(process.env.COMMIT_SHA!=='
        + json.dumps(TARGET)
        + "||process.getuid()!==1000||process.cwd()!=='/app/apps/web')"
        + "throw Error('Historical observer runtime mismatch');\n"
    )
    for name, version in record(evidence['externals'], 'externals').items():
        prelude += (
            'if(require('
            + json.dumps(name + '/package.json')
            + ').version!=='
            + json.dumps(version)
            + ")throw Error('Historical module mismatch');\n"
        )
    command = [
        'ssh',
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        'sotto-prod',
        shlex.join(
            [
                'docker',
                'exec',
                '-i',
                '-w',
                '/app/apps/web',
                container,
                'node',
                '-',
            ]
        ),
    ]
    payload = prelude.encode() + content
    with (
        tempfile.TemporaryFile() as stdout,
        tempfile.TemporaryFile() as stderr,
    ):
        result = subprocess.run(
            command,
            input=payload,
            stdout=stdout,
            stderr=stderr,
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            raise ValueError(
                'Historical observer failed; no state was changed'
            )
        stdout.seek(0)
        content = stdout.read(8 * 1024 * 1024 + 1)
    if len(content) > 8 * 1024 * 1024:
        raise ValueError('Observer output exceeds its bound')
    value = record(json.loads(content), 'observer output')
    database = record(value.get('database'), 'database')
    if (
        value.get('schemaVersion') != 1
        or value.get('purpose') != 'sotto-review-readonly-preflight'
        or value.get('namespace') != 'sotto-platform-v2'
        or database.get('readOnly') is not True
    ):
        raise ValueError('Observer did not prove its read-only connection')
    descriptor = os.open(
        output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
    )
    with os.fdopen(descriptor, 'w') as stream:
        json.dump(
            {
                'observer': evidence,
                'container': container,
                'image': image,
                'observation': value,
            },
            stream,
            indent=2,
        )
        stream.write('\n')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--tool-revision', required=True)
    parser.add_argument(
        '--bundle-sha256',
        required=True,
        help='Independently retained trusted build digest',
    )
    parser.add_argument('--container', required=True)
    parser.add_argument('--image', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    observe(
        Path(__file__).resolve().parents[3],
        args.bundle,
        args.receipt,
        args.tool_revision,
        args.bundle_sha256,
        args.container,
        args.image,
        args.output,
    )
    print('Read-only historical observation saved privately.')


if __name__ == '__main__':
    main()
