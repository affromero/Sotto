"""Exercise clean production setup with disposable Docker and HTTP boundaries."""

import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.parse import quote

from scripts.tests.test_deploy_script import BOUNDARY, SHA, serving_fixture


BOOTSTRAP_BOUNDARY = r'''
import json, os, pathlib, sys, time
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['TEST_ROOT'])
state_path = root / 'state.json'
state = json.loads(state_path.read_text())
marker = root / '.local/state/sotto-deploy/unresolved.json'

def persist():
    pending = state_path.with_suffix('.next')
    pending.write_text(json.dumps(state))
    pending.replace(state_path)

def done(value='', code=0):
    persist()
    if value: print(value)
    sys.exit(code)

def record():
    with (root / 'calls.jsonl').open('a') as stream:
        stream.write(json.dumps([name, *args]) + '\n')

def barrier(stage):
    if os.environ.get('TEST_BOOTSTRAP_STOP') == stage:
        (root / 'reached-stage').write_text(stage)
        while True: time.sleep(1)

if name == 'docker' and args[:1] == ['info']:
    record()
    done('fixture-docker-daemon')
if name == 'docker' and args[:2] == ['volume', 'ls']:
    record()
    done('\n'.join(state['volumes']))
if name == 'docker' and args[:2] == ['volume', 'inspect']:
    record()
    volume = state['volumes'].get(args[-1])
    if volume is None: done(code=1)
    done(json.dumps([volume]))
if name == 'docker' and args[:2] == ['volume', 'create']:
    record()
    state['marker_missing_at_mutation'] |= not marker.is_file()
    volume_name = args[-1]
    if os.environ.get('TEST_BOOTSTRAP_RACE_VOLUME') == volume_name:
        state['volumes'][volume_name] = {'Name': volume_name, 'Driver': 'local',
            'Labels': {'owner': 'other'}, 'Options': {},
            'Mountpoint': str(root / 'volumes' / volume_name)}
        destination = root / 'volumes' / volume_name
        destination.mkdir(parents=True, exist_ok=True)
        (destination / 'existing-data').write_bytes(b'preserve racing volume')
    labels = {}
    for index, arg in enumerate(args[:-1]):
        if arg == '--label':
            key, _, value = args[index + 1].partition('=')
            labels[key] = value
    state['volumes'].setdefault(volume_name, {'Name': volume_name, 'Driver': 'local',
        'Labels': labels, 'Options': {}, 'Mountpoint': str(root / 'volumes' / volume_name)})
    (root / 'volumes' / volume_name).mkdir(parents=True, exist_ok=True)
    persist()
    barrier('volume')
    done(volume_name)
if name == 'docker' and args[:2] == ['network', 'ls']:
    record()
    done('\n'.join(state['networks']))
if name == 'docker' and args[:2] == ['network', 'inspect']:
    record()
    network = state['networks'].get(args[-1])
    if network is None: done(code=1)
    done(json.dumps([network]))
if name == 'docker' and args[:2] == ['network', 'create']:
    record()
    state['marker_missing_at_mutation'] |= not marker.is_file()
    network_name = args[-1]
    state['networks'][network_name] = {'Name': network_name, 'Id': '9' * 64,
        'Driver': 'bridge', 'Containers': {}, 'Labels': {}}
    persist()
    barrier('network')
    done('9' * 64)
if name == 'docker' and args[0] == 'inspect' and args[1:] == [
        'sotto-prod-postgres', 'sotto-prod-redis', 'sotto-prod-pgbouncer', 'sotto-prod-pinchtab']:
    record()
    done(json.dumps(state['infrastructure']))
if name == 'docker' and args[0] == 'ps' and not any('compose.service=' in arg for arg in args):
    if not state['worker_ids']:
        record()
        done('\n'.join(state['existing_containers']))
if (name == 'docker' and args[0] == 'compose' and 'docker-compose.infra.yml' in args
        and 'exec' in args and ('-p' not in args or args[args.index('-p') + 1] != 'sotto')):
    record()
    done(code=1)
if name == 'docker' and args[0] == 'compose' and 'up' in args:
    state['marker_missing_at_mutation'] |= not marker.is_file()
    persist()
    if 'docker-compose.infra.yml' in args:
        record()
        services = ('postgres', 'redis', 'pgbouncer', 'pinchtab')
        ids = {service: str(index + 1) * 64 for index, service in enumerate(services)}
        state['networks']['sotto-network'] = {'Name': 'sotto-network', 'Id': '9' * 64,
            'Driver': 'bridge', 'Containers': {identifier: {} for identifier in ids.values()}, 'Labels': {}}
        image_names = {'postgres': 'pgvector/pgvector:pg17', 'redis': 'redis:7-alpine',
            'pgbouncer': 'edoburu/pgbouncer:v1.23.1-p3', 'pinchtab': 'pinchtab/pinchtab'}
        state['infrastructure'] = [{
            'Name': '/sotto-prod-' + service, 'Id': identifier,
            'Image': 'sha256:' + 'c' * 64, 'Config': {'Image': image_names[service]},
            'State': {'Running': True, 'OOMKilled': False},
            'NetworkSettings': {'Networks': {'sotto-network': {'NetworkID': '9' * 64,
                'Aliases': [service], 'IPAddress': '127.0.0.1'}}},
            'Mounts': ([{'Type': 'volume', 'Name': 'sotto_postgres_data',
                         'Destination': '/var/lib/postgresql/data', 'RW': True}] if service == 'postgres' else
                [{'Type': 'volume', 'Name': 'sotto_sotto_redis_data',
                  'Destination': '/data', 'RW': True}] if service == 'redis' else []),
        } for service, identifier in ids.items()]
        defect = os.environ.get('TEST_BOOTSTRAP_BAD_INFRA', '')
        for row in state['infrastructure']:
            service = row['Name'].removeprefix('/sotto-prod-')
            if defect == service + '-destination': row['Mounts'][0]['Destination'] = '/wrong'
            if defect == service + '-readonly': row['Mounts'][0]['RW'] = False
            if defect == service + '-duplicate': row['Mounts'].append(dict(row['Mounts'][0]))
            if defect == service + '-overlap': row['Mounts'].append({
                'Type': 'bind', 'Source': '/other',
                'Destination': row['Mounts'][0]['Destination'] + '/nested', 'RW': True})
            if defect == service + '-image': row['Image'] = 'sha256:' + 'd' * 64
        persist()
        barrier('infrastructure')
        done()
    if '-p' in args and args[args.index('-p') + 1] == 'sotto' and 'credential-sync' not in args:
        record()
        state['workers'] = 'sha256:' + 'c' * 64
        for index, service in enumerate(('workers-heavy', 'workers-pipeline', 'workers-light')):
            identifier = str(index + 6) * 64
            state['worker_ids'][service] = identifier
            state['running'][identifier] = True
        done()
    if ('-p' in args and args[args.index('-p') + 1] == 'sotto-blue'
            and os.environ.get('TEST_BOOTSTRAP_CADDY_APPEARS')):
        (root / 'caddy.conf').write_bytes(b'other site appeared during setup\n')
if name == 'docker' and args[0] == 'compose' and 'migrate' in args and 'deploy' in args:
    state['marker_missing_at_mutation'] |= not marker.is_file()
    persist()
    barrier('migration')
if name == 'docker' and args[0] == 'exec' and 'pg_catalog.pg_class' in args[-1]:
    record()
    done('0')
if name == 'docker' and args[0] == 'exec' and 'DBSIZE' in args[-1]:
    record()
    done('0')
if name == 'sudo' and args[:2] == ['caddy', 'reload']:
    state['marker_missing_at_mutation'] |= not marker.is_file()
    persist()
    barrier('routing')
if name == 'curl' and state.get('active_route') == 'candidate':
    if (os.environ.get('TEST_BOOTSTRAP_TAMPER_MARKER') and marker.exists()
            and (root / '.sotto-deploy-slot').exists() and not state.get('marker_tampered')):
        altered = json.loads(marker.read_text())
        altered['stack'] = 'another-stack'
        marker.write_text(json.dumps(altered))
        state['marker_tampered'] = True
        persist()
    barrier('post-route')
'''


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        source = Path(__file__).parents[3]
        shutil.copytree(source / 'scripts/deploy', self.root / 'scripts/deploy')
        for name in ('deploy.sh', 'smoke-prod.sh'):
            shutil.copyfile(source / 'scripts' / name, self.root / 'scripts' / name)
        shutil.copyfile(source / 'Caddyfile', self.root / 'Caddyfile')
        (self.root / 'calls.jsonl').write_text('')
        (self.root / 'volumes').mkdir()
        self.state = {'capacity': 0, 'pulled': False, 'web': None, 'old_web': None,
            'workers': None, 'public_health': [], 'verified_workers': [],
            'premature_route': False, 'active_route': 'old', 'old_slot': 'none',
            'new_slot': 'blue', 'candidate_port': 3000, 'running': {}, 'worker_ids': {},
            'queue_flags': {}, 'active': 0, 'journal_pending': False, 'unsafe_stops': [],
            'unsafe_starts': [], 'stopped': [], 'worker_generation': 'none',
            'volumes': {}, 'networks': {}, 'infrastructure': [], 'existing_containers': [],
            'marker_missing_at_mutation': False}
        self.write_state()
        binaries = self.root / 'bin'
        binaries.mkdir()
        for name in ('git', 'docker', 'sudo', 'curl', 'sleep', 'flock', 'capacity', 'sha256sum'):
            path = binaries / name
            boundary = BOUNDARY.replace("'serverAddress': '127.0.0.1'",
                "'serverAddress': os.environ.get('TEST_BOOTSTRAP_DB_ADDRESS', '127.0.0.1/32')")
            path.write_text('#!' + sys.executable + '\n' + BOOTSTRAP_BOUNDARY + boundary)
            path.chmod(0o755)
        self.environment = dict(os.environ, HOME=str(self.root), TEST_ROOT=str(self.root),
            TEST_FAILURE='bootstrap-clean', PATH=str(binaries) + os.pathsep + os.environ['PATH'],
            TMPDIR=str(self.root), SOTTO_ENV_FILE=str(self.root / '.env.production'),
            PRODUCTION_DEPLOY_LOCK=str(self.root / 'deploy.lock'),
            PRODUCTION_CAPACITY_CHECKER=str(binaries / 'capacity'))
        for name in ('SOTTO_COMPATIBILITY_REVIEW_FILE', 'SOTTO_COMPATIBILITY_EVIDENCE_FILE'):
            self.environment.pop(name, None)
        self.values = {'NEXT_PUBLIC_APP_URL': 'https://fixture.example', 'SELF_HOSTED': 'false',
            'BYOK_ENCRYPTION_KEY': '0' * 32, 'SOTTO_STACK': 'sotto',
            'POSTGRES_USER': 'sotto', 'POSTGRES_DB': 'sotto', 'POSTGRES_PASSWORD': 'fixture-postgres',
            'REDIS_PASSWORD': 'fixture-redis', 'SOTTO_RELEASE_SHA': SHA,
            'DATABASE_URL': 'postgresql://sotto:fixture-postgres@pgbouncer:5432/sotto?pgbouncer=true',
            'DIRECT_DATABASE_URL': 'postgresql://sotto:fixture-postgres@postgres:5432/sotto',
            'REDIS_URL': 'redis://:fixture-redis@redis:6379',
            'SOTTO_WEB_IMAGE_REF': 'fixture/web@sha256:' + 'c' * 64,
            'SOTTO_WORKERS_IMAGE_REF': 'fixture/workers@sha256:' + 'c' * 64,
            'SOTTO_BACKUP_DIR': str(self.root / 'backups'),
            'PRODUCTION_IMAGE_RETENTION_DIR': str(self.root / 'retention'),
            'CADDY_SITE_PATH': str(self.root / 'caddy.conf'),
            **{name: '1048576' for name in ('SOTTO_WEB_IMAGE_BYTES', 'SOTTO_WEB_TRANSFER_BYTES',
                'SOTTO_WORKERS_IMAGE_BYTES', 'SOTTO_WORKERS_TRANSFER_BYTES', 'SOTTO_BACKUP_BYTES')}}

    def write_state(self):
        (self.root / 'state.json').write_text(json.dumps(self.state))

    def run_bootstrap(self, *, stop=None, blocked_failure=False):
        (self.root / '.env.production').write_text(''.join(
            key + '=' + shlex.quote(value) + '\n' for key, value in self.values.items()))
        environment = dict(self.environment)
        if stop: environment['TEST_BOOTSTRAP_STOP'] = stop
        with serving_fixture(self.root) as (ports, _, _):
            environment.update(ports)
            command = ['bash', str(self.root / 'scripts/deploy.sh'), '--bootstrap-clean-primary']
            if stop is None and not blocked_failure:
                result = subprocess.run(command, env=environment, text=True, capture_output=True, timeout=60)
                return result.returncode, result.stdout + result.stderr
            log = self.root / 'controller.log'
            with log.open('w') as output:
                process = subprocess.Popen(command, env=environment, stdout=output,
                    stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    deadline = time.monotonic() + 45
                    while process.poll() is None and time.monotonic() < deadline:
                        if stop and (self.root / 'reached-stage').exists(): break
                        if blocked_failure and 'Unresolved deployment.' in log.read_text(): break
                        time.sleep(0.02)
                    if stop: self.assertTrue((self.root / 'reached-stage').exists(), log.read_text())
                    if blocked_failure: self.assertIn('Unresolved deployment.', log.read_text())
                    self.assertIsNone(process.poll(), log.read_text())
                finally:
                    if process.poll() is None: os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)
            return process.returncode, log.read_text()

    def calls(self):
        return [json.loads(line) for line in (self.root / 'calls.jsonl').read_text().splitlines()]

    def test_clean_primary_starts_with_fresh_data_and_a_durable_slot(self):
        status, output = self.run_bootstrap()
        self.assertEqual(status, 0, output)
        state = json.loads((self.root / 'state.json').read_text())
        self.assertEqual(state['web'], 'sha256:' + 'c' * 64, output)
        self.assertEqual(state['workers'], 'sha256:' + 'c' * 64, output)
        self.assertEqual(state['active_route'], 'candidate', output)
        self.assertFalse(state['marker_missing_at_mutation'], output)
        self.assertEqual((self.root / '.sotto-deploy-slot').read_text(), 'blue\n')
        self.assertFalse((self.root / '.local/state/sotto-deploy/unresolved.json').exists())
        self.assertTrue(any('initialize' in call and 'dist/access.cjs' in call for call in self.calls()), output)
        self.assertTrue(any('finalize' in call and 'dist/access.cjs' in call for call in self.calls()), output)

    def test_inherited_compose_project_cannot_redirect_bootstrap_infrastructure(self):
        self.environment['COMPOSE_PROJECT_NAME'] = 'unrelated-project'
        status, output = self.run_bootstrap()
        self.assertEqual(status, 0, output)
        infrastructure = [call for call in self.calls() if call[:2] == ['docker', 'compose']
                          and 'docker-compose.infra.yml' in call and ('up' in call or 'exec' in call)]
        self.assertTrue(infrastructure, output)
        for call in infrastructure:
            self.assertIn('-p', call, output)
            self.assertEqual(call[call.index('-p') + 1], 'sotto', output)

    def test_unrelated_pythonpath_package_cannot_replace_the_marker_helper(self):
        foreign = self.root / 'foreign-pythonpath'
        package = foreign / 'scripts/deploy'
        package.mkdir(parents=True)
        (foreign / 'scripts/__init__.py').write_text('')
        (package / '__init__.py').write_text('')
        (package / 'compatibility-review.py').write_text(
            'raise RuntimeError("unrelated marker helper was loaded")\n')
        self.environment['PYTHONPATH'] = str(foreign)
        status, output = self.run_bootstrap()
        self.assertEqual(status, 0, output)
        self.assertNotIn('unrelated marker helper was loaded', output)
        self.assertEqual((self.root / '.sotto-deploy-slot').read_text(), 'blue\n')
        self.assertFalse((self.root / '.local/state/sotto-deploy/unresolved.json').exists())

    def test_preexisting_database_or_redis_volume_is_never_adopted(self):
        for name in ('sotto_postgres_data', 'sotto_sotto_redis_data'):
            with self.subTest(volume=name), tempfile.TemporaryDirectory() as directory:
                self.state['volumes'] = {name: {'Name': name, 'Driver': 'local', 'Labels': {},
                    'Options': {}, 'Mountpoint': directory}}
                sentinel = Path(directory) / 'existing-data'
                sentinel.write_bytes(b'preserve database or queued work')
                self.write_state()
                status, output = self.run_bootstrap()
                self.assertNotEqual(status, 0, output)
                self.assertNotIn('deployment slot is missing', output)
                self.assertEqual(sentinel.read_bytes(), b'preserve database or queued work')
                self.assertFalse(any(call[:3] == ['docker', 'volume', 'create'] for call in self.calls()), output)
                self.assertFalse(any(call[0] == 'docker' and 'up' in call for call in self.calls()), output)

    def test_unrelated_database_and_redis_endpoints_are_rejected(self):
        for name, value in (('DATABASE_URL', 'postgresql://sotto:fixture-postgres@another:5432/sotto'),
                            ('DIRECT_DATABASE_URL', 'postgresql://sotto:fixture-postgres@another:5432/sotto'),
                            ('REDIS_URL', 'redis://:fixture-redis@another:6379')):
            with self.subTest(variable=name):
                original = self.values[name]
                self.values[name] = value
                status, output = self.run_bootstrap()
                self.values[name] = original
                self.assertNotEqual(status, 0, output)
                self.assertNotIn('deployment slot is missing', output)
                self.assertFalse(any(call[0] == 'docker' and ('up' in call or 'create' in call)
                                     for call in self.calls()), output)
                self.assertFalse((self.root / 'caddy.conf').exists(), output)

    def test_ambiguous_database_routing_options_are_rejected(self):
        self.values['DIRECT_DATABASE_URL'] += '?hostaddr=127.0.0.1'
        status, output = self.run_bootstrap()
        self.assertNotEqual(status, 0, output)
        self.assertNotIn('deployment slot is missing', output)
        self.assertFalse(any(call[0] == 'docker' and ('up' in call or 'create' in call)
                             for call in self.calls()), output)

    def test_credentials_with_uri_delimiters_or_whitespace_are_rejected(self):
        original = dict(self.values)
        for variable in ('POSTGRES_PASSWORD', 'REDIS_PASSWORD'):
            for password in ('fixture@secret', 'fixture:secret', 'fixture secret'):
                with self.subTest(variable=variable, password=password):
                    self.values = dict(original)
                    self.values[variable] = password
                    encoded = quote(password, safe='')
                    if variable == 'POSTGRES_PASSWORD':
                        self.values['DATABASE_URL'] = f'postgresql://sotto:{encoded}@pgbouncer:5432/sotto?pgbouncer=true'
                        self.values['DIRECT_DATABASE_URL'] = f'postgresql://sotto:{encoded}@postgres:5432/sotto'
                    else:
                        self.values['REDIS_URL'] = f'redis://:{encoded}@redis:6379'
                    status, output = self.run_bootstrap()
                    self.assertNotEqual(status, 0, output)
                    self.assertIn('credentials are incompatible', output)
                    self.assertNotIn(password, output)
                    self.assertFalse(any(call[0] == 'docker' and ('up' in call or 'create' in call)
                                         for call in self.calls()), output)

    def test_stopped_infrastructure_container_is_preserved(self):
        self.state['existing_containers'] = ['sotto-prod-postgres']
        self.write_state()
        status, output = self.run_bootstrap()
        self.assertNotEqual(status, 0, output)
        state = json.loads((self.root / 'state.json').read_text())
        self.assertEqual(state['existing_containers'], ['sotto-prod-postgres'])
        self.assertFalse(any(call[0] == 'docker' and ('up' in call or 'create' in call)
                             for call in self.calls()), output)

    def test_existing_network_is_preserved(self):
        self.state['networks']['sotto-network'] = {'Name': 'sotto-network', 'Id': '7' * 64,
            'Driver': 'bridge', 'Containers': {}, 'Labels': {'owner': 'existing'}}
        self.write_state()
        status, output = self.run_bootstrap()
        self.assertNotEqual(status, 0, output)
        state = json.loads((self.root / 'state.json').read_text())
        self.assertEqual(state['networks']['sotto-network']['Id'], '7' * 64)
        self.assertFalse(any(call[0] == 'docker' and ('up' in call or 'create' in call)
                             for call in self.calls()), output)

    def test_symlinked_backup_or_retention_directory_is_never_adopted(self):
        outside = self.root / 'other-directory'
        outside.mkdir()
        sentinel = outside / 'existing-data'
        sentinel.write_bytes(b'preserve existing records')
        for name in ('SOTTO_BACKUP_DIR', 'PRODUCTION_IMAGE_RETENTION_DIR'):
            with self.subTest(directory=name):
                target = Path(self.values[name])
                target.symlink_to(outside, target_is_directory=True)
                try:
                    status, output = self.run_bootstrap()
                    self.assertNotEqual(status, 0, output)
                    self.assertEqual(sentinel.read_bytes(), b'preserve existing records')
                    self.assertFalse(any(call[0] == 'docker' and ('up' in call or 'create' in call)
                                         for call in self.calls()), output)
                    self.assertFalse((self.root / 'caddy.conf').exists(), output)
                finally:
                    target.unlink()

    def test_existing_public_route_is_preserved(self):
        target = self.root / 'caddy.conf'
        target.write_bytes(b'existing site configuration\n')
        status, output = self.run_bootstrap()
        self.assertNotEqual(status, 0, output)
        self.assertNotIn('deployment slot is missing', output)
        self.assertEqual(target.read_bytes(), b'existing site configuration\n')
        self.assertFalse(any(call[0] == 'docker' and ('up' in call or 'create' in call)
                             for call in self.calls()), output)

    def test_volume_created_by_another_process_is_not_adopted(self):
        name = 'sotto_postgres_data'
        self.environment['TEST_BOOTSTRAP_RACE_VOLUME'] = name
        status, output = self.run_bootstrap()
        self.assertNotEqual(status, 0, output)
        sentinel = self.root / 'volumes' / name / 'existing-data'
        self.assertEqual(sentinel.read_bytes(), b'preserve racing volume')
        self.assertFalse(any(call[0] == 'docker' and 'up' in call for call in self.calls()), output)

    def test_infrastructure_mount_and_image_changes_are_rejected_before_sql(self):
        for service in ('postgres', 'redis'):
            for defect in ('destination', 'readonly', 'duplicate', 'overlap', 'image'):
                with self.subTest(service=service, defect=defect):
                    self.setUp()
                    try:
                        self.environment['TEST_BOOTSTRAP_BAD_INFRA'] = service + '-' + defect
                        status, output = self.run_bootstrap(blocked_failure=True)
                        self.assertNotEqual(status, 0, output)
                        self.assertIn('Clean bootstrap rejected', output)
                        self.assertTrue((self.root / '.local/state/sotto-deploy/unresolved.json').is_file())
                        self.assertFalse(any(call[0] == 'docker' and 'migrate' in call
                                             for call in self.calls()), output)
                        self.assertFalse((self.root / 'caddy.conf').exists(), output)
                    finally:
                        self.temporary.cleanup()

    def test_different_database_address_is_rejected_before_migration(self):
        self.environment['TEST_BOOTSTRAP_DB_ADDRESS'] = '127.0.0.2/32'
        status, output = self.run_bootstrap(blocked_failure=True)
        self.assertNotEqual(status, 0, output)
        self.assertIn('database endpoints', output)
        self.assertTrue((self.root / '.local/state/sotto-deploy/unresolved.json').is_file())
        self.assertFalse(any(call[0] == 'docker' and 'migrate' in call for call in self.calls()), output)

    def test_public_route_appearing_during_setup_is_preserved(self):
        self.environment['TEST_BOOTSTRAP_CADDY_APPEARS'] = '1'
        status, output = self.run_bootstrap(blocked_failure=True)
        self.assertNotEqual(status, 0, output)
        self.assertEqual((self.root / 'caddy.conf').read_bytes(), b'other site appeared during setup\n')
        self.assertTrue((self.root / '.local/state/sotto-deploy/unresolved.json').is_file())
        self.assertFalse(any(call[:2] == ['sudo', 'install'] for call in self.calls()), output)

    def test_changed_unresolved_marker_is_not_cleared_after_successful_routing(self):
        self.environment['TEST_BOOTSTRAP_TAMPER_MARKER'] = '1'
        status, output = self.run_bootstrap(blocked_failure=True)
        self.assertNotEqual(status, 0, output)
        marker = self.root / '.local/state/sotto-deploy/unresolved.json'
        self.assertEqual(json.loads(marker.read_text())['stack'], 'another-stack')
        self.assertEqual((self.root / '.sotto-deploy-slot').read_text(), 'blue\n')

    def check_interruption(self, stage):
        self.run_bootstrap(stop=stage)
        marker = self.root / '.local/state/sotto-deploy/unresolved.json'
        self.assertTrue(marker.is_file())
        original = marker.read_bytes()
        state = json.loads((self.root / 'state.json').read_text())
        self.assertFalse(state['marker_missing_at_mutation'])
        before = self.calls()
        status, output = self.run_bootstrap()
        self.assertNotEqual(status, 0, output)
        self.assertEqual(marker.read_bytes(), original)
        self.assertFalse(any(call[0] == 'docker' for call in self.calls()[len(before):]), output)

    def test_interruption_during_volume_creation_blocks_retry(self):
        self.check_interruption('volume')

    def test_interruption_during_infrastructure_start_blocks_retry(self):
        self.check_interruption('infrastructure')

    def test_interruption_during_database_migration_blocks_retry(self):
        self.check_interruption('migration')

    def test_interruption_before_public_routing_blocks_retry(self):
        self.check_interruption('routing')

    def test_interruption_after_public_routing_blocks_retry(self):
        self.check_interruption('post-route')


if __name__ == '__main__':
    unittest.main()
