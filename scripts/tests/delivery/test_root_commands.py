"""Root npm proxies preserve arguments for the actual workspace command."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]


class RootCommandTests(unittest.TestCase):
    def test_web_test_preserves_filters_and_serial_execution(self) -> None:
        script = json.loads((ROOT / 'package.json').read_text())[
            'scripts'
        ]['test']
        arguments = [
            '--run', 'tests/first case.test.ts', 'tests/second.test.ts',
            '--no-file-parallelism',
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            workspace = root / 'apps/web'
            workspace.mkdir(parents=True)
            (root / 'package.json').write_text(json.dumps({
                'name': 'root-command-fixture',
                'version': '1.0.0',
                'private': True,
                'workspaces': ['apps/web'],
                'scripts': {'test': script},
            }))
            (workspace / 'package.json').write_text(json.dumps({
                'name': '@sotto/web',
                'version': '1.0.0',
                'private': True,
                'scripts': {'test': 'node capture.cjs'},
            }))
            capture = root / 'arguments.json'
            (workspace / 'capture.cjs').write_text(
                "require('node:fs').writeFileSync(process.env.ARGV_CAPTURE,"
                "JSON.stringify(process.argv.slice(2)));"
            )
            environment = {
                name: value for name, value in os.environ.items()
                if not name.lower().startswith('npm_config_')
            }
            result = subprocess.run(
                ['npm', 'test', '--', *arguments],
                cwd=root,
                env={
                    **environment,
                    'ARGV_CAPTURE': str(capture),
                    'npm_config_offline': 'true',
                    'npm_config_update_notifier': 'false',
                },
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(
                result.returncode, 0, result.stdout + result.stderr,
            )
            self.assertEqual(json.loads(capture.read_text()), arguments)
