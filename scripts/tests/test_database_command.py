"""Connection handling and opt-in real PostgreSQL backup verification."""

import importlib.util
import fcntl
import os
from pathlib import Path
import subprocess
import signal
import tempfile
import time
import unittest
import uuid

HELPER = Path(__file__).parents[1] / 'deploy/database-command.py'
spec = importlib.util.spec_from_file_location('database_command', HELPER)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConnectionTests(unittest.TestCase):
    def test_password_is_removed_and_libpq_settings_preserved(self):
        payload = module.connection_input('postgresql://user:p%40ss@host/db?schema=public&sslmode=require&connect_timeout=7')
        self.assertEqual(payload, b'p@ss\npostgresql://user@host/db?sslmode=require&connect_timeout=7\n')

    def test_query_password_is_removed(self):
        self.assertEqual(module.connection_input('postgres://user@host/db?password=p%26ss'), b'p&ss\npostgres://user@host/db\n')

    def test_ambiguous_passwords_and_newlines_fail(self):
        for url in ('postgres://u:p@host/db?password=q', 'postgres://u:p%0Ass@host/db', 'postgres://u:p\tss@host/db'):
            with self.assertRaises(ValueError):
                module.connection_input(url)

    def test_database_child_keeps_lock_after_helper_is_killed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock = root / 'lock'
            child_pid = root / 'child.pid'
            release = root / 'release'
            child_released = False
            docker = root / 'docker'
            docker.write_text('#!/usr/bin/env python3\nimport os,time\nfrom pathlib import Path\nPath(os.environ["CHILD_PID"]).write_text(str(os.getpid()))\nwhile not Path(os.environ["CHILD_RELEASE"]).exists(): time.sleep(0.02)\n')
            docker.chmod(0o755)
            launch = 'exec 9>"$1"; python3 -c \'import fcntl; fcntl.flock(9, fcntl.LOCK_EX)\'; exec python3 "$2" size'
            process = subprocess.Popen(['bash', '-c', launch, 'bash', str(lock), str(HELPER)], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                       env={**os.environ, 'PATH': directory + os.pathsep + os.environ['PATH'], 'CHILD_PID': str(child_pid), 'CHILD_RELEASE': str(release)})
            try:
                process.stdin.write(b'postgresql://fixture@localhost/db\n')
                process.stdin.close()
                deadline = time.monotonic() + 10
                while not child_pid.exists() and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(child_pid.exists(), 'Database child did not start')
                process.kill()
                process.wait(timeout=5)
                with lock.open('w') as stream:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    release.touch()
                    deadline = time.monotonic() + 10
                    while True:
                        try:
                            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                            child_released = True
                            break
                        except BlockingIOError:
                            if time.monotonic() >= deadline:
                                self.fail('Lock remained held after database child exited')
                            time.sleep(0.02)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=5)
                if child_pid.exists() and not child_released:
                    try:
                        os.kill(int(child_pid.read_text()), signal.SIGKILL)
                    except ProcessLookupError:
                        pass


@unittest.skipUnless(os.environ.get('SOTTO_TEST_POSTGRES') == '1', 'Set SOTTO_TEST_POSTGRES=1 for disposable Docker PostgreSQL integration')
class PostgreSQLTests(unittest.TestCase):
    def test_uri_credentials_size_and_custom_dump_restore(self):
        name = 'sotto-backup-test-' + uuid.uuid4().hex[:10]
        password = 'fixture:p@ss/word'
        environment = {**os.environ, 'POSTGRES_PASSWORD': password}
        subprocess.run(['docker', 'run', '-d', '--name', name, '--network', 'none', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER=fixture', '-e', 'POSTGRES_DB=fixture', 'postgres:17-alpine'], env=environment, check=True, capture_output=True)
        try:
            for _ in range(60):
                # Initialization uses a temporary socket-only server that stops
                # before the permanent server begins accepting TCP connections.
                ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'fixture', '-d', 'fixture'], capture_output=True)
                if ready.returncode == 0:
                    break
                time.sleep(1)
            else:
                logs = subprocess.run(['docker', 'logs', name], capture_output=True)
                self.fail('PostgreSQL did not become ready:\n' + (logs.stdout + logs.stderr).decode(errors='replace'))
            subprocess.run(['docker', 'exec', name, 'psql', '-U', 'fixture', '-d', 'fixture', '-c', "CREATE TABLE saved(value text); INSERT INTO saved VALUES ('retained');"], check=True, capture_output=True)
            url = b'postgresql://fixture:fixture%3Ap%40ss%2Fword@127.0.0.1:5432/fixture?schema=public&sslmode=disable&connect_timeout=3\n'
            size = subprocess.run(['python3', str(HELPER), 'size', '--container', name], input=url, capture_output=True, check=True)
            self.assertGreater(int(size.stdout), 0)
            dump = subprocess.run(['python3', str(HELPER), 'dump', '--container', name], input=url, capture_output=True, check=True)
            self.assertTrue(dump.stdout.startswith(b'PGDMP'))
            subprocess.run(['docker', 'exec', name, 'createdb', '-U', 'fixture', 'restored'], check=True, capture_output=True)
            subprocess.run(['docker', 'exec', '-i', name, 'pg_restore', '-U', 'fixture', '-d', 'restored'], input=dump.stdout, check=True, capture_output=True)
            result = subprocess.run(['docker', 'exec', name, 'psql', '-U', 'fixture', '-d', 'restored', '-Atc', 'SELECT value FROM saved'], check=True, capture_output=True)
            self.assertEqual(result.stdout.strip(), b'retained')
        except subprocess.CalledProcessError as error:
            self.fail(f'{error}\n{(error.stderr or b"").decode(errors="replace")}')
        finally:
            subprocess.run(['docker', 'rm', '-f', name], check=True, capture_output=True)


if __name__ == '__main__':
    unittest.main()
