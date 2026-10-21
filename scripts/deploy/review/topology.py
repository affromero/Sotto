"""Exact existing review topology and private candidate configuration."""

from __future__ import annotations

import ipaddress
import re
from collections.abc import Mapping, Sequence
from pathlib import PurePosixPath

from scripts.deploy.images.metadata import (
    digest,
    image_reference,
    record,
    source_sha,
)
from scripts.deploy.review.artifact import review_reference
from scripts.deploy.review.build_observer import TARGET
from scripts.deploy.review.state import checksum

PROJECT = 'sotto-review'
ORIGIN = 'https://demo.sotto.fm'
DIRECTORY = '/home/sotto/sotto-review'
NETWORK = 'sotto-review_review'
STORAGE = '/tmp/sotto-review-storage'
EXECUTIONS = '/app/apps/web/.sotto/runtime'
AUTH_HOME = '/home/sotto/.codex'
SERVICES = ('postgres', 'redis', 'web')
PUBLIC_ENVIRONMENT = {
    'NEXT_PUBLIC_APP_URL': ORIGIN,
    'NODE_ENV': 'production',
    'SELF_HOSTED': 'true',
    'LOCAL_STORAGE_DIR': STORAGE,
    'SIDEDOOR_EXECUTION_DIR': EXECUTIONS + '/executions',
}
PRESERVED_ENVIRONMENT = {
    *PUBLIC_ENVIRONMENT, 'DATABASE_URL', 'REDIS_URL', 'BYOK_ENCRYPTION_KEY',
    'NODE_OPTIONS', 'NEXT_TELEMETRY_DISABLED', 'PORT', 'HOSTNAME',
    'CLAUDE_HOME', 'SIDEDOOR_PASSWORD_ORIGINS', 'SOTTO_PRIVACY_CONTACT_EMAIL',
}
REPLACED_ENVIRONMENT = {'COMMIT_SHA', 'HOME', 'CODEX_HOME'}
IMAGE_ENVIRONMENT = {'NODE_VERSION', 'YARN_VERSION', 'PATH'}


def classified_environment(
    values: Mapping[str, str], image: Mapping[str, str],
) -> dict[str, str]:
    if set(values) - (
        PRESERVED_ENVIRONMENT | REPLACED_ENVIRONMENT | IMAGE_ENVIRONMENT
    ):
        raise ValueError('Unreviewed existing runtime environment setting')
    for name in IMAGE_ENVIRONMENT & set(values):
        if values[name] != image.get(name):
            raise ValueError('Operator changed an image-default setting')
    return {name: value for name, value in values.items()
            if name in PRESERVED_ENVIRONMENT}


def overlaps(left: str, right: str) -> bool:
    paths = [PurePosixPath(value) for value in (left, right)]
    if any(not path.is_absolute() or '..' in path.parts for path in paths):
        raise ValueError('Expected canonical absolute storage source paths')
    return (paths[0] == paths[1] or paths[0] in paths[1].parents
            or paths[1] in paths[0].parents)


def rows(value: object, name: str) -> list[dict[str, object]]:
    if not isinstance(value, list) or len(value) > 1000:
        raise ValueError(f'Expected a bounded {name} inventory')
    return [record(item, name) for item in value]


def environment(container: Mapping[str, object]) -> dict[str, str]:
    config = record(container.get('Config'), 'container configuration')
    entries = config.get('Env')
    if not isinstance(entries, list) or len(entries) > 200:
        raise ValueError('Expected a bounded environment inventory')
    result: dict[str, str] = {}
    for entry in entries:
        if (not isinstance(entry, str) or len(entry) > 65_536
                or '=' not in entry):
            raise ValueError('Invalid private environment entry')
        name, value = entry.split('=', 1)
        if not re.fullmatch(r'[A-Z][A-Z0-9_]*', name) or name in result:
            raise ValueError('Invalid or duplicate environment name')
        result[name] = value
    return result


def exact_mounts(service: str, value: object) -> list[dict[str, object]]:
    expected = {
        'web': {
            STORAGE: ('bind', DIRECTORY + '/storage'),
            EXECUTIONS: ('volume', PROJECT + '_executions'),
        },
        'postgres': {
            '/var/lib/postgresql/data': ('volume', PROJECT + '_postgres'),
        },
        'redis': {'/data': ('volume', PROJECT + '_redis')},
    }[service]
    mounts = rows(value, 'mount')
    if len(mounts) != len(expected):
        raise ValueError('Unexpected review mount count')
    result: list[dict[str, object]] = []
    for mount in mounts:
        destination = mount.get('Destination')
        if destination not in expected:
            raise ValueError('Unexpected review mount destination')
        kind, source = expected[destination]
        if (
            mount.get('Type') != kind or mount.get('RW') is not True
            or mount.get('Name' if kind == 'volume' else 'Source') != source
            or not isinstance(mount.get('Source'), str)
        ):
            raise ValueError('Review storage identity changed')
        result.append({key: mount.get(key) for key in (
            'Type', 'Name', 'Source', 'Destination', 'RW',
        )})
    if len({mount['Destination'] for mount in result}) != len(expected):
        raise ValueError('Duplicate review storage destination')
    return sorted(result, key=lambda mount: str(mount['Destination']))


def capture(
    containers: Sequence[Mapping[str, object]],
    network: Mapping[str, object],
    all_containers: Sequence[Mapping[str, object]],
    *, original_image_environment: Mapping[str, str],
) -> dict[str, object]:
    """Return bounded identity hashes, without retaining environment values."""
    if len(containers) != 3 or len(all_containers) > 1000:
        raise ValueError('Exactly three existing review containers required')
    network_id = digest(network.get('Id'), 'review network')
    ipam = record(network.get('IPAM'), 'network IPAM')
    subnets = rows(ipam.get('Config'), 'network subnet')
    if (
        network.get('Name') != NETWORK
        or network.get('Driver') != 'bridge'
        or network.get('Internal') is not True
        or network.get('EnableIPv6') is not False
        or subnets != [{'Subnet': '172.30.99.0/24', 'Gateway': '172.30.99.1'}]
    ):
        raise ValueError('Existing isolated review network changed')
    captured: dict[str, object] = {}
    identities: set[str] = set()
    sources: set[str] = set()
    for container in containers:
        config = record(container.get('Config'), 'container configuration')
        labels = record(config.get('Labels'), 'Compose labels')
        service = labels.get('com.docker.compose.service')
        if (
            service not in SERVICES or service in captured
            or labels.get('com.docker.compose.project') != PROJECT
            or labels.get('com.docker.compose.project.config_files')
            != DIRECTORY + '/compose.yml'
            or labels.get('com.docker.compose.project.working_dir')
            != DIRECTORY
        ):
            raise ValueError('Unexpected established review service')
        identity = digest(container.get('Id'), 'container identity')
        identities.add(identity)
        private = environment(container)
        if service == 'web':
            classified_environment(private, original_image_environment)
            if any(private.get(key) != value
                   for key, value in PUBLIC_ENVIRONMENT.items()):
                raise ValueError('Established review configuration changed')
            if (private.get('COMMIT_SHA') != TARGET
                    or config.get('User') != '1000'):
                raise ValueError('Historical source or identity changed')
            for name in ('DATABASE_URL', 'REDIS_URL', 'BYOK_ENCRYPTION_KEY'):
                if not private.get(name):
                    raise ValueError('Established runtime secret missing')
        host = record(container.get('HostConfig'), 'host configuration')
        if (
            host.get('Privileged') is not False
            or host.get('NetworkMode') in {'host', 'none'}
            or host.get('PidMode') not in {'', None}
            or host.get('Binds') is not None
            and not isinstance(host.get('Binds'), list)
            or host.get('CapAdd') not in (None, [])
            or host.get('Devices') not in (None, [])
        ):
            raise ValueError('Unexpected review host access')
        state = record(container.get('State'), 'container state')
        health = state.get('Health')
        if (state.get('Running') is not True
                or state.get('OOMKilled') is not False
                or (health is not None
                    and record(health, 'health').get('Status') != 'healthy')):
            raise ValueError('Established review service is unhealthy')
        settings = record(container.get('NetworkSettings'), 'network settings')
        networks = record(settings.get('Networks'), 'container networks')
        if set(networks) != {NETWORK}:
            raise ValueError('Review container has another network')
        attachment = record(networks[NETWORK], 'review attachment')
        expected_ip = {'web': '172.30.99.10', 'redis': '172.30.99.2',
                       'postgres': '172.30.99.3'}[service]
        if (attachment.get('NetworkID') != network_id
                or attachment.get('IPAddress') != expected_ip
                or attachment.get('GlobalIPv6Address') not in ('', None)):
            raise ValueError('Review network attachment changed')
        ports = record(settings.get('Ports'), 'container ports')
        if any(value not in (None, []) for value in ports.values()):
            raise ValueError('Review ports must not be published on the host')
        mounts = exact_mounts(service, container.get('Mounts'))
        sources.update(str(mount['Source']) for mount in mounts)
        captured[service] = {
            'id': identity,
            'imageId': digest(container.get('Image'), 'image', 'sha256:'),
            'name': container.get('Name'),
            'environmentHash': checksum(private),
            'mounts': mounts,
            'network': {'id': network_id, 'address': expected_ip},
            'user': config.get('User'),
            'restartPolicy': host.get('RestartPolicy'),
            'memory': host.get('Memory'),
            'logging': host.get('LogConfig'),
        }
    if set(captured) != set(SERVICES) or len(identities) != 3:
        raise ValueError('Exact established service inventory required')
    attached = record(network.get('Containers'), 'attached review containers')
    if set(attached) != identities:
        raise ValueError('An unknown container is attached to review storage')
    for container in all_containers:
        if container.get('Id') in identities:
            continue
        config = record(container.get('Config'), 'other configuration')
        labels = record(config.get('Labels') or {}, 'other container labels')
        if labels.get('com.docker.compose.project') == PROJECT:
            raise ValueError('An additional review service exists')
        for mount in rows(container.get('Mounts'), 'other container mount'):
            source = mount.get('Source')
            if (mount.get('RW') is True and isinstance(source, str)
                    and any(overlaps(source, known) for known in sources)):
                raise ValueError('Another container can write review storage')
    return {'schemaVersion': 1, 'origin': ORIGIN, 'services': captured,
            'network': {'id': network_id, 'name': NETWORK,
                        'subnet': '172.30.99.0/24'}}


def verify_capture(
    expected: Mapping[str, object], actual: Mapping[str, object],
) -> None:
    if checksum(expected) != checksum(actual):
        raise ValueError('Captured established review topology changed')


def candidate_compose(
    *, attempt_id: str, web_reference: str, worker_reference: str,
    final_source: str, original_environment: Mapping[str, str],
    original_image_environment: Mapping[str, str],
    auth_source: str, runtime_uid: int, runtime_gid: int,
    web_memory: int, worker_memory: int, egress_network: str,
) -> dict[str, object]:
    """Private JSON Compose document. Callers must never log its contents."""
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,39}', attempt_id):
        raise ValueError('Invalid candidate attempt name')
    source_sha(final_source)
    review_reference(web_reference)
    image_reference('workers', worker_reference)
    if (
        runtime_uid != 1000 or runtime_gid <= 0
        or web_memory < 268_435_456 or worker_memory < 536_870_912
        or auth_source != DIRECTORY + '/auth/codex'
        or egress_network != PROJECT + '_egress'
    ):
        raise ValueError('Invalid admitted candidate resources')
    values = classified_environment(
        original_environment, original_image_environment,
    )
    if any(not values.get(name) for name in (
        'DATABASE_URL', 'REDIS_URL', 'BYOK_ENCRYPTION_KEY',
    )):
        raise ValueError('Established secret input is missing')
    values.update(PUBLIC_ENVIRONMENT)
    values.update({'COMMIT_SHA': final_source, 'HOME': '/home/sotto',
                   'CODEX_HOME': AUTH_HOME, 'PORT': '3000'})
    mounts = [DIRECTORY + '/storage:' + STORAGE,
              'executions:' + EXECUTIONS, auth_source + ':' + AUTH_HOME]
    services: dict[str, object] = {}
    for role, reference, memory, address in (
        ('web', web_reference, web_memory, '172.30.99.10'),
        ('workers', worker_reference, worker_memory, '172.30.99.11'),
    ):
        role_environment = dict(values)
        if role == 'workers':
            role_environment.update({
                'WORKER_PROFILE': 'all', 'WORKER_PRESET': 'full',
                'WORKER_QUEUES': '', 'WORKER_EXCLUDE_QUEUES': '',
            })
        services[role] = {
            'image': reference, 'pull_policy': 'never',
            'container_name': f'{PROJECT}-{attempt_id}-{role}',
            'user': f'{runtime_uid}:{runtime_gid}',
            'environment': role_environment, 'volumes': mounts,
            'restart': 'no', 'mem_limit': memory,
            'logging': {'driver': 'json-file',
                        'options': {'max-size': '10m', 'max-file': '2'}},
            'networks': {'review': {'ipv4_address': address}, 'egress': {}},
        }
    return {
        'name': PROJECT + '-runtime', 'services': services,
        'volumes': {'executions': {'external': True,
                                  'name': PROJECT + '_executions'}},
        'networks': {
            'review': {'external': True, 'name': NETWORK},
            'egress': {'external': True, 'name': egress_network},
        },
    }


def review_address(value: str) -> str:
    address = ipaddress.ip_address(value)
    if address not in ipaddress.ip_network('172.30.99.0/24'):
        raise ValueError('Expected an address on the existing review network')
    return str(address)
