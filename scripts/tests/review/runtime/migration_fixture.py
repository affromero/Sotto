"""Process transport for canonical migration and recovery exercises."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from contextlib import ExitStack
from pathlib import Path, PurePosixPath
from types import TracebackType
from unittest.mock import patch

from scripts.deploy.images.metadata import record
from scripts.deploy.review.runtime.mounts import MOUNT_PROBE
from scripts.deploy.review.runtime.operations import (
    MAINTENANCE,
    HostOperations,
)
from scripts.deploy.review.state import (
    Attempt,
    DeploymentLock,
    atomic_json,
    checksum,
)
from scripts.tests.review.runtime import admitted_runtime_fixture

ToolExecutor = Callable[[Sequence[str], bytes | None, float | None], bytes]
PREFIX = 'apps/web/prisma/migrations/'


def interleaved_inventories() -> list[dict[str, str]]:
    """Model the reviewed 11, 13, 28, 31 inventories with merged timestamps."""
    names = [f'{index:03}_old' for index in range(20, 130, 10)]
    result: list[dict[str, str]] = []
    for additions in (names, ['130_first', '140_first'],
                      [f'{index:03}_middle' for index in range(150, 300, 10)],
                      ['015_final', '025_final', '300_final']):
        previous = result[-1] if result else {}
        result.append({**previous, **{
            PREFIX + name + '/migration.sql':
            hashlib.sha256(name.encode()).hexdigest() for name in additions
        }})
    return result


def sql_names(inventory: Mapping[str, str]) -> dict[str, str]:
    return {PurePosixPath(path).parent.name: value
            for path, value in inventory.items()}


class MigrationFixture:
    """Keep guards and journals real while substituting external processes.

    For a disposable PostgreSQL proof, supply four exact image receipts, their
    SQL inventories and lifecycle helper bytes. ``tool_executor`` receives the
    original rendered ``docker create`` argv, stdin and timeout at each start.
    It must execute that entrypoint/argv with the pinned image, rendered mounts
    and environment against the disposable schema, returning raw stdout or
    raising on failure. It must never silently use the simulated ledger.

    Baseline the seeded eleven migrations with real Prisma resolve --applied
    before invoking migrate_stage. Use reconstruct() across checkpoints and set
    replay_only during retained-stage replay. Apply and resolve the first final
    addition externally for the partial-stage checkpoint, then finish through
    migrate_stage. Check the real ledger and preservation at every checkpoint.
    Docker metadata and helper lifecycle checks run through image_command.
    """

    def __init__(
        self, root: Path, inventories: Sequence[Mapping[str, str]], *,
        receipts: Sequence[Mapping[str, object]] | None = None,
        helper_sources: Sequence[bytes] | None = None,
        tool_executor: ToolExecutor | None = None,
        environment: Mapping[str, str] | None = None,
    ) -> None:
        if len(inventories) < 2:
            raise ValueError('A baseline and a candidate stage are required')
        self.root = root
        root.chmod(0o700)
        self.tool_executor = tool_executor
        self.replay_only = False
        self.ledger: list[dict[str, object]] = []
        self.set_inventory(sql_names(inventories[0]))
        self.deploy_result: Mapping[str, str] | None = None
        self.establishment: Mapping[str, object] | None = None
        self.drift = False
        self.helpers: dict[str, dict[str, object]] = {}
        self.commands: dict[str, list[str]] = {}
        self.inventories = [dict(item) for item in inventories]
        if receipts is None:
            receipts = [{
                'reference': 'fixture@sha256:' + str(index + 1) * 64,
                'imageId': 'sha256:' + str(index + 1) * 64,
                'sha': str(index + 1) * 40,
            } for index in range(len(inventories))]
        if len(receipts) != len(inventories):
            raise ValueError('Exact receipt inventory required')
        self.receipts = [dict(item) for item in receipts]
        repository = Path(__file__).resolve().parents[4]
        if helper_sources is None:
            source = repository / 'scripts/deploy/queue-lifecycle.cjs'
            helper_sources = [source.read_bytes()] * len(inventories)
        if len(helper_sources) != len(inventories):
            raise ValueError('Exact lifecycle helper inventory required')
        self.stages: list[dict[str, object]] = []
        for inventory, receipt, helper_bytes in zip(
            inventories, self.receipts, helper_sources, strict=True,
        ):
            helper = root / 'review-stage-assets' / str(receipt['sha'])
            helper.mkdir(parents=True)
            (helper / 'queue-lifecycle.cjs').write_bytes(helper_bytes)
            self.stages.append({
                'migrations': dict(inventory), 'receipt': receipt,
                'lifecycleSha256': hashlib.sha256(helper_bytes).hexdigest(),
            })
        original_environment = {
            'DATABASE_URL': 'postgresql://fixture/db',
            'REDIS_URL': 'redis://fixture/0',
        } if environment is None else dict(environment)
        storage = root / 'storage'
        storage.mkdir()
        self.original: dict[str, object] = {
            'Id': 'b' * 64, 'Image': self.receipts[0]['imageId'],
            'Config': {'Env': [key + '=' + value for key, value in
                               original_environment.items()]},
            'State': {'Running': True, 'Pid': 123},
            'Mounts': [{'Source': str(storage), 'Destination': '/storage',
                        'RW': True}],
        }
        manifest = {**admitted_runtime_fixture(), 'topology': {
            'services': {'web': {
                'id': self.original['Id'], 'imageId': self.original['Image'],
                'environmentHash': checksum(original_environment),
            }},
        }, 'images': self.receipts[1:], 'stages': self.stages[1:]}
        self.attempt = Attempt.create(root, 'migration-attempt', manifest,
                                      'a' * 64)
        self.retention = root / 'retention'
        self.retention.mkdir()
        for receipt in self.receipts[1:]:
            name = ('sotto-review-import-' + str(receipt['sha']) + '-'
                    + str(receipt['reference']).rsplit(':', 1)[1] + '.json')
            atomic_json(self.retention / name, {
                'protected_images': [receipt['imageId']],
                'image_ref': receipt['reference'],
                'release_sha': receipt['sha'], 'state': 'verified',
            })
        self.host_state = root / 'host-state'
        self.host_state.mkdir(mode=0o700)
        self.attempt.install_marker(self.host_state / 'unresolved.json')
        self.caddy = root / 'caddy.conf'
        self.caddy.write_bytes(MAINTENANCE)
        path = root / 'deployment.lock'
        path.touch(mode=0o600)
        self.lock = DeploymentLock(path)
        self.boundaries = ExitStack()
        self.boundaries.callback(self.lock.close)

    def __enter__(self) -> MigrationFixture:
        module = 'scripts.deploy.review.runtime.operations.'
        for name, value in (('HOST_STATE', self.host_state),
                            ('RETENTION', self.retention),
                            ('CADDY', self.caddy)):
            self.boundaries.enter_context(patch(module + name, value))
        self.boundaries.enter_context(patch.object(
            HostOperations, 'command', side_effect=self.command,
        ))
        response = self.boundaries.enter_context(patch(
            'http.client.HTTPSConnection',
        )).return_value.getresponse.return_value
        response.status = 503
        response.read.return_value = b'Review upgrade in progress.'
        return self

    def __exit__(
        self, kind: type[BaseException] | None, value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.boundaries.__exit__(kind, value, traceback)

    def reconstruct(self) -> HostOperations:
        operations = HostOperations(Attempt(self.attempt.directory), self.lock)
        operations.root = self.root
        return operations

    def set_inventory(self, inventory: Mapping[str, str]) -> None:
        self.ledger = [{'name': name, 'checksum': value, 'finished': True,
                        'rolledBack': False}
                       for name, value in inventory.items()]

    def stage_path(self, index: int) -> Path:
        return self.attempt.directory / (
            'stage-' + str(self.receipts[index]['sha']) + '.json'
        )

    def command(
        self, arguments: Sequence[str], *, content: bytes | None = None,
        timeout: float | None = 60,
    ) -> bytes:
        self.lock.validate()
        if list(arguments) == ['sudo', '-n', '/usr/bin/python3',
                               '-c', MOUNT_PROBE]:
            request = json.loads(content or b'{}')
            return json.dumps({
                'sources': {source: {'path': source, 'ancestors': [[1, 2]]}
                            for source in request['sources']},
                'mounted': {item['key']: [1, 2]
                            for item in request['mounted']},
            }).encode()
        if not arguments or arguments[0] != 'docker':
            raise AssertionError('Unexpected external command')
        action = list(arguments[1:])
        if action[:2] == ['image', 'inspect'] and len(action) == 3:
            receipt = next(item for item in self.receipts if action[2]
                           in (item['imageId'], item['reference']))
            return json.dumps([{
                'Id': receipt['imageId'], 'Os': 'linux',
                'Architecture': 'amd64', 'RepoDigests': [receipt['reference']],
                'Config': {'User': '1000', 'Env': [], 'Labels': {
                    'org.opencontainers.image.revision': receipt['sha'],
                }},
            }]).encode()
        if action == ['ps', '-aq', '--no-trunc']:
            identities = [str(self.original['Id']), *self.helpers]
            return '\n'.join(identities).encode()
        if action and action[0] == 'inspect':
            return json.dumps([
                self.original if identity == self.original['Id']
                else self.helpers[identity] for identity in action[1:]
            ]).encode()
        if action and action[0] == 'create':
            return self.create_helper(list(arguments))
        if action[:2] == ['start', '-ai'] and len(action) == 3:
            identity = action[2]
            try:
                return self.run_tool(self.commands[identity], content, timeout)
            except BaseException:
                state = record(self.helpers[identity]['State'], 'helper')
                state['ExitCode'] = 1
                raise
        raise AssertionError('Unexpected external command')

    def create_helper(self, command: list[str]) -> bytes:
        values = dict(line.split('=', 1) for line in Path(
            command[command.index('--env-file') + 1],
        ).read_text().splitlines())
        labels: dict[str, str] = {}
        mounts: list[dict[str, object]] = []
        for index, option in enumerate(command):
            if option in {'--env', '--label'}:
                key, value = command[index + 1].split('=', 1)
                (values if option == '--env' else labels)[key] = value
            if option == '--mount':
                fields = dict(part.split('=', 1) for part in
                              command[index + 1].split(',') if '=' in part)
                mounts.append({'Source': fields['src'],
                               'Destination': fields['dst'],
                               'RW': 'readonly' not in command[index + 1]})
        entry = command.index('--entrypoint')
        receipt = next(item for item in self.receipts if command[entry + 2]
                       in (item['reference'], item['imageId']))
        identity = checksum(command)
        self.commands[identity] = command
        self.helpers[identity] = {
            'Id': identity, 'Image': receipt['imageId'],
            'Name': '/' + command[command.index('--name') + 1],
            'Config': {'Entrypoint': [command[entry + 1]],
                       'Cmd': command[entry + 3:], 'Labels': labels,
                       'User': command[command.index('--user') + 1],
                       'Env': [key + '=' + value for key, value in
                               values.items()]},
            'HostConfig': {'ReadonlyRootfs': '--read-only' in command,
                           'Privileged': '--privileged' in command,
                           'NetworkMode': command[
                               command.index('--network') + 1],
                           'Memory': int(command[
                               command.index('--memory') + 1]),
                           'MemorySwap': int(command[
                               command.index('--memory-swap') + 1])},
            'State': {'Running': False, 'OOMKilled': False, 'ExitCode': 0},
            'Mounts': mounts,
        }
        return identity.encode()

    def run_tool(
        self, command: Sequence[str], content: bytes | None,
        timeout: float | None,
    ) -> bytes:
        entry = command.index('--entrypoint')
        entrypoint, reference = command[entry + 1:entry + 3]
        arguments = list(command[entry + 3:])
        if entrypoint == 'node':
            arguments = arguments[1:]
        inventory = (entrypoint == 'node' and len(arguments) == 2
                     and arguments[0] == '-e'
                     and 'SELECT json_agg' in arguments[1]
                     and 'FROM \\"_prisma_migrations\\"' in arguments[1])
        if self.replay_only and not inventory:
            raise AssertionError('Replay attempted a schema-changing tool')
        deploy = entrypoint == 'npx' and arguments == [
            '--no-install', 'prisma', 'migrate', 'deploy',
            '--config=/app/prisma.config.ts',
        ]
        diff = entrypoint == 'npx' and arguments == [
            '--no-install', 'prisma', 'migrate', 'diff',
            '--config=/app/prisma.config.ts', '--from-config-datasource',
            '--to-schema', '/app/apps/web/prisma/schema.prisma',
            '--script', '--exit-code',
        ]
        established = entrypoint == 'node' and arguments == [
            '--require', 'tsx/cjs', '/review-stage/queue-lifecycle.cjs',
        ] and content == b'{"command":"established"}'
        if not any((inventory, deploy, diff, established)):
            raise AssertionError('Unexpected maintenance tool')
        if self.tool_executor is not None:
            return self.tool_executor(command, content, timeout)
        if inventory:
            return json.dumps(self.ledger).encode()
        index = next(index for index, item in enumerate(self.receipts)
                     if reference in (item['reference'], item['imageId']))
        if deploy:
            expected = sql_names(self.inventories[index])
            self.set_inventory(expected if self.deploy_result is None
                               else self.deploy_result)
        if established:
            result = {
                'established': True, 'appliedMigrations': len(self.ledger),
            } if self.establishment is None else self.establishment
            return b'SOTTO_DEPLOY_QUEUE=' + json.dumps(result).encode()
        if diff and self.drift:
            raise RuntimeError('Prisma detected schema drift')
        return b''
