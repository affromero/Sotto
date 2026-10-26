"""Preserve review data and admit the one shared native-review runtime."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import selectors
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from collections.abc import Sequence
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, cast

from scripts.deploy.images.metadata import record
from scripts.deploy.review.build_observer import TARGET, bounded_bytes
from scripts.deploy.review.egress import (
    RULES_PATH,
    bridge_name,
    collect_policy,
    guard_unit,
    host_addresses,
    render_rules,
    semantic_policy,
)
from scripts.deploy.review.runtime.policy import helper_memory, runtime_policy
from scripts.deploy.review.runtime.release import (
    before_fence as before_fence,
)
from scripts.deploy.review.runtime.release import (
    cutover as cutover,
)
from scripts.deploy.review.runtime.release import (
    finalize as finalize,
)
from scripts.deploy.review.runtime.release import (
    recover_completed as recover_completed,
)
from scripts.deploy.review.runtime.release import (
    start_completed as start_completed,
)
from scripts.deploy.review.runtime.release import (
    verify_completed as verify_completed,
)
from scripts.deploy.review.state import (
    atomic_json,
    checksum,
    private_json,
    sync_directory,
)
from scripts.deploy.review.topology import (
    AUTH_HOME,
    DIRECTORY,
    NETWORK,
    PROJECT,
    candidate_compose,
    environment,
    rows,
)

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations


PRESERVATION_OBSERVER = r'''
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {Client}=require('pg');
const raw=fs.readFileSync(0);
assert(raw.length<=262144);
const retained=JSON.parse(raw);
const client=new Client({connectionString:process.env.DATABASE_URL,
 connectionTimeoutMillis:5000,query_timeout:5000});
const timer=setTimeout(()=>process.exit(124),60000);
const quote=name=>{
 assert(typeof name==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
 return '"'+name+'"';
};
(async()=>{
 await client.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY');
  await client.query("SET LOCAL statement_timeout='5000ms'");
  const setting=await client.query('SHOW transaction_read_only');
  assert.equal(setting.rows[0].transaction_read_only,'on');
  let inventory;
  if(retained===null){
   const result=await client.query(`SELECT table_name,column_name
    FROM information_schema.columns WHERE table_schema=current_schema()
    AND table_name<>'_prisma_migrations'
    ORDER BY table_name,ordinal_position`);
   assert(result.rows.length>0&&result.rows.length<=10000);
   const mapping=new Map();
   for(const row of result.rows){
    if(!mapping.has(row.table_name)) mapping.set(row.table_name,[]);
    mapping.get(row.table_name).push(row.column_name);
   }
   inventory=[...mapping].map(([table,columns])=>({table,columns}));
  }else inventory=retained;
  assert(Array.isArray(inventory)&&inventory.length>0&&inventory.length<=256);
  const names=new Set();const tables=[];let totalBytes=0,totalRows=0;
  for(const item of inventory){
   assert(!names.has(item.table));names.add(item.table);
   assert(Array.isArray(item.columns)&&item.columns.length>0
          &&item.columns.length<=256);
   const selected=item.columns.map(quote).join(',');
   const from='(SELECT '+selected+' FROM '+quote(item.table)+') v';
   const budget=await client.query('SELECT count(*)::int AS count,'+
    'coalesce(sum(octet_length(row_to_json(v)::text)),0)::text AS bytes FROM '
    +from);
   const count=budget.rows[0].count,bytes=Number(budget.rows[0].bytes);
   totalRows+=count;totalBytes+=bytes;
   assert(count<=10000&&bytes<=4194304&&totalRows<=50000&&totalBytes<=16777216);
   const result=await client.query(
    'SELECT row_to_json(v)::text AS value FROM '+from
    +' ORDER BY row_to_json(v)::text');
   assert.equal(result.rows.length,count);
   const hash=crypto.createHash('sha256');let actualBytes=0;
   for(const row of result.rows){
    const size=Buffer.byteLength(row.value);assert(size<=262144);
    actualBytes+=size;hash.update(row.value);hash.update('\n');
   }
   assert.equal(actualBytes,bytes);
   tables.push({table:item.table,columns:item.columns,count,bytes,
                sha256:hash.digest('hex')});
  }
  const output=JSON.stringify({schemaVersion:1,tables,totalBytes,totalRows});
  assert(Buffer.byteLength(output)<=262144);console.log(output);
 }finally{
  await client.query('ROLLBACK');await client.end();clearTimeout(timer);
 }
})().catch(()=>{console.error('Review preservation observation refused');
 process.exitCode=1;clearTimeout(timer);});
'''


def preserve_data(operations: HostOperations) -> dict[str, object]:
    path = operations.attempt.directory / 'original-data.json'
    retained = private_json(path) if path.exists() else None
    selected = None if retained is None else [
        {'table': item['table'], 'columns': item['columns']}
        for item in rows(retained['tables'], 'original table')
    ]
    topology = record(operations.manifest['topology'], 'topology')
    web = record(record(topology['services'], 'services')['web'], 'old web')
    actual = record(json.loads(operations.image_command(
        {'reference': web['imageId'], 'sha': TARGET},
        'node', ['-e', PRESERVATION_OBSERVER],
        content=json.dumps(selected).encode(),
    )), 'protected data observation')
    if retained is not None and actual != retained:
        raise ValueError('original-review-data-changed')
    if retained is None:
        atomic_json(path, actual)
    return actual


def private_inputs(operations: HostOperations) -> dict[str, object]:
    path = operations.attempt.directory / 'inputs.json'
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(descriptor)
        if (not stat.S_ISREG(metadata.st_mode)
                or metadata.st_uid != os.geteuid()
                or stat.S_IMODE(metadata.st_mode) != 0o600
                or metadata.st_size > 262_144):
            raise ValueError('owned-private-inputs-required')
        with os.fdopen(descriptor, 'rb', closefd=False) as source:
            raw = source.read(262_145)
    finally:
        os.close(descriptor)
    if len(raw) > 262_144:
        raise ValueError('bounded-private-inputs-required')
    value = record(json.loads(raw), 'private runtime inputs')
    if (hashlib.sha256(raw).hexdigest()
            != operations.manifest['inputsSha256']
            or set(value) != {'auth', 'readiness', 'workloads'}):
        raise ValueError('admitted-private-inputs-changed')
    for mode in ('readiness', 'workloads'):
        candidate = record(value[mode], 'private runtime input')
        if candidate.get('endpoint') != 'http://127.0.0.1:3000':
            raise ValueError('exact-candidate-loopback-required')
    readiness = record(value['readiness'], 'private readiness input')
    password = readiness.get('householdPassword')
    credentials = record(readiness.get('credentialValues'),
                         'selected speech credential input')
    if (not isinstance(password, str) or not 0 < len(password) <= 4096
            or not credentials or not any(
                isinstance(item, str) and 0 < len(item) <= 65_536
                for item in credentials.values()
            )):
        raise ValueError('existing-review-provider-inputs-required')
    auth = record(value['auth'], 'isolated Codex input')
    if set(auth) != {'auth.json', 'config.toml'}:
        raise ValueError('exact-isolated-codex-files-required')
    for name, content in auth.items():
        if not isinstance(content, str):
            raise ValueError('bounded-isolated-auth-input-required')
        decoded = base64.b64decode(content, validate=True)
        if not 0 < len(decoded) <= 65_536:
            raise ValueError('bounded-isolated-auth-input-required')
        if name == 'auth.json':
            if record(json.loads(decoded), 'Codex authentication') \
                    .get('auth_mode') != 'chatgpt':
                raise ValueError('fresh-isolated-codex-session-required')
    return value


def handover_auth(operations: HostOperations) -> None:
    operations.verify_fence()
    operations.verify_egress()
    value = private_inputs(operations)
    target = Path(DIRECTORY) / 'auth/codex'
    receipt = operations.attempt.directory / 'auth-handover.json'
    uid = cast(int, operations.manifest['runtimeUid'])
    gid = cast(int, operations.manifest['runtimeGid'])
    if os.geteuid() != uid or os.getegid() != gid:
        raise ValueError('proven-review-runtime-ownership-required')
    if receipt.exists():
        retained = private_json(receipt)
        parent = target.parent
        staging = parent / ('codex-' + operations.attempt.manifest_hash[:24])
        if not target.exists() and not target.is_symlink():
            metadata = staging.lstat()
            if retained.get('identity') != [metadata.st_dev, metadata.st_ino]:
                raise ValueError('auth-handover-location-unresolved')
            staging.rename(target)
            sync_directory(parent)
        metadata = target.lstat()
        if (not stat.S_ISDIR(metadata.st_mode)
                or stat.S_IMODE(metadata.st_mode) != 0o700
                or metadata.st_uid != uid or metadata.st_gid != gid
                or retained.get('identity')
                != [metadata.st_dev, metadata.st_ino]):
            raise ValueError('handed-over-codex-home-changed')
        # Rotating credentials belong to this one shared home after handover.
        # Initial local bytes must never overwrite a server refresh.
        for name in ('auth.json', 'config.toml'):
            metadata = (target / name).lstat()
            if (not stat.S_ISREG(metadata.st_mode)
                    or stat.S_IMODE(metadata.st_mode) != 0o600
                    or metadata.st_uid != uid or metadata.st_gid != gid):
                raise ValueError('handed-over-codex-file-changed')
        return
    if target.exists() or target.is_symlink():
        raise ValueError('unknown-existing-review-codex-home')
    parent = target.parent
    if not parent.exists():
        parent.mkdir(mode=0o700)
    metadata = parent.lstat()
    if (not stat.S_ISDIR(metadata.st_mode)
            or metadata.st_uid != uid or metadata.st_mode & 0o077):
        raise ValueError('private-review-auth-parent-required')
    staging = parent / ('codex-' + operations.attempt.manifest_hash[:24])
    staging.mkdir(mode=0o700)
    for name, content in record(value['auth'], 'Codex files').items():
        operations.private_file(staging / name, base64.b64decode(
            cast(str, content), validate=True,
        ))
    metadata = staging.stat()
    atomic_json(receipt, {
        'home': str(target), 'identity': [metadata.st_dev, metadata.st_ino],
        'uid': uid, 'gid': gid,
        'inputsSha256': operations.manifest['inputsSha256'],
        'localRefreshForbiddenAfterHandover': True,
    })
    staging.rename(target)
    sync_directory(parent)


def candidate_document(operations: HostOperations) -> dict[str, object]:
    topology = record(operations.manifest['topology'], 'topology')
    old = record(record(topology['services'], 'services')['web'], 'old web')
    original = operations.inspect(cast(str, old['id']))[0]
    image = rows(json.loads(operations.docker(
        'image', 'inspect', cast(str, old['imageId']),
    )), 'original image')[0]
    resources = record(operations.manifest['resources'], 'resources')
    web = record(operations.manifest['finalWeb'], 'final web')
    workers = record(operations.manifest['finalWorker'], 'final workers')
    if web['sha'] != workers['sha']:
        raise ValueError('one-admitted-final-source-required')
    result = candidate_compose(
        attempt_id=operations.attempt.directory.name,
        web_reference=cast(str, web['reference']),
        worker_reference=cast(str, workers['reference']),
        final_source=cast(str, web['sha']),
        original_environment=environment(original),
        original_image_environment=environment(image),
        auth_source=DIRECTORY + '/auth/codex',
        runtime_uid=cast(int, operations.manifest['runtimeUid']),
        runtime_gid=cast(int, operations.manifest['runtimeGid']),
        web_memory=cast(int, resources['webMemoryBytes']),
        worker_memory=cast(int, resources['workerMemoryBytes']),
        egress_network=PROJECT + '_egress',
        runtime_policy=runtime_policy(operations.manifest),
    )
    for service in record(result['services'], 'candidate services').values():
        record(service, 'candidate service')['labels'] = {
            'io.sotto.review-attempt': operations.attempt.manifest_hash,
        }
    return result


def runtime_identity(operations: HostOperations) -> None:
    worker = record(operations.manifest['finalWorker'], 'final worker')
    actual = json.loads(operations.image_command(
        worker, 'node', ['-e',
                         'console.log(JSON.stringify({uid:process.getuid(),'
                         'gid:process.getgid()}))'], network='none',
    ))
    expected = {'uid': operations.manifest['runtimeUid'],
                'gid': operations.manifest['runtimeGid']}
    if actual != expected or expected['uid'] != 1000:
        raise ValueError('actual-final-runtime-ownership-changed')
    atomic_json(operations.attempt.directory / 'runtime-ownership.json',
                actual)


def validate_created_candidate(
    operations: HostOperations, actual: dict[str, object],
    desired: dict[str, object], expected_image: dict[str, object],
) -> None:
    image = rows(json.loads(operations.docker(
        'image', 'inspect', cast(str, expected_image['imageId']),
    )), 'candidate image')[0]
    config = record(actual['Config'], 'candidate configuration')
    base = record(image['Config'], 'admitted image configuration')
    labels = record(config.get('Labels'), 'candidate labels')
    supplied = record(desired['environment'], 'candidate environment')
    state = record(actual['State'], 'candidate state')
    if (actual['Image'] != expected_image['imageId']
            or actual['Name'] != '/' + str(desired['container_name'])
            or config.get('User') != desired['user']
            or labels.get('io.sotto.review-attempt')
            != operations.attempt.manifest_hash
            or state.get('Running') is not False
            or state.get('Status') != 'created' or state.get('Pid') != 0
            or state.get('StartedAt') != '0001-01-01T00:00:00Z'
            or state.get('ExitCode') != 0 or state.get('OOMKilled') is not False
            or environment(actual) != {**environment(image), **supplied}):
        raise ValueError('created-review-candidate-not-admitted')
    if config.get('Cmd') != desired['command']:
        raise ValueError('candidate-admitted-command-changed')
    for name in ('Entrypoint', 'WorkingDir', 'Healthcheck',
                 'StopSignal', 'ExposedPorts'):
        if config.get(name) != base.get(name):
            raise ValueError('candidate-image-command-changed')
    host = record(actual['HostConfig'], 'candidate host configuration')
    logging = record(desired['logging'], 'candidate logging')
    if (host.get('Privileged') is not False
            or host.get('PublishAllPorts') is not False
            or host.get('ReadonlyRootfs') is not False
            or host.get('NetworkMode') not in {NETWORK, PROJECT + '_egress'}
            or host.get('PidMode') not in ('', None)
            or host.get('IpcMode') != 'private'
            or host.get('UTSMode') not in ('', None)
            or host.get('UsernsMode') not in ('', None)
            or host.get('Memory') != desired['mem_limit']
            or host.get('MemorySwap') != desired['memswap_limit']
            or host.get('RestartPolicy')
            != {'Name': 'no', 'MaximumRetryCount': 0}
            or host.get('LogConfig') != {
                'Type': logging['driver'], 'Config': logging['options'],
            }):
        raise ValueError('candidate-host-configuration-changed')
    for name in ('CapAdd', 'Devices', 'DeviceRequests', 'DeviceCgroupRules',
                 'GroupAdd', 'SecurityOpt', 'VolumesFrom', 'Links', 'Dns',
                 'DnsOptions', 'DnsSearch', 'ExtraHosts'):
        if host.get(name) not in (None, []):
            raise ValueError('candidate-host-access-not-admitted')
    for name in ('PortBindings', 'Sysctls', 'Tmpfs', 'StorageOpt'):
        if host.get(name) not in (None, {}):
            raise ValueError('candidate-host-overrides-not-admitted')
    topology = record(operations.manifest['topology'], 'topology')
    original = record(record(topology['services'], 'services')['web'], 'web')
    expected_mounts = rows(original['mounts'], 'original web mount') + [{
        'Type': 'bind', 'Name': None,
        'Source': DIRECTORY + '/auth/codex', 'Destination': AUTH_HOME,
        'RW': True,
    }]
    mounted = rows(actual.get('Mounts'), 'candidate mount')
    if any(item.get('Propagation') not in ('', 'rprivate', None)
           or item.get('Mode') not in ('', 'rw', None) for item in mounted):
        raise ValueError('candidate-mount-propagation-changed')
    fields = ('Type', 'Name', 'Source', 'Destination', 'RW')
    projected = [{key: item.get(key) for key in fields} for item in mounted]
    if (sorted(projected, key=lambda item: str(item['Destination']))
            != sorted(expected_mounts,
                      key=lambda item: str(item['Destination']))):
        raise ValueError('candidate-storage-mounts-changed')
    networks = record(record(actual['NetworkSettings'], 'candidate network')
                      ['Networks'], 'candidate networks')
    if set(networks) != {NETWORK, PROJECT + '_egress'}:
        raise ValueError('candidate-network-membership-changed')
    review = record(networks[NETWORK], 'review endpoint')
    address = record(desired['networks'], 'desired networks')
    expected_ip = record(address['review'], 'desired review')['ipv4_address']
    ipam = record(review.get('IPAMConfig'), 'candidate IPAM')
    proof = private_json(operations.attempt.directory / 'egress.json')
    guarded = record(networks[PROJECT + '_egress'], 'guarded endpoint')
    expected_ids = {
        NETWORK: record(topology['network'], 'review network')['id'],
        PROJECT + '_egress': proof['networkId'],
    }
    resolved = rows(json.loads(operations.docker(
        'network', 'inspect', NETWORK, PROJECT + '_egress',
    )), 'created candidate networks')
    if (len(resolved) != 2 or {item.get('Name'): item.get('Id')
                              for item in resolved} != expected_ids):
        raise ValueError('created-candidate-network-changed')
    for name, expected_id in expected_ids.items():
        endpoint = record(networks[name], 'created candidate endpoint')
        if endpoint.get('NetworkID') == '':
            if endpoint.get('EndpointID') != '':
                raise ValueError('created-candidate-address-changed')
        elif endpoint.get('NetworkID') != expected_id:
            raise ValueError('created-candidate-address-changed')
    if (ipam.get('IPv4Address') != expected_ip
            or ipam.get('IPv6Address') not in ('', None)
            or review.get('GlobalIPv6Address') not in ('', None)
            or guarded.get('GlobalIPv6Address') not in ('', None)):
        raise ValueError('created-candidate-address-changed')


def candidate(operations: HostOperations, role: str) -> str:
    if role not in {'web', 'workers'}:
        raise ValueError('exact-review-runtime-role-required')
    operations.verify_fence()
    operations.verify_egress()
    operations.verify_images()
    operations.verify_storage()
    document = candidate_document(operations)
    services = record(document['services'], 'candidate services')
    desired = record(services[role], 'candidate role')
    compose = operations.attempt.directory / 'candidate-compose.json'
    encoded = json.dumps(document, sort_keys=True).encode()
    if compose.exists():
        if bounded_bytes(compose, private=True) != encoded:
            raise ValueError('prepared-review-compose-changed')
    else:
        operations.private_file(compose, encoded)
    intent = operations.attempt.directory / (
        'candidate-' + role + '-intent.json'
    )
    wanted = {'name': desired['container_name'],
              'reference': desired['image'],
              'composeHash': hashlib.sha256(encoded).hexdigest()}
    binding_path = operations.attempt.directory / (
        'candidate-' + role + '.json'
    )
    if binding_path.exists():
        if not intent.exists() or private_json(intent) != wanted:
            raise ValueError('retained-review-candidate-intent-changed')
        binding = private_json(binding_path)
        actual = operations.inspect(cast(str, binding['id']))[0]
        if operations.writer_binding(actual) != binding:
            raise ValueError('retained-review-candidate-changed')
    else:
        if intent.exists():
            if private_json(intent) != wanted:
                raise ValueError('unresolved-review-candidate-intent')
        else:
            atomic_json(intent, wanted)
        existing = operations.docker(
            'ps', '-aq', '--no-trunc', '--filter',
            'name=^/' + cast(str, desired['container_name']) + '$',
        ).decode().split()
        if not existing:
            operations.command([
                'docker', 'compose', '-f', str(compose), 'create',
                '--no-build', '--pull', 'never', role,
            ])
        elif len(existing) != 1:
            raise ValueError('unique-attempt-candidate-required')
        actual = operations.inspect(cast(str, desired['container_name']))[0]
        expected_image = record(operations.manifest[
            'finalWeb' if role == 'web' else 'finalWorker'
        ], 'candidate image')
        validate_created_candidate(operations, actual, desired, expected_image)
        atomic_json(binding_path, operations.writer_binding(actual))
    identity = cast(str, actual['Id'])
    state = record(actual['State'], 'candidate state')
    if state.get('Running') is not True:
        if state.get('Status') != 'created':
            raise ValueError('failed-candidate-requires-forward-recovery')
        operations.verify_storage()
        operations.verify_egress()
        operations.docker('start', identity)
    verify_candidate(operations, role)
    return identity


def verify_candidate(
    operations: HostOperations, role: str, *, require_running: bool = True,
) -> str:
    binding = private_json(operations.attempt.directory / (
        'candidate-' + role + '.json'
    ))
    actual = operations.inspect(cast(str, binding['id']))[0]
    if operations.writer_binding(actual) != binding:
        raise ValueError('running-review-candidate-changed')
    state = record(actual['State'], 'running candidate state')
    if (state.get('OOMKilled')
            or (require_running and state.get('Running') is not True)
            or state.get('Status') not in {'running', 'exited', 'created'}):
        raise ValueError('review-candidate-not-running')
    settings = record(actual['NetworkSettings'], 'candidate network')
    networks = record(settings['Networks'], 'candidate networks')
    if set(networks) != {NETWORK, PROJECT + '_egress'}:
        raise ValueError('candidate-network-membership-changed')
    own = record(networks[NETWORK], 'review attachment')
    topology = record(operations.manifest['topology'], 'topology')
    network = record(topology['network'], 'review network')
    address = '172.30.99.10' if role == 'web' else '172.30.99.11'
    actual_address = (own.get('IPAddress') if state.get('Running') else
                      record(own.get('IPAMConfig'), 'stopped IPAM')
                      .get('IPv4Address'))
    if (own.get('NetworkID') != network['id']
            or actual_address != address):
        raise ValueError('candidate-review-address-changed')
    egress = record(networks[PROJECT + '_egress'], 'egress attachment')
    proof = private_json(operations.attempt.directory / 'egress.json')
    if egress.get('NetworkID') != proof['networkId']:
        raise ValueError('candidate-egress-network-changed')
    ports = record(settings['Ports'], 'candidate ports')
    if any(value not in (None, []) for value in ports.values()):
        raise ValueError('review-candidate-published-an-unadmitted-port')
    return cast(str, actual['Id'])


def wait_health(operations: HostOperations, *, public: bool = False) -> None:
    expected = record(operations.manifest['finalWeb'], 'final web')['sha']
    deadline = time.monotonic() + 120
    script = '''(async()=>{
const response=await fetch('http://127.0.0.1:3000/api/v1/health',
 {signal:AbortSignal.timeout(5000)});
const body=await response.json();
console.log(JSON.stringify({status:response.status,body}));
})().catch(()=>{console.log(JSON.stringify({status:0,body:{}}))})'''
    while time.monotonic() < deadline:
        identity = verify_candidate(operations, 'web')
        if public:
            status, body = operations.public_get('/api/v1/health')
            value = json.loads(body)
        else:
            result = record(json.loads(operations.docker(
                'exec', identity, 'node', '-e', script,
            )), 'candidate health')
            status = cast(int, result['status'])
            value = result['body']
        health = record(value, 'health')
        if (status == 200 and health.get('version') == expected
                and health.get('status') == 'healthy'):
            return
        time.sleep(1)
    raise TimeoutError('review-candidate-health-unresolved')


def stream_backup(
    operations: HostOperations, name: str, arguments: Sequence[str], *,
    limit: int, content: bytes | None = None, timeout: float = 600,
) -> Path:
    """Retain partial archives and refuse to overwrite another backup."""
    target = operations.attempt.directory / name
    operations.lock.validate()
    if limit <= 0 or not 0 < timeout <= 600:
        raise ValueError('bounded-backup-output-and-deadline-required')
    descriptor = os.open(
        target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
    )
    try:
        with (os.fdopen(descriptor, 'wb', closefd=False) as output,
              tempfile.TemporaryFile() as error,
              selectors.DefaultSelector() as selector):
            process = subprocess.Popen(
                arguments, stdin=subprocess.PIPE if content is not None
                else subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=error, pass_fds=(9,), start_new_session=True,
            )
            assert process.stdout is not None
            deadline = time.monotonic() + timeout
            total = 0
            try:
                if content is not None:
                    if len(content) > 4096:
                        raise ValueError('bounded-backup-input-required')
                    assert process.stdin is not None
                    process.stdin.write(content)
                    process.stdin.close()
                selector.register(process.stdout, selectors.EVENT_READ)
                while selector.get_map():
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not selector.select(remaining):
                        raise TimeoutError('review-backup-deadline-expired')
                    chunk = os.read(process.stdout.fileno(), 65_536)
                    if not chunk:
                        selector.unregister(process.stdout)
                        break
                    total += len(chunk)
                    if total > limit:
                        raise ValueError('review-backup-byte-budget-exceeded')
                    output.write(chunk)
                code = process.wait(timeout=max(
                    0.001, deadline - time.monotonic(),
                ))
            except BaseException:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=2)
                raise
            finally:
                process.stdout.close()
                if process.stdin is not None:
                    process.stdin.close()
            output.flush()
            os.fsync(descriptor)
            error.seek(0)
            detail = error.read(65_536)
        if code:
            atomic_json(operations.attempt.directory / (
                'backup-failure-' + str(time.time_ns()) + '.json'
            ), {
                'archive': name, 'exitCode': code,
                'stderr': detail.decode(errors='replace'),
            })
            raise ValueError('review-backup-failed')
    finally:
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        sync_directory(target.parent)
    return target

def backup_review(operations: HostOperations) -> None:
    operations.verify_fence()
    if (operations.attempt.directory / 'backups.json').exists():
        verify_backups(operations)
        return
    operations.settle_pending_helpers()
    operations.capacity()
    operations.runtime_environment()
    services = record(record(operations.manifest['topology'], 'topology')
                      ['services'], 'services')
    postgres = record(services['postgres'], 'postgres')
    redis = record(services['redis'], 'redis')
    web = record(services['web'], 'web')
    pg_id = cast(str, postgres['id'])
    redis_id = cast(str, redis['id'])
    budget = cast(int, record(operations.manifest['resources'], 'resources')
                  ['backupBudgetBytes'])
    directory = operations.attempt.directory / ('backup-'+str(time.time_ns()))
    directory.mkdir(mode=0o700)
    sync_directory(directory.parent)
    prefix = directory.name + '/'
    dump = stream_backup(operations, prefix+'review.dump', [
        sys.executable,
        str(operations.root / 'scripts/deploy/database-command.py'),
        'dump', '--container', pg_id,
    ], limit=budget,
        content=operations.private_environment['DATABASE_URL'].encode())
    if not 0 < dump.stat().st_size <= budget:
        raise ValueError('database-backup-budget-exceeded')
    verify_database_backup(operations, dump, pg_id)
    operations.docker('exec', redis_id, 'redis-cli', 'SAVE')
    archives: dict[str, object] = {}
    total = dump.stat().st_size
    for name, container, path in (
        ('redis', redis_id, '/data'),
        ('storage', cast(str, web['id']), '/tmp/sotto-review-storage'),
        ('executions', cast(str, web['id']),
         '/app/apps/web/.sotto/runtime'),
    ):
        archive = backup_archive(operations, prefix+name, container,
                                 cast(str, web['imageId']), path,
                                 budget - total)
        proof = operations.verify_archive(archive, budget - total)
        archives[name] = proof
        total += cast(int, proof['bytes'])
    hashed = hashlib.sha256()
    with dump.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            hashed.update(chunk)
    archives['database'] = {'sha256': hashed.hexdigest(),
                            'bytes': dump.stat().st_size}
    files: dict[str, str] = {}
    for name, source_path in (
        ('compose', Path(DIRECTORY) / 'compose.yml'),
        ('caddy', operations.attempt.directory / 'original-caddy.conf'),
        ('environment', operations.runtime_environment()),
    ):
        value = bounded_bytes(source_path)
        operations.private_file(
            directory / (name + '.backup'), value,
        )
        files[name] = hashlib.sha256(value).hexdigest()
        total += len(value)
    if total > budget:
        raise ValueError('combined-backup-budget-exceeded')
    atomic_json(operations.attempt.directory / 'backups.json', {
        'archives': archives, 'files': files, 'bytes': total,
        'databaseArchiveParsed': True, 'directory': directory.name,
    })
    operations.verify_fence()


def verify_database_backup(
    operations: HostOperations, path: Path, postgres: str, *,
    timeout: float = 120,
) -> None:
    """Bound the actual custom-archive parser and retain failed diagnostics."""
    if not 0 < timeout <= 120:
        raise ValueError('bounded-backup-parser-deadline-required')
    with path.open('rb') as source, tempfile.TemporaryFile() as error:
        process = subprocess.Popen(
            ['docker', 'exec', '-i', postgres, 'pg_restore',
             '--file=/dev/null'], stdin=source, stderr=error,
            stdout=subprocess.DEVNULL, pass_fds=(9,), start_new_session=True,
        )
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=2)
            code = 124
        if code:
            error.seek(0)
            atomic_json(operations.attempt.directory / (
                'backup-parser-failure-'+str(time.time_ns())+'.json'
            ), {'archive': str(path), 'exitCode': code,
                'stderr': error.read(65_536).decode(errors='replace')})
            raise ValueError('database-backup-archive-verification-failed')


def verify_backups(operations: HostOperations) -> None:
    retained = private_json(operations.attempt.directory / 'backups.json')
    name = cast(str, retained['directory'])
    if Path(name).name != name or not name.startswith('backup-'):
        raise ValueError('retained-backup-directory-invalid')
    directory = operations.attempt.directory / name
    metadata = directory.lstat()
    if (not stat.S_ISDIR(metadata.st_mode)
            or metadata.st_uid != os.geteuid() or metadata.st_mode & 0o077):
        raise ValueError('retained-backup-directory-changed')
    budget = cast(int, record(operations.manifest['resources'], 'resources')
                  ['backupBudgetBytes'])
    archives = record(retained['archives'], 'retained archives')
    if (set(archives) != {'database', 'redis', 'storage', 'executions'}
            or retained.get('databaseArchiveParsed') is not True):
        raise ValueError('complete-retained-backups-required')
    total = 0
    for archive_name, proof in archives.items():
        path = directory / ('review.dump' if archive_name == 'database'
                            else archive_name+'.tar')
        if archive_name == 'database':
            actual = file_integrity(path, budget-total)
        else:
            actual = verify_archive(path, budget-total)
        if actual != proof:
            raise ValueError('retained-backup-archive-changed')
        total += cast(int, actual['bytes'])
    files = record(retained['files'], 'retained configurations')
    if set(files) != {'compose', 'caddy', 'environment'}:
        raise ValueError('complete-retained-configuration-required')
    for filename, expected in files.items():
        raw = bounded_bytes(directory / (filename+'.backup'), private=True)
        if hashlib.sha256(raw).hexdigest() != expected:
            raise ValueError('retained-configuration-backup-changed')
        total += len(raw)
    if total != retained['bytes'] or total > budget:
        raise ValueError('retained-combined-backup-budget-changed')


def file_integrity(path: Path, budget: int) -> dict[str, object]:
    metadata = path.stat(follow_symlinks=False)
    if (not stat.S_ISREG(metadata.st_mode)
            or not 0 < metadata.st_size <= budget):
        raise ValueError('bounded-backup-file-required')
    hashed = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b''):
            hashed.update(chunk)
    return {'sha256': hashed.hexdigest(), 'bytes': metadata.st_size}


def backup_archive(
    operations: HostOperations, name: str, source: str, image: str,
    path: str, limit: int,
) -> Path:
    """Name, bind and settle only the admitted read-only archive process."""
    operations.settle_pending_helpers()
    arguments = ['-C', path, '-cf', '-', '.']
    base = rows(json.loads(operations.docker(
        'image', 'inspect', image,
    )), 'backup image')[0]
    binding = {
        'kind': 'backup', 'imageId': image, 'network': 'none',
        'entrypoint': 'tar', 'argumentsHash': checksum(arguments),
        'inputSha256': hashlib.sha256(b'').hexdigest(),
        'sourceContainerId': source, 'invocation': time.time_ns(),
        'memoryBytes': helper_memory(operations.manifest),
        'environmentHash': checksum(environment(base)),
    }
    identity = checksum(binding)
    container_name = PROJECT + '-tool-' + identity[:24]
    journal = operations.attempt.directory / ('helper-'+identity+'.json')
    atomic_json(journal, {**binding, 'name': container_name,
                          'status': 'prepared'})
    container = operations.docker(
        'create', '--name', container_name, '--label',
        'io.sotto.review-attempt='+operations.attempt.manifest_hash,
        '--pull', 'never', '--network', 'none', '--read-only',
        '--memory', str(helper_memory(operations.manifest)),
        '--memory-swap', str(helper_memory(operations.manifest)),
        '--volumes-from', source+':ro', '--user', '0:0',
        '--entrypoint', 'tar', image, *arguments,
    ).decode().strip()
    operations.check_helper(container, {'imageId': image}, binding,
                            container_name)
    atomic_json(journal, {**binding, 'name': container_name,
                          'containerId': container, 'status': 'created'})
    try:
        result = stream_backup(operations, name+'.tar',
                               ['docker', 'start', '-a', container],
                               limit=limit)
    except BaseException:
        operations.settle_helper(container, {'imageId': image}, journal,
                                 binding, container_name,
                                 require_success=False)
        raise
    operations.settle_helper(container, {'imageId': image}, journal, binding,
                             container_name)
    return result


def verify_archive(path: Path, budget: int) -> dict[str, object]:
    size = path.stat(follow_symlinks=False)
    if not stat.S_ISREG(size.st_mode) or not 0 < size.st_size <= budget:
        raise ValueError('bounded-backup-archive-required')
    with tarfile.open(path) as archive:
        total = 0
        for index, member in enumerate(archive):
            name = PurePosixPath(member.name)
            total += member.size
            if (index >= 100_000 or name.is_absolute()
                    or '..' in name.parts or total > budget
                    or not (member.isfile() or member.isdir()
                            or member.issym() or member.islnk())):
                raise ValueError('unsafe-backup-archive-member')
            if member.issym() or member.islnk():
                target = PurePosixPath(member.linkname)
                if target.is_absolute() or '..' in target.parts:
                    raise ValueError('external-backup-link')
    hashed = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            hashed.update(chunk)
    return {'sha256': hashed.hexdigest(), 'bytes': size.st_size}


def install_egress(operations: HostOperations) -> None:
    operations.verify_fence()
    proof_path = operations.attempt.directory / 'egress.json'
    if proof_path.exists():
        operations.verify_egress()
        return
    existing = rows(json.loads(operations.docker(
        'network', 'inspect', NETWORK,
    )), 'review network')[0]
    admitted = record(record(operations.manifest['topology'], 'topology')
                      ['network'], 'admitted network')
    if existing.get('Id') != admitted['id']:
        raise ValueError('captured-review-network-replaced')
    name = PROJECT + '_egress'
    intent = operations.attempt.directory / 'egress-network-intent.json'
    identity_path = operations.attempt.directory / 'egress-network.json'
    current = operations.docker(
        'network', 'ls', '--filter', 'name=^' + name + '$',
        '--format', '{{.ID}}', '--no-trunc',
    ).decode().split()
    binding = {'name': name, 'reviewNetworkId': admitted['id'],
               'attempt': operations.attempt.manifest_hash}
    if intent.exists():
        if private_json(intent) != binding:
            raise ValueError('review-egress-network-intent-changed')
    elif current:
        raise ValueError('unknown-existing-review-egress-network')
    else:
        atomic_json(intent, binding)
    if not current:
        operations.docker('network', 'create', '--driver', 'bridge', '--label',
                          'io.sotto.purpose=review-egress', '--label',
                          'io.sotto.review-attempt='
                          + operations.attempt.manifest_hash, name)
    elif len(current) != 1:
        raise ValueError('unique-review-egress-network-required')
    egress = rows(json.loads(operations.docker(
        'network', 'inspect', name,
    )), 'egress network')[0]
    labels = record(egress.get('Labels') or {}, 'egress labels')
    if (egress.get('Driver') != 'bridge'
            or egress.get('Internal') is not False
            or egress.get('EnableIPv6') is not False
            or labels.get('io.sotto.purpose') != 'review-egress'
            or labels.get('io.sotto.review-attempt')
            != operations.attempt.manifest_hash
            or record(egress.get('Containers'), 'egress attachments')):
        raise ValueError('unadmitted-egress-topology')
    identity = {**binding, 'networkId': egress['Id'],
                'bridge': bridge_name(egress)}
    if identity_path.exists():
        if private_json(identity_path) != identity:
            raise ValueError('created-review-egress-network-replaced')
    else:
        atomic_json(identity_path, identity)
    addresses = host_addresses(json.loads(operations.command(
        ['ip', '-j', 'addr'],
    )))
    rules = render_rules([bridge_name(existing), bridge_name(egress)],
                         addresses).encode()
    candidate = operations.attempt.directory / 'egress.nft'
    if candidate.exists():
        if bounded_bytes(candidate, private=True) != rules:
            raise ValueError('retained-review-guard-rules-changed')
    else:
        operations.private_file(candidate, rules)
    operations.command(['sudo', '-n', '/usr/sbin/nft', '--check', '-f',
                  str(candidate)])
    operations.command(['sudo', '-n', 'install', '-d', '-o', 'root',
                  '-g', 'root',
                  '-m', '0755', '/etc/sotto-review'])
    operations.command(['sudo', '-n', 'install', '-o', 'root', '-g', 'root',
                  '-m',
                  '0644', str(candidate), RULES_PATH])
    unit = operations.attempt.directory / 'sotto-review-egress.service'
    unit_bytes = guard_unit().encode()
    if unit.exists():
        if bounded_bytes(unit, private=True) != unit_bytes:
            raise ValueError('retained-review-guard-unit-changed')
    else:
        operations.private_file(unit, unit_bytes)
    operations.command(['sudo', '-n', 'install', '-o', 'root', '-g', 'root',
                  '-m',
                  '0644', str(unit),
                  '/etc/systemd/system/sotto-review-egress.service'])
    operations.command(['sudo', '-n', 'systemctl', 'daemon-reload'])
    operations.command(['sudo', '-n', 'systemctl', 'enable',
                  'sotto-review-egress.service'])
    operations.command(['sudo', '-n', 'systemctl', 'reload-or-restart',
                        'sotto-review-egress.service'])
    policy = collect_policy(operations.command)
    atomic_json(operations.attempt.directory / 'egress.json', {
        'networkId': egress['Id'], 'policyHash': checksum(
            semantic_policy(policy)),
        'bridges': sorted([bridge_name(existing), bridge_name(egress)]),
        'rulesHash': hashlib.sha256(rules).hexdigest(),
        'addresses': addresses,
    })
