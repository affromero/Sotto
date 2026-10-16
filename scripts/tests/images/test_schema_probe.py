"""Exercise the schema receipt against real Linux filesystem entries."""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PROBE = ROOT / 'scripts/deploy/images/schema.cjs'
RUNNER = textwrap.dedent('''
    const fs = require('node:fs');
    const vm = require('node:vm');
    const fixture = process.argv[1];
    const source = fs.readFileSync(process.argv[2], 'utf8');
    const system = {
      ...fs,
      openSync(file, flags) {
        return fs.openSync(file === '/app' ? fixture : file, flags);
      },
    };
    vm.runInNewContext(source, {
      require(name) {
        return name === 'node:fs' ? system : require(name);
      },
      console,
    });
''')


@unittest.skipUnless(sys.platform.startswith('linux'), 'Linux fd paths')
class SchemaProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name) / 'app'
        self.prisma = self.root / 'apps/web/prisma'
        self.prisma.mkdir(parents=True)
        (self.prisma / 'schema.prisma').write_bytes(b'generator client {}\n')

    def run_probe(self) -> subprocess.CompletedProcess[str]:
        return subprocess.run([
            'node', '-e', RUNNER, str(self.root), str(PROBE),
        ], capture_output=True, text=True, timeout=10)

    def test_schema_and_sorted_migrations_retain_canonical_hash(self) -> None:
        files = {
            'schema.prisma': b'generator client {}\n',
            'migrations/a/migration.sql': b'CREATE TABLE a();\n',
            'migrations/z/migration.sql': b'CREATE TABLE z();\n',
        }
        for name in reversed(list(files)):
            target = self.prisma / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(files[name])
        expected = hashlib.sha256()
        for name, content in files.items():
            expected.update(name.encode())
            expected.update(content)
        result = self.run_probe()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), expected.hexdigest())

    def test_absent_migrations_keep_schema_only_hash(self) -> None:
        expected = hashlib.sha256(
            b'schema.prismagenerator client {}\n').hexdigest()
        result = self.run_probe()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), expected)

    def test_symlinked_schema_assets_and_ancestors_are_rejected(self) -> None:
        for name in ['schema.prisma', 'migrations', '../prisma']:
            with self.subTest(name=name):
                target = self.prisma if name == '../prisma' else (
                    self.prisma / name)
                if target.is_file():
                    target.unlink()
                external = Path(self.directory.name) / 'external'
                if name == 'schema.prisma':
                    external.write_bytes(b'external schema')
                else:
                    external.mkdir(exist_ok=True)
                if name == '../prisma':
                    (self.prisma / 'schema.prisma').unlink()
                    self.prisma.rmdir()
                target.symlink_to(external)
                result = self.run_probe()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, '')
                target.unlink()
                if external.is_file():
                    external.unlink()
                self.prisma.mkdir(exist_ok=True)
                (self.prisma / 'schema.prisma').write_bytes(
                    b'generator client {}\n')

    def test_nonregular_schema_entry_is_rejected_without_blocking(self) -> None:
        target = self.prisma / 'schema.prisma'
        target.unlink()
        os.mkfifo(target)
        result = self.run_probe()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Unexpected schema entry', result.stderr)
        self.assertEqual(result.stdout, '')
