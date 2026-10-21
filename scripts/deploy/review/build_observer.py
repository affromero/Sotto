"""Bundle a read-only observer against the exact historical locked SDK."""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import stat
import subprocess
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from typing import cast

from scripts.deploy.images.metadata import record, source_sha

TARGET = '41e03c38b3b6833d0719c5d708acb56c305e484a'
SOURCE = Path('scripts/deploy/review/observer.ts')
BUILDER = Path('scripts/deploy/review/build_observer.py')
MAX_BYTES = 32 * 1024 * 1024


def bounded_bytes(path: Path, *, private: bool = False) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_size > MAX_BYTES
            or (private and metadata.st_mode & 0o077)
        ):
            raise ValueError('Expected a bounded regular private input')
        with os.fdopen(descriptor, 'rb', closefd=False) as stream:
            value = stream.read(MAX_BYTES + 1)
        if len(value) > MAX_BYTES:
            raise ValueError('Input bound exceeded')
        return value
    finally:
        os.close(descriptor)


def sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def git(root: Path, *arguments: str) -> bytes:
    return subprocess.check_output(
        ['git', *arguments], cwd=root, stderr=subprocess.PIPE
    )


def historical_lock(root: Path) -> tuple[bytes, dict[str, object]]:
    raw = git(root, 'show', TARGET + ':package-lock.json')
    packages = record(record(json.loads(raw), 'lock')['packages'], 'packages')
    sdk = record(packages['apps/web/node_modules/thesidedoor-core'], 'SDK')
    if sdk.get('version') != '0.3.4':
        raise ValueError('Historical SDK version differs')
    return raw, sdk


def unpack(
    archive: Path,
    target: Path,
    integrity: str,
    name: str = 'thesidedoor-core',
    version: str = '0.3.4',
) -> dict[str, object]:
    content = bounded_bytes(archive)
    actual = (
        'sha512-' + base64.b64encode(hashlib.sha512(content).digest()).decode()
    )
    if integrity != actual:
        raise ValueError('Historical SDK archive integrity differs')
    total = 0
    names: set[str] = set()
    with tarfile.open(fileobj=io.BytesIO(content), mode='r:gz') as packed:
        for index, member in enumerate(packed):
            path = PurePosixPath(member.name)
            if (
                index >= 10_000
                or path.is_absolute()
                or '..' in path.parts
                or not path.parts
                or path.parts[0] != 'package'
                or not (member.isfile() or member.isdir())
            ):
                raise ValueError('Unsupported SDK archive entry')
            if str(path) in names:
                raise ValueError('Duplicate SDK archive entry')
            names.add(str(path))
            total += member.size
            if total > 128 * 1024 * 1024 or member.size > MAX_BYTES:
                raise ValueError('SDK extraction bound exceeded')
            if member.isdir():
                continue
            stream = packed.extractfile(member)
            if stream is None:
                raise ValueError('Missing SDK archive file')
            data = stream.read(MAX_BYTES + 1)
            if len(data) != member.size:
                raise ValueError('SDK archive file length differs')
            destination = target.joinpath(*path.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
    package = record(
        json.loads(bounded_bytes(target / 'package/package.json')),
        'SDK package',
    )
    if package.get('name') != name or package.get('version') != version:
        raise ValueError('Unexpected historical SDK package')
    return package


def build(
    root: Path,
    archive: Path,
    zod_archive: Path,
    output: Path,
) -> dict[str, object]:
    source = bounded_bytes(root / SOURCE)
    lock, sdk = historical_lock(root)
    packages = record(record(json.loads(lock), 'lock')['packages'], 'packages')
    zod = record(packages['node_modules/zod'], 'historical zod')
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    with tempfile.TemporaryDirectory(
        prefix='sotto-observer-sdk-'
    ) as temporary:
        stage = Path(temporary).resolve()
        package = unpack(archive, stage / 'sdk', cast(str, sdk['integrity']))
        unpack(
            zod_archive,
            stage / 'zod',
            cast(str, zod['integrity']),
            'zod',
            cast(str, zod['version']),
        )
        exports = record(package['exports'], 'SDK exports')
        aliases: dict[str, str] = {'zod': str(stage / 'zod/package/index.js')}
        for public in sorted(
            set(re.findall(r"from 'thesidedoor-core([^']*)'", source.decode()))
        ):
            path = record(exports['.' + public], 'SDK export')['import']
            resolved = stage / 'sdk/package' / cast(str, path)
            if not resolved.is_file():
                raise ValueError('Historical SDK export missing')
            aliases['thesidedoor-core' + public] = str(resolved)
        metafile = stage / 'metafile.json'
        bundle = output / 'observer.cjs'
        options = {
            'entryPoints': [str(root / SOURCE)],
            'bundle': True,
            'platform': 'node',
            'format': 'cjs',
            'target': 'node22',
            'minifyWhitespace': True,
            'external': ['pg', 'ioredis'],
            'alias': aliases,
            'define': {
                'import.meta.url': '"file:///app/apps/web/observer.cjs"'
            },
            'outfile': str(bundle),
            'metafile': True,
        }
        # The broad access export imports unused passkey/CLI modules. Mark
        # their imports pure, then reject the build if any reference survives.
        script = """
const esbuild = require('esbuild');
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
input.options.plugins = [{name: 'unused-access-imports', setup(build) {
  build.onResolve({filter: /^(@simplewebauthn\\/server|readline\\/promises)$/},
    args => ({path: args.path, external: true, sideEffects: false}));
}}];
esbuild.build(input.options).then(result =>
  fs.writeFileSync(input.metafile, JSON.stringify(result.metafile))
).catch(() => process.exit(1));
"""
        subprocess.run(
            ['node', '-e', script],
            input=json.dumps(
                {
                    'options': options,
                    'metafile': str(metafile),
                }
            ).encode(),
            cwd=root,
            capture_output=True,
            check=True,
        )
        metadata = record(
            json.loads(bounded_bytes(metafile)), 'build metadata'
        )
        inputs = record(metadata['inputs'], 'inputs')
        outputs = record(metadata['outputs'], 'outputs')
        builtins = json.loads(
            subprocess.check_output(
                [
                    'node',
                    '-e',
                    'console.log(JSON.stringify(require("node:module").builtinModules))',
                ],
                cwd=root,
            )
        )
        for value in outputs.values():
            imports = record(value, 'output')['imports']
            if not isinstance(imports, list):
                raise ValueError('Invalid external imports')
            for item in imports:
                dependency = record(item, 'external import')['path']
                if not isinstance(dependency, str) or (
                    not dependency.startswith('node:')
                    and dependency not in ['pg', 'ioredis', *builtins]
                ):
                    raise ValueError(
                        'Unexpected bundled external import: '
                        + str(dependency)
                    )
        inventory: dict[str, str] = {}
        for name in inputs:
            path = (root / name).resolve()
            if path.is_relative_to(stage):
                label = 'historical-sdk/' + str(path.relative_to(stage))
            elif path.is_relative_to(root):
                label = 'project/' + str(path.relative_to(root))
            else:
                raise ValueError('Unbound observer build input')
            inventory[label] = sha(bounded_bytes(path))
    revision = git(root, 'rev-parse', 'HEAD').decode().strip()
    source_sha(revision)
    try:
        committed = all(
            git(root, 'show', revision + ':' + str(path))
            == bounded_bytes(root / path)
            for path in [SOURCE, BUILDER]
        )
    except subprocess.CalledProcessError:
        committed = False
    esbuild = record(
        json.loads(bounded_bytes(root / 'node_modules/esbuild/package.json')),
        'build tool',
    )
    result: dict[str, object] = {
        'schemaVersion': 1,
        'purpose': 'sotto-review-readonly-observer',
        'targetSource': TARGET,
        'targetLockSha256': sha(lock),
        'toolRevision': revision,
        'sourceCommitted': committed,
        'observerSourceSha256': sha(source),
        'bundleSha256': sha(bounded_bytes(bundle)),
        'builderSourceSha256': sha(bounded_bytes(Path(__file__))),
        'sdkVersion': '0.3.4',
        'sdkIntegrity': sdk['integrity'],
        'sdkArchiveSha256': sha(bounded_bytes(archive)),
        'zodVersion': zod['version'],
        'zodIntegrity': zod['integrity'],
        'zodArchiveSha256': sha(bounded_bytes(zod_archive)),
        'esbuildVersion': esbuild['version'],
        'inputs': inventory,
        'esbuildExecutableSha256': sha(
            bounded_bytes(root / 'node_modules/esbuild/bin/esbuild')
        ),
        'externals': {
            name: record(packages['node_modules/' + name], name)['version']
            for name in ['pg', 'ioredis']
        },
    }
    bundle.chmod(0o600)
    receipt = output / 'observer-receipt.json'
    with receipt.open('x') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    receipt.chmod(0o600)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk-archive', type=Path, required=True)
    parser.add_argument('--zod-archive', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    build(root, args.sdk_archive, args.zod_archive, args.output)
    print('Historical observer bundle and integrity receipt prepared.')


if __name__ == '__main__':
    main()
