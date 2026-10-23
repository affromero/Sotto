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
WORKFLOWS = ROOT / '.github/workflows'
GATES = {'web', 'packages', 'tooling', 'speech'}
WEB_GATES = {'web-checks', 'web-tests'}


class SourceValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # The tooling gate installs the repository's pinned npm dependencies.
        cls.jobs = {}
        for name in ('source-ci.yml', 'browser.yml', 'deploy.yml'):
            result = subprocess.run(
                [shutil.which('node'), '-e',
                 "process.stdout.write(JSON.stringify(require('yaml').parse("
                 "require('node:fs').readFileSync(process.argv[1], 'utf8'))))",
                 str(WORKFLOWS / name)],
                cwd=ROOT, text=True, capture_output=True, check=True,
            )
            cls.jobs.update(json.loads(result.stdout)['jobs'])

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.log = self.root / 'commands.jsonl'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.mirrors = self.root / 'apt-mirrors.txt'
        self.mirrors.write_text('http://azure.archive.ubuntu.com/ubuntu/\n')
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
            'mirror = pathlib.Path(os.environ["APT_MIRRORS_FILE"])\n'
            'if command == ["sudo", "test", "-f", '
            '"/etc/apt/apt-mirrors.txt"] and not mirror.is_file():\n'
            '    raise SystemExit(1)\n'
            'if command == ["sudo", "tee", "/etc/apt/apt-mirrors.txt"]:\n'
            '    mirror.write_text(sys.stdin.read())\n'
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
            'APT_MIRRORS_FILE': str(self.mirrors),
        }
        self.environment.pop('SOTTO_TEST_POSTGRES', None)
        self.command_output = ''

    def run_job(
        self, name: str, failure: list[str] | None = None,
        shard: int = 1,
        step_name: str | None = None,
    ) -> tuple[int, list[dict[str, object]]]:
        job = self.jobs[name]
        steps = [step for step in job['steps'] if 'run' in step
                 and (step_name is None or step.get('name') == step_name)]
        if step_name is not None:
            self.assertEqual(len(steps), 1,
                             'Select exactly one runnable workflow step')
        environment = {
            **self.environment, **job.get('env', {}),
            'FAIL_COMMAND': json.dumps(failure or []),
        }
        status = 0
        for step in steps:
            script = step['run'].replace('${{ matrix.shard }}', str(shard))
            result = subprocess.run(
                ['bash', '-e', '-o', 'pipefail', '-c', script],
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
        self, results: dict[str, object], job: str = 'source',
    ) -> subprocess.CompletedProcess[str]:
        step = self.jobs[job]['steps'][0]
        variable = 'WEB_JOB_RESULTS' if job == 'web' else 'SOURCE_JOB_RESULTS'
        return subprocess.run(
            ['bash', '-e', '-c', step['run']], cwd=ROOT,
            env={**os.environ, variable: json.dumps(results)},
            text=True, capture_output=True,
        )

    def successful_results(self, gates: set[str] = GATES) -> dict[str, object]:
        return {name: {'result': 'success'} for name in gates}

    def test_independent_jobs_keep_every_validation_command(self) -> None:
        expected = {
            'web-checks': [
                ['npm', 'ci'],
                ['npx', '--no-install', 'prisma', 'generate',
                 '--schema=apps/web/prisma/schema.prisma'],
                ['npm', 'run', 'speech:config:check', '--workspace=@sotto/web'],
                ['npm', 'run', 'lint', '--workspace=@sotto/web'],
                ['npm', 'run', 'type-check', '--workspace=@sotto/web'],
                ['npm', 'run', 'build'],
            ],
            'web-tests': [
                ['npm', 'ci'],
                ['npx', '--no-install', 'prisma', 'generate',
                 '--schema=apps/web/prisma/schema.prisma'],
                ['npm', 'test', '--workspace=@sotto/web', '--', '--run',
                 '--no-file-parallelism', '--shard=1/4'],
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
                if name == 'web-tests':
                    install = next(command for command in actual
                                   if command[:3] == ['sudo', 'apt-get',
                                                      'install'])
                    self.assertIn('redis-server', install)
                    self.assertLess(actual.index(install),
                                    actual.index(commands[-1]))
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
            ('web-checks', ['npm', 'run', 'speech:config:check',
                            '--workspace=@sotto/web']),
            ('web-checks', ['npm', 'run', 'lint', '--workspace=@sotto/web']),
            ('web-checks', ['npm', 'run', 'type-check',
                            '--workspace=@sotto/web']),
            ('web-checks', ['npm', 'run', 'build']),
            ('browser', ['npm', 'run', 'test:browser']),
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

    def test_media_installation_selects_the_official_ubuntu_archive(
        self,
    ) -> None:
        for name, validation in (
            ('web-tests', ['npm', 'test', '--workspace=@sotto/web', '--',
                           '--run', '--no-file-parallelism', '--shard=1/4']),
            ('browser', ['npm', 'run', 'test:browser']),
        ):
            with self.subTest(job=name):
                self.mirrors.write_text(
                    'http://azure.archive.ubuntu.com/ubuntu/\n')
                status, records = self.run_job(name)
                self.assertEqual(status, 0, self.command_output)
                self.assertEqual(
                    self.mirrors.read_text(),
                    'https://archive.ubuntu.com/ubuntu/\n',
                )
                self.assertIn(validation,
                              [record['command'] for record in records])

    def test_mirror_setup_failure_stops_before_installation_or_validation(
        self,
    ) -> None:
        for name, validation in (
            ('web-tests', ['npm', 'test', '--workspace=@sotto/web', '--',
                           '--run', '--no-file-parallelism', '--shard=1/4']),
            ('browser', ['npm', 'run', 'test:browser']),
        ):
            for failure in ('missing', 'write'):
                with self.subTest(job=name, failure=failure):
                    self.mirrors.write_text(
                        'http://azure.archive.ubuntu.com/ubuntu/\n')
                    command = None
                    if failure == 'missing':
                        self.mirrors.unlink()
                    else:
                        command = ['sudo', 'tee',
                                   '/etc/apt/apt-mirrors.txt']
                    status, records = self.run_job(name, command)
                    self.assertNotEqual(status, 0)
                    commands = [record['command'] for record in records]
                    self.assertNotIn(['sudo', 'apt-get', 'update'], commands)
                    self.assertNotIn(validation, commands)

    def test_production_audio_uses_canonical_mirror_before_installing(
        self,
    ) -> None:
        status, records = self.run_job(
            'local-stt', step_name='Install audio decoder')
        self.assertEqual(status, 0, self.command_output)
        self.assertEqual(self.mirrors.read_text(),
                         'https://archive.ubuntu.com/ubuntu/\n')
        commands = [record['command'] for record in records]
        write = ['sudo', 'tee', '/etc/apt/apt-mirrors.txt']
        update = ['sudo', 'apt-get', 'update']
        install = ['sudo', 'apt-get', 'install', '-y', 'ffmpeg']
        self.assertLess(commands.index(write), commands.index(update))
        self.assertLess(commands.index(update), commands.index(install))

    def test_production_audio_setup_failure_prevents_installation(
        self,
    ) -> None:
        for failure in ('missing', 'write', 'update'):
            with self.subTest(failure=failure):
                self.mirrors.write_text(
                    'http://azure.archive.ubuntu.com/ubuntu/\n')
                command = None
                if failure == 'missing':
                    self.mirrors.unlink()
                elif failure == 'write':
                    command = ['sudo', 'tee', '/etc/apt/apt-mirrors.txt']
                else:
                    command = ['sudo', 'apt-get', 'update']
                status, records = self.run_job(
                    'local-stt', command, step_name='Install audio decoder')
                self.assertNotEqual(status, 0)
                commands = [record['command'] for record in records]
                self.assertNotIn(
                    ['sudo', 'apt-get', 'install', '-y', 'ffmpeg'], commands)
                if failure != 'update':
                    self.assertNotIn(['sudo', 'apt-get', 'update'], commands)

    def test_every_test_shard_has_its_own_database_and_redis_services(self) -> None:
        self.assertEqual(
            set(self.jobs['web-tests']['services']), {'redis', 'postgres'},
        )
        self.assertEqual(self.jobs['web-tests']['env'], {
            'NEXT_PUBLIC_APP_URL': 'https://selfhost.example.com',
            'SIDEDOOR_TEST_DATABASE_URL': (
                'postgresql://postgres:sidedoor-test-only'
                '@127.0.0.1:5432/sidedoor_test'
            ),
            'SIDEDOOR_TEST_REDIS_URL': 'redis://127.0.0.1:6379/15',
            'REDIS_URL': 'redis://127.0.0.1:6379/14',
        })
        for name in GATES | {'web-checks'}:
            with self.subTest(job=name):
                self.assertNotIn('services', self.jobs[name])

    def test_all_four_shards_run_serial_files_with_complete_partition_indices(self) -> None:
        strategy = self.jobs['web-tests']['strategy']
        shards = strategy['matrix']['shard']
        self.assertEqual(shards, [1, 2, 3, 4])
        self.assertFalse(strategy['fail-fast'])
        for shard in shards:
            with self.subTest(shard=shard):
                status, records = self.run_job('web-tests', shard=shard)
                self.assertEqual(status, 0, self.command_output)
                self.assertEqual(records[-1]['command'], [
                    'npm', 'test', '--workspace=@sotto/web', '--', '--run',
                    '--no-file-parallelism', f'--shard={shard}/{len(shards)}',
                ])

    def test_failure_in_any_test_shard_fails_its_job(self) -> None:
        for shard in self.jobs['web-tests']['strategy']['matrix']['shard']:
            command = ['npm', 'test', '--workspace=@sotto/web', '--', '--run',
                       '--no-file-parallelism', f'--shard={shard}/4']
            with self.subTest(shard=shard):
                status, records = self.run_job('web-tests', command, shard)
                self.assertNotEqual(status, 0)
                self.assertEqual(records[-1]['command'], command)

    def test_named_check_waits_for_every_gate_after_failure(self) -> None:
        aggregate = self.jobs['source']
        self.assertEqual(aggregate['name'], 'Lint, Type Check, Test & Build')
        self.assertEqual(aggregate['if'], 'always()')
        self.assertEqual(set(aggregate['needs']), GATES)
        self.assertEqual(aggregate['steps'][0]['env']['SOURCE_JOB_RESULTS'],
                         '${{ toJSON(needs) }}')
        result = self.aggregate(self.successful_results())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        web = self.jobs['web']
        self.assertEqual(web['name'], 'Web')
        self.assertEqual(web['if'], 'always()')
        self.assertEqual(set(web['needs']), WEB_GATES)
        self.assertEqual(web['steps'][0]['env']['WEB_JOB_RESULTS'],
                         '${{ toJSON(needs) }}')
        result = self.aggregate(self.successful_results(WEB_GATES), 'web')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_failed_skipped_and_cancelled_gates_never_pass(self) -> None:
        for job, gates in (('source', GATES), ('web', WEB_GATES)):
            for name in gates:
                for state in ('failure', 'skipped', 'cancelled'):
                    with self.subTest(aggregate=job, gate=name, state=state):
                        results = self.successful_results(gates)
                        results[name] = {'result': state}
                        result = self.aggregate(results, job)
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn(name, result.stderr)

    def test_missing_and_unexpected_gates_never_pass_aggregate(self) -> None:
        for job, gates in (('source', GATES), ('web', WEB_GATES)):
            missing = self.successful_results(gates)
            del missing[next(iter(gates))]
            extra = {**self.successful_results(gates),
                     'unknown': {'result': 'success'}}
            for results in ({}, missing, extra):
                with self.subTest(aggregate=job, results=results):
                    self.assertNotEqual(self.aggregate(results, job).returncode, 0)


if __name__ == '__main__':
    unittest.main()
