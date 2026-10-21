"""Exercise independent source jobs and their fail-closed aggregate."""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / '.github/workflows/source-ci.yml'
GATES = {'web', 'packages', 'tooling', 'speech'}


class SourceValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # The tooling gate installs the repository's pinned npm dependencies.
        result = subprocess.run(
            [shutil.which('node'), '-e',
             "process.stdout.write(JSON.stringify(require('yaml').parse("
             "require('node:fs').readFileSync(process.argv[1], 'utf8'))))",
             str(WORKFLOW)],
            cwd=ROOT, text=True, capture_output=True, check=True,
        )
        cls.jobs = json.loads(result.stdout)['jobs']

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.log = self.root / 'commands.jsonl'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.home = self.root / 'home'
        uv_directory = self.home / '.local/bin'
        uv_directory.mkdir(parents=True)
        boundary = (
            '#!' + sys.executable + '\n'
            'import json, os, pathlib, sys\n'
            'command = [pathlib.Path(sys.argv[0]).name, *sys.argv[1:]]\n'
            "with open(os.environ['COMMAND_LOG'], 'a') as stream:\n"
            '    stream.write(json.dumps({"command": command, '
            '"postgres": os.environ.get("SOTTO_TEST_POSTGRES")}) + "\\n")\n'
            'if command == json.loads(os.environ["FAIL_COMMAND"]):\n'
            '    raise SystemExit(7)\n'
        )
        for name in ('npm', 'npx', 'node', 'python3', 'go', 'sudo', 'curl'):
            executable = self.bin / name
            executable.write_text(boundary)
            executable.chmod(0o700)
        for name in ('uv', 'uvx'):
            executable = uv_directory / name
            executable.write_text(boundary)
            executable.chmod(0o700)
        self.environment = {
            **os.environ,
            'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
            'HOME': str(self.home),
            'COMMAND_LOG': str(self.log),
            'FAIL_COMMAND': '[]',
        }
        self.environment.pop('SOTTO_TEST_POSTGRES', None)
        self.command_output = ''

    def run_job(
        self, name: str, failure: list[str] | None = None,
    ) -> tuple[int, list[dict[str, object]]]:
        job = self.jobs[name]
        environment = {
            **self.environment, **job.get('env', {}),
            'FAIL_COMMAND': json.dumps(failure or []),
        }
        status = 0
        for step in job['steps']:
            if 'run' not in step:
                continue
            result = subprocess.run(
                ['bash', '-e', '-o', 'pipefail', '-c', step['run']],
                cwd=ROOT / step.get('working-directory', ''),
                env={**environment, **step.get('env', {})},
                text=True, capture_output=True,
            )
            self.command_output = result.stdout + result.stderr
            status = result.returncode
            if status:
                break
        records = [
            json.loads(line) for line in self.log.read_text().splitlines()
        ]
        self.log.unlink()
        return status, records

    def aggregate(
        self, results: dict[str, object],
    ) -> subprocess.CompletedProcess[str]:
        step = self.jobs['source']['steps'][0]
        return subprocess.run(
            ['bash', '-e', '-c', step['run']], cwd=ROOT,
            env={**os.environ, 'SOURCE_JOB_RESULTS': json.dumps(results)},
            text=True, capture_output=True,
        )

    def successful_results(self) -> dict[str, object]:
        return {name: {'result': 'success'} for name in GATES}

    def test_independent_jobs_keep_every_validation_command(self) -> None:
        expected = {
            'web': [
                ['npm', 'ci'],
                ['npx', '--no-install', 'prisma', 'generate',
                 '--schema=apps/web/prisma/schema.prisma'],
                ['npm', 'run', 'ci:web'],
            ],
            'packages': [['npm', 'ci'], ['npm', 'run', 'ci:packages']],
            'tooling': [
                ['npm', 'ci'],
                ['go', 'run',
                 'github.com/rhysd/actionlint/cmd/actionlint@v1.7.7'],
                ['curl', '--proto', '=https', '--tlsv1.2', '-LsSf',
                 'https://astral.sh/uv/0.11.17/install.sh'],
                ['uvx', '--from', 'mypy==2.4.0', 'mypy', '--strict',
                 '--explicit-package-bases', '--python-version', '3.12',
                 'scripts/deploy/images', 'scripts/deploy/review',
                 'scripts/deploy/compatibility-review.py'],
                ['node', 'scripts/ci/audit-gate.mjs'],
                ['python3', '-m', 'unittest', 'discover', '-s',
                 'scripts/tests', '-p', 'test*.py'],
                ['python3', '-m', 'unittest', 'discover', '-s',
                 'scripts/tests', '-p', 'test_database_command.py'],
            ],
            'speech': [
                ['uv', 'sync', '--locked', '--python', '3.11'],
                ['uv', 'run', 'pytest'],
                ['uv', 'run', 'pytest', '../local-stt/tests'],
                ['uv', 'run', 'ruff', 'check', '.'],
                ['uv', 'run', 'ruff', 'format', '--check', '.'],
                ['uv', 'run', 'ruff', 'check', '../local-stt'],
                ['uv', 'run', 'ruff', 'format', '--check', '../local-stt'],
            ],
        }
        for name, commands in expected.items():
            with self.subTest(job=name):
                self.assertNotIn('needs', self.jobs[name])
                self.assertNotIn('if', self.jobs[name])
                status, records = self.run_job(name)
                self.assertEqual(status, 0, self.command_output)
                actual = [record['command'] for record in records]
                for command in commands:
                    self.assertIn(command, actual)
                checkouts = [
                    step for step in self.jobs[name]['steps']
                    if step.get('uses', '').startswith('actions/checkout@')
                ]
                self.assertEqual(
                    checkouts[0]['with']['submodules'], 'recursive',
                )
                self.assertNotIn('ref', checkouts[0]['with'])
                if name == 'tooling':
                    backup = next(record for record in records
                                  if record['command'] == commands[-1])
                    self.assertEqual(backup['postgres'], '1')

    def test_failed_validation_commands_fail_their_job(self) -> None:
        failures = [
            ('web', ['npm', 'run', 'ci:web']),
            ('packages', ['npm', 'run', 'ci:packages']),
            ('tooling', ['node', 'scripts/ci/audit-gate.mjs']),
            ('tooling', ['uvx', '--from', 'mypy==2.4.0', 'mypy', '--strict',
                         '--explicit-package-bases', '--python-version',
                         '3.12', 'scripts/deploy/images',
                         'scripts/deploy/review',
                         'scripts/deploy/compatibility-review.py']),
            ('speech', ['uv', 'run', 'pytest']),
        ]
        for name, command in failures:
            with self.subTest(job=name):
                status, records = self.run_job(name, command)
                self.assertNotEqual(status, 0)
                self.assertEqual(records[-1]['command'], command)

    def test_only_web_uses_shared_database_and_redis_services(self) -> None:
        self.assertEqual(
            set(self.jobs['web']['services']), {'redis', 'postgres'},
        )
        self.assertEqual(self.jobs['web']['env'], {
            'NEXT_PUBLIC_APP_URL': 'https://selfhost.example.com',
            'SIDEDOOR_TEST_DATABASE_URL': (
                'postgresql://postgres:sidedoor-test-only'
                '@127.0.0.1:5432/sidedoor_test'
            ),
            'SIDEDOOR_TEST_REDIS_URL': 'redis://127.0.0.1:6379/15',
            'REDIS_URL': 'redis://127.0.0.1:6379/14',
        })
        for name in GATES - {'web'}:
            with self.subTest(job=name):
                self.assertNotIn('services', self.jobs[name])

    def test_named_check_waits_for_every_gate_after_failure(self) -> None:
        aggregate = self.jobs['source']
        self.assertEqual(aggregate['name'], 'Lint, Type Check, Test & Build')
        self.assertEqual(aggregate['if'], 'always()')
        self.assertEqual(set(aggregate['needs']), GATES)
        self.assertEqual(aggregate['steps'][0]['env']['SOURCE_JOB_RESULTS'],
                         '${{ toJSON(needs) }}')
        result = self.aggregate(self.successful_results())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_failed_skipped_and_cancelled_gates_never_pass(self) -> None:
        for name in GATES:
            for state in ('failure', 'skipped', 'cancelled'):
                with self.subTest(job=name, state=state):
                    results = self.successful_results()
                    results[name] = {'result': state}
                    result = self.aggregate(results)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(name, result.stderr)

    def test_missing_and_unexpected_gates_never_pass_aggregate(self) -> None:
        missing = self.successful_results()
        del missing['web']
        extra = {**self.successful_results(), 'unknown': {'result': 'success'}}
        for results in ({}, missing, extra):
            with self.subTest(results=results):
                self.assertNotEqual(self.aggregate(results).returncode, 0)


if __name__ == '__main__':
    unittest.main()
