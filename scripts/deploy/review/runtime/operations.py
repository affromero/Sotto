"""Bounded host operations for the existing, isolated review stack."""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import subprocess
import sys
import tempfile
import time
from collections.abc import Mapping, Sequence
from importlib import import_module
from pathlib import Path
from typing import cast
from urllib.parse import urlsplit

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.build_observer import TARGET, bounded_bytes
from scripts.deploy.review.egress import (
    RULES_PATH,
    bridge_name,
    collect_policy,
    verify_policy,
)
from scripts.deploy.review.runtime.channel import exchange
from scripts.deploy.review.runtime.mounts import MOUNT_PROBE, resolve_mounts
from scripts.deploy.review.runtime.policy import (
    admit_queue_getter,
    bind_helper_environment,
    concurrent_memory,
    helper_arguments,
    helper_memory,
    retain_queue_intent,
    runtime_policy,
)
from scripts.deploy.review.runtime.release.migrations import (
    later_stage_progress,
    migration_inventory,
    stage_progress,
    verify_stage_schema,
)
from scripts.deploy.review.runtime.services import (
    backup_review,
    install_egress,
    verify_archive,
)
from scripts.deploy.review.state import (
    Attempt,
    DeploymentLock,
    atomic_json,
    checksum,
    private_json,
    sync_directory,
)
from scripts.deploy.review.topology import (
    DIRECTORY,
    NETWORK,
    PROJECT,
    capture,
    classified_environment,
    environment,
    rows,
    verify_capture,
)

HOST_STATE = Path('/home/sotto/.local/state/sotto-review-deploy')
RETENTION = Path('/home/sotto/.local/state/production-image-retention')
CAPACITY = '/usr/local/lib/production/production_capacity.py'
CADDY = Path('/etc/caddy/conf.d/sotto-review.conf')
CADDY_ROOT = Path('/etc/caddy/Caddyfile')
MAINTENANCE = b'''demo.sotto.fm {
    header Cache-Control "no-store"
    respond "Review upgrade in progress." 503
}
'''


class HostOperations:
    attempt: Attempt
    lock: DeploymentLock
    root: Path
    manifest: dict[str, object]
    private_environment: dict[str, str]

    def __init__(self, attempt: Attempt, lock: DeploymentLock) -> None:
        self.attempt = attempt
        self.lock = lock
        self.root = Path(__file__).resolve().parents[4]
        self.manifest = attempt.manifest()
        self.private_environment = {}

    def command(
        self, arguments: Sequence[str], *, content: bytes | None = None,
        timeout: float | None = 60,
    ) -> bytes:
        """Keep output private and exclude arguments from error categories."""
        self.lock.validate()
        with (tempfile.TemporaryFile() as output,
              tempfile.TemporaryFile() as error):
            if arguments and arguments[0] == 'sudo':
                if list(arguments[:2]) != ['sudo', '-n']:
                    raise ValueError('noninteractive-root-command-required')
                self.verify_tools()
                command = [
                    'sudo', '-n', '/usr/bin/python3', '-m',
                    'scripts.deploy.review.runtime.privileged',
                    '--lock', str(self.lock.path), '--owner-uid',
                    str(os.geteuid()),
                ]
                if content is not None:
                    if len(content) > 262_144:
                        raise ValueError('bounded-root-input-required')
                    hashed = hashlib.sha256(content).hexdigest()
                    payload = self.attempt.directory / (
                        'root-input-' + str(time.time_ns()) + '.json'
                    )
                    self.private_file(payload, content)
                    command.extend(['--payload', str(payload),
                                    '--payload-sha256', hashed])
                command.extend(['--', *arguments[2:]])
                result = subprocess.run(
                    command, stdin=9, stdout=output, stderr=error,
                    pass_fds=(9,), timeout=timeout, check=False,
                    cwd=self.root,
                )
            else:
                result = subprocess.run(
                    arguments, input=content, stdout=output, stderr=error,
                    pass_fds=(9,), timeout=timeout, check=False,
                )
            output.seek(0)
            value = output.read(8 * 1024 * 1024 + 1)
            error.seek(0)
            diagnostic = error.read(65_537)
        if result.returncode:
            atomic_json(self.attempt.directory / (
                'command-failure-' + str(time.time_ns()) + '.json'
            ), {
                'exitCode': result.returncode,
                'stderr': diagnostic.decode(errors='replace'),
            })
            raise RuntimeError('review-command-failed')
        if len(value) > 8 * 1024 * 1024 or len(diagnostic) > 65_536:
            raise ValueError('review-command-output-bound')
        return value

    def docker(self, *arguments: str) -> bytes:
        return self.command(['docker', *arguments])

    def verify_tools(self) -> None:
        self.verify_tool_inventory(self.root, self.manifest)

    @staticmethod
    def verify_tool_inventory(
        root: Path, manifest: Mapping[str, object],
    ) -> None:
        tools = record(manifest['tools'], 'review tools')
        required = {
            'scripts/deploy/review/first-worker.ts',
            'scripts/deploy/review/readiness.ts',
            'scripts/deploy/review/runtime/channel.ts',
            'scripts/deploy/review/runtime/channel.py',
            'scripts/deploy/review/runtime/operations.py',
            'scripts/deploy/review/runtime/privileged.py',
            'scripts/deploy/review/runtime/mounts.py',
            'scripts/deploy/review/runtime/transport.ts',
            'scripts/deploy/review/state.py',
            'scripts/deploy/review/topology.py',
            'scripts/deploy/review/egress.py',
            'scripts/deploy/queue-lifecycle.cjs',
            'scripts/deploy/compatibility-review.py',
        }
        runtime = root / 'scripts/deploy/review/runtime'
        required.update(str(path.relative_to(root)) for path in
                        runtime.rglob('*')
                        if path.is_file() and path.suffix in {'.py', '.ts'})
        if not required <= tools.keys() or len(tools) > 200:
            raise ValueError('complete-runtime-source-binding-required')
        for relative, expected in tools.items():
            path = Path(relative)
            if (path.is_absolute() or '..' in path.parts
                    or not relative.startswith('scripts/deploy/')
                    or hashlib.sha256(bounded_bytes(root / path))
                    .hexdigest() != digest(expected, 'runtime tool')):
                raise ValueError('reviewed-runtime-tool-changed')

    def inspect(self, *identities: str) -> list[dict[str, object]]:
        if not identities or len(identities) > 1000:
            raise ValueError('bounded-container-inventory-required')
        return rows(json.loads(self.docker('inspect', *identities)),
                    'container')

    def resolved_mounts(
        self, containers: Sequence[Mapping[str, object]],
        protected: set[str],
    ) -> list[dict[str, object]]:
        path = self.attempt.directory / 'original-mount-objects.json'
        retained = private_json(path) if path.exists() else None

        def probe(content: bytes) -> bytes:
            return self.command(
                ['sudo', '-n', '/usr/bin/python3', '-c', MOUNT_PROBE],
                content=content,
            )

        result, bindings = resolve_mounts(
            containers, protected, probe, retained,
            self.admitted_writers(containers),
        )
        if retained is None:
            atomic_json(path, bindings)
        return result

    def admitted_writers(
        self, containers: Sequence[Mapping[str, object]],
    ) -> set[str]:
        allowed: set[str] = set()
        for role in ('web', 'workers'):
            path = self.attempt.directory / ('candidate-' + role + '.json')
            if not path.exists():
                continue
            retained = private_json(path)
            actual = [item for item in containers
                      if item['Id'] == retained.get('id')]
            if (len(actual) != 1
                    or self.writer_binding(actual[0]) != retained):
                raise ValueError('admitted-review-writer-changed')
            allowed.add(cast(str, retained['id']))
        return allowed

    @staticmethod
    def writer_binding(container: Mapping[str, object]) -> dict[str, object]:
        return {
            'id': container['Id'], 'imageId': container['Image'],
            'name': container['Name'],
            'configHash': checksum(container['Config']),
            'hostHash': checksum(container['HostConfig']),
            'mountsHash': checksum(container['Mounts']),
        }

    def verify_storage(self) -> None:
        services = record(record(self.manifest['topology'], 'topology')
                          ['services'], 'services')
        identities = {str(record(item, 'service')['id'])
                      for item in services.values()}
        all_ids = self.docker('ps', '-aq', '--no-trunc').decode().split()
        self.resolved_mounts(self.inspect(*all_ids), identities)

    def preflight(self) -> dict[str, object]:
        endpoint = os.environ.get('DOCKER_HOST') or self.docker(
            'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}',
        ).decode().strip()
        if (endpoint not in {'unix:///var/run/docker.sock',
                              'unix:///run/docker.sock'}
                or not sys.platform.startswith('linux')):
            raise ValueError('local-linux-docker-daemon-required')
        expected = record(self.manifest['topology'], 'admitted topology')
        services = record(expected['services'], 'admitted services')
        identities = [cast(str, record(service, 'service')['id'])
                      for service in services.values()]
        all_ids = self.docker('ps', '-aq', '--no-trunc').decode().split()
        all_containers = self.resolved_mounts(self.inspect(*all_ids),
                                              set(identities))
        containers = [item for item in all_containers
                      if item.get('Id') in identities]
        web = next(item for item in containers
                   if item['Id'] == record(services['web'], 'web')['id'])
        images = rows(json.loads(self.docker(
            'image', 'inspect', cast(str, web['Image']),
        )), 'image')
        if len(images) != 1:
            raise ValueError('unique-historical-image-required')
        image_environment = environment(images[0])
        self.private_environment = environment(web)
        network = rows(json.loads(self.docker(
            'network', 'inspect', NETWORK,
        )), 'network')
        if len(network) != 1:
            raise ValueError('unique-review-network-required')
        actual = capture(containers, network[0], all_containers,
                         original_image_environment=image_environment)
        verify_capture(expected, actual)
        files = record(self.manifest['originalFiles'], 'original files')
        for name, path in (
            ('compose', Path(DIRECTORY) / 'compose.yml'),
            ('caddyFragment', CADDY), ('caddyRoot', CADDY_ROOT),
        ):
            if hashlib.sha256(bounded_bytes(path)).hexdigest() != files[name]:
                raise ValueError('original-configuration-changed')
        for marker in (
            Path('/home/sotto/.local/state/sotto-deploy/unresolved.json'),
            HOST_STATE / 'unresolved.json',
        ):
            if marker.exists() or marker.is_symlink():
                raise ValueError('existing-unresolved-deployment')
        self.verify_images()
        self.capacity()
        return {'topologyHash': checksum(actual),
                'imageEnvironment': image_environment}

    def verify_images(
        self, *, require_imports: bool = True, final_only: bool = False,
    ) -> None:
        images = rows(self.manifest['images'], 'admitted image')
        if final_only:
            references = {record(self.manifest[key], key)['reference']
                          for key in ('finalWeb', 'finalWorker')}
            images = [image for image in images
                      if image['reference'] in references]
            if {image['reference'] for image in images} != references:
                raise ValueError('final-runtime-image-receipts-required')
        for receipt in images:
            reference = cast(str, receipt['reference'])
            actual = rows(json.loads(self.docker(
                'image', 'inspect', reference,
            )), 'image')
            if len(actual) != 1:
                raise ValueError('unique-prestaged-image-required')
            image = actual[0]
            config = record(image.get('Config'), 'image configuration')
            labels = record(config.get('Labels'), 'image labels')
            if (
                image.get('Id') != receipt['imageId']
                or image.get('Os') != 'linux'
                or image.get('Architecture') != 'amd64'
                or labels.get('org.opencontainers.image.revision')
                != receipt['sha']
                or reference not in cast(list[str], image.get('RepoDigests'))
                or config.get('User') != '1000'
            ):
                raise ValueError('prestaged-image-identity-changed')
            if not require_imports:
                continue
            name = ('sotto-review-import-' + cast(str, receipt['sha']) + '-'
                    + reference.rsplit(':', 1)[1] + '.json')
            protection = private_json(RETENTION / name)
            if (
                protection.get('protected_images') != [receipt['imageId']]
                or protection.get('image_ref') != reference
                or protection.get('release_sha') != receipt['sha']
                or protection.get('state') != 'verified'
            ):
                raise ValueError('verified-import-protection-required')

    def capacity(self) -> None:
        resources = record(self.manifest['resources'], 'resources')
        docker_root = self.docker(
            'info', '--format', '{{.DockerRootDir}}',
        ).decode().strip()
        self.command([
            sys.executable, CAPACITY, 'before-switch',
            '--docker-root', docker_root,
            '--backup-path', str(self.attempt.directory),
            '--backup-bytes', str(resources['backupBudgetBytes']),
        ])
        require_memory = import_module('scripts.deploy.stop-workers')
        require_memory.require_overlap_memory(
            Path('/proc/meminfo').read_text(),
            concurrent_memory(self.manifest),
        )

    def install_caddy(self, content: bytes) -> None:
        target = self.attempt.directory / (
            'caddy-' + hashlib.sha256(content).hexdigest() + '.conf'
        )
        if target.exists():
            if bounded_bytes(target, private=True) != content:
                raise ValueError('private-caddy-candidate-changed')
        else:
            self.private_file(target, content)
        self.command([
            'sudo', '-n', 'install', '-o', 'root', '-g', 'root', '-m', '0644',
            str(target), str(CADDY),
        ])
        self.command([
            'sudo', '-n', 'caddy', 'validate', '--config', str(CADDY_ROOT),
        ])
        self.command(['sudo', '-n', 'systemctl', 'reload', 'caddy'])

    def fence(self) -> None:
        marker = HOST_STATE / 'unresolved.json'
        if marker.exists() or marker.is_symlink():
            self.attempt.verify_marker(marker)
        else:
            self.attempt.install_marker(marker)
        original = self.attempt.directory / 'original-caddy.conf'
        if not original.exists():
            self.private_file(original, bounded_bytes(CADDY))
        expected = record(self.manifest['originalFiles'], 'original files')
        if hashlib.sha256(bounded_bytes(original, private=True)).hexdigest() \
                != expected['caddyFragment']:
            raise ValueError('retained-caddy-identity-changed')
        self.install_caddy(MAINTENANCE)
        self.verify_fence()

    def verify_fence(self) -> None:
        self.lock.validate()
        self.attempt.verify_marker(HOST_STATE / 'unresolved.json')
        if bounded_bytes(CADDY) != MAINTENANCE:
            raise ValueError('review-fence-changed')
        status, body = self.public_get('/')
        if status != 503 or body != b'Review upgrade in progress.':
            raise ValueError('public-review-fence-not-established')

    def retire_old_web(self) -> None:
        services = record(record(self.manifest['topology'], 'topology')
                          ['services'], 'services')
        web = record(services['web'], 'old web')
        identity = cast(str, web['id'])
        actual = self.inspect(identity)[0]
        state = record(actual['State'], 'old web state')
        if actual['Image'] != web['imageId']:
            raise ValueError('captured-web-image-changed')
        restart = record(actual['HostConfig'], 'old web host') \
            .get('RestartPolicy')
        if (restart != web['restartPolicy'] or record(restart, 'restart')
                .get('Name') not in {'no', 'unless-stopped'}):
            raise ValueError('old-web-restart-could-bypass-upgrade-fence')
        self.verify_storage()
        if state.get('Running') is True:
            stop = import_module('scripts.deploy.stop-workers')
            stop.stop_container(
                identity, lambda *args: self.docker(*args).decode(),
                worker=False,
            )
        elif state.get('OOMKilled') or state.get('ExitCode') not in (0, 143):
            raise ValueError('old-web-stop-is-unresolved')
        self.verify_fence()

    def verify_empty_redis(self) -> None:
        self.runtime_environment()
        url = urlsplit(self.private_environment['REDIS_URL'])
        if (url.scheme != 'redis' or url.username or url.password
                or url.hostname not in {'redis', 'sotto-review-redis-1'}
                or url.port not in (None, 6379)
                or url.path not in ('', '/0') or url.query or url.fragment):
            raise ValueError('captured-review-redis-cli-target-not-admitted')
        topology = record(self.manifest['topology'], 'topology')
        redis = record(record(topology['services'], 'services')['redis'],
                       'captured Redis')
        command = ('exec', cast(str, redis['id']), 'redis-cli', '--raw',
                   '-n', '0')
        for arguments in (('DBSIZE',), ('SCAN', '0', 'COUNT', '1000'),
                          ('DBSIZE',)):
            lines = self.docker(*command, *arguments).decode().splitlines()
            if not lines or lines[0] != '0' or any(lines[1:]):
                raise ValueError('review-redis-is-not-empty')

    @staticmethod
    def public_get(path: str) -> tuple[int, bytes]:
        connection = http.client.HTTPSConnection('demo.sotto.fm', timeout=15)
        try:
            connection.request('GET', path)
            response = connection.getresponse()
            content = response.read(262_145)
            if len(content) > 262_144:
                raise ValueError('bounded-public-response-required')
            return response.status, content
        finally:
            connection.close()

    @staticmethod
    def private_file(path: Path, content: bytes) -> None:
        descriptor = os.open(
            path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600,
        )
        try:
            with os.fdopen(descriptor, 'wb', closefd=False) as output:
                output.write(content)
                output.flush()
                os.fsync(descriptor)
        finally:
            os.close(descriptor)
        sync_directory(path.parent)

    def verify_archive(self, path: Path, budget: int) -> dict[str, object]:
        return verify_archive(path, budget)

    def runtime_environment(self) -> Path:
        topology = record(self.manifest['topology'], 'topology')
        web = record(record(topology['services'], 'services')['web'], 'web')
        original = self.inspect(cast(str, web['id']))[0]
        if original.get('Image') != web['imageId']:
            raise ValueError('historical-runtime-image-changed')
        values = environment(original)
        if checksum(values) != web['environmentHash']:
            raise ValueError('historical-environment-changed')
        self.private_environment = values
        if any('\n' in value or '\r' in value or '\x00' in value
               for value in values.values()):
            raise ValueError('unsupported-docker-environment-value')
        encoded = ''.join(f'{name}={value}\n'
                          for name, value in sorted(values.items())).encode()
        target = self.attempt.directory / 'original.env'
        if target.exists():
            if bounded_bytes(target, private=True) != encoded:
                raise ValueError('retained-private-environment-changed')
        else:
            self.private_file(target, encoded)
        return target

    def image_command(
        self, receipt: Mapping[str, object], entrypoint: str,
        arguments: Sequence[str], *, content: bytes | None = None,
        network: str = NETWORK, mounts: Sequence[str] = (),
    ) -> bytes:
        """An admitted image runs the explicitly named maintenance tool."""
        self.settle_pending_helpers()
        arguments = helper_arguments(self.manifest, entrypoint, arguments)
        image = rows(json.loads(self.docker(
            'image', 'inspect', cast(str, receipt['reference']),
        )), 'maintenance image')[0]
        image_id = digest(image['Id'], 'maintenance image', 'sha256:')
        binding = {
            'kind': 'maintenance', 'imageId': image_id, 'network': network,
            'entrypoint': entrypoint, 'argumentsHash': checksum(arguments),
            'inputSha256': hashlib.sha256(content or b'').hexdigest(),
            'memoryBytes': helper_memory(self.manifest),
            'invocation': time.time_ns(),
        }
        identity = checksum(binding)
        name = PROJECT + '-tool-' + identity[:24]
        path = self.attempt.directory / ('helper-' + identity + '.json')
        command = self.tool_command(
            receipt, entrypoint, arguments, network=network, mounts=mounts,
            container_name=name,
        )
        binding['environmentHash'] = bind_helper_environment(
            self, command, image,
        )
        atomic_json(path, {**binding, 'name': name, 'status': 'prepared'})
        container_id = self.command(command).decode().strip()
        digest(container_id, 'maintenance container')
        admitted_image = {'imageId': image_id}
        self.check_helper(container_id, admitted_image, binding, name)
        atomic_json(path, {**binding, 'name': name,
                           'containerId': container_id, 'status': 'created'})
        try:
            value = self.command(['docker', 'start', '-ai', container_id],
                                 content=content, timeout=900)
        except BaseException:
            self.settle_helper(container_id, admitted_image, path, binding,
                               name, require_success=False)
            raise
        self.settle_helper(container_id, admitted_image, path, binding, name)
        return value

    def tool_command(
        self, receipt: Mapping[str, object], entrypoint: str,
        arguments: Sequence[str], *, network: str = NETWORK,
        mounts: Sequence[str] = (),
        container_name: str | None = None,
    ) -> list[str]:
        if entrypoint not in {'node', 'npx', 'tar'}:
            raise ValueError('unsupported-reviewed-tool-entrypoint')
        if network not in {NETWORK, 'none'} \
                and not network.startswith('container:'):
            raise ValueError('unsupported-reviewed-tool-network')
        self.runtime_environment()
        self.verify_storage()
        topology = record(self.manifest['topology'], 'topology')
        old = record(record(topology['services'], 'services')['web'], 'web')
        image = rows(json.loads(self.docker(
            'image', 'inspect', cast(str, old['imageId']),
        )), 'historical image')[0]
        values = classified_environment(self.private_environment,
                                        environment(image))
        values.update({'COMMIT_SHA': cast(str, receipt['sha']),
                       'HOME': '/home/sotto',
                       'CODEX_HOME': '/home/sotto/.codex'})
        heap = runtime_policy(self.manifest)['helperHeapMiB']
        values['NODE_OPTIONS'] = (values.get('NODE_OPTIONS', '')
                                 + f' --max-old-space-size={heap}').strip()
        encoded = ''.join(f'{name}={value}\n'
                          for name, value in sorted(values.items())).encode()
        private_env = self.attempt.directory / (
            'tool-' + hashlib.sha256(encoded).hexdigest() + '.env'
        )
        if not private_env.exists():
            self.private_file(private_env, encoded)
        elif bounded_bytes(private_env, private=True) != encoded:
            raise ValueError('stage-tool-environment-changed')
        command = ['docker']
        if container_name is None:
            command.extend(['run', '--rm', '-i'])
        else:
            command.extend(['create', '-i', '--name', container_name,
                            '--label', 'io.sotto.review-attempt='
                            + self.attempt.manifest_hash])
        command.extend([
            '--pull', 'never', '--platform',
            'linux/amd64', '--read-only', '--tmpfs', '/tmp',
            '--network', network, '--user', '1000',
            '--memory', str(helper_memory(self.manifest)),
            '--memory-swap', str(helper_memory(self.manifest)),
            '--workdir', '/app/apps/web', '--env-file',
            str(private_env), '--env', 'TSX_DISABLE_CACHE=1',
            '--env', 'TSX_TSCONFIG_PATH=/app/apps/web/tsconfig.json',
        ])
        for mount in mounts:
            command.extend(['--mount', mount])
        command.extend(['--entrypoint', entrypoint,
                        cast(str, receipt['reference']), *arguments])
        return command

    def check_stage(
        self, stage: Mapping[str, object], previous: Mapping[str, object],
    ) -> None:
        before = record(previous['migrations'], 'previous migrations')
        after = record(stage['migrations'], 'stage migrations')
        changes = {name: {'previousSha256': before.get(name),
                          'candidateSha256': after.get(name)}
                   for name in sorted(before.keys() | after.keys())
                   if before.get(name) != after.get(name)}
        guard = import_module('scripts.deploy.compatibility-review')
        guard.published_migration_additions(changes)
        self.verify_images()
        self.verify_fence()
        self.verify_storage()

    def applied_migrations(self) -> dict[str, str]:
        sql = '''SELECT json_agg(json_build_object(
'name',migration_name,'checksum',checksum,'finished',finished_at IS NOT NULL,
'rolledBack',rolled_back_at IS NOT NULL))::text FROM "_prisma_migrations"'''
        script = (
            'const {Client}=require("pg");'
            'const c=new Client({connectionString:process.env.DATABASE_URL,'
            'connectionTimeoutMillis:5000,query_timeout:5000});'
            '(async()=>{await c.connect();try{'
            'await c.query("BEGIN READ ONLY");'
            'const r=await c.query(' + json.dumps(sql) + ');'
            'console.log(r.rows[0].json_agg);'
            '}finally{await c.query("ROLLBACK");await c.end()}})()'
            '.catch(()=>{console.error("Migration inventory unavailable");'
            'process.exitCode=1});'
        )
        topology = record(self.manifest['topology'], 'topology')
        old = record(record(topology['services'], 'services')['web'], 'web')
        values = json.loads(self.image_command(
            {'reference': old['imageId'], 'sha': TARGET},
            'node', ['-e', script],
        ))
        result: dict[str, str] = {}
        for migration in rows(values, 'applied migration'):
            name = migration.get('name')
            if (
                not isinstance(name, str) or name in result
                or migration.get('finished') is not True
                or migration.get('rolledBack') is not False
            ):
                raise ValueError('unfinished-or-ambiguous-migration')
            result[name] = digest(migration.get('checksum'), 'applied SQL')
        return result

    def migrate_stage(
        self, stage: Mapping[str, object], previous: Mapping[str, object],
    ) -> None:
        self.check_stage(stage, previous)
        expected = migration_inventory(stage)
        applied = self.applied_migrations()
        retained = self.attempt.directory / (
            'stage-' + cast(str, record(stage['receipt'], 'stage')['sha'])
            + '.json'
        )
        if retained.exists():
            proof = private_json(retained)
            if (proof.get('verified') is not True
                    or proof.get('migrations') != expected):
                raise ValueError('retained-stage-verification-changed')
            inventories = [migration_inventory(item) for item in
                           rows(self.manifest['stages'], 'admitted stage')]
            if not later_stage_progress(applied, expected, inventories):
                raise ValueError('unknown-post-stage-sql-state')
            verify_stage_schema(self, stage, retained=proof)
            return
        if not stage_progress(
            applied, migration_inventory(previous), expected,
        ):
            raise ValueError('actual-sql-is-not-an-admitted-stage-prefix')
        if applied != expected:
            self.image_command(
                record(stage['receipt'], 'stage image'), 'npx',
                ['--no-install', 'prisma', 'migrate', 'deploy',
                 '--config=/app/prisma.config.ts'],
            )
        if self.applied_migrations() != expected:
            raise ValueError('stage-sql-not-established')
        receipt = record(stage['receipt'], 'stage image')
        helper = self.root / 'review-stage-assets' / cast(str, receipt['sha'])
        source = helper / 'queue-lifecycle.cjs'
        if hashlib.sha256(bounded_bytes(source)).hexdigest() \
                != stage['lifecycleSha256']:
            raise ValueError('stage-matched-helper-changed')
        result = self.image_command(
            receipt, 'node', ['--require', 'tsx/cjs',
                              '/review-stage/queue-lifecycle.cjs'],
            content=b'{"command":"established"}',
            mounts=[f'type=bind,src={helper},dst=/review-stage,readonly'],
        )
        lines = result.decode().splitlines()
        proofs = [json.loads(line.removeprefix('SOTTO_DEPLOY_QUEUE='))
                  for line in lines if line.startswith('SOTTO_DEPLOY_QUEUE=')]
        if (len(proofs) != 1 or proofs[0].get('established') is not True
                or proofs[0].get('appliedMigrations') != len(expected)):
            raise ValueError('canonical-stage-establishment-failed')
        verification = verify_stage_schema(self, stage)
        atomic_json(self.attempt.directory / (
            'stage-' + cast(str, receipt['sha']) + '.json'
        ), {'verified': True, 'migrations': expected, **verification})

    def backups(self) -> None:
        backup_review(self)

    def install_egress(self) -> None:
        install_egress(self)

    def verify_egress(self) -> None:
        proof = private_json(self.attempt.directory / 'egress.json')
        topology = record(self.manifest['topology'], 'topology')
        expected = record(topology['network'], 'admitted review network')
        networks = rows(json.loads(self.docker(
            'network', 'inspect', NETWORK, PROJECT + '_egress',
        )), 'guarded review networks')
        by_name = {item.get('Name'): item for item in networks}
        if (len(networks) != 2 or set(by_name) != {
            NETWORK, PROJECT + '_egress',
        } or by_name[NETWORK].get('Id') != expected['id']
                or by_name[PROJECT + '_egress'].get('Id')
                != proof['networkId']
                or sorted(bridge_name(item) for item in networks)
                != proof['bridges']):
            raise ValueError('guarded-review-network-identity-changed')
        policy = collect_policy(self.command)
        verify_policy(policy, cast(str, proof['policyHash']))
        if hashlib.sha256(bounded_bytes(Path(RULES_PATH))).hexdigest() \
                != proof['rulesHash']:
            raise ValueError('persistent-egress-configuration-changed')

    def runtime_exchange(
        self, mode: str, value: object, *,
        checkpoint: object = None, candidate_id: str | None = None,
    ) -> object:
        """Bind the helper before start and audit its exit."""
        if mode not in {'capture', 'inspect', 'prepare', 'providers',
                        'queues', 'continuation', 'consumers', 'workloads',
                        'paused-admission', 'queue-policy'}:
            raise ValueError('unsupported-review-runtime-operation')
        self.lock.validate()
        self.settle_pending_helpers()
        if mode == 'queue-policy':
            admit_queue_getter(self)
        elif mode != 'capture':
            self.verify_fence()
            self.verify_egress()
        image = record(self.manifest['finalWorker'], 'final worker image')
        self.verify_tools()
        tools = record(self.manifest['tools'], 'review tools')
        if mode in {'providers', 'workloads'}:
            if candidate_id is None:
                raise ValueError('exact-private-candidate-required')
            digest(candidate_id, 'candidate container')
            candidate = self.inspect(candidate_id)[0]
            expected_web = record(self.manifest['finalWeb'], 'final web')
            if (candidate['Id'] != candidate_id
                    or candidate['Image'] != expected_web['imageId']
                    or record(candidate['State'], 'candidate state')
                    .get('Running') is not True):
                raise ValueError('private-candidate-identity-changed')
            network = 'container:' + candidate_id
        else:
            if candidate_id is not None:
                raise ValueError('unexpected-runtime-network-reference')
            network = NETWORK
        initial = {'mode': mode, 'input': value,
                   'checkpoint': checkpoint,
                   'policy': runtime_policy(self.manifest)}
        script = (
            'require("/app/scripts/deploy/review/runtime/channel.ts")'
            '.main().catch(()=>{console.error('
            '"Review runtime operation failed");process.exitCode=1})'
        )
        arguments = helper_arguments(
            self.manifest, 'node', ['--require', 'tsx/cjs', '-e', script],
        )
        binding = {'mode': mode, 'inputSha256': checksum(initial),
                   'imageId': image['imageId'], 'network': network,
                   'entrypoint': 'node', 'toolsSha256': checksum(tools),
                   'argumentsHash': checksum(arguments),
                   'memoryBytes': helper_memory(self.manifest),
                   'invocation': time.time_ns()}
        identity = checksum(binding)
        name = PROJECT + '-tool-' + identity[:24]
        intent = self.attempt.directory / ('helper-' + identity + '.json')
        if intent.exists():
            raise ValueError('retained-helper-requires-explicit-recovery')
        command = self.tool_command(
            image, 'node', arguments,
            network=network,
            container_name=name,
            mounts=[f'type=bind,src={self.root / "scripts/deploy"},'
                    'dst=/app/scripts/deploy,readonly'],
        )
        actual_image = rows(json.loads(self.docker(
            'image', 'inspect', cast(str, image['imageId']),
        )), 'runtime helper image')[0]
        binding['environmentHash'] = bind_helper_environment(
            self, command, actual_image,
        )
        atomic_json(intent, {**binding, 'name': name, 'status': 'prepared'})
        # Create first so process loss cannot hide the container identity.
        container_id = self.command(command).decode().strip()
        digest(container_id, 'runtime helper container')
        actual = self.inspect(container_id)[0]
        self.check_helper(container_id, image, binding, name)
        if (actual['Id'] != container_id
                or actual['Image'] != image['imageId']
                or record(actual['HostConfig'], 'helper host')
                .get('NetworkMode') != network):
            raise ValueError('created-runtime-helper-identity-changed')
        atomic_json(intent, {**binding, 'name': name,
                             'containerId': container_id,
                             'status': 'created'})

        def verify() -> None:
            if mode == 'queue-policy':
                admit_queue_getter(self)
            else:
                self.verify_fence()
                self.verify_egress()
            current = self.inspect(container_id)[0]
            if (current['Id'] != container_id
                    or current['Image'] != image['imageId']
                    or record(current['State'], 'helper state')
                    .get('Running') is not True):
                raise ValueError('runtime-helper-identity-changed')

        def original_manifest(manifest: Mapping[str, object]) -> None:
            expected = record(self.manifest['originalQueues'],
                              'admitted empty queue manifest')
            if dict(manifest) != expected:
                raise ValueError('runtime-original-queues-changed')
            path = self.attempt.directory / 'original-queues.json'
            if path.exists():
                raise ValueError('original-queue-manifest-already-retained')
            atomic_json(path, manifest)

        try:
            result = exchange(
                ['docker', 'start', '-ai', container_id], initial,
                directory=self.attempt.directory,
                assert_fence=verify, queue_manifest=original_manifest,
                queue_policy=lambda value: retain_queue_intent(self, value),
                timeout=(3330 if mode == 'workloads' else
                         330 if mode == 'providers' else 100),
            )
        except BaseException as original:
            try:
                self.settle_helper(container_id, image, intent, binding, name,
                                   require_success=False)
            except BaseException as cleanup:
                raise RuntimeError('runtime-helper-settlement-unresolved') \
                    from cleanup
            atomic_json(self.attempt.directory / (
                'runtime-failure-' + str(time.time_ns()) + '.json'
            ), {'mode': mode, 'category': type(original).__name__,
                'containerId': container_id})
            raise
        self.settle_helper(container_id, image, intent, binding, name)
        if mode == 'queue-policy':
            admit_queue_getter(self)
        elif mode != 'capture':
            self.verify_fence()
            self.verify_egress()
        else:
            self.lock.validate()
        atomic_json(intent, {**binding, 'name': name,
                             'containerId': container_id,
                             'status': 'verified'})
        return result

    def settle_pending_helpers(self) -> None:
        self.lock.validate()
        paths = sorted(self.attempt.directory.glob('helper-*.json'))
        if len(paths) > 1000:
            raise ValueError('review-helper-history-bound')
        for path in paths:
            retained = private_json(path)
            if retained.get('status') in {'settled', 'verified', 'uncreated'}:
                continue
            name = cast(str, retained['name'])
            if not name.startswith(PROJECT + '-tool-'):
                raise ValueError('retained-helper-name-not-admitted')
            identity = retained.get('containerId')
            if identity is None:
                found = self.docker(
                    'ps', '-aq', '--no-trunc', '--filter',
                    'name=^/' + name + '$',
                ).decode().split()
                if not found:
                    atomic_json(path, {**retained, 'status': 'uncreated'})
                    continue
                if len(found) != 1:
                    raise ValueError('unresolved-helper-identity')
                identity = found[0]
            digest(identity, 'retained helper')
            binding = {key: value for key, value in retained.items()
                       if key not in {'name', 'status', 'containerId'}}
            self.settle_helper(cast(str, identity),
                               {'imageId': retained['imageId']}, path,
                               binding, name, require_success=False)

    def check_helper(
        self, identity: str, image: Mapping[str, object],
        binding: Mapping[str, object], name: str,
    ) -> dict[str, object]:
        actual = self.inspect(identity)[0]
        config = record(actual['Config'], 'runtime helper configuration')
        labels = record(config.get('Labels'), 'runtime helper labels')
        host = record(actual['HostConfig'], 'runtime helper host')
        if (actual['Id'] != identity or actual['Image'] != image['imageId']
                or actual['Name'] != '/' + name
                or labels.get('io.sotto.review-attempt')
                != self.attempt.manifest_hash
                or config.get('Entrypoint') != [binding['entrypoint']]
                or checksum(config.get('Cmd')) != binding['argumentsHash']
                or config.get('User') != (
                    '0:0' if binding.get('kind') == 'backup' else '1000'
                )
                or host.get('ReadonlyRootfs') is not True
                or host.get('Privileged') is not False
                or host.get('NetworkMode') != binding['network']):
            raise ValueError('retained-runtime-helper-identity-changed')
        if (host.get('Memory') != binding['memoryBytes']
                or binding['memoryBytes'] != helper_memory(self.manifest)
                or host.get('MemorySwap') != binding['memoryBytes']
                or checksum(environment(actual))
                != binding['environmentHash']):
            raise ValueError('retained-helper-resource-or-environment-changed')
        return actual

    def settle_helper(
        self, identity: str, image: Mapping[str, object], path: Path,
        binding: Mapping[str, object], name: str,
        *, require_success: bool = True,
    ) -> None:
        actual = self.check_helper(identity, image, binding, name)
        if record(actual['State'], 'runtime helper state').get('Running'):
            # This is the admitted maintenance process, never an app worker.
            self.docker('stop', '--time', '15', identity)
            actual = self.inspect(identity)[0]
        state = record(actual['State'], 'settled helper state')
        if state.get('Running') or state.get('OOMKilled'):
            raise ValueError('runtime-helper-not-settled')
        atomic_json(path, {**binding, 'name': name,
                           'containerId': identity,
                           'status': 'settled',
                           'exitCode': state.get('ExitCode')})
        if require_success and state.get('ExitCode') != 0:
            raise ValueError('runtime-helper-unsuccessful')
