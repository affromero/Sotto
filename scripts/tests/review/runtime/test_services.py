"""Retain one server Codex home through handover and forward recovery."""

from __future__ import annotations

import base64
import copy
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import uuid
from collections.abc import Sequence
from pathlib import Path
from typing import BinaryIO, cast
from unittest.mock import patch
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from scripts.deploy.images.metadata import record
from scripts.deploy.review.runtime.operations import HostOperations
from scripts.deploy.review.runtime.services import (
    PRESERVATION_OBSERVER,
    handover_auth,
    private_inputs,
    stream_backup,
    validate_created_candidate,
    verify_backups,
    verify_database_backup,
)
from scripts.deploy.review.state import Attempt, DeploymentLock, atomic_json
from scripts.deploy.review.topology import AUTH_HOME, DIRECTORY, NETWORK
from scripts.tests.review.runtime import admitted_runtime_fixture


class AuthHandoverTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.root.chmod(0o700)
        self.review = self.root / 'review'
        self.review.mkdir(mode=0o700)
        self.target = self.review / 'auth/codex'
        path = self.root / 'fixture.lock'
        path.touch(mode=0o600)
        self.lock = DeploymentLock(path)
        self.addCleanup(self.lock.close)
        self.auth = json.dumps({'auth_mode': 'chatgpt',
                                'fixtureSession': 'isolated'}).encode()
        self.inputs = {
            'auth': {
                'auth.json': base64.b64encode(self.auth).decode(),
                'config.toml': base64.b64encode(
                    b'cli_auth_credentials_store="file"\n',
                ).decode(),
            },
            'readiness': {'endpoint': 'http://127.0.0.1:3000',
                          'householdPassword': 'fixture password',
                          'credentialValues': {'apiKey': 'fixture key'}},
            'workloads': {'endpoint': 'http://127.0.0.1:3000'},
        }
        self.raw = json.dumps(self.inputs).encode()
        attempt = Attempt.create(self.root, 'fixture', {
            'runtimeUid': os.geteuid(), 'runtimeGid': os.getegid(),
            'inputsSha256': hashlib.sha256(self.raw).hexdigest(),
        }, 'a' * 64)
        self.operations = HostOperations(attempt, self.lock)
        self.operations.private_file(attempt.directory / 'inputs.json',
                                     self.raw)
        for target, value in (
            ('scripts.deploy.review.runtime.services.DIRECTORY',
             str(self.review)),
            ('scripts.deploy.review.runtime.operations.HostOperations.'
             'verify_fence', lambda _: None),
            ('scripts.deploy.review.runtime.operations.HostOperations.'
             'verify_egress', lambda _: None),
        ):
            boundary = patch(target, value)
            boundary.start()
            self.addCleanup(boundary.stop)

    def test_recovery_preserves_server_rotated_session(self) -> None:
        handover_auth(self.operations)
        self.assertEqual((self.target / 'auth.json').read_bytes(), self.auth)
        rotated = b'{"auth_mode":"chatgpt","fixtureSession":"refreshed"}'
        (self.target / 'auth.json').write_bytes(rotated)
        handover_auth(self.operations)
        self.assertEqual((self.target / 'auth.json').read_bytes(), rotated)
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.target / 'auth.json').stat().st_mode & 0o777,
                         0o600)
        receipt = json.loads((self.operations.attempt.directory
                              / 'auth-handover.json').read_text())
        self.assertTrue(receipt['localRefreshForbiddenAfterHandover'])

    def test_recovery_finishes_the_same_durably_recorded_directory(
        self,
    ) -> None:
        with patch.object(Path, 'rename', side_effect=OSError('fixture loss')):
            with self.assertRaisesRegex(OSError, 'fixture loss'):
                handover_auth(self.operations)
        receipt = self.operations.attempt.directory / 'auth-handover.json'
        self.assertTrue(receipt.exists())
        self.assertFalse(self.target.exists())
        handover_auth(self.operations)
        self.assertEqual((self.target / 'auth.json').read_bytes(), self.auth)
        self.assertEqual(list(self.target.parent.glob('codex-*')), [])

    def test_unknown_existing_home_and_changed_private_inputs_refuse(
        self,
    ) -> None:
        self.target.mkdir(mode=0o700, parents=True)
        unknown = self.target / 'auth.json'
        unknown.write_bytes(b'unknown existing session')
        with self.assertRaisesRegex(ValueError, 'unknown-existing'):
            handover_auth(self.operations)
        self.assertEqual(unknown.read_bytes(), b'unknown existing session')
        path = self.operations.attempt.directory / 'inputs.json'
        path.write_bytes(b'{"changed":true}')
        with self.assertRaisesRegex(ValueError, 'private-inputs-changed'):
            private_inputs(self.operations)

    def test_consumes_exact_admitted_bytes_when_input_path_is_replaced(
        self,
    ) -> None:
        path = self.operations.attempt.directory / 'inputs.json'
        replacement = path.with_name('replacement.json')
        changed: dict[str, object] = {**self.inputs, 'auth': {
            **record(self.inputs['auth'], 'fixture auth'),
            'auth.json': base64.b64encode(
                b'{"auth_mode":"chatgpt","fixtureSession":"other"}',
            ).decode(),
        }}
        self.operations.private_file(replacement,
                                     json.dumps(changed).encode())
        original_open = os.open
        replaced = False

        def replace_after_open(
            name: str | Path, flags: int, mode: int = 0o777,
            *, dir_fd: int | None = None,
        ) -> int:
            nonlocal replaced
            descriptor = original_open(name, flags, mode, dir_fd=dir_fd)
            if Path(name) == path and not replaced:
                replaced = True
                replacement.replace(path)
            return descriptor

        with patch('os.open', side_effect=replace_after_open):
            observed = private_inputs(self.operations)
        self.assertTrue(replaced)
        self.assertEqual(observed, self.inputs)
        self.assertNotEqual(json.loads(path.read_bytes()), self.inputs)


class BackupStreamTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.root.chmod(0o700)
        path = self.root / 'fixture.lock'
        path.touch(mode=0o600)
        lock = DeploymentLock(path)
        self.addCleanup(lock.close)
        attempt = Attempt.create(self.root, 'backup', {
            'resources': {'backupBudgetBytes': 1_048_576},
        }, 'a'*64)
        self.operations = HostOperations(attempt, lock)

    def test_backup_budget_preserves_partial_output_without_overwriting(
        self,
    ) -> None:
        with self.assertRaisesRegex(ValueError, 'byte-budget'):
            stream_backup(self.operations, 'partial.dump', [
                sys.executable, '-c',
                'import sys;sys.stdout.buffer.write(b"a"*65536)',
            ], limit=32)
        path = self.operations.attempt.directory / 'partial.dump'
        self.assertLessEqual(path.stat().st_size, 32)
        original = path.read_bytes()
        with self.assertRaises(FileExistsError):
            stream_backup(self.operations, 'partial.dump', [
                sys.executable, '-c', 'raise Exception("must not execute")',
            ], limit=32)
        self.assertEqual(path.read_bytes(), original)

    def test_backup_deadline_settles_the_owned_process_and_retains_output(
        self,
    ) -> None:
        pid_file = self.root / 'child-pid'
        with self.assertRaisesRegex(TimeoutError, 'backup-deadline'):
            stream_backup(self.operations, 'slow.dump', [
                sys.executable, '-c',
                'import os,time;from pathlib import Path;'
                'Path('+repr(str(pid_file))+').write_text(str(os.getpid()));'
                'print("partial",flush=True);time.sleep(30)',
            ], limit=1024, timeout=0.2)
        pid = int(pid_file.read_text())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        self.assertEqual((self.operations.attempt.directory
                          / 'slow.dump').read_bytes(), b'partial\n')

    def test_retained_backup_receipt_rechecks_every_file_before_reuse(
        self,
    ) -> None:
        directory = self.operations.attempt.directory / 'backup-complete'
        directory.mkdir(mode=0o700)
        dump = b'fixture-pg-custom-archive'
        self.operations.private_file(directory / 'review.dump', dump)
        archives: dict[str, object] = {'database': {
            'sha256': hashlib.sha256(dump).hexdigest(), 'bytes': len(dump),
        }}
        total = len(dump)
        for name in ('redis', 'storage', 'executions'):
            path = directory / (name+'.tar')
            with tarfile.open(path, 'w') as archive:
                info = tarfile.TarInfo('preserved.txt')
                info.size = len(name)
                archive.addfile(info, io.BytesIO(name.encode()))
            path.chmod(0o600)
            proof = self.operations.verify_archive(path, 1_048_576-total)
            total += cast(int, proof['bytes'])
            archives[name] = proof
        files = {}
        for name in ('compose', 'caddy', 'environment'):
            raw = ('fixture '+name).encode()
            self.operations.private_file(directory / (name+'.backup'), raw)
            files[name] = hashlib.sha256(raw).hexdigest()
            total += len(raw)
        atomic_json(self.operations.attempt.directory / 'backups.json', {
            'directory': directory.name, 'archives': archives,
            'files': files, 'bytes': total, 'databaseArchiveParsed': True,
        })
        verify_backups(self.operations)
        (directory / 'environment.backup').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,
                                    'configuration-backup-changed'):
            verify_backups(self.operations)

    def test_archive_parser_deadline_stops_its_process_and_keeps_diagnostics(
        self,
    ) -> None:
        path = self.operations.attempt.directory / 'fixture.dump'
        path.write_bytes(b'fixture archive')
        pid_file = self.root / 'parser-pid'
        actual_popen = subprocess.Popen

        def parser(
            arguments: Sequence[str], *, stdin: BinaryIO, stderr: BinaryIO,
            stdout: int, pass_fds: tuple[int, ...], start_new_session: bool,
        ) -> subprocess.Popen[bytes]:
            self.assertEqual(list(arguments), [
                'docker', 'exec', '-i', 'owned-postgres', 'pg_restore',
                '--file=/dev/null',
            ])
            process = actual_popen([
                sys.executable, '-c',
                'import os,time;from pathlib import Path;'
                'Path('+repr(str(pid_file))+').write_text(str(os.getpid()));'
                'time.sleep(30)',
            ], stdin=stdin, stdout=stdout, stderr=stderr,
                pass_fds=pass_fds, start_new_session=start_new_session)
            deadline = time.monotonic()+2
            while not pid_file.exists() and time.monotonic() < deadline:
                time.sleep(0.005)
            if not pid_file.exists():
                process.kill()
                process.wait(timeout=2)
                raise TimeoutError('Fixture parser did not become ready')
            return process

        with (patch('scripts.deploy.review.runtime.services.subprocess.Popen',
                    side_effect=parser),
              self.assertRaisesRegex(ValueError, 'archive-verification')):
            verify_database_backup(self.operations, path, 'owned-postgres',
                                   timeout=0.05)
        with self.assertRaises(ProcessLookupError):
            os.kill(int(pid_file.read_text()), 0)
        failures = list(self.operations.attempt.directory.glob(
            'backup-parser-failure-*.json',
        ))
        self.assertEqual(len(failures), 1)
        self.assertEqual(json.loads(failures[0].read_bytes())['exitCode'], 124)


class CandidateAdmissionTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        root.chmod(0o700)
        path = root / 'fixture.lock'
        path.touch(mode=0o600)
        lock = DeploymentLock(path)
        self.addCleanup(lock.close)
        attempt = Attempt.create(root, 'candidate', {
            **admitted_runtime_fixture(), 'topology': {
            'network': {'id': 'review-network'},
            'services': {'web': {'mounts': []}},
        }}, 'a' * 64)
        self.operations = HostOperations(attempt, lock)
        atomic_json(attempt.directory / 'egress.json',
                    {'networkId': 'egress-network'})
        self.image: dict[str, object] = {'Config': {
            'Env': ['IMAGE_DEFAULT=retained'], 'Cmd': ['node', 'server.js'],
            'Entrypoint': ['entrypoint'], 'WorkingDir': '/app',
        }}
        self.desired: dict[str, object] = {
            'container_name': 'admitted', 'user': '1000', 'mem_limit': 123,
            'memswap_limit': 123,
            'command': ['node', '--max-old-space-size=256', 'server.js'],
            'environment': {'NODE_ENV': 'production'},
            'logging': {'driver': 'json-file', 'options': {'max-size': '5m'}},
            'networks': {'review': {'ipv4_address': '172.30.99.10'}},
        }
        self.actual: dict[str, object] = {
            'Name': '/admitted', 'Image': 'admitted-image',
            'Config': {**record(self.image['Config'], 'image'),
                       'Cmd': self.desired['command'],
                       'User': '1000',
                       'Labels': {'io.sotto.review-attempt':
                                  attempt.manifest_hash},
                       'Env': ['IMAGE_DEFAULT=retained',
                               'NODE_ENV=production']},
            'State': {'Running': False, 'Status': 'created', 'Pid': 0,
                      'StartedAt': '0001-01-01T00:00:00Z',
                      'ExitCode': 0, 'OOMKilled': False},
            'HostConfig': {
                'Privileged': False, 'PublishAllPorts': False,
                'ReadonlyRootfs': False, 'NetworkMode': NETWORK,
                'IpcMode': 'private', 'Memory': 123, 'MemorySwap': 123,
                'RestartPolicy': {'Name': 'no', 'MaximumRetryCount': 0},
                'LogConfig': {'Type': 'json-file',
                              'Config': {'max-size': '5m'}},
            },
            'Mounts': [{'Type': 'bind', 'Name': None,
                        'Source': DIRECTORY + '/auth/codex',
                        'Destination': AUTH_HOME, 'RW': True}],
            'NetworkSettings': {'Networks': {
                NETWORK: {'NetworkID': 'review-network',
                          'IPAMConfig': {'IPv4Address': '172.30.99.10'}},
                'sotto-review_egress': {'NetworkID': 'egress-network'},
            }},
        }

    def docker(self, *arguments: str) -> bytes:
        if arguments[:2] == ('image', 'inspect'):
            return json.dumps([self.image]).encode()
        if arguments[:2] == ('network', 'inspect'):
            return json.dumps([
                {'Name': NETWORK, 'Id': 'review-network'},
                {'Name': 'sotto-review_egress', 'Id': 'egress-network'},
            ]).encode()
        raise AssertionError('Unexpected Docker boundary: ' + repr(arguments))

    def test_created_networks_are_admitted_before_endpoint_allocation(
        self,
    ) -> None:
        networks = record(record(self.actual['NetworkSettings'], 'settings')
                          ['Networks'], 'networks')
        for endpoint in networks.values():
            record(endpoint, 'endpoint')['NetworkID'] = ''
            record(endpoint, 'endpoint')['EndpointID'] = ''
        with patch.object(HostOperations, 'docker', side_effect=self.docker):
            validate_created_candidate(self.operations, self.actual,
                                       self.desired,
                                       {'imageId': 'admitted-image'})

    def test_created_networks_reject_changed_live_identity(self) -> None:
        for name in (NETWORK, 'sotto-review_egress'):
            with self.subTest(network=name):
                def changed(*arguments: str) -> bytes:
                    raw = self.docker(*arguments)
                    if arguments[:2] != ('network', 'inspect'):
                        return raw
                    networks = json.loads(raw)
                    for item in networks:
                        if item['Name'] == name:
                            item['Id'] = 'replaced-network'
                    return json.dumps(networks).encode()

                with (patch.object(HostOperations, 'docker',
                                   side_effect=changed),
                      self.assertRaisesRegex(ValueError, 'network-changed')):
                    validate_created_candidate(self.operations, self.actual,
                                               self.desired,
                                               {'imageId': 'admitted-image'})

    def test_lazy_network_ids_require_a_never_started_created_container(
        self,
    ) -> None:
        networks = record(record(self.actual['NetworkSettings'], 'settings')
                          ['Networks'], 'networks')
        record(networks[NETWORK], 'endpoint')['NetworkID'] = ''
        record(networks[NETWORK], 'endpoint')['EndpointID'] = ''
        for key, value in [('Running', True), ('Status', 'exited'),
                           ('Pid', 123), ('StartedAt', '2026-10-25T00:00:00Z'),
                           ('ExitCode', 1), ('OOMKilled', True)]:
            changed = copy.deepcopy(self.actual)
            record(changed['State'], 'state')[key] = value
            with (self.subTest(state=key),
                  patch.object(HostOperations, 'docker', side_effect=self.docker),
                  self.assertRaises(ValueError)):
                validate_created_candidate(self.operations, changed,
                                           self.desired,
                                           {'imageId': 'admitted-image'})

    def test_created_networks_require_two_exact_unique_names(self) -> None:
        review = {'Name': NETWORK, 'Id': 'review-network'}
        egress = {'Name': 'sotto-review_egress', 'Id': 'egress-network'}
        for networks in ([review], [review, review],
                         [review, {**egress, 'Name': 'unexpected-network'}],
                         [review, egress, egress]):
            def changed(*arguments: str) -> bytes:
                if arguments[:2] == ('network', 'inspect'):
                    return json.dumps(networks).encode()
                return self.docker(*arguments)

            with (self.subTest(networks=networks),
                  patch.object(HostOperations, 'docker', side_effect=changed),
                  self.assertRaisesRegex(ValueError, 'network-changed')):
                validate_created_candidate(self.operations, self.actual,
                                           self.desired,
                                           {'imageId': 'admitted-image'})

    def test_created_networks_reject_an_incorrect_configured_identity(
        self,
    ) -> None:
        for name in (NETWORK, 'sotto-review_egress'):
            changed = copy.deepcopy(self.actual)
            networks = record(record(changed['NetworkSettings'], 'settings')
                              ['Networks'], 'networks')
            record(networks[name], 'endpoint')['NetworkID'] = 'other-network'
            with (self.subTest(network=name),
                  patch.object(HostOperations, 'docker', side_effect=self.docker),
                  self.assertRaisesRegex(ValueError, 'address-changed')):
                validate_created_candidate(self.operations, changed,
                                           self.desired,
                                           {'imageId': 'admitted-image'})

    def test_lazy_network_id_rejects_an_existing_endpoint(self) -> None:
        for name in (NETWORK, 'sotto-review_egress'):
            changed = copy.deepcopy(self.actual)
            selected = record(record(changed['NetworkSettings'], 'settings')
                              ['Networks'], 'networks')
            record(selected[name], 'endpoint')['NetworkID'] = ''
            record(selected[name], 'endpoint')['EndpointID'] = 'allocated-endpoint'
            with (self.subTest(network=name),
                  patch.object(HostOperations, 'docker', side_effect=self.docker),
                  self.assertRaisesRegex(ValueError, 'address-changed')):
                validate_created_candidate(self.operations, changed,
                                           self.desired,
                                           {'imageId': 'admitted-image'})

    def test_unknown_candidate_cannot_adopt_changed_command_host_or_network(
        self,
    ) -> None:
        cases = [('Config', 'Cmd', ['malicious']),
                 ('HostConfig', 'MemorySwap', 0),
                 ('HostConfig', 'Memory', 999),
                 ('HostConfig', 'CapAdd', ['SYS_ADMIN']),
                 ('Config', 'Env', ['NODE_ENV=production'])]
        with patch.object(HostOperations, 'docker', side_effect=self.docker):
            validate_created_candidate(self.operations, self.actual,
                                       self.desired,
                                       {'imageId': 'admitted-image'})
            for section, name, value in cases:
                changed = copy.deepcopy(self.actual)
                record(changed[section], 'fixture')[name] = value
                with self.subTest(field=name), self.assertRaises(ValueError):
                    validate_created_candidate(self.operations, changed,
                                               self.desired,
                                               {'imageId': 'admitted-image'})
            changed = copy.deepcopy(self.actual)
            networks = record(record(changed['NetworkSettings'], 'settings')
                              ['Networks'], 'networks')
            record(networks['sotto-review_egress'], 'egress')['NetworkID'] = \
                'recreated-network'
            with self.assertRaisesRegex(ValueError, 'address-changed'):
                validate_created_candidate(self.operations, changed,
                                           self.desired,
                                           {'imageId': 'admitted-image'})


@unittest.skipUnless(
    os.environ.get('SOTTO_REVIEW_OBSERVER_INTEGRATION') == '1',
    'Requires the explicitly selected disposable PostgreSQL fixture',
)
class ProtectedDataTests(unittest.TestCase):
    def setUp(self) -> None:
        url = urlsplit(os.environ['DATABASE_URL'])
        if (url.hostname not in {'localhost', '127.0.0.1'}
                or url.port != 56462 or url.path != '/sidedoor_test'):
            raise ValueError('owned-loopback-PostgreSQL-fixture-required')
        self.schema = 'review_preservation_' + uuid.uuid4().hex
        query = dict(parse_qsl(url.query))
        query['options'] = '-c search_path=' + self.schema
        self.environment = {**os.environ, 'DATABASE_URL': urlunsplit(
            url._replace(query=urlencode(query)),
        )}
        self.sql('CREATE SCHEMA "' + self.schema + '"')
        self.addCleanup(self.sql, 'DROP SCHEMA "' + self.schema + '" CASCADE')
        self.sql('''CREATE TABLE "User" (id text PRIMARY KEY, token text);
INSERT INTO "User" VALUES ('owner','fixture-owner-credential'),
('member','fixture-member-credential');
CREATE TABLE "SidedoorState" (id text PRIMARY KEY, state jsonb);
INSERT INTO "SidedoorState" VALUES
('sotto-platform-v2','{"householdProfiles":["owner","member"]}');''')

    def node(
        self, script: str, content: object,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ['node', '-e', script], input=json.dumps(content), text=True,
            capture_output=True, check=False, timeout=70,
            env=self.environment,
        )

    def sql(self, sql: str) -> None:
        script = '''const {Client}=require('pg');
const fs=require('node:fs');
const c=new Client({connectionString:process.env.DATABASE_URL});
(async()=>{await c.connect();try{
 await c.query(JSON.parse(fs.readFileSync(0)));
}finally{await c.end();}})().catch(e=>{
 console.error(e.message);process.exitCode=1;
});
'''
        result = self.node(script, sql)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_original_columns_survive_additions_and_changed_profile_is_seen(
        self,
    ) -> None:
        initial = self.node(PRESERVATION_OBSERVER, None)
        self.assertEqual(initial.returncode, 0,
                         initial.stdout + initial.stderr)
        self.assertNotIn('fixture-owner-credential', initial.stdout)
        snapshot = json.loads(initial.stdout)
        columns = [{'table': item['table'], 'columns': item['columns']}
                   for item in snapshot['tables']]
        self.sql('''ALTER TABLE "User" ADD COLUMN added text DEFAULT 'new';
CREATE TABLE "NewMigrationTable" (id text);
INSERT INTO "NewMigrationTable" VALUES ('migration bookkeeping');''')
        observed = self.node(PRESERVATION_OBSERVER, columns)
        self.assertEqual(observed.returncode, 0,
                         observed.stdout + observed.stderr)
        self.assertEqual(json.loads(observed.stdout), snapshot)
        self.sql('UPDATE "User" SET token=\'changed\' WHERE id=\'member\'')
        changed = self.node(PRESERVATION_OBSERVER, columns)
        self.assertEqual(changed.returncode, 0, changed.stderr)
        self.assertNotEqual(json.loads(changed.stdout), snapshot)

    def test_untrusted_identifiers_and_oversized_rows_fail_without_output(
        self,
    ) -> None:
        invalid = self.node(PRESERVATION_OBSERVER, [{
            'table': 'User; DROP TABLE "User"', 'columns': ['id'],
        }])
        self.assertNotEqual(invalid.returncode, 0)
        self.assertEqual(invalid.stdout, '')
        self.assertEqual(invalid.stderr,
                         'Review preservation observation refused\n')
        self.sql('UPDATE "User" SET token=repeat(\'x\',262145) '
                 'WHERE id=\'member\'')
        oversized = self.node(PRESERVATION_OBSERVER, None)
        self.assertNotEqual(oversized.returncode, 0)
        self.assertEqual(oversized.stdout, '')
        self.assertEqual(oversized.stderr,
                         'Review preservation observation refused\n')
