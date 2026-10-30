"""Admit and inspect the existing production topology for a clean primary setup."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import parse_qsl, unquote, urlsplit


VOLUMES = (
    'sotto_postgres_data', 'sotto_sotto_redis_data', 'sotto-storage',
    'sotto-executions', 'sotto-cli-credentials',
)
CONTAINERS = (
    'sotto-prod-postgres', 'sotto-prod-redis', 'sotto-prod-pgbouncer',
    'sotto-prod-pinchtab',
)
PROJECTS = ('sotto', 'sotto-blue', 'sotto-green')
LABEL = 'fm.sotto.bootstrap'
IMAGES = {
    'sotto-prod-postgres': 'pgvector/pgvector:pg17',
    'sotto-prod-redis': 'redis:7-alpine',
    'sotto-prod-pgbouncer': 'edoburu/pgbouncer:v1.23.1-p3',
    'sotto-prod-pinchtab': 'pinchtab/pinchtab',
}


def docker(*arguments: str) -> str:
    return subprocess.check_output(['docker', *arguments], text=True).strip()


def url(value: str, *, hosts: set[str], user: str, password: str,
        database: str, scheme: str, options: set[tuple[str, str]]) -> None:
    parsed = urlsplit(value)
    if (parsed.scheme not in ({'postgres', 'postgresql'} if scheme == 'postgres' else {'redis'})
            or parsed.hostname not in hosts or parsed.port not in (None, 5432 if scheme == 'postgres' else 6379)
            or unquote(parsed.username or '') != user
            or unquote(parsed.password or '') != password
            or parsed.path not in ({'/' + database} if scheme == 'postgres' else {'', '/0'})
            or parsed.fragment):
        raise ValueError('Bootstrap endpoint does not match the clean primary services')
    query = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
    if len(query) != len(set(key for key, _ in query)) or not set(query) <= options:
        raise ValueError('Bootstrap endpoint contains unreviewed connection options')


def configuration() -> dict[str, str]:
    environment = os.environ
    if environment.get('SOTTO_STACK') != 'sotto':
        raise ValueError('Clean bootstrap supports the primary stack only')
    user = environment.get('POSTGRES_USER', 'sotto')
    database = environment.get('POSTGRES_DB', 'sotto')
    password = environment.get('POSTGRES_PASSWORD', '')
    redis_password = environment.get('REDIS_PASSWORD', '')
    if not user or not database or not password or not redis_password:
        raise ValueError('Clean bootstrap requires its own database and Redis credentials')
    if (not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', user)
            or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', database)
            or not re.fullmatch(r'[A-Za-z0-9._~-]+', password)
            or not re.fullmatch(r'[A-Za-z0-9._~-]+', redis_password)):
        raise ValueError('Bootstrap credentials are incompatible with the production Compose configuration')
    if any(character in password + redis_password for character in ('\n', '\r', '\x00')):
        raise ValueError('Clean bootstrap credentials contain unsupported control characters')
    if any(name.startswith('PG') and value for name, value in environment.items()):
        raise ValueError('PostgreSQL environment overrides require separate review')
    url(environment['DATABASE_URL'], hosts={'postgres', 'pgbouncer'}, user=user,
        password=password, database=database, scheme='postgres',
        options={('schema', 'public'), ('pgbouncer', 'true')})
    url(environment['DIRECT_DATABASE_URL'], hosts={'postgres'}, user=user,
        password=password, database=database, scheme='postgres', options={('schema', 'public')})
    url(environment['REDIS_URL'], hosts={'redis'}, user='', password=redis_password,
        database='0', scheme='redis', options=set())
    if environment.get('LOCAL_STORAGE_DIR', '/app/apps/web/.sotto/storage') != '/app/apps/web/.sotto/storage':
        raise ValueError('Clean bootstrap cannot adopt custom storage')
    return {key: environment.get(key, '') for key in (
        'DATABASE_URL', 'DIRECT_DATABASE_URL', 'REDIS_URL', 'POSTGRES_USER',
        'POSTGRES_DB', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'LOCAL_STORAGE_DIR',
    )}


def preflight() -> dict[str, object]:
    config = configuration()
    names = set(docker('ps', '-a', '--format', '{{.Names}}').splitlines())
    if names.intersection(CONTAINERS):
        raise ValueError('Existing infrastructure containers require reviewed recovery')
    for project in PROJECTS:
        if docker('ps', '-aq', '--no-trunc', '--filter',
                  'label=com.docker.compose.project=' + project):
            raise ValueError('Existing stack containers require reviewed recovery')
    if set(docker('volume', 'ls', '--format', '{{.Name}}').splitlines()).intersection(VOLUMES):
        raise ValueError('Existing stack volumes require reviewed recovery')
    if 'sotto-network' in docker('network', 'ls', '--format', '{{.Name}}').splitlines():
        raise ValueError('Existing stack network requires reviewed recovery')
    home = Path(os.environ['HOME'])
    caddy = Path(os.environ.get('CADDY_SITE_PATH', '/etc/caddy/conf.d/sotto.conf'))
    if caddy.exists() or caddy.is_symlink():
        raise ValueError('Existing Caddy destination requires reviewed recovery')
    retention = Path(os.environ.get('PRODUCTION_IMAGE_RETENTION_DIR', str(home / '.local/state/production-image-retention')))
    backup = Path(os.environ.get('SOTTO_BACKUP_DIR', str(home / '.local/state/sotto-backups/sotto')))
    attempts = home / '.local/state/sotto-deploy'
    if (retention.is_symlink() or (retention.exists() and not retention.is_dir())
            or any(retention.glob('sotto.json')) or any(retention.glob('sotto-attempt-*.json'))):
        raise ValueError('Existing image retention records require reviewed recovery')
    if backup.is_symlink() or (backup.exists() and (not backup.is_dir() or any(backup.iterdir()))):
        raise ValueError('Existing backup records require reviewed recovery')
    if attempts.is_symlink() or (attempts.exists() and (not attempts.is_dir() or any(attempts.iterdir()))):
        raise ValueError('Existing deployment records require reviewed recovery')
    daemon = docker('info', '--format', '{{.ID}}')
    if not daemon:
        raise ValueError('Docker daemon identity is unavailable')
    images = {name: docker('image', 'inspect', '--format', '{{.Id}}', reference)
              for name, reference in IMAGES.items()}
    if any(not re.fullmatch(r'sha256:[a-f0-9]{64}', image) for image in images.values()):
        raise ValueError('Preinstalled infrastructure image identities required')
    return {'daemon': daemon, 'images': images, 'configurationSha256': hashlib.sha256(
        json.dumps(config, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}


def create_volumes(attempt: str, expected_daemon: str) -> None:
    if not re.fullmatch(r'[0-9]+-[0-9]+', attempt):
        raise ValueError('Exact bootstrap attempt identity required')
    if docker('info', '--format', '{{.ID}}') != expected_daemon:
        raise ValueError('Docker daemon changed during bootstrap')
    names = set(docker('ps', '-a', '--format', '{{.Names}}').splitlines())
    if names.intersection(CONTAINERS):
        raise ValueError('Infrastructure appeared after bootstrap admission')
    for project in PROJECTS:
        if docker('ps', '-aq', '--no-trunc', '--filter',
                  'label=com.docker.compose.project=' + project):
            raise ValueError('Stack containers appeared after bootstrap admission')
    if 'sotto-network' in docker('network', 'ls', '--format', '{{.Name}}').splitlines():
        raise ValueError('Stack network appeared after bootstrap admission')
    existing = set(docker('volume', 'ls', '--format', '{{.Name}}').splitlines())
    if existing.intersection(VOLUMES):
        raise ValueError('A bootstrap volume appeared after admission')
    for name in VOLUMES:
        if docker('volume', 'create', '--label', LABEL + '=' + attempt, name) != name:
            raise ValueError('Docker returned a different bootstrap volume')
        rows = json.loads(docker('volume', 'inspect', name))
        if (not isinstance(rows, list) or len(rows) != 1 or rows[0].get('Name') != name
                or rows[0].get('Driver') != 'local' or rows[0].get('Options') not in (None, {})
                or rows[0].get('Labels', {}).get(LABEL) != attempt):
            raise ValueError('Bootstrap volume identity or ownership changed')
        docker('run', '--rm', '--pull', 'never', '--network', 'none', '--user', '0',
               '--entrypoint', 'node', '--mount',
               'type=volume,src=' + name + ',dst=/admission,volume-nocopy,readonly',
               os.environ['SOTTO_WORKERS_IMAGE_REF'], '-e',
               "if(require('node:fs').readdirSync('/admission').length)process.exit(1)")


def verify_infrastructure(attempt: str, expected: dict[str, object]) -> dict[str, str]:
    if docker('info', '--format', '{{.ID}}') != expected.get('daemon'):
        raise ValueError('Docker daemon changed during bootstrap')
    config_hash = hashlib.sha256(json.dumps(
        configuration(), sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if config_hash != expected.get('configurationSha256'):
        raise ValueError('Bootstrap connection configuration changed')
    for name in VOLUMES:
        rows = json.loads(docker('volume', 'inspect', name))
        if (not isinstance(rows, list) or len(rows) != 1 or rows[0].get('Name') != name
                or rows[0].get('Driver') != 'local' or rows[0].get('Options') not in (None, {})
                or not isinstance(rows[0].get('Labels'), dict)
                or rows[0]['Labels'].get(LABEL) != attempt):
            raise ValueError('Bootstrap volume identity changed')
    networks = json.loads(docker('network', 'inspect', 'sotto-network'))
    containers = json.loads(docker('inspect', *CONTAINERS))
    if (not isinstance(networks, list) or len(networks) != 1
            or not isinstance(containers, list) or len(containers) != len(CONTAINERS)):
        raise ValueError('Exact bootstrap infrastructure inspection required')
    network = networks[0]
    network_id = network.get('Id')
    if not isinstance(network_id, str) or not re.fullmatch(r'[a-f0-9]{64}', network_id):
        raise ValueError('Exact bootstrap network identity required')
    expected_mount = {'sotto-prod-postgres': ('sotto_postgres_data', '/var/lib/postgresql/data'),
                      'sotto-prod-redis': ('sotto_sotto_redis_data', '/data')}
    images = expected.get('images')
    if not isinstance(images, dict) or set(images) != set(CONTAINERS):
        raise ValueError('Admitted infrastructure image identities required')
    identifiers = set()
    postgres_address = ''
    for row in containers:
        name = str(row.get('Name', '')).lstrip('/')
        state, settings = row.get('State', {}), row.get('NetworkSettings', {})
        identifier = row.get('Id')
        if (name not in CONTAINERS or not isinstance(identifier, str)
                or not re.fullmatch(r'[a-f0-9]{64}', identifier) or row.get('Image') != images[name]
                or state.get('Running') is not True or state.get('OOMKilled') is not False):
            raise ValueError('Exact healthy bootstrap infrastructure required')
        attached = settings.get('Networks', {})
        endpoint = attached.get('sotto-network', {})
        alias = name.removeprefix('sotto-prod-')
        if (set(attached) != {'sotto-network'} or endpoint.get('NetworkID') != network_id
                or alias not in (endpoint.get('Aliases') or [])):
            raise ValueError('Bootstrap infrastructure network changed')
        if name in expected_mount:
            mounts = row.get('Mounts')
            volume, destination = expected_mount[name]
            if (not isinstance(mounts, list) or len(mounts) != 1
                    or mounts[0].get('Name') != volume or mounts[0].get('Destination') != destination
                    or mounts[0].get('Type') != 'volume' or mounts[0].get('RW') is not True):
                raise ValueError('Bootstrap infrastructure data volume changed')
        if name == 'sotto-prod-postgres':
            postgres_address = endpoint.get('IPAddress', '')
        identifiers.add(identifier)
    if len(identifiers) != len(CONTAINERS) or set(network.get('Containers', {})) != identifiers:
        raise ValueError('Bootstrap network contains unexpected services')
    if not isinstance(postgres_address, str) or not postgres_address:
        raise ValueError('Bootstrap PostgreSQL network address required')
    return {'networkId': network_id, 'postgresAddress': postgres_address}


def main() -> None:
    if sys.argv[1:] == ['preflight']:
        print(json.dumps(preflight(), sort_keys=True))
    elif len(sys.argv) == 4 and sys.argv[1] == 'create-volumes':
        create_volumes(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == 'verify-infrastructure':
        expected = json.loads(Path(sys.argv[3]).read_text())
        if not isinstance(expected, dict):
            raise ValueError('Bootstrap admission record required')
        print(json.dumps(verify_infrastructure(sys.argv[2], expected), sort_keys=True))
    else:
        raise ValueError('Unknown clean bootstrap operation')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print('Clean bootstrap rejected: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
