"""Exercise native smoke checks through the Docker process boundary."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

from images.fixtures import ROOT, environment


class NativeRuntimeSmokeTests(unittest.TestCase):
    root: Path
    runtime: Path
    core: Path
    native: Path
    libc: str
    env: dict[str, str]

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix='sotto-native-smoke-')
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.runtime = self.root / 'apps/web'
        self.core = self.runtime / 'node_modules/thesidedoor-core'
        (self.core / 'dist/storage').mkdir(parents=True)
        (self.core / 'package.json').write_text(json.dumps({
            'name': 'thesidedoor-core',
            'exports': {'./storage': './dist/storage/index.cjs'},
        }))
        (self.core / 'dist/storage/index.cjs').write_text(
            'throw new Error("Resolving storage must not execute it");')
        self.env = environment()
        self.env.pop('NODE_PATH', None)
        resolved = subprocess.run([
            'node', '-e', '''
                const {createRequire} = require('node:module');
                const owner = createRequire(
                    require.resolve('thesidedoor-core/storage'));
                console.log(owner.resolve('thesidedoor-flock'));
                console.log(process.report.getReport().header
                    .glibcVersionRuntime ? 'glibc' : 'musl');
            ''',
        ], cwd=ROOT / 'apps/web', env=self.env, text=True,
            capture_output=True, check=True)
        native, self.libc = resolved.stdout.splitlines()
        self.native = Path(native).parent
        docker = self.root / 'docker'
        docker.write_text(f'#!{sys.executable}\n' + textwrap.dedent('''
            import os
            import subprocess
            import sys
            args = sys.argv[1:]
            assert args[:4] == ['run', '--rm', '--network', 'none']
            assert args[6:10] == [
                '--entrypoint', 'node', 'fixture-image', '-e']
            key, value = args[5].split('=', 1)
            assert args[4] == '-e' and key == 'EXPECTED_LIBC'
            child_env = {**os.environ, key: value}
            result = subprocess.run(
                ['node', '-e', args[10]],
                cwd=os.environ['NATIVE_SMOKE_FIXTURE'], env=child_env)
            sys.exit(result.returncode)
        '''))
        docker.chmod(0o700)
        self.env.update({
            'PATH': str(self.root) + os.pathsep + self.env['PATH'],
            'NATIVE_SMOKE_FIXTURE': str(self.runtime),
        })

    def link_native(self, parent: Path) -> None:
        parent.mkdir(parents=True, exist_ok=True)
        (parent / 'thesidedoor-flock').symlink_to(
            self.native, target_is_directory=True)

    def smoke(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run([
            'bash', str(ROOT / 'scripts/deploy/checks/native-runtime.sh'),
            'fixture-image', self.libc,
        ], env=self.env, text=True, capture_output=True)

    def test_nested_owner_dependency_ignores_wrong_app_shadow(self) -> None:
        self.link_native(self.core / 'node_modules')
        shadow = self.runtime / 'node_modules/thesidedoor-flock'
        shadow.mkdir()
        (shadow / 'index.js').write_text(
            'throw new Error("Wrong app-scoped flock was loaded");')
        result = self.smoke()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('rejects contention and releases', result.stdout)

    def test_owner_resolution_accepts_a_legitimately_hoisted_native(
        self,
    ) -> None:
        self.link_native(self.runtime / 'node_modules')
        result = self.smoke()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('rejects contention and releases', result.stdout)

    def test_missing_owner_resolvable_native_fails(self) -> None:
        result = self.smoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Cannot find module 'thesidedoor-flock'", result.stderr)
        self.assertNotIn('rejects contention and releases', result.stdout)

    def test_missing_public_storage_export_does_not_load_app_native(
        self,
    ) -> None:
        self.link_native(self.runtime / 'node_modules')
        (self.core / 'package.json').write_text(json.dumps({
            'name': 'thesidedoor-core', 'exports': {},
        }))
        result = self.smoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('ERR_PACKAGE_PATH_NOT_EXPORTED', result.stderr)

    def test_native_without_exclusive_locking_fails_contention_check(
        self,
    ) -> None:
        broken = self.core / 'node_modules/thesidedoor-flock'
        broken.mkdir(parents=True)
        (broken / 'index.js').write_text(
            'module.exports = {constants: {LOCK_EX: 2, LOCK_NB: 4}, '
            'flock() {}};')
        result = self.smoke()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Missing expected exception', result.stderr)
        self.assertNotIn('rejects contention and releases', result.stdout)
