"""Run the deployment controller against disposable filesystem and CLI boundaries."""

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest


SHA = 'a' * 40
OLD = 'sha256:' + 'b' * 64
NEW = 'sha256:' + 'c' * 64
BOUNDARY = r'''
import hashlib, json, os, pathlib, re, shutil, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['TEST_ROOT'])
state_path = root / 'state.json'
state = json.loads(state_path.read_text())
mode = os.environ['TEST_FAILURE']
with (root / 'calls.jsonl').open('a') as stream:
    stream.write(json.dumps([name, *args]) + '\n')
def finish(value='', code=0):
    state_path.write_text(json.dumps(state))
    if value: print(value)
    sys.exit(code)
old = 'sha256:' + 'b' * 64
new = 'sha256:' + 'c' * 64
sha = 'a' * 40
if name in ('sleep', 'flock'): finish()
if name == 'git': finish(sha if args[0] == 'rev-parse' else '')
if name == 'sha256sum':
    finish(hashlib.sha256(pathlib.Path(args[0]).read_bytes()).hexdigest() + '  ' + args[0])
if name == 'capacity':
    state['capacity'] += 1
    fail = (mode == 'pre-capacity' and state['capacity'] == 1) or (mode == 'post-capacity' and state['capacity'] == 2) or (mode == 'final-capacity' and state['capacity'] == 5)
    finish(code=1 if fail else 0)
if name == 'sudo':
    if args[0] == 'install': shutil.copyfile(args[-2], args[-1])
    elif args[:2] == ['rm', '-f']: pathlib.Path(args[-1]).unlink(missing_ok=True)
    finish()
if name == 'curl':
    url = args[-1]
    if url.endswith('/api/v1/tags'): finish('401')
    public = url.startswith('https://')
    if public:
        state['public_health'].append(state['web'])
        text = (root / 'caddy.conf').read_text()
        candidate = 'localhost:3010' in text and 'localhost:3000' not in text
    else: candidate = ':3010/' in url
    version = sha if candidate else 'd' * 40
    finish('200' if '%{http_code}' in args else json.dumps({'version': version}, separators=(',', ':')))
if name != 'docker': finish(code=2)
if args[0] == 'version': finish('linux/amd64')
if args[:2] == ['image', 'inspect']:
    if '--format' not in args: finish(code=0 if state['pulled'] else 1)
    fmt = args[args.index('--format') + 1]
    if 'Config.User' in fmt: finish('1001' if mode == 'runtime-owner' else '1000')
    finish(sha if 'revision' in fmt else ('linux/amd64' if 'Architecture' in fmt else new))
if args[0] == 'pull': state['pulled'] = True; finish()
if args[0] == 'ps':
    service = next((arg.split('=', 2)[-1] for arg in args if 'compose.service=' in arg), None)
    project = next((arg.split('=', 2)[-1] for arg in args if 'compose.project=' in arg), '')
    if service: finish('old-web' if service == 'web' and project.endswith('-blue') else (service if service != 'web' else ''))
    finish('old-web' if project.endswith('-blue') else ('workers-heavy' if project == 'sotto-test' else ''))
if args[0] == 'inspect':
    fmt = args[args.index('--format') + 1] if '--format' in args else args[args.index('-f') + 1]
    identifier = args[-1]
    if fmt == '{{.Image}}': finish(old)
    if fmt == '{{.State.Running}}': finish('true')
    if 'RestartCount' in fmt:
        image = state['workers']
        if 'revision' in fmt: finish('false false 0 ' + sha if mode == 'workers' else 'true false 0 ' + sha)
        if image == old: state['verified_workers'].append(identifier)
        finish('true false 0 ' + image)
    finish()
if args[0] == 'run':
    if mode.startswith('schema-'): finish(('d' if old in args else 'e') * 64)
    finish('same')
if args[0] == 'exec':
    script = args[-1]
    if 'pg_database_size' in script: finish('1024', code=1 if mode in ('backup', 'schema-reviewed') else 0)
    if 'pg_dump' in script: finish('verified fixture dump')
    finish()
if args[0] in ('volume', 'tag'): finish()
if args[0] != 'compose': finish(code=2)
project = args[args.index('-p') + 1] if '-p' in args else ''
overrides = [args[index + 1] for index, value in enumerate(args[:-1]) if value == '-f' and args[index + 1].endswith('.json')]
config = json.loads(pathlib.Path(overrides[-1]).read_text()) if overrides else {}
if 'ps' in args: finish(args[-1])
if 'exec' in args:
    command = args[args.index('exec') + 1:]
    if command[:2] == ['-T', 'postgres'] and 'pg_isready' in command:
        host = command[command.index('-h') + 1] if '-h' in command else None
        # The temporary initialization server answers socket probes before TCP is ready.
        if host is None: finish()
        ready = host == '127.0.0.1' and mode != 'postgres-unavailable'
        state['postgres_ready'] = ready
        finish(code=0 if ready else 1)
    if command[:2] == ['-T', 'redis']: finish('PONG')
    finish()
if 'up' in args:
    if project.endswith('-green'):
        state['web'] = new
        state['premature_route'] = 'localhost:3010' in (root / 'caddy.conf').read_text()
    if project.endswith('-blue'):
        state['old_web'] = old
        state['old_web_recreated'] = True
    if 'workers-heavy' in config.get('services', {}) and ('--force-recreate' in args or 'workers-heavy' in args):
        image = config['services']['workers-heavy']['image']
        state['workers'] = old if image == old else new
if 'down' in args and project.endswith('-green'): state['web'] = None
finish()
'''


class DeploymentFailureTests(unittest.TestCase):
    def run_deployment(self, failure, stack='sotto-test', reviewed_schema=False, expect_rollback=True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = Path(__file__).parents[2]
            (root / 'scripts/deploy').mkdir(parents=True)
            for name in ('deploy.sh', 'deploy/production-retention.py', 'deploy/database-command.py', 'smoke-prod.sh'):
                shutil.copyfile(source / 'scripts' / name, root / 'scripts' / name)
            shutil.copyfile(source / 'Caddyfile', root / 'Caddyfile')
            slot_file = root / f'.{stack}-deploy-slot'
            slot_file.write_text('blue\n')
            original_caddy = 'reverse_proxy localhost:3000 localhost:3010\n'
            (root / 'caddy.conf').write_text(original_caddy)
            state = {'capacity': 0, 'pulled': False, 'web': None, 'old_web': OLD, 'workers': OLD, 'public_health': [], 'verified_workers': [], 'premature_route': False}
            (root / 'state.json').write_text(json.dumps(state))
            bin_path = root / 'bin'
            bin_path.mkdir()
            for name in ('git', 'docker', 'sudo', 'curl', 'sleep', 'flock', 'capacity', 'sha256sum'):
                path = bin_path / name
                path.write_text('#!' + sys.executable + '\n' + BOUNDARY)
                path.chmod(0o755)
            environment = dict(os.environ, HOME=str(root), TEST_ROOT=str(root), TEST_FAILURE=failure,
                               PATH=str(bin_path) + os.pathsep + os.environ['PATH'],
                               SOTTO_ENV_FILE=str(root / '.env.production'),
                               PRODUCTION_DEPLOY_LOCK=str(root / 'deploy.lock'),
                               PRODUCTION_CAPACITY_CHECKER=str(bin_path / 'capacity'))
            values = {'NEXT_PUBLIC_APP_URL': 'https://fixture.example', 'SELF_HOSTED': 'false',
                      'BYOK_ENCRYPTION_KEY': '0' * 32, 'SOTTO_STACK': stack,
                      'REDIS_PASSWORD': 'fixture-redis-password',
                      'SOTTO_RELEASE_SHA': SHA, 'SOTTO_WEB_IMAGE_REF': 'fixture/web@sha256:' + 'c' * 64,
                      'SOTTO_WORKERS_IMAGE_REF': 'fixture/workers@sha256:' + 'c' * 64,
                      'SOTTO_BACKUP_DIR': str(root / 'backups'), 'PRODUCTION_IMAGE_RETENTION_DIR': str(root / 'retention'),
                      'CADDY_SITE_PATH': str(root / 'caddy.conf'), 'DATABASE_URL': 'postgresql://fixture',
                      **{name: '1048576' for name in ('SOTTO_WEB_IMAGE_BYTES', 'SOTTO_WEB_TRANSFER_BYTES', 'SOTTO_WORKERS_IMAGE_BYTES', 'SOTTO_WORKERS_TRANSFER_BYTES', 'SOTTO_BACKUP_BYTES')}}
            if reviewed_schema:
                values['SOTTO_REVIEWED_PREVIOUS_SCHEMA_HASH'] = 'd' * 64
                values['SOTTO_REVIEWED_CANDIDATE_SCHEMA_HASH'] = 'e' * 64
            (root / '.env.production').write_text(''.join(key + '=' + value + '\n' for key, value in values.items()))
            result = subprocess.run(['bash', str(root / 'scripts/deploy.sh')], env=environment,
                                    text=True, capture_output=True, timeout=30)
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            after = json.loads((root / 'state.json').read_text())
            if expect_rollback:
                self.assertEqual(after['old_web'], OLD, result.stdout + result.stderr)
                self.assertEqual(after['workers'], OLD, result.stdout + result.stderr)
                self.assertIsNone(after['web'], result.stdout + result.stderr)
                self.assertEqual(slot_file.read_text(), 'blue\n')
                self.assertEqual((root / 'caddy.conf').read_text(), original_caddy)
            else:
                self.assertEqual(after['workers'], NEW, result.stdout + result.stderr)
                self.assertEqual(after['web'], NEW, result.stdout + result.stderr)
                self.assertEqual(slot_file.read_text(), 'green\n')
            self.assertFalse(after['premature_route'], result.stdout + result.stderr)
            return after, result.stdout + result.stderr

    def test_primary_deployment_stops_when_only_initialization_socket_is_ready(self):
        state, output = self.run_deployment('postgres-unavailable', stack='sotto')
        self.assertIn('Postgres not ready', output)
        self.assertNotIn('Backing up the application database', output)
        self.assertFalse(state.get('postgres_ready', False), output)

    def test_primary_deployment_reaches_backup_after_database_accepts_tcp(self):
        state, output = self.run_deployment('backup', stack='sotto')
        self.assertTrue(state.get('postgres_ready', False), output)
        self.assertIn('Backing up the application database', output)
        self.assertNotIn('Postgres not ready', output)

    def test_capacity_rejection_before_import_keeps_current_services(self):
        state, output = self.run_deployment('pre-capacity')
        self.assertEqual(state['capacity'], 1, output)
        self.assertFalse(state['pulled'], output)

    def test_wrong_runtime_owner_never_replaces_running_services(self):
        state, output = self.run_deployment('runtime-owner')
        self.assertIn('production images must use UID 1000', output)
        self.assertFalse(state.get('old_web_recreated', False), output)

    def test_backup_failure_preserves_the_running_web_container(self):
        state, output = self.run_deployment('backup')
        self.assertIn('Backing up the application database', output)
        self.assertFalse(state.get('old_web_recreated', False), output)

    def test_capacity_rejection_after_import_keeps_current_services(self):
        state, output = self.run_deployment('post-capacity')
        self.assertTrue(state['pulled'], output)
        self.assertEqual(state['capacity'], 2, output)

    def test_schema_difference_never_replaces_running_services(self):
        state, output = self.run_deployment('schema-unreviewed')
        self.assertIn('exact reviewed previous and candidate schema hashes', output)
        self.assertTrue(state['pulled'])

    def test_reviewed_schema_transition_reaches_verified_backup_gate(self):
        state, output = self.run_deployment('schema-reviewed', reviewed_schema=True)
        self.assertIn('Accepted reviewed schema transition', output)
        self.assertIn('Backing up the application database', output)
        self.assertEqual(state['workers'], OLD, output)

    def test_worker_failure_restores_images_routing_slot_and_checks_public_health(self):
        state, output = self.run_deployment('workers')
        self.assertIn('workers-heavy did not remain healthy', output)
        self.assertNotIn('restored worker', output)
        self.assertGreaterEqual(len(state['public_health']), 2, output)
        self.assertIsNone(state['public_health'][-1], output)
        self.assertEqual(set(state['verified_workers']), {'workers-heavy', 'workers-pipeline', 'workers-light'}, output)

    def test_post_finalization_failure_keeps_the_verified_candidate_serving(self):
        state, output = self.run_deployment('final-capacity', expect_rollback=False)
        self.assertEqual(state['capacity'], 5, output)
        self.assertIn('Tags access check OK (status 401)', output)
        self.assertIn('Saved active slot: green', output)
        self.assertIn('Keeping the verified candidate serving', output)


class CliHomeSmokeTests(unittest.TestCase):
    def run_probe(self, script):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / 'home'
            home.mkdir(mode=0o700)
            executable = root / 'codex'
            executable.write_text('#!/usr/bin/env node\n' + script)
            executable.chmod(0o755)
            pid_file = root / 'child.pid'
            source = Path(__file__).parents[2] / 'scripts/deploy/checks/cli-home.cjs'
            environment = dict(os.environ, CODEX_HOME=str(home), EXPECTED_UID=str(os.getuid()),
                               FIXTURE_PID_OUT=str(pid_file),
                               PATH=str(root) + os.pathsep + os.environ['PATH'])
            before = home.stat()
            try:
                result = subprocess.run(['node', str(source)], env=environment,
                                        capture_output=True, text=True, timeout=10)
                self.assertEqual(home.stat().st_ino, before.st_ino)
                self.assertEqual(home.stat().st_mode, before.st_mode)
                if pid_file.exists():
                    with self.assertRaises(ProcessLookupError):
                        os.kill(int(pid_file.read_text()), 0)
                return result
            finally:
                if pid_file.exists():
                    try:
                        os.kill(int(pid_file.read_text()), signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    def test_initialized_cli_that_ignores_termination_is_stopped(self):
        result = self.run_probe('''
require('node:fs').writeFileSync(process.env.FIXTURE_PID_OUT, String(process.pid));
process.on('SIGTERM', () => {});
process.stdin.once('data', () => console.log(JSON.stringify({id: 1, result: {userAgent: 'fixture'}})));
setInterval(() => {}, 1000);
''')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Codex initializes with the private UID', result.stdout)

    def test_cli_startup_failure_is_reported(self):
        result = self.run_probe("console.error('fixture initialization failure'); process.exit(3);")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('fixture initialization failure', result.stderr)


if __name__ == '__main__':
    unittest.main()
