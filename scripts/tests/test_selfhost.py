"""Execute the shipped self-host scripts with Docker and HTTP boundaries isolated."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
REVISION = "12345678" + "a" * 32
OLD_REVISION = "87654321" + "b" * 32

BOUNDARY = r'''#!/usr/bin/env python3
import json, os, pathlib, shlex, shutil, subprocess, sys
args = sys.argv[1:]
name = pathlib.Path(sys.argv[0]).name
root = pathlib.Path(os.environ["TEST_REPO"])
def key_environment(path):
    values = {}
    if not path.is_file():
        return values
    for line in path.read_text().splitlines():
        if line.startswith(('BYOK_ENCRYPTION_KEY=', 'SOTTO_SPEAKING_REFERENCE_KEYRING=')):
            parts = shlex.split(line)
            if parts and '=' in parts[0]:
                key, value = parts[0].split('=', 1)
                values[key] = value
    return values
with open(os.environ["TEST_LOG"], "a") as log:
    record = {"command": name, "args": args, "cwd": os.getcwd()}
    for argument in args:
        if argument.endswith('/candidate-images.yml') and pathlib.Path(argument).is_file():
            record['pinned_images'] = pathlib.Path(argument).read_text()
        if argument.endswith('/frozen-compose.json') and pathlib.Path(argument).is_file():
            config = json.loads(pathlib.Path(argument).read_text())
            record['frozen_note'] = config.get('services', {}).get('web', {}).get('environment', {}).get('EXTRA_POLICY')
            record['frozen_mode'] = pathlib.Path(argument).stat().st_mode & 0o777
    log.write(json.dumps(record) + "\n")
if name == "sleep":
    sys.exit(0)
if name == "lsof":
    sys.exit(1)
if name == "curl":
    url = next(a for a in args if a.startswith("http"))
    if "/health" in url:
        print(json.dumps({"status": "healthy", "version": os.environ.get("TEST_HEALTH", "87654321")}))
    elif "-o" in args:
        target = args[args.index("-o") + 1]
        if os.environ.get("TEST_DOWNLOAD_FAIL") and "docker-compose" in url:
            sys.exit(22)
        for relative in ("scripts/selfhost/images.sh", "docker-compose.selfhost.yml", "scripts/agent/sync-cli-credentials.sh", "scripts/sotto-host"):
            if url.endswith(relative):
                shutil.copyfile(root / relative, target)
                break
        else:
            sys.exit(22)
    else:
        print('{\n  "sha": "' + os.environ["TEST_REVISION"] + '",\n}')
    sys.exit(0)
if name == "docker":
    if args[0] == "pull":
        sys.exit(1 if os.environ.get("TEST_PULL_FAIL") else 0)
    if args[:2] == ["image", "inspect"]:
        is_workers = 'workers' in args[-1] or args[-1] == 'sha256:' + 'b' * 64
        if '{{.Id}}' in ' '.join(args):
            print('invalid' if os.environ.get('TEST_BAD_IMAGE_ID') else 'sha256:' + ('c' if ':swapped' in args[-1] else 'b' if is_workers else 'a') * 64)
            sys.exit(0)
        if '{{.Config.WorkingDir}}' in ' '.join(args):
            print('/old' if os.environ.get('TEST_BAD_IMAGE_WORKDIR') else '/app/apps/web')
            sys.exit(0)
        if '{{json .Config.Env}}' in ' '.join(args):
            print(json.dumps(['SOTTO_SPEAKING_REFERENCE_KEYRING=private-image-default'] if os.environ.get('TEST_IMAGE_DEFAULT_KEY') else []))
            sys.exit(0)
        if 'fm.sotto.speaking-reference-capability' in ' '.join(args):
            role = 'workers' if is_workers else 'web'
            print(os.environ.get('TEST_' + role.upper() + '_CAPABILITY', '<no value>'))
            sys.exit(0)
        revision = os.environ["TEST_REVISION"]
        if os.environ.get("TEST_MISMATCH") and is_workers:
            revision = "ffffffff" + "a" * 32
        print(revision)
    elif args[0] == "inspect":
        if '{{json .Config.Env}}' in ' '.join(args):
            values = key_environment(pathlib.Path(os.environ['SOTTO_DIR']) / '.env')
            if os.environ.get('TEST_MATCH_IMAGE_DEFAULT'):
                values['SOTTO_SPEAKING_REFERENCE_KEYRING'] = 'private-image-default'
            if os.environ.get('TEST_RUNNING_KEY_MISMATCH') and args[-1] == 'b' * 64:
                values['BYOK_ENCRYPTION_KEY'] = 'live-private-mismatch'
            print(json.dumps([key + '=' + value for key, value in values.items()]))
            sys.exit(0)
        if '{{.State.Running}}' in ' '.join(args):
            print('false' if os.environ.get('TEST_RUNNING_STOPPED') else 'true')
            sys.exit(0)
        if '{{.Image}}' in ' '.join(args):
            print('sha256:' + ('b' if args[-1] == 'b' * 64 else 'a') * 64)
            sys.exit(0)
        print("87654321" + "b" * 32)
    elif args[0] == "run":
        if any(marker in ' '.join(args) for marker in ('__SOTTO_COMPOSE_IMAGE_PROBE__', '__SOTTO_ROLLBACK_KEY_PROBE__', '__SOTTO_FREEZE_CONFIG__', '__SOTTO_COMPARE_CONFIG__')):
            result = subprocess.run(['node', '-e', args[args.index('-e') + 1], *args[args.index('-e') + 2:]], input=sys.stdin.read(), text=True, capture_output=True)
            sys.stdout.write(result.stdout)
            sys.stderr.write(result.stderr)
            sys.exit(result.returncode)
        health = json.load(sys.stdin)
        sys.exit(0 if health.get("status") == "healthy" and health.get("version", "")[:8] == args[-1][:8] else 1)
    elif args[0] == "compose":
        command = args[1:]
        while command and command[0] in ("--project-directory", "--env-file", "-f"):
            command = command[2:]
        if command[:3] == ['config', '--format', 'json']:
            if os.environ.get('TEST_COMPOSE_CONFIG_ERROR'):
                print('private-compose-error', file=sys.stderr)
                sys.exit(1)
            frozen = next((pathlib.Path(arg) for arg in args if arg.endswith(('/frozen-compose.tmp', '/frozen-compose.json'))), None)
            if frozen:
                def render(value):
                    if isinstance(value, list): return [render(item) for item in value]
                    if isinstance(value, dict): return {key.replace('$', '$$'): render(item) for key, item in value.items()}
                    return value
                print(json.dumps(render(json.loads(frozen.read_text()))))
                sys.exit(0)
            env_path = pathlib.Path(args[args.index('--env-file') + 1]) if '--env-file' in args else pathlib.Path(os.environ['SOTTO_DIR']) / '.env'
            keys = {key: value.replace('$', '$$') for key, value in key_environment(env_path).items()}
            web = {'image': 'ghcr.io/affromero/sotto-web:' + ('swapped' if os.environ.get('TEST_IMAGE_SWAP') else '12345678'), 'environment': dict(keys)}
            workers = {'image': 'ghcr.io/affromero/sotto-workers:12345678', 'environment': dict(keys)}
            if os.environ.get('TEST_EXTRA_ENV_FILE'):
                web['environment']['EXTRA_POLICY'] = 'original-$$value'
                workers['environment']['EXTRA_POLICY'] = 'original-$$value'
                web['labels'] = {'fixture$$key': '$$literal'}
            if os.environ.get('TEST_ROLLBACK_OVERRIDE_KEY') and any('/rollback/candidate-env.yml' in arg for arg in args):
                workers['environment']['SOTTO_SPEAKING_REFERENCE_KEYRING'] = 'private-override-mismatch'
            if os.environ.get('TEST_ROLLBACK_IMAGE_OVERRIDE') and any('/rollback/candidate-env.yml' in arg for arg in args):
                workers['image'] = 'ghcr.io/affromero/sotto-workers:swapped'
            if os.environ.get('TEST_ROLLBACK_NULL_KEY') and any('/rollback/candidate-env.yml' in arg for arg in args):
                workers['environment']['BYOK_ENCRYPTION_KEY'] = None
            if os.environ.get('TEST_ROLE_COMMAND'):
                web['command'] = ['changed']
            if os.environ.get('TEST_ROLE_VOLUME'):
                web['volumes'] = [{'type': 'bind', 'source': '/old', 'target': '/app/apps/web'}]
            for kind in ('configs', 'secrets', 'tmpfs', 'volumes_from', 'post_start', 'pre_stop'):
                if os.environ.get('TEST_' + kind.upper()):
                    web[kind] = ['/app/apps/web']
            if os.environ.get('TEST_NODE_OPTIONS'):
                web['environment']['NODE_OPTIONS'] = '--require=/tmp/old.js'
            if os.environ.get('TEST_PATH_OVERRIDE'):
                web['environment']['PATH'] = '/old/bin'
            if os.environ.get('TEST_TSX_OVERRIDE'):
                workers['environment']['TSX_TSCONFIG_PATH'] = '/old/tsconfig.json'
            if os.environ.get('TEST_WORKDIR_OVERRIDE'):
                web['working_dir'] = '/app/apps/web/.sotto/storage'
            if os.environ.get('TEST_KEY_MISMATCH'):
                workers['environment'] = {'SOTTO_SPEAKING_REFERENCE_KEYRING': 'changed'}
            if os.environ.get('TEST_DATABASE_MISMATCH'):
                workers['environment'] = {'DATABASE_URL': 'postgresql://different/database'}
            print(json.dumps({'services': {'web': web, 'workers': workers}}))
            sys.exit(0)
        if command[0] == "pull" and os.environ.get("TEST_COMPOSE_PULL_FAIL"):
            sys.exit(1)
        if command[0] == "run" and os.environ.get("TEST_MIGRATION_FAIL"):
            sys.exit(1)
        if command[0] == "run" and "dist/access.cjs" in command:
            if "list" in command:
                print('{"mode":"household","principals":[]}')
            sys.exit(0)
        if command[:3] == ["exec", "-T", "postgres"]:
            if os.environ.get("TEST_DB_FAIL"):
                sys.exit(1)
            probe = command[3:]
            if probe[:2] == ["sh", "-c"]:
                probe = shlex.split(probe[2])
            if probe and probe[0] == "pg_isready":
                # Model a running TCP server without a local Unix socket.
                sys.exit(0 if "-h" in probe and probe[probe.index("-h") + 1] == "127.0.0.1" else 2)
        if command[0] == "ps":
            if command[1:2] == ['-q']:
                role = command[-1]
                calls = [json.loads(line) for line in pathlib.Path(os.environ['TEST_LOG']).read_text().splitlines()]
                seen = sum(item['command'] == 'docker' and item['args'][-3:] == ['ps', '-q', role] for item in calls)
                changed = os.environ.get('TEST_CONTAINER_SWAP') and role == 'web' and seen > 1
                print(('c' if changed else 'b' if role == 'workers' else 'a') * 64)
                sys.exit(0)
            print("sotto-web")
    sys.exit(0)
sys.exit(1)
'''


class SelfHostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.install = self.directory / "install"
        self.install.mkdir()
        self.bin = self.directory / "bin"
        self.bin.mkdir()
        for command in ("docker", "curl", "sleep", "lsof"):
            executable = self.bin / command
            executable.write_text(BOUNDARY)
            executable.chmod(0o755)
        self.log = self.directory / "commands.jsonl"
        self.env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "SOTTO_DIR": str(self.install),
            "SOTTO_BIN_DIR": str(self.bin),
            "SOTTO_YES": "1",
            "TEST_REPO": str(ROOT),
            "TEST_LOG": str(self.log),
            "TEST_REVISION": REVISION,
        }
        self.original = {
            ".env": "SOTTO_IMAGE_TAG=87654321\nSOTTO_PREVIOUS_IMAGE_TAG=11111111\nBYOK_ENCRYPTION_KEY=fixture-key\nCUSTOM_SETTING=preserved\n",
            "docker-compose.yml": "name: sotto\nservices: {}\n",
            "docker-compose.override.yml": "services:\n  web:\n    volumes: [custom:/custom]\n",
        }
        for name, content in self.original.items():
            (self.install / name).write_text(content)

    def run_script(self, script, *args, **extra):
        return subprocess.run(
            ["bash", str(ROOT / "scripts" / script), *args],
            env={**self.env, **extra}, capture_output=True, text=True, timeout=30,
        )

    def assert_unchanged(self):
        for name, content in self.original.items():
            self.assertEqual((self.install / name).read_text(), content, name)

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_access_list_uses_the_bundled_operator(self):
        result = self.run_script("sotto-host", "access", "list")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        runs = [
            command["args"]
            for command in self.commands()
            if command["command"] == "docker" and command["args"][:2] == ["compose", "run"]
        ]
        self.assertEqual(
            runs,
            [
                ["compose", "run", "--rm", "--no-deps", "web", "node", "dist/access.cjs", "list"],
            ],
        )
        self.assert_unchanged()

    def test_access_recovery_is_not_an_operator_command(self):
        result = self.run_script("sotto-host", "access", "recover")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("access list, setup, or reset", result.stderr)
        self.assertFalse(self.log.exists())

    def test_unavailable_images_leave_installation_and_rollback_history_untouched(self):
        for _ in range(2):
            result = self.run_script("sotto-host", "update", "--no-backup", TEST_PULL_FAIL="1")
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assert_unchanged()

    def test_failed_candidate_pull_keeps_all_existing_configuration(self):
        result = self.run_script("sotto-host", "update", "--no-backup", TEST_COMPOSE_PULL_FAIL="1")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_unchanged()

    def test_update_rejects_mismatched_or_unknown_speaking_capabilities(self):
        for web, workers in (
            ('web-v1', '<no value>'),
            ('<no value>', 'workers-v1'),
            ('web-v2', 'workers-v1'),
            ('web-v1', 'web-v1'),
        ):
            with self.subTest(web=web, workers=workers):
                result = self.run_script(
                    'sotto-host', 'update', '--no-backup',
                    TEST_WEB_CAPABILITY=web, TEST_WORKERS_CAPABILITY=workers,
                )
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('speaking reference', result.stderr)
                self.assert_unchanged()

    def test_update_accepts_matching_speaking_capabilities(self):
        result = self.run_script(
            'sotto-host', 'update', '--no-backup', TEST_HEALTH='12345678',
            TEST_WEB_CAPABILITY='web-v1', TEST_WORKERS_CAPABILITY='workers-v1',
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        inspections = [
            c['args'] for c in self.commands()
            if c['command'] == 'docker' and c['args'][:2] == ['image', 'inspect']
            and ('revision' in ' '.join(c['args']) or 'capability' in ' '.join(c['args']))
        ]
        self.assertTrue(inspections)
        self.assertTrue(all(args[-1].startswith('sha256:') for args in inspections))

    def test_update_rejects_invalid_image_identity(self):
        result = self.run_script('sotto-host', 'update', '--no-backup', TEST_BAD_IMAGE_ID='1')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('immutable image identity', result.stderr)
        self.assert_unchanged()

    def test_update_rejects_image_with_unexpected_working_directory(self):
        result = self.run_script(
            'sotto-host', 'update', '--no-backup', TEST_BAD_IMAGE_WORKDIR='1',
        )
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('unsupported working directory', result.stderr)
        self.assert_unchanged()

    def test_update_requires_an_installed_helper_that_captures_image_identities(self):
        helper = (ROOT / 'scripts/selfhost/images.sh').read_text()
        helper = helper.replace(
            '    printf \'%s\\n%s\\n\' "$web_id" "$workers_id" > "$STAGING_DIR/resolved-image-ids"',
            '    :',
        )
        self.assertNotIn('> "$STAGING_DIR/resolved-image-ids"', helper)
        (self.install / 'images.sh').write_text(helper)
        result = self.run_script('sotto-host', 'update', '--no-backup')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('configuration could not be frozen', result.stderr)
        self.assertEqual((self.install / 'images.sh').read_text(), helper)
        self.assert_unchanged()

    def test_update_rejects_changed_candidate_images_or_role_configuration(self):
        for variable in ('TEST_IMAGE_SWAP', 'TEST_ROLE_COMMAND', 'TEST_KEY_MISMATCH', 'TEST_DATABASE_MISMATCH', 'TEST_ROLE_VOLUME', 'TEST_NODE_OPTIONS', 'TEST_PATH_OVERRIDE', 'TEST_TSX_OVERRIDE', 'TEST_WORKDIR_OVERRIDE', 'TEST_CONFIGS', 'TEST_SECRETS', 'TEST_TMPFS', 'TEST_VOLUMES_FROM', 'TEST_POST_START', 'TEST_PRE_STOP'):
            with self.subTest(variable=variable):
                result = self.run_script(
                    'sotto-host', 'update', '--no-backup', **{variable: '1'},
                )
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('changed after verification', result.stderr)
                self.assert_unchanged()
                self.assertFalse(any(
                    'prisma migrate deploy' in ' '.join(command['args'])
                    for command in self.commands() if command['command'] == 'docker'
                ))

    def test_rollback_rejects_mismatched_speaking_capabilities(self):
        result = self.run_script(
            'sotto-host', 'rollback', TEST_REVISION='11111111' + 'a' * 32,
            TEST_WEB_CAPABILITY='web-v1', TEST_WORKERS_CAPABILITY='<no value>',
        )
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('speaking reference', result.stderr)
        self.assert_unchanged()

    def test_failed_migrations_keep_existing_configuration_and_rollback_history(self):
        result = self.run_script("sotto-host", "update", "--no-backup", TEST_MIGRATION_FAIL="1")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_unchanged()

    def test_latest_uses_matching_published_worker_and_release_configuration(self):
        result = self.run_script("sotto-host", "update", "--no-backup", TEST_HEALTH="12345678")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        configuration = (self.install / ".env").read_text()
        self.assertIn("SOTTO_IMAGE_TAG=12345678\n", configuration)
        self.assertIn("SOTTO_PREVIOUS_IMAGE_TAG=87654321\n", configuration)
        self.assertIn("CUSTOM_SETTING=preserved\n", configuration)
        commands = self.commands()
        pulls = [c["args"][-1] for c in commands if c["command"] == "docker" and c["args"][0] == "pull"]
        self.assertEqual(pulls, ["ghcr.io/affromero/sotto-web:latest", "ghcr.io/affromero/sotto-workers:12345678"])
        urls = [a for c in commands if c["command"] == "curl" for a in c["args"] if a.startswith("http")]
        self.assertTrue(any(f"/{REVISION}/docker-compose.selfhost.yml" in url for url in urls))
        self.assertFalse(any("/commits/main" in url for url in urls))
        self.assertEqual((self.install / "previous" / "docker-compose.yml").read_text(), self.original["docker-compose.yml"])
        candidate_commands = [c["args"] for c in commands if c["command"] == "docker" and "--no-deps" in c["args"]]
        self.assertEqual(len(candidate_commands), 3)
        migration = next(command for command in candidate_commands if "prisma migrate deploy" in command[-1])
        conversion = next(command for command in candidate_commands if command[-1] == "initialize")
        finalization = next(command for command in candidate_commands if command[-1] == "finalize")
        self.assertEqual(migration[migration.index("--project-directory") + 1], str(self.install))
        self.assertNotEqual(migration[migration.index("--env-file") + 1], str(self.install / ".env"))
        self.assertIn("prisma migrate deploy", migration[-1])
        self.assertIn("tsx apps/web/prisma/seed-curriculum.ts", migration[-1])
        compose_files = [Path(migration[index + 1]).name for index, argument in enumerate(migration) if argument == "-f"]
        self.assertEqual(compose_files, ["frozen-compose.json", "candidate-images.yml"])
        self.assertEqual(conversion[-3:], ["node", "dist/access.cjs", "initialize"])
        self.assertEqual(conversion[conversion.index("--project-directory") + 1], str(self.install))
        self.assertEqual(finalization[-3:], ["node", "dist/access.cjs", "finalize"])
        pinned = [c for c in commands if c['command'] == 'docker' and c.get('pinned_images')]
        self.assertTrue(any('prisma migrate deploy' in ' '.join(c['args']) for c in pinned))
        self.assertTrue(any('up' in c['args'] and '--pull' in c['args'] and 'never' in c['args'] for c in pinned))
        self.assertTrue(all('sha256:' + 'a' * 64 in c['pinned_images'] and 'sha256:' + 'b' * 64 in c['pinned_images'] and c['pinned_images'].count('pull_policy: never') == 2 for c in pinned))
        self.assertTrue(all(c.get('frozen_mode') == 0o600 for c in pinned))
        health_checks = [
            c['args'] for c in commands if c['command'] == 'docker'
            and c['args'][0] == 'run' and c['args'][-1] == '12345678'
        ]
        self.assertTrue(health_checks)
        self.assertTrue(all('sha256:' + 'a' * 64 in args for args in health_checks))

    def test_check_does_not_pull_or_modify_installation(self):
        result = self.run_script("sotto-host", "update", "--check")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_unchanged()
        self.assertFalse(any(c["command"] == "docker" and c["args"][0] == "pull" for c in self.commands()))

    def test_incompatible_images_are_rejected_before_configuration_changes(self):
        result = self.run_script("sotto-host", "update", "--no-backup", TEST_MISMATCH="1")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("different releases", result.stderr)
        self.assert_unchanged()

    def test_failed_reinstall_preserves_existing_ssh_override(self):
        result = self.run_script("install.sh", TEST_COMPOSE_PULL_FAIL="1")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_unchanged()

    def test_fresh_install_can_defer_provider_setup_and_pins_a_release(self):
        for name in self.original:
            (self.install / name).unlink()
        result = self.run_script("install.sh", TEST_HEALTH="12345678")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        configuration = (self.install / ".env").read_text()
        self.assertIn("SOTTO_IMAGE_TAG=12345678\n", configuration)
        self.assertIn("BYOK_ENCRYPTION_KEY=", configuration)
        self.assertTrue((self.install / "images.sh").is_file())
        self.assertIn("sotto-host access setup", result.stdout)
        self.assertIn("Continue in your browser", result.stdout)

    def test_install_database_timeout_exits_with_actionable_failure(self):
        result = self.run_script("install.sh", TEST_DB_FAIL="1")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PostgreSQL did not become ready", result.stdout)

    def test_wrong_running_release_is_not_reported_as_success(self):
        result = self.run_script("sotto-host", "update", "--no-backup", TEST_HEALTH="ffffffff")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("did not report healthy", result.stderr)

    def test_concurrent_update_cannot_modify_a_locked_installation(self):
        (self.install / ".operation-lock").mkdir()
        result = self.run_script("sotto-host", "update", "--no-backup")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("locked", result.stderr)
        self.assert_unchanged()
        self.assertTrue((self.install / ".operation-lock").is_dir())

    def test_reinstall_preserves_runtime_settings(self):
        with (self.install / ".env").open("a") as configuration:
            configuration.write('WEB_PORT="4321"\n')
            configuration.write('NEXT_PUBLIC_APP_URL=https://learning.example.com\n')
        result = self.run_script("install.sh", TEST_HEALTH="12345678")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        configuration = (self.install / ".env").read_text()
        self.assertIn("WEB_PORT=4321\n", configuration)
        self.assertIn("NEXT_PUBLIC_APP_URL=https://learning.example.com\n", configuration)

    def test_rollback_restores_saved_configuration_and_absence_of_an_override(self):
        previous = self.install / "previous"
        previous.mkdir()
        (previous / "docker-compose.yml").write_text(self.original["docker-compose.yml"])
        (previous / ".env").write_text("SOTTO_IMAGE_TAG=11111111\nBYOK_ENCRYPTION_KEY=fixture-key\nCUSTOM_SETTING=old\n")
        result = self.run_script(
            "sotto-host", "rollback", TEST_REVISION="11111111" + "a" * 32,
            TEST_HEALTH="11111111",
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.install / ".env").read_text(), (previous / ".env").read_text() + "SOTTO_PREVIOUS_IMAGE_TAG=\n")
        self.assertFalse((self.install / "docker-compose.override.yml").exists())
        starts = [entry for entry in self.commands() if entry['command'] == 'docker' and 'up' in entry['args'] and entry.get('pinned_images')]
        self.assertEqual(len(starts), 1)
        self.assertIn('sha256:' + 'a' * 64, starts[0]['pinned_images'])
        self.assertIn('sha256:' + 'b' * 64, starts[0]['pinned_images'])
        self.assertEqual(starts[0]['pinned_images'].count('pull_policy: never'), 2)
        self.assertIn('--pull', starts[0]['args'])
        self.assertIn('never', starts[0]['args'])
        restored_configuration = (self.install / ".env").read_text()
        repeated = self.run_script("sotto-host", "rollback")
        self.assertNotEqual(repeated.returncode, 0, repeated.stdout + repeated.stderr)
        self.assertIn("No previous tag", repeated.stderr)
        self.assertEqual((self.install / ".env").read_text(), restored_configuration)

    def test_rollback_preserves_current_encryption_keys_when_saved_settings_differ(self):
        previous = self.install / 'previous'
        previous.mkdir()
        (previous / 'docker-compose.yml').write_text(self.original['docker-compose.yml'])
        for current_line, previous_line in (
            ("SOTTO_SPEAKING_REFERENCE_KEYRING='private-current'\n", ''),
            ('', 'SOTTO_SPEAKING_REFERENCE_KEYRING=\n'),
            ('BYOK_ENCRYPTION_KEY=second-private\n', ''),
            (' export SOTTO_SPEAKING_REFERENCE_KEYRING=ambiguous\n', ''),
        ):
            with self.subTest(current=current_line != '', previous=previous_line != ''):
                current = self.original['.env'] + current_line
                saved = 'SOTTO_IMAGE_TAG=11111111\nBYOK_ENCRYPTION_KEY=fixture-key\n' + previous_line
                (self.install / '.env').write_text(current)
                (previous / '.env').write_text(saved)
                result = self.run_script('sotto-host', 'rollback', TEST_REVISION='11111111' + 'a' * 32)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertNotIn('private-current', result.stdout + result.stderr)
                self.assertNotIn('second-private', result.stdout + result.stderr)
                self.assertEqual((self.install / '.env').read_text(), current)
                self.assertEqual((previous / '.env').read_text(), saved)

    def test_rollback_rejects_missing_saved_environment(self):
        previous = self.install / 'previous'
        previous.mkdir()
        (previous / 'docker-compose.yml').write_text(self.original['docker-compose.yml'])
        result = self.run_script('sotto-host', 'rollback', TEST_REVISION='11111111' + 'a' * 32)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('unavailable or ambiguous', result.stderr)
        self.assert_unchanged()

    def test_rollback_rejects_saved_executable_override(self):
        previous = self.install / 'previous'
        previous.mkdir()
        (previous / 'docker-compose.yml').write_text(self.original['docker-compose.yml'])
        (previous / '.env').write_text('SOTTO_IMAGE_TAG=11111111\nBYOK_ENCRYPTION_KEY=fixture-key\n')
        result = self.run_script(
            'sotto-host', 'rollback', TEST_REVISION='11111111' + 'a' * 32,
            TEST_ROLE_VOLUME='1',
        )
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('Saved image configuration could not be verified', result.stderr)
        self.assert_unchanged()

    def test_rollback_freezes_additional_environment_values(self):
        previous = self.install / 'previous'
        previous.mkdir()
        (previous / 'docker-compose.yml').write_text(self.original['docker-compose.yml'])
        (previous / '.env').write_text('SOTTO_IMAGE_TAG=11111111\nBYOK_ENCRYPTION_KEY=fixture-key\n')
        result = self.run_script(
            'sotto-host', 'rollback', TEST_REVISION='11111111' + 'a' * 32,
            TEST_EXTRA_ENV_FILE='1', TEST_HEALTH='11111111',
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        starts = [entry for entry in self.commands() if entry['command'] == 'docker' and 'up' in entry['args'] and entry.get('pinned_images')]
        self.assertEqual(len(starts), 1)
        self.assertEqual(starts[0]['frozen_note'], 'original-$$value')

    def test_rollback_rejects_multiline_encryption_settings(self):
        previous = self.install / 'previous'
        previous.mkdir()
        (previous / 'docker-compose.yml').write_text(self.original['docker-compose.yml'])
        for key in ('BYOK_ENCRYPTION_KEY', 'SOTTO_SPEAKING_REFERENCE_KEYRING'):
            with self.subTest(key=key):
                current = self.original['.env']
                saved = 'SOTTO_IMAGE_TAG=11111111\nBYOK_ENCRYPTION_KEY=fixture-key\n'
                if key == 'BYOK_ENCRYPTION_KEY':
                    current = current.replace('BYOK_ENCRYPTION_KEY=fixture-key', "BYOK_ENCRYPTION_KEY='same\nnew'")
                    saved = saved.replace('BYOK_ENCRYPTION_KEY=fixture-key', "BYOK_ENCRYPTION_KEY='same\nold'")
                else:
                    current += "SOTTO_SPEAKING_REFERENCE_KEYRING='same\nnew'\n"
                    saved += "SOTTO_SPEAKING_REFERENCE_KEYRING='same\nold'\n"
                (self.install / '.env').write_text(current)
                (previous / '.env').write_text(saved)
                result = self.run_script('sotto-host', 'rollback', TEST_REVISION='11111111' + 'a' * 32)
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual((self.install / '.env').read_text(), current)
                self.assertEqual((previous / '.env').read_text(), saved)

    def test_rollback_preserves_matching_quoted_keyring(self):
        previous = self.install / 'previous'
        previous.mkdir()
        (previous / 'docker-compose.yml').write_text(self.original['docker-compose.yml'])
        keyring = "SOTTO_SPEAKING_REFERENCE_KEYRING='{" + '\"version\":1,\"active\":\"legacy\",\"keys\":[]' + "}'\n"
        (self.install / '.env').write_text(self.original['.env'] + keyring)
        (previous / '.env').write_text('SOTTO_IMAGE_TAG=11111111\nBYOK_ENCRYPTION_KEY=fixture-key\n' + keyring)
        result = self.run_script('sotto-host', 'rollback', TEST_REVISION='11111111' + 'a' * 32, TEST_HEALTH='11111111')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(keyring, (self.install / '.env').read_text())

    def test_rollback_preserves_single_quoted_key_with_dollar_sign(self):
        previous = self.install / 'previous'
        previous.mkdir()
        (previous / 'docker-compose.yml').write_text(self.original['docker-compose.yml'])
        current = self.original['.env'].replace('BYOK_ENCRYPTION_KEY=fixture-key', "BYOK_ENCRYPTION_KEY='fixture$literal'")
        saved = "SOTTO_IMAGE_TAG=11111111\nBYOK_ENCRYPTION_KEY='fixture$literal'\n"
        (self.install / '.env').write_text(current)
        (previous / '.env').write_text(saved)
        result = self.run_script('sotto-host', 'rollback', TEST_REVISION='11111111' + 'a' * 32, TEST_HEALTH='11111111')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("BYOK_ENCRYPTION_KEY='fixture$literal'", (self.install / '.env').read_text())

    def test_rollback_rejects_effective_or_running_key_mismatch_without_disclosure(self):
        previous = self.install / 'previous'
        previous.mkdir()
        (previous / 'docker-compose.yml').write_text(self.original['docker-compose.yml'])
        saved = 'SOTTO_IMAGE_TAG=11111111\nBYOK_ENCRYPTION_KEY=fixture-key\n'
        (previous / '.env').write_text(saved)
        for variable in ('TEST_RUNNING_KEY_MISMATCH', 'TEST_ROLLBACK_OVERRIDE_KEY', 'TEST_ROLLBACK_NULL_KEY', 'TEST_IMAGE_DEFAULT_KEY', 'TEST_RUNNING_STOPPED', 'TEST_COMPOSE_CONFIG_ERROR', 'TEST_CONTAINER_SWAP', 'TEST_ROLLBACK_IMAGE_OVERRIDE'):
            with self.subTest(variable=variable):
                self.log.unlink(missing_ok=True)
                result = self.run_script(
                    'sotto-host', 'rollback', TEST_REVISION='11111111' + 'a' * 32,
                    **{variable: '1'},
                )
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertTrue('could not be verified' in result.stderr or 'could not be frozen' in result.stderr)
                self.assertNotIn('live-private-mismatch', result.stdout + result.stderr)
                self.assertNotIn('private-override-mismatch', result.stdout + result.stderr)
                self.assertNotIn('private-image-default', result.stdout + result.stderr)
                self.assertNotIn('private-compose-error', result.stdout + result.stderr)
                self.assertEqual((previous / '.env').read_text(), saved)
                self.assert_unchanged()

    def test_rollback_accepts_matching_inherited_image_key_defaults(self):
        previous = self.install / 'previous'
        previous.mkdir()
        (previous / 'docker-compose.yml').write_text(self.original['docker-compose.yml'])
        (previous / '.env').write_text('SOTTO_IMAGE_TAG=11111111\nBYOK_ENCRYPTION_KEY=fixture-key\n')
        result = self.run_script(
            'sotto-host', 'rollback', TEST_REVISION='11111111' + 'a' * 32,
            TEST_HEALTH='11111111', TEST_IMAGE_DEFAULT_KEY='1', TEST_MATCH_IMAGE_DEFAULT='1',
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('private-image-default', result.stdout + result.stderr)

    def test_current_full_revision_leaves_rollback_history_untouched(self):
        result = self.run_script(
            "sotto-host", "update", "--no-backup", TEST_REVISION=OLD_REVISION,
            TEST_HEALTH=OLD_REVISION,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("nothing to do", result.stdout)
        self.assert_unchanged()

    def run_local_setup(self, existing_environment=False):
        repository = self.directory / "source"
        scripts = repository / "scripts"
        scripts.mkdir(parents=True)
        (scripts / "setup.sh").write_text((ROOT / "scripts/setup.sh").read_text())
        (scripts / "install-deps.sh").write_text("#!/usr/bin/env bash\nexit 0\n")
        (repository / ".env.oss.example").write_text(
            'DATABASE_URL="postgresql://fixture:password@localhost/sotto"\n'
            'BYOK_ENCRYPTION_KEY=""\n'
        )
        if existing_environment:
            (repository / ".env.local").write_text((repository / ".env.oss.example").read_text())
        npm = self.bin / "npm"
        npm.write_text("#!/usr/bin/env bash\nexit 0\n")
        npm.chmod(0o755)
        npx = self.bin / "npx"
        npx.write_text(
            '#!/usr/bin/env python3\nimport os,sys\n'
            'from pathlib import Path\n'
            'if "migrate" in sys.argv:\n'
            '    Path(os.environ["TEST_DATABASE_ENV"]).write_text(os.environ.get("DATABASE_URL", "missing"))\n'
            '    Path(os.environ["TEST_KEY_ENV"]).write_text(os.environ.get("BYOK_ENCRYPTION_KEY", "missing"))\n'
            '    sys.exit(0 if os.environ.get("DATABASE_URL") else 1)\n'
        )
        npx.chmod(0o755)
        observed = self.directory / "database-env"
        observed_key = self.directory / "key-env"
        environment = {**self.env, "TEST_DATABASE_ENV": str(observed), "TEST_KEY_ENV": str(observed_key)}
        environment.pop("DATABASE_URL", None)
        environment.pop("DIRECT_DATABASE_URL", None)
        result = subprocess.run(
            ["bash", str(scripts / "setup.sh")], env=environment,
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(observed.read_text(), "postgresql://fixture:password@localhost/sotto")
        return scripts, repository, environment, observed_key

    def test_setup_exports_new_environment_before_database_migrations(self):
        self.run_local_setup()

    def test_copied_template_gets_an_encryption_key_that_survives_repeated_setup(self):
        scripts, repository, environment, observed_key = self.run_local_setup(existing_environment=True)
        key = observed_key.read_text()
        self.assertRegex(key, r"^[0-9a-f]{64}$")
        configuration = (repository / ".env.local").read_text()
        self.assertIn(key, configuration)
        result = subprocess.run(
            ["bash", str(scripts / "setup.sh")], env=environment,
            capture_output=True, text=True, timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(observed_key.read_text(), key)
        self.assertEqual((repository / ".env.local").read_text(), configuration)


if __name__ == "__main__":
    unittest.main()
