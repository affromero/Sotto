"""Run the deployment controller against disposable filesystem and CLI boundaries."""

import fcntl
import hashlib
import json
import logging
import os
from pathlib import Path
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


SHA = 'a' * 40
OLD = 'sha256:' + 'b' * 64
NEW = 'sha256:' + 'c' * 64
OLD_WEB = '1' * 64
CANDIDATE_WEB = '2' * 64
SERVICES = ('workers-heavy', 'workers-pipeline', 'workers-light')
OLD_WORKERS = {service: str(index + 3) * 64 for index, service in enumerate(SERVICES)}
NEW_WORKERS = {service: str(index + 6) * 64 for index, service in enumerate(SERVICES)}


@contextmanager
def serving_fixture(root):
    """Exercise real HTTP availability while Docker boundaries change state."""
    observations = []
    phase_observations = {}
    stopped = threading.Event()

    class Backend(BaseHTTPRequestHandler):
        def do_GET(self):
            state = json.loads((root / 'state.json').read_text())
            available = state['old_web'] if self.server.role == 'old' else state['web']
            self.send_response(200 if available else 503)
            self.end_headers()
            self.wfile.write(json.dumps({'version': ('d' * 40) if self.server.role == 'old' else SHA}).encode())

        def log_message(self, format, *args):
            logging.getLogger(__name__).debug(format, *args)

    class Proxy(BaseHTTPRequestHandler):
        def do_GET(self):
            try:
                route = json.loads((root / 'state.json').read_text())['active_route']
                if route == 'maintenance':
                    self.send_response(503)
                    self.end_headers()
                    self.wfile.write(b'Sotto schema maintenance')
                    return
                target = candidate if route == 'candidate' else old
                with urlopen(f'http://127.0.0.1:{target.server_port}/api/v1/health', timeout=1) as response:
                    body = response.read()
                    self.send_response(response.status)
                    self.end_headers()
                    self.wfile.write(body)
            except (OSError, HTTPError, URLError) as error:
                self.send_response(503)
                self.end_headers()
                self.wfile.write(str(error).encode())

        def log_message(self, format, *args):
            logging.getLogger(__name__).debug(format, *args)

    old = ThreadingHTTPServer(('127.0.0.1', 0), Backend)
    old.role = 'old'
    candidate = ThreadingHTTPServer(('127.0.0.1', 0), Backend)
    candidate.role = 'candidate'
    proxy = ThreadingHTTPServer(('127.0.0.1', 0), Proxy)
    servers = (old, candidate, proxy)
    threads = [threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.01}) for server in servers]
    for thread in threads:
        thread.start()

    def poll():
        while not stopped.is_set():
            try:
                with urlopen(f'http://127.0.0.1:{proxy.server_port}/api/v1/health', timeout=1) as response:
                    observation = (response.status, json.load(response)['version'])
                    observations.append(observation)
                    phase = json.loads((root / 'state.json').read_text()).get('phase')
                    if phase:
                        phase_observations.setdefault(phase, []).append(observation)
            except (OSError, ValueError, HTTPError, URLError) as error:
                observations.append((503, str(error)))
            stopped.wait(0.01)

    monitor = threading.Thread(target=poll)
    monitor.start()
    try:
        yield {'TEST_PROXY_PORT': str(proxy.server_port), 'TEST_CANDIDATE_PORT': str(candidate.server_port),
               'TEST_OLD_PORT': str(old.server_port)}, observations, phase_observations
    finally:
        stopped.set()
        monitor.join(timeout=2)
        for server in servers:
            server.shutdown()
            server.server_close()
        for thread in threads:
            thread.join(timeout=2)


BOUNDARY = r'''
import fcntl, hashlib, json, os, pathlib, re, shutil, sys, time, urllib.request, urllib.error
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(os.environ['TEST_ROOT'])
state_path = root / 'state.json'
state = json.loads(state_path.read_text())
mode = os.environ['TEST_FAILURE']
with (root / 'calls.jsonl').open('a') as stream:
    stream.write(json.dumps([name, *args]) + '\n')
if name == 'docker' and args[0] == 'compose' and 'run' in args and 'SOTTO_DEPLOY_QUEUE=' in args[-1]:
    args = ['exec', '-i', 'candidate-control', 'node', '--import', 'tsx', '-e', args[-1]]
def finish(value='', code=0):
    pending = state_path.with_suffix('.next')
    pending.write_text(json.dumps(state))
    pending.replace(state_path)
    if value: print(value)
    sys.exit(code)
def delayed(phase):
    state['phase'] = phase
    pending = state_path.with_suffix('.next')
    pending.write_text(json.dumps(state))
    pending.replace(state_path)
    time.sleep(0.12)
old = 'sha256:' + 'b' * 64
new = 'sha256:' + 'c' * 64
sha = 'a' * 40
old_web = '1' * 64
candidate_web = '2' * 64
services = ('workers-heavy', 'workers-pipeline', 'workers-light')
old_workers = {service: str(index + 3) * 64 for index, service in enumerate(services)}
new_workers = {service: str(index + 6) * 64 for index, service in enumerate(services)}
def image_for(identifier):
    return new if identifier == candidate_web or identifier in new_workers.values() else old
def runtime_row(identifier):
    candidate = image_for(identifier) == new
    service = 'web' if identifier in (old_web, candidate_web) else next(
        key for key in services if identifier in (old_workers[key], new_workers[key]))
    project = os.environ['SOTTO_STACK'] + ('-' + (state['new_slot'] if candidate else state['old_slot']) if service == 'web' else '')
    source = state.get('candidate_activation', state.get('old_activation', '')) if candidate else state.get('old_activation', '')
    return {'Id': identifier, 'State': {'Running': state['running'].get(identifier, True),
        'ExitCode': 143 if identifier in (old_web, candidate_web) and not state['running'].get(identifier, True) else 0,
        'OOMKilled': False, 'Error': ''}, 'Image': image_for(identifier), 'RestartCount': 0,
        'Config': {'Labels': {'org.opencontainers.image.revision': sha if candidate else 'd' * 40,
            'com.docker.compose.project': project, 'com.docker.compose.service': service},
            'Env': ['SOTTO_RELEASE_SHA=' + (sha if candidate else 'd' * 40),
                'SOTTO_PROVIDER_ACTIVATION_FILE=/run/sotto-provider-activation/fish.json',
                'DATABASE_URL=' + ('postgresql://another' if mode == 'migration-old-web-config' and identifier == old_web else 'postgresql://fixture'),
                'REDIS_URL=redis://fixture']
                + (['PGOPTIONS=-c search_path=another'] if mode == 'migration-old-pg-options' and identifier == old_web else [])},
        'Mounts': [{'Type': 'bind', 'Source': source, 'Destination': '/run/sotto-provider-activation',
            'RW': (mode == 'compat-provider-old-mount' and not candidate)
                or (mode == 'compat-provider-overlap' and candidate and state['worker_generation'] == 'new')}]}
if name == 'sleep': finish()
if name == 'flock':
    try: fcntl.flock(int(args[-1]), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: finish(code=1)
    finish()
if name == 'git': finish(sha if args[0] == 'rev-parse' else '')
if name == 'sha256sum':
    finish(hashlib.sha256(pathlib.Path(args[0]).read_bytes()).hexdigest() + '  ' + args[0])
if name == 'capacity':
    state['capacity'] += 1
    fail = (mode == 'pre-capacity' and state['capacity'] == 1) or (mode == 'post-capacity' and state['capacity'] == 2) or (mode in ('final-capacity', 'compat-final-capacity') and state['capacity'] == 5)
    finish(code=1 if fail else 0)
if name == 'sudo':
    if args[0] == 'install':
        shutil.copyfile(args[-2], args[-1])
        if pathlib.Path(args[-2]).name == 'caddy.current':
            state['normalized_old_config'] = pathlib.Path(args[-1]).read_text()
    elif args[:2] == ['rm', '-f']: pathlib.Path(args[-1]).unlink(missing_ok=True)
    elif args[:2] == ['caddy', 'reload']:
        config = (root / 'caddy.conf').read_text()
        if 'Sotto schema maintenance' in config:
            route = 'maintenance'
        else:
            first_port = int(re.search(r'reverse_proxy\s+localhost:(\d+)', config).group(1))
            route = 'candidate' if first_port == state['candidate_port'] else 'old'
        if mode == 'caddy-rollback' and state['active_route'] == 'candidate' and route == 'old':
            delayed('rollback-route-failed')
            finish(code=1)
        state['active_route'] = route
        if mode == 'migration-fence-lost' and route == 'maintenance' and not state.get('lost_fence_response'):
            state['lost_fence_response'] = True
            finish(code=1)
        if mode.startswith('compat-') and route == 'candidate':
            marker = root / '.local/state/sotto-deploy/unresolved.json'
            state['cutover_marker_before_reload'] = json.loads(marker.read_text())
            directory = pathlib.Path(state['cutover_marker_before_reload']['stateDirectory'])
            state['gate_disabled_before_cutover'] = json.loads((directory / 'provider-activation/fish.json').read_text())['fishEnabled'] is False
            if mode == 'compat-cutover': finish(code=1)
    finish()
if name == 'curl':
    url = args[-1]
    if url.startswith('https://') and state['active_route'] == 'maintenance':
        if '-o' in args:
            pathlib.Path(args[args.index('-o') + 1]).write_text('Sotto schema maintenance')
        finish('503' if '%{http_code}' in args else 'Sotto schema maintenance',
               code=22 if '-f' in args or '-fsS' in args else 0)
    if url.endswith('/api/v1/tags'): finish('401')
    public = url.startswith('https://')
    if public:
        state['public_health'].append(state['web'])
        candidate = state['active_route'] == 'candidate'
    else: candidate = ':' + str(state['candidate_port']) + '/' in url
    port = os.environ['TEST_PROXY_PORT'] if public else os.environ['TEST_CANDIDATE_PORT' if candidate else 'TEST_OLD_PORT']
    if candidate and mode == 'candidate': finish(code=22)
    if public and candidate and mode == 'caddy-rollback': finish(code=22)
    try:
        with urllib.request.urlopen('http://127.0.0.1:' + port + '/api/v1/health', timeout=2) as response:
            body = json.dumps(json.load(response), separators=(',', ':'))
            finish(str(response.status) if '%{http_code}' in args else body)
    except urllib.error.HTTPError: finish(code=22)
if name != 'docker': finish(code=2)
if args[0] == 'version': finish('linux/amd64')
if args[:2] == ['image', 'inspect']:
    if '--format' not in args: finish(code=0 if state['pulled'] else 1)
    fmt = args[args.index('--format') + 1]
    if fmt == '{{json .Config}}':
        finish(json.dumps({'Cmd': ['node', 'server.js'], 'Entrypoint': ['docker-entrypoint.sh'],
                           'Env': ['NEXT_MANUAL_SIG_HANDLE=1'] if mode == 'manual-signal-image' else []}))
    if 'Config.User' in fmt: finish('1001' if mode == 'runtime-owner' else '1000')
    finish(sha if 'revision' in fmt else ('linux/amd64' if 'Architecture' in fmt else new))
if args[0] == 'pull': state['pulled'] = True; finish()
if args[0] == 'ps':
    service = next((arg.split('=', 2)[-1] for arg in args if 'compose.service=' in arg), None)
    project = next((arg.split('=', 2)[-1] for arg in args if 'compose.project=' in arg), '')
    if service:
        identifier = ((old_web if project.endswith('-' + state['old_slot']) else (candidate_web if state['web'] else ''))
                      if service == 'web' else state['worker_ids'].get(service, service))
        finish(identifier if state['running'].get(identifier, False) else '')
    finish(old_web if project.endswith('-' + state['old_slot']) else (state['worker_ids']['workers-heavy'] if project in ('sotto-test', 'sotto') else ''))
if args[0] == 'inspect':
    if '--format' not in args and '-f' not in args:
        finish(json.dumps([runtime_row(identifier) for identifier in args[1:]]))
    fmt = args[args.index('--format') + 1] if '--format' in args else args[args.index('-f') + 1]
    identifier = args[-1]
    if fmt == '{{json .Config}}':
        finish(json.dumps({'Cmd': ['node', 'server.js'], 'Entrypoint': ['docker-entrypoint.sh'],
                           'Env': ['NEXT_MANUAL_SIG_HANDLE=1'] if mode == 'manual-signal-runtime' else []}))
    if fmt == '{{.Image}}': finish(image_for(identifier))
    if fmt == '{{.State.Running}}': finish('true' if state['running'].get(identifier, True) else 'false')
    if 'ExitCode' in fmt:
        if fmt == '{{.State.ExitCode}}': finish('0')
        finish('false false 0')
    if 'RestartCount' in fmt:
        image = image_for(identifier)
        if 'revision' in fmt:
            revision = 'e' * 40 if mode in ('workers', 'compat-before') and image == new else sha
            finish('true false 0 ' + revision)
        if identifier in old_workers.values():
            state['verified_workers'].append(next(service for service, value in old_workers.items() if value == identifier))
        finish('true false 0 ' + image)
    finish()
if args[0] == 'run':
    if 'const files = {};' in args[-1]:
        candidate = old not in args
        files = {'apps/web/src/lib/providers/fish.ts': ('b' if candidate else 'a') * 64,
                 'apps/web/src/lib/sidedoor/authority.ts': 'f' * 64}
        if mode.startswith('migration-'):
            files['apps/web/prisma/schema.prisma'] = ('e' if candidate else 'd') * 64
            if candidate:
                files['apps/web/prisma/migrations/20261020120000_learner_review_events/migration.sql'] = '9' * 64
        if mode == 'compat-provider-assets' and candidate:
            files['apps/web/src/lib/sidedoor/unreviewed.ts'] = 'c' * 64
        finish(json.dumps({'protectedHash': ('2' if candidate else '1') * 64, 'files': files}))
    if '/proc/meminfo' in args[-1]:
        available = 1024 if mode == 'overlap-memory' else 6291456
        finish('MemTotal: 8388608 kB\nMemAvailable: ' + str(available) + ' kB')
    if 'ALL_QUEUE_NAMES' in args[-1]:
        transition = state.get('queue_transition')
        finish(json.dumps(transition['previousQueues' if old in args else 'candidateQueues'] if transition else sorted(state['queue_flags'])))
    if (mode == 'contract' or mode.startswith(('compat-', 'migration-'))) and 'schema.prisma' not in args[-1]:
        if mode == 'migration-schema-only': finish('d' * 64)
        finish(('d' if old in args else 'e') * 64)
    if mode.startswith('migration-'): finish(('d' if old in args else 'e') * 64)
    if mode.startswith('schema-'): finish(('d' if old in args else 'e') * 64)
    finish('same')
if args[0] == 'exec':
    script = args[-1]
    if 'SOTTO_DEPLOY_QUEUE=' in script:
        request = json.load(sys.stdin)
        command = request['command']
        snapshot = {'schemaVersion': 1, 'connectionIdentity': 'f' * 64,
                    'queues': [{'name': key, 'paused': value} for key, value in sorted(state['queue_flags'].items())]}
        transition = request.get('queueTransition', request.get('manifest', {}).get('queueTransition'))
        if transition:
            snapshot.update(schemaVersion=2, queueTransition=transition)
        if command == 'established':
            finish('SOTTO_DEPLOY_QUEUE=' + json.dumps({'schemaVersion': 1, 'connectionIdentity': 'f' * 64,
                                                     'established': True, 'appliedMigrations': 3}))
        if command == 'database-identity':
            database = 'another' if mode == 'migration-direct-target' and os.environ.get('DATABASE_URL') == 'postgresql://another-target' else 'fixture'
            schema = 'another' if mode == 'migration-old-target' and 'candidate-control' not in args else 'public'
            finish('SOTTO_DEPLOY_QUEUE=' + json.dumps({**snapshot, 'databaseIdentity': {
                'databaseName': database, 'schemaName': schema, 'serverAddress': '127.0.0.1',
                'serverPort': 5432, 'databaseOid': '12345'}}))
        if command == 'schema-index':
            finish('SOTTO_DEPLOY_QUEUE=' + json.dumps({**snapshot, 'indexProof': {
                'schemaName': 'public', 'quotedSchema': 'public', 'tableName': 'SidedoorState',
                'indexName': 'SidedoorState_id_pattern_idx', 'accessMethod': 'btree',
                'isValid': True, 'isReady': True, 'isLive': True, 'isUnique': False,
                'isPrimary': False, 'isExclusion': False, 'keyCount': 1, 'attributeCount': 1,
                'noExpressions': True, 'noPredicate': True, 'columnName': 'id',
                'operatorClass': 'text_pattern_ops', 'operatorNamespace': 'pg_catalog',
                'ordering': 0, 'defaultCollation': True, 'sameSchema': True,
                'definition': 'CREATE INDEX "SidedoorState_id_pattern_idx" ON public."SidedoorState" USING btree (id text_pattern_ops)',
            }}))
        if command == 'activation-ready':
            if mode == 'compat-existing-fish': finish(code=1)
            finish('SOTTO_DEPLOY_QUEUE=' + json.dumps({'schemaVersion': 1, 'connectionIdentity': 'f' * 64,
                                                     'activationReady': True, 'inspectedCredentials': 0, 'inspectedJobs': 0}))
        if command == 'pause':
            state['queue_flags'] = dict.fromkeys(state['queue_flags'], True)
            snapshot['queues'] = [{'name': key, 'paused': True} for key in sorted(state['queue_flags'])]
        if command == 'restore':
            if mode in ('compat-restore', 'migration-restore'):
                state['queue_flags']['audio-generation'] = False
                finish(code=1)
            state['queue_flags'] = {queue['name']: queue['paused'] for queue in request['manifest']['queues']}
            snapshot['queues'] = request['manifest']['queues']
        if command in ('drained', 'drained-all'):
            if state['journal_pending']: finish(code=1)
            active = state['active']
            snapshot.update({'drained': active == 0, 'activeJobs': active,
                'executions': {'inspected': active, 'settled': 0, 'synchronousActive': 0, 'workerActive': active}})
            state['active'] = 0
            delayed('drain')
        finish('SOTTO_DEPLOY_QUEUE=' + json.dumps(snapshot))
    if 'pg_database_size' in script:
        delayed('backup')
        finish('1024', code=1 if mode in ('backup', 'schema-reviewed') else 0)
    if 'pg_dump' in script:
        state['backup_while_old_writers_running'] = any(state['running'].get(item, False) for item in (old_web, *old_workers.values()))
        finish('verified fixture dump')
    finish()
if args[0] == 'top':
    processes = 'PID PPID COMMAND\n100 1 node --max-old-space-size=1024 --import tsx src/workers/index.ts\n101 100 /app/node_modules/@esbuild/linux-x64/bin/esbuild --service=0.25.0 --ping'
    if mode == 'extra-process': processes += '\n102 100 codex exec fixture'
    finish(processes)
if args[0] == 'stop':
    identifiers = [arg for arg in args[1:] if arg in state['running']]
    for identifier in identifiers:
        if identifier in (*old_workers.values(), *new_workers.values()) and (state['active'] or state['journal_pending'] or not all(state['queue_flags'].values())):
            state['unsafe_stops'].append(identifier)
            finish(code=1)
        if '--time' not in args or args[args.index('--time') + 1] != '-1':
            state['unsafe_stops'].append(identifier)
            finish(code=1)
        state['running'][identifier] = False
        state['stopped'].append(identifier)
        if identifier == old_web: state['old_web'] = None
    finish('\n'.join(identifiers))
if args[0] in ('volume', 'tag'): finish()
if args[0] != 'compose': finish(code=2)
project = args[args.index('-p') + 1] if '-p' in args else ''
overrides = [args[index + 1] for index, value in enumerate(args[:-1]) if value == '-f' and args[index + 1].endswith('.json')]
config = json.loads(pathlib.Path(overrides[-1]).read_text()) if overrides else {}
if 'run' in args and 'migrate' in args:
    if 'deploy' in args:
        state['migration_started'] = True
        state['migration_admitted_safely'] = (state['active_route'] == 'maintenance'
            and all(state['queue_flags'].values()) and not state['active']
            and not any(state['running'].get(item, False) for item in (old_web, *old_workers.values()))
            and bool(list((root / 'backups').glob('*.dump.sha256'))))
        state['migration_partial'] = mode == 'migration-partial'
        state['migration_complete'] = mode != 'migration-partial'
        finish(code=1 if mode == 'migration-partial' else 0)
    if 'diff' in args:
        if mode == 'migration-drift': finish('ALTER TABLE "LearnerReviewEvent" ADD COLUMN "unexpected" TEXT;', code=2)
        if mode == 'migration-sdk-index':
            finish('-- DropIndex\nDROP INDEX "SidedoorState_id_pattern_idx";\n\n-- CreateIndex\nCREATE INDEX "SidedoorState_id_pattern_idx" ON "SidedoorState"("id" text_pattern_ops);\n', code=2)
        finish('-- This is an empty migration.')
if 'ps' in args:
    finish((old_web if project.endswith('-' + state['old_slot']) else candidate_web) if args[-1] == 'web' else state['worker_ids'].get(args[-1], args[-1]))
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
    if project.endswith('-' + state['new_slot']):
        mounts = config.get('services', {}).get('web', {}).get('volumes', [])
        for mount in mounts:
            if mount.get('target') == '/run/sotto-provider-activation':
                state['candidate_activation'] = mount['source']
                state['provider_enabled_at_web_start'] = json.loads((pathlib.Path(mount['source']) / 'fish.json').read_text())['fishEnabled']
        state['web'] = new
        state['running'][candidate_web] = True
        state['premature_route'] = state['active_route'] == 'candidate'
        delayed('warmup')
    if project.endswith('-' + state['old_slot']):
        state['old_web'] = old
        state['running'][old_web] = True
        state['old_web_recreated'] = True
    selected = [service for service in services if service in args]
    if 'workers-heavy' in config.get('services', {}) and selected:
        image = config['services'][selected[0]]['image']
        if not all(state['queue_flags'].values()):
            state['unsafe_starts'].extend(selected)
            finish(code=1)
        state['workers'] = old if image == old else new
        state['worker_generation'] = 'old' if image == old else 'new'
        for service in selected:
            identifier = (old_workers if image == old else new_workers)[service]
            state['worker_ids'][service] = identifier
            state['running'][identifier] = True
if 'down' in args:
    identifier = candidate_web if project.endswith('-' + state['new_slot']) else old_web
    if state['running'].get(identifier, False):
        state['unsafe_stops'].append(identifier + ':compose-down-running')
        finish(code=1)
    if project.endswith('-' + state['new_slot']): state['web'] = None
finish()
'''


class DeploymentFailureTests(unittest.TestCase):
    def run_deployment(self, failure, stack='sotto-test', reviewed_schema=False, success=False,
                       expect_rollback=True, prepaused=False, retained_candidate=False, rollback_blocked=False,
                       old_slot='blue', reviewed_runtime=False, stale_review=False, provider_continuity=False,
                       schema_transition=False, additive_queues=False):
        if schema_transition:
            reviewed_runtime = provider_continuity = True
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = Path(__file__).parents[2]
            shutil.copytree(source / 'scripts/deploy', root / 'scripts/deploy')
            for name in ('deploy.sh', 'smoke-prod.sh'):
                shutil.copyfile(source / 'scripts' / name, root / 'scripts' / name)
            shutil.copyfile(source / 'Caddyfile', root / 'Caddyfile')
            slot_file = root / f'.{stack}-deploy-slot'
            new_slot = 'green' if old_slot == 'blue' else 'blue'
            slot_file.write_text(old_slot + '\n')
            original_caddy = 'reverse_proxy localhost:3000 localhost:3010\n'
            (root / 'caddy.conf').write_text(original_caddy)
            state = {'capacity': 0, 'pulled': False, 'web': None, 'old_web': OLD,
                     'workers': OLD, 'public_health': [], 'verified_workers': [],
                     'premature_route': False, 'active_route': 'old', 'old_slot': old_slot, 'new_slot': new_slot,
                     'candidate_port': 3010 if new_slot == 'green' else 3000, 'running': {OLD_WEB: True,
                     **dict.fromkeys(OLD_WORKERS.values(), True)},
                     'worker_ids': OLD_WORKERS.copy(),
                     'queue_flags': {'audio-generation': prepaused, 'speaking-grading': False},
                     'active': 1, 'journal_pending': failure == 'unknown-cleanup', 'unsafe_stops': [],
                     'unsafe_starts': [], 'stopped': [], 'worker_generation': 'old'}
            if additive_queues:
                previous = sorted(state['queue_flags'])
                state['queue_flags'].update({'material-analysis': True, 'vocabulary-audio': False})
                state['queue_transition'] = {
                    'previousQueues': previous, 'candidateQueues': sorted(state['queue_flags']),
                    'addedQueues': ['material-analysis', 'vocabulary-audio'],
                }
            if provider_continuity:
                activation = root / 'previous-activation'
                activation.mkdir()
                (activation / 'fish.json').write_text(json.dumps({'releaseSha': 'd' * 40, 'fishEnabled': True}))
                state['old_activation'] = str(activation.resolve())
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
            if failure == 'migration-direct-target':
                values['DIRECT_DATABASE_URL'] = 'postgresql://another-target'
            if reviewed_runtime:
                evidence = b'Independent review of exact fixture images.'
                evidence_path = root / 'compatibility-evidence.txt'
                evidence_path.write_bytes(evidence)
                evidence_path.chmod(0o600)
                review_path = root / 'compatibility-review.json'
                review = {
                    'schemaVersion': 1,
                    'procedure': 'compatible-runtime-overlap',
                    'stack': stack,
                    'releaseSha': SHA,
                    'candidateWebImage': values['SOTTO_WEB_IMAGE_REF'],
                    'candidateWorkersImage': values['SOTTO_WORKERS_IMAGE_REF'],
                    'previousWebImage': OLD,
                    'previousWorkerContracts': {OLD: 'd' * 64},
                    'candidateContract': ('f' if stale_review else 'd' if failure == 'migration-schema-only' else 'e') * 64,
                    'reviewer': 'Independent fixture reviewer',
                    'evidenceSha256': hashlib.sha256(evidence).hexdigest(),
                }
                if provider_continuity:
                    review.update(schemaVersion=2, providerActivation={
                        'mode': 'preserve-existing', 'previousReleaseSha': 'd' * 40,
                        'previousAssetsHash': '1' * 64, 'candidateAssetsHash': '2' * 64,
                        'previousRuntimes': {service: {'containerId': identifier, 'imageId': OLD}
                            for service, identifier in {'web': OLD_WEB, **OLD_WORKERS}.items()},
                        'reviewedRuntimeFiles': {'apps/web/src/lib/providers/fish.ts': {
                            'previousSha256': 'a' * 64, 'candidateSha256': 'b' * 64}},
                    })
                    if schema_transition:
                        review['providerActivation']['reviewedRuntimeFiles'].update({
                            'apps/web/prisma/schema.prisma': {'previousSha256': 'd' * 64, 'candidateSha256': 'e' * 64},
                            'apps/web/prisma/migrations/20261020120000_learner_review_events/migration.sql': {
                                'previousSha256': None, 'candidateSha256': '9' * 64},
                        })
                review_path.write_text(json.dumps(review))
                review_path.chmod(0o600)
                values['SOTTO_COMPATIBILITY_REVIEW_FILE'] = str(review_path)
                values['SOTTO_COMPATIBILITY_EVIDENCE_FILE'] = str(evidence_path)
                if schema_transition:
                    schema_evidence = root / 'schema-evidence.txt'
                    schema_evidence.write_bytes(b'Independent exact fenced migration review.')
                    schema_evidence.chmod(0o600)
                    schema_review = root / 'schema-review.json'
                    schema_review.write_text(json.dumps({
                        'schemaVersion': 1, 'procedure': 'fenced-schema-migration',
                        'stack': stack, 'releaseSha': SHA,
                        'candidateWebImage': values['SOTTO_WEB_IMAGE_REF'],
                        'candidateWorkersImage': values['SOTTO_WORKERS_IMAGE_REF'],
                        'candidateSchemaHash': 'e' * 64, 'previousSchemaHashes': {OLD: 'd' * 64},
                        'compatibilityReviewSha256': hashlib.sha256(review_path.read_bytes()).hexdigest(),
                        'reviewer': 'Independent schema reviewer',
                        'evidenceSha256': hashlib.sha256(schema_evidence.read_bytes()).hexdigest(),
                    }))
                    schema_review.chmod(0o600)
                    if additive_queues:
                        value = json.loads(schema_review.read_text())
                        value.update(schemaVersion=2, queueTransition=state['queue_transition'])
                        schema_review.write_text(json.dumps(value))
            (root / '.env.production').write_text(''.join(key + '=' + value + '\n' for key, value in values.items()))
            with serving_fixture(root) as (ports, observations, phase_observations):
                environment.update(ports)
                command = ['bash', str(root / 'scripts/deploy.sh')]
                if schema_transition:
                    command = ['bash', str(root / 'scripts/deploy/schema/deploy.sh'), str(schema_review), str(schema_evidence)]
                if retained_candidate:
                    unresolved = root / '.local/state/sotto-deploy/unresolved.json'
                    stdout = root / 'controller.stdout'
                    stderr = root / 'controller.stderr'
                    with stdout.open('w') as output, stderr.open('w') as errors:
                        process = subprocess.Popen(command, env=environment, stdout=output,
                                                   stderr=errors, start_new_session=True)
                        try:
                            deadline = time.monotonic() + 30
                            while (not unresolved.exists() or 'Unresolved deployment.' not in stdout.read_text() + stderr.read_text()) and process.poll() is None and time.monotonic() < deadline:
                                time.sleep(0.02)
                            self.assertTrue(unresolved.exists(), stdout.read_text() + stderr.read_text())
                            self.assertIsNone(process.poll(), stdout.read_text() + stderr.read_text())
                            with (root / 'deploy.lock').open('a') as lock:
                                with self.assertRaises(BlockingIOError):
                                    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                            time.sleep(0.15)
                            self.assertIsNone(process.poll(), stdout.read_text() + stderr.read_text())
                        finally:
                            if process.poll() is None:
                                os.killpg(process.pid, signal.SIGKILL)
                            process.wait(timeout=5)
                    if reviewed_runtime:
                        retry = subprocess.run(command, env=environment, text=True,
                                               capture_output=True, timeout=5)
                        self.assertNotEqual(retry.returncode, 0)
                        self.assertIn('unresolved deployment requires review', retry.stderr)
                    result = subprocess.CompletedProcess(command, process.returncode,
                                                         stdout.read_text(), stderr.read_text())
                else:
                    try:
                        result = subprocess.run(command, env=environment, text=True,
                                                capture_output=True, timeout=30)
                    except subprocess.TimeoutExpired as error:
                        streams = [value.decode() if isinstance(value, bytes) else value or ''
                                   for value in (error.stdout, error.stderr)]
                        self.fail('Controller timed out:\n' + ''.join(streams))
            if success:
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            else:
                self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            after = json.loads((root / 'state.json').read_text())
            marker = root / '.local/state/sotto-deploy/unresolved.json'
            after['unresolved_marker'] = json.loads(marker.read_text()) if marker.exists() else None
            if marker.exists():
                state_directory = Path(after['unresolved_marker']['stateDirectory'])
                observed = state_directory / 'compatibility-queues-observed.json'
                if observed.exists():
                    after['observed_queues'] = json.loads(observed.read_text())
            for gate in (root / '.local/state/sotto-deploy').glob('*/provider-activation/fish.json'):
                after['gate_enabled_after_controller'] = json.loads(gate.read_text())['fishEnabled']
                if not provider_continuity:
                    self.assertFalse(after['gate_enabled_after_controller'] and after['running'][OLD_WEB], result.stdout + result.stderr)
            if provider_continuity:
                after['previous_activation'] = json.loads((root / 'previous-activation/fish.json').read_text())
            after['observations'] = observations
            after['phase_observations'] = phase_observations
            after['calls'] = [json.loads(line) for line in (root / 'calls.jsonl').read_text().splitlines()]
            if schema_transition:
                after['active_slot'] = slot_file.read_text().strip()
                proofs = list((root / '.local/state/sotto-deploy').glob('*/schema-drift-proof.json'))
                after['drift_proof'] = json.loads(proofs[0].read_text()) if proofs else None
            elif expect_rollback:
                self.assertEqual(after['old_web'], OLD, result.stdout + result.stderr)
                self.assertEqual(after['workers'], NEW if rollback_blocked else OLD, result.stdout + result.stderr)
                self.assertEqual(after['web'], NEW if retained_candidate else None, result.stdout + result.stderr)
                self.assertEqual(slot_file.read_text(), old_slot + '\n')
                if not retained_candidate:
                    self.assertEqual((root / 'caddy.conf').read_text(), after.get('normalized_old_config', original_caddy))
            else:
                self.assertEqual(after['workers'], NEW, result.stdout + result.stderr)
                self.assertEqual(after['web'], NEW, result.stdout + result.stderr)
                self.assertEqual(slot_file.read_text(), new_slot + '\n')
            self.assertFalse(after['premature_route'], result.stdout + result.stderr)
            self.assertTrue(observations, result.stdout + result.stderr)
            if not schema_transition:
                self.assertTrue(all(status == 200 for status, version in observations), observations)
            self.assertFalse(after['unsafe_stops'], result.stdout + result.stderr)
            self.assertFalse(after['unsafe_starts'], result.stdout + result.stderr)
            return after, result.stdout + result.stderr

    def test_established_primary_keeps_shared_infrastructure_running_during_backup(self):
        state, output = self.run_deployment('backup', stack='sotto')
        self.assertIn('Backing up the application database', output)
        self.assertFalse(any(call[0] == 'docker' and 'compose' in call and
                             'docker-compose.infra.yml' in call and 'up' in call
                             for call in state['calls']), output)
        self.assertEqual({version for status, version in state['observations']}, {'d' * 40})

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
        self.assertIn('separately reviewed migration procedure', output)
        self.assertNotIn('Backing up the application database', output)
        self.assertNotIn('Running database migrations', output)
        self.assertTrue(state['pulled'])

    def test_matching_review_hashes_cannot_bypass_schema_difference(self):
        state, output = self.run_deployment('schema-reviewed', reviewed_schema=True)
        self.assertIn('separately reviewed migration procedure', output)
        self.assertNotIn('Backing up the application database', output)
        self.assertNotIn('Running database migrations', output)
        self.assertEqual(state['workers'], OLD, output)

    def test_wrong_worker_revision_restores_images_routing_slot_and_checks_public_health(self):
        state, output = self.run_deployment('workers')
        self.assertIn('workers-heavy did not remain healthy', output)
        self.assertNotIn('restored worker', output)
        self.assertGreaterEqual(len(state['public_health']), 2, output)
        self.assertIsNone(state['public_health'][-1], output)
        self.assertEqual(set(state['verified_workers']), {'workers-heavy', 'workers-pipeline', 'workers-light'}, output)

    def test_final_metadata_failure_does_not_remove_the_verified_public_service(self):
        state, output = self.run_deployment('final-capacity', expect_rollback=False)
        self.assertEqual(state['capacity'], 5, output)
        self.assertIn('Tags access check OK (status 401)', output)
        self.assertIn('Saved active slot: green', output)
        self.assertEqual(state['observations'][-1], (200, SHA))

    def test_code_only_deployment_keeps_http_serving_through_warmup_and_drain(self):
        state, output = self.run_deployment('none', success=True, expect_rollback=False)
        self.assertIn((200, 'd' * 40), state['observations'])
        self.assertIn((200, SHA), state['observations'])
        for phase in ('backup', 'warmup', 'drain'):
            self.assertIn((200, 'd' * 40), state['phase_observations'].get(phase, []), output)
        self.assertTrue(all(not paused for paused in state['queue_flags'].values()), output)
        self.assertEqual(state['worker_ids'], NEW_WORKERS, output)
        self.assertTrue(all(state['running'][identifier] for identifier in NEW_WORKERS.values()), output)
        self.assertTrue(all(not state['running'][identifier] for identifier in OLD_WORKERS.values()), output)
        self.assertIsNone(state['old_web'], output)
        self.assertFalse(any('initialize' in call or 'finalize' in call or
                             'migrate' in call or '--force-recreate' in call
                             for call in state['calls']), output)

    def test_candidate_failure_keeps_old_http_and_workers_serving(self):
        state, output = self.run_deployment('candidate')
        self.assertEqual({version for status, version in state['observations']}, {'d' * 40})
        self.assertFalse(any(identifier != CANDIDATE_WEB for identifier in state['stopped']), output)

    def test_prepaused_queue_remains_paused_after_successful_worker_replacement(self):
        state, output = self.run_deployment('none', success=True, expect_rollback=False, prepaused=True)
        self.assertEqual(state['queue_flags'], {'audio-generation': True, 'speaking-grading': False}, output)

    def test_unknown_worker_cleanup_blocks_replacement_without_stopping_old_workers(self):
        state, output = self.run_deployment('unknown-cleanup', retained_candidate=True)
        self.assertFalse(set(state['stopped']) & set(OLD_WORKERS.values()), output)
        self.assertEqual(state['worker_generation'], 'old', output)
        self.assertTrue(all(state['queue_flags'].values()), output)
        self.assertEqual({version for status, version in state['observations']}, {'d' * 40})

    def test_extra_worker_child_blocks_replacement_without_forcing_termination(self):
        state, output = self.run_deployment('extra-process', retained_candidate=True)
        self.assertFalse(set(state['stopped']) & set(OLD_WORKERS.values()), output)
        self.assertEqual(state['worker_generation'], 'old', output)
        self.assertTrue(all(state['queue_flags'].values()), output)
        self.assertEqual({version for status, version in state['observations']}, {'d' * 40})

    def test_incompatible_job_contract_never_starts_a_candidate(self):
        state, output = self.run_deployment('contract')
        self.assertFalse(any('up' in call and 'web' in call for call in state['calls']), output)
        self.assertFalse(state['stopped'], output)

    def test_reviewed_runtime_pair_deploys_and_clears_its_recovery_marker(self):
        state, output = self.run_deployment(
            'compat-success', reviewed_runtime=True, success=True,
            expect_rollback=False, prepaused=True)
        self.assertEqual(state['queue_flags'], {
            'audio-generation': True, 'speaking-grading': False}, output)
        self.assertEqual(state['cutover_marker_before_reload']['phase'],
                         'compatibility-cutover', output)
        self.assertIsNone(state['unresolved_marker'], output)
        self.assertTrue(state['gate_disabled_before_cutover'], output)
        self.assertTrue(state['gate_enabled_after_controller'], output)

    def test_stale_runtime_review_never_starts_candidate_services(self):
        state, output = self.run_deployment(
            'compat-success', reviewed_runtime=True, stale_review=True)
        self.assertIn('Compatibility review rejected', output)
        self.assertFalse(state['stopped'], output)
        self.assertFalse(any('up' in call and 'web' in call
                             for call in state['calls']), output)

    def test_existing_fish_state_blocks_candidate_start_and_stays_disabled(self):
        state, output = self.run_deployment('compat-existing-fish', reviewed_runtime=True)
        self.assertFalse(state['stopped'], output)
        self.assertFalse(state['gate_enabled_after_controller'], output)
        self.assertFalse(any('up' in call and 'web' in call for call in state['calls']), output)

    def test_reviewed_enabled_provider_remains_available_through_both_slots(self):
        state, output = self.run_deployment(
            'compat-provider-success', reviewed_runtime=True,
            provider_continuity=True, success=True, expect_rollback=False)
        self.assertTrue(state['provider_enabled_at_web_start'], output)
        self.assertFalse(state['gate_disabled_before_cutover'], output)
        self.assertTrue(state['gate_enabled_after_controller'], output)
        self.assertEqual(state['previous_activation'], {
            'releaseSha': 'd' * 40, 'fishEnabled': True}, output)
        self.assertIsNone(state['unresolved_marker'], output)
        self.assertTrue(all(not paused for paused in state['queue_flags'].values()), output)

    def test_unreviewed_provider_assets_or_writable_old_mount_never_start_candidate(self):
        for failure in ('compat-provider-assets', 'compat-provider-old-mount'):
            with self.subTest(failure=failure):
                state, output = self.run_deployment(
                    failure, reviewed_runtime=True, provider_continuity=True)
                self.assertFalse(state['stopped'], output)
                self.assertFalse(any('up' in call and 'web' in call for call in state['calls']), output)
                self.assertTrue(state['previous_activation']['fishEnabled'], output)

    def test_changed_candidate_activation_before_cutover_restores_old_enabled_services(self):
        state, output = self.run_deployment(
            'compat-provider-overlap', reviewed_runtime=True, provider_continuity=True)
        self.assertEqual(state['active_route'], 'old', output)
        self.assertEqual(state['worker_generation'], 'old', output)
        self.assertTrue(state['previous_activation']['fishEnabled'], output)
        self.assertIsNone(state['unresolved_marker'], output)

    def test_reviewed_upgrade_can_restore_old_workers_before_cutover(self):
        state, output = self.run_deployment('compat-before', reviewed_runtime=True)
        self.assertEqual(state['worker_generation'], 'old', output)
        self.assertIsNone(state['unresolved_marker'], output)
        self.assertEqual(state['queue_flags'], {
            'audio-generation': False, 'speaking-grading': False}, output)

    def test_uncertain_compatible_cutover_keeps_new_workers_and_durable_lock(self):
        state, output = self.run_deployment(
            'compat-cutover', reviewed_runtime=True, retained_candidate=True,
            rollback_blocked=True)
        self.assertEqual(state['active_route'], 'candidate', output)
        self.assertEqual(state['worker_generation'], 'new', output)
        self.assertTrue(state['running'][OLD_WEB], output)
        self.assertTrue(all(state['queue_flags'].values()), output)
        self.assertEqual(state['unresolved_marker']['phase'],
                         'compatibility-cutover', output)
        self.assertFalse(state['gate_enabled_after_controller'], output)

    def test_partial_queue_restore_fences_delivery_without_killing_active_work(self):
        state, output = self.run_deployment(
            'compat-restore', reviewed_runtime=True, retained_candidate=True,
            rollback_blocked=True)
        self.assertEqual(state['worker_generation'], 'new', output)
        self.assertTrue(all(state['queue_flags'].values()), output)
        self.assertTrue(all(queue['paused'] for queue in
                            state['observed_queues']['queues']), output)
        self.assertTrue(state['running'][CANDIDATE_WEB], output)

    def test_post_commit_failure_keeps_compatible_candidate_and_evidence(self):
        state, output = self.run_deployment(
            'compat-final-capacity', reviewed_runtime=True,
            retained_candidate=True, expect_rollback=False)
        self.assertEqual(state['active_route'], 'candidate', output)
        self.assertEqual(state['worker_generation'], 'new', output)
        self.assertTrue(state['running'][CANDIDATE_WEB], output)
        self.assertTrue(all(state['queue_flags'].values()), output)

    def test_insufficient_overlap_memory_keeps_old_http_and_workers_serving(self):
        state, output = self.run_deployment('overlap-memory')
        self.assertIn('Insufficient RAM', output)
        self.assertFalse(state['stopped'], output)
        self.assertFalse(any('up' in call and 'web' in call for call in state['calls']), output)
        self.assertEqual({version for status, version in state['observations']}, {'d' * 40})

    def test_custom_signal_handler_blocks_replacement_before_mutation(self):
        for failure in ('manual-signal-image', 'manual-signal-runtime'):
            with self.subTest(configuration=failure):
                state, output = self.run_deployment(failure)
                self.assertFalse(state['stopped'], output)
                self.assertFalse(any('up' in call and 'web' in call for call in state['calls']), output)
                self.assertEqual({version for status, version in state['observations']}, {'d' * 40})

    def test_failed_routing_rollback_keeps_both_web_slots_and_active_proxy_serving(self):
        state, output = self.run_deployment('caddy-rollback', retained_candidate=True, rollback_blocked=True)
        self.assertTrue(state['running'][OLD_WEB], output)
        self.assertTrue(state['running'][CANDIDATE_WEB], output)
        self.assertEqual(state['active_route'], 'candidate', output)
        self.assertTrue(all(state['queue_flags'].values()), output)
        self.assertIn((200, SHA), state['phase_observations'].get('rollback-route-failed', []), output)

    def test_legacy_dual_upstreams_restore_old_green_without_routing_to_retired_blue(self):
        state, output = self.run_deployment('workers', old_slot='green')
        self.assertEqual(state['active_route'], 'old', output)
        self.assertTrue(state['running'][OLD_WEB], output)
        self.assertFalse(state['running'][CANDIDATE_WEB], output)
        self.assertIn('localhost:3010', state['normalized_old_config'], output)
        self.assertNotIn('localhost:3000', state['normalized_old_config'], output)
        self.assertEqual({version for status, version in state['observations']}, {'d' * 40})


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
