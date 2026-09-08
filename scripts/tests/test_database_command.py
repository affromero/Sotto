"""Connection handling and opt-in real PostgreSQL backup verification."""

import importlib.util
import os
from pathlib import Path
import subprocess
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


@unittest.skipUnless(os.environ.get('SOTTO_TEST_POSTGRES') == '1', 'Set SOTTO_TEST_POSTGRES=1 for disposable Docker PostgreSQL integration')
class PostgreSQLTests(unittest.TestCase):
    def test_uri_credentials_size_and_custom_dump_restore(self):
        name = 'sotto-backup-test-' + uuid.uuid4().hex[:10]
        password = 'fixture:p@ss/word'
        environment = {**os.environ, 'POSTGRES_PASSWORD': password}
        subprocess.run(['docker', 'run', '-d', '--name', name, '--network', 'none', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER=fixture', '-e', 'POSTGRES_DB=fixture', 'postgres:17-alpine'], env=environment, check=True, capture_output=True)
        try:
            for _ in range(60):
                ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'fixture'], capture_output=True)
                if ready.returncode == 0:
                    break
                time.sleep(1)
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
        finally:
            subprocess.run(['docker', 'rm', '-f', name], check=True, capture_output=True)


if __name__ == '__main__':
    unittest.main()
