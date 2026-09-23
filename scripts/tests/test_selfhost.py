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
import json, os, pathlib, shlex, shutil, sys
args = sys.argv[1:]
name = pathlib.Path(sys.argv[0]).name
root = pathlib.Path(os.environ["TEST_REPO"])
with open(os.environ["TEST_LOG"], "a") as log:
    log.write(json.dumps({"command": name, "args": args, "cwd": os.getcwd()}) + "\n")
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
        revision = os.environ["TEST_REVISION"]
        if os.environ.get("TEST_MISMATCH") and "workers" in args[-1]:
            revision = "ffffffff" + "a" * 32
        print(revision)
    elif args[0] == "inspect":
        print("87654321" + "b" * 32)
    elif args[0] == "run":
        health = json.load(sys.stdin)
        sys.exit(0 if health.get("status") == "healthy" and health.get("version", "")[:8] == args[-1][:8] else 1)
    elif args[0] == "compose":
        command = args[1:]
        while command and command[0] in ("--project-directory", "--env-file", "-f"):
            command = command[2:]
        if command[0] == "pull" and os.environ.get("TEST_COMPOSE_PULL_FAIL"):
            sys.exit(1)
        if command[0] == "run" and os.environ.get("TEST_MIGRATION_FAIL"):
            sys.exit(1)
        if command[0] == "run" and "dist/access.cjs" in command:
            if "list" in command:
                print('{"mode":"household","principals":[]}')
            elif "claim" in command:
                print('{"operation":"claim","code":"fixture-owner-claim","expiresInMinutes":15}')
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
            ".env": "SOTTO_IMAGE_TAG=87654321\nSOTTO_PREVIOUS_IMAGE_TAG=11111111\nCUSTOM_SETTING=preserved\n",
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

    def test_access_recovery_uses_the_bundled_operator(self):
        for args in (("list",), ("recover", "admin-principal")):
            result = self.run_script("sotto-host", "access", *args)
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
                ["compose", "run", "--rm", "--no-deps", "web", "node", "dist/access.cjs", "recover", "admin-principal"],
            ],
        )
        self.assert_unchanged()

    def test_access_recovery_rejects_missing_principal_before_starting_a_container(self):
        result = self.run_script("sotto-host", "access", "recover")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("recover <principal-id>", result.stderr)
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
        self.assertEqual(compose_files, ["docker-compose.yml", "candidate-env.yml", "docker-compose.override.yml"])
        self.assertEqual(conversion[-3:], ["node", "dist/access.cjs", "initialize"])
        self.assertEqual(conversion[conversion.index("--project-directory") + 1], str(self.install))
        self.assertEqual(finalization[-3:], ["node", "dist/access.cjs", "finalize"])

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
        self.assertIn("fixture-owner-claim", result.stdout)
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
        (previous / ".env").write_text("SOTTO_IMAGE_TAG=11111111\nCUSTOM_SETTING=old\n")
        result = self.run_script(
            "sotto-host", "rollback", TEST_REVISION="11111111" + "a" * 32,
            TEST_HEALTH="11111111",
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.install / ".env").read_text(), (previous / ".env").read_text() + "SOTTO_PREVIOUS_IMAGE_TAG=\n")
        self.assertFalse((self.install / "docker-compose.override.yml").exists())
        restored_configuration = (self.install / ".env").read_text()
        repeated = self.run_script("sotto-host", "rollback")
        self.assertNotEqual(repeated.returncode, 0, repeated.stdout + repeated.stderr)
        self.assertIn("No previous tag", repeated.stderr)
        self.assertEqual((self.install / ".env").read_text(), restored_configuration)

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
