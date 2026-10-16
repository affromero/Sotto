"""Bind independently reviewed runtime overlap to exact immutable images."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
from typing import Mapping, cast


LIMIT = 262144
FIELDS = {
    'schemaVersion', 'procedure', 'stack', 'releaseSha',
    'candidateWebImage', 'candidateWorkersImage', 'previousWebImage',
    'previousWorkerContracts', 'candidateContract', 'reviewer',
    'evidenceSha256',
}
WORKERS = {'workers-heavy', 'workers-pipeline', 'workers-light'}


def provider_activation(review: Mapping[str, object]) -> dict[str, object]:
    value = review.get('providerActivation')
    fields = {
        'mode', 'previousReleaseSha', 'previousAssetsHash',
        'candidateAssetsHash', 'reviewedRuntimeFiles', 'previousRuntimes',
    }
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError('Exact provider continuity review required')
    if value['mode'] != 'preserve-existing' or not isinstance(
        value['previousReleaseSha'], str
    ) or not re.fullmatch(r'[a-f0-9]{40}', value['previousReleaseSha']):
        raise ValueError('Existing provider release identity required')
    for field in ('previousAssetsHash', 'candidateAssetsHash'):
        if not isinstance(value[field], str) or not re.fullmatch(
            r'[a-f0-9]{64}', value[field]
        ):
            raise ValueError('Exact provider asset hash required')
    runtimes = value['previousRuntimes']
    if not isinstance(runtimes, dict) or set(runtimes) != WORKERS | {'web'}:
        raise ValueError('Review must bind the four exact previous runtimes')
    contracts = review.get('previousWorkerContracts')
    if not isinstance(contracts, dict):
        raise ValueError('Previous worker contracts must map exact image IDs')
    for service, runtime in runtimes.items():
        if not isinstance(runtime, dict) or set(runtime) != {'containerId', 'imageId'}:
            raise ValueError('Exact previous runtime identity required')
        if not isinstance(runtime['containerId'], str) or not re.fullmatch(
            r'[a-f0-9]{64}', runtime['containerId']
        ) or not isinstance(runtime['imageId'], str) or not re.fullmatch(
            r'sha256:[a-f0-9]{64}', runtime['imageId']
        ):
            raise ValueError('Full previous runtime identities required')
        allowed = {review.get('previousWebImage')} if service == 'web' else set(contracts)
        if runtime['imageId'] not in allowed:
            raise ValueError('Previous runtime differs from reviewed images')
    files = value['reviewedRuntimeFiles']
    if not isinstance(files, dict) or len(files) > 512:
        raise ValueError('Bounded exact runtime file review required')
    for path, pair in files.items():
        if not isinstance(path, str) or not re.fullmatch(
            r'[A-Za-z0-9_@+.-]+(?:/[A-Za-z0-9_@+.-]+)*', path
        ) or any(part in {'.', '..'} for part in path.split('/')):
            raise ValueError('Exact relative runtime paths required')
        if not isinstance(pair, dict) or set(pair) != {
            'previousSha256', 'candidateSha256',
        } or pair['previousSha256'] == pair['candidateSha256']:
            raise ValueError('Explicit changed runtime blob pair required')
        for digest in pair.values():
            if digest is not None and (
                not isinstance(digest, str)
                or not re.fullmatch(r'[a-f0-9]{64}', digest)
            ):
                raise ValueError('Exact runtime blob hash required')
    return cast(dict[str, object], value)


def unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate review field')
        result[key] = value
    return result


def read_bytes(path: Path, private: bool = False) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > LIMIT:
            raise ValueError('Review must be a bounded regular file')
        if private and (
            metadata.st_uid != os.getuid() or metadata.st_mode & 0o077
        ):
            raise ValueError('Review files must be private and operator-owned')
        content = stream.read(LIMIT + 1)
        if len(content) > LIMIT:
            raise ValueError('Review size bound exceeded')
        return content


def mapping(content: bytes) -> dict[str, object]:
    result: object = json.loads(content, object_pairs_hook=unique_object)
    if not isinstance(result, dict):
        raise ValueError('Review must be an object')
    return cast(dict[str, object], result)


def service_images(path: Path) -> dict[str, str]:
    services = mapping(read_bytes(path)).get('services')
    if not isinstance(services, dict) or not services:
        raise ValueError('Captured service inventory required')
    result: dict[str, str] = {}
    for name, value in services.items():
        if not isinstance(name, str) or not isinstance(value, dict):
            raise ValueError('Malformed service inventory')
        image = value.get('image')
        if not isinstance(image, str) or not re.fullmatch(
            r'sha256:[a-f0-9]{64}', image
        ):
            raise ValueError('Immutable previous image required')
        result[name] = image
    return result


def validate(
    review: Mapping[str, object],
    evidence: bytes,
    candidate_contract: str,
    contracts: bytes,
    environment: Mapping[str, str],
) -> None:
    version = review.get('schemaVersion')
    fields = FIELDS | {'providerActivation'} if version == 2 else FIELDS
    if set(review) != fields or type(version) is not int or version not in {1, 2}:
        raise ValueError('Unexpected review schema')
    expected: dict[str, object] = {
        'schemaVersion': version,
        'procedure': 'compatible-runtime-overlap',
        'stack': environment['SOTTO_STACK'],
        'releaseSha': environment['SOTTO_RELEASE_SHA'],
        'candidateWebImage': environment['SOTTO_WEB_IMAGE_REF'],
        'candidateWorkersImage': environment['SOTTO_WORKERS_IMAGE_REF'],
        'candidateContract': candidate_contract,
        'evidenceSha256': hashlib.sha256(evidence).hexdigest(),
    }
    if not re.fullmatch(r'[a-f0-9]{64}', candidate_contract):
        raise ValueError('Invalid candidate contract')
    previous: dict[str, str] = {}
    for line in contracts.decode().splitlines():
        image, digest = line.split()
        if image in previous or not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise ValueError('Invalid previous contract inventory')
        previous[image] = digest
    workers = service_images(Path(environment['PREVIOUS_WORKER_IMAGES']))
    if set(previous) != set(workers.values()):
        raise ValueError('Previous worker inventory changed')
    expected['previousWorkerContracts'] = previous
    web = service_images(Path(environment['PREVIOUS_APP_IMAGES']))
    if set(web) != {'web'}:
        raise ValueError('Unique previous web image required')
    expected['previousWebImage'] = web['web']
    for field, value in expected.items():
        if review[field] != value:
            raise ValueError('Review does not match ' + field)
    reviewer = review['reviewer']
    if not isinstance(reviewer, str) or not reviewer.strip():
        raise ValueError('Independent reviewer identity required')
    if not evidence.strip():
        raise ValueError('Independent review evidence required')
    if version == 2:
        provider_activation(review)


def sync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def record_marker(
    path: Path, state: str, overrides: str, stack: str, phase: str,
) -> None:
    if phase not in {
        'unresolved', 'compatibility-preparation', 'compatibility-cutover',
    }:
        raise ValueError('Unknown recovery phase')
    value = {
        'stack': stack, 'stateDirectory': state,
        'imageOverrides': overrides, 'phase': phase,
    }
    exists = path.exists()
    if exists:
        previous = mapping(read_bytes(path, private=True))
        if set(previous) != set(value) or any(
            previous[key] != value[key] for key in value if key != 'phase'
        ):
            raise ValueError('Recovery attempt identity changed')
        if phase == 'unresolved':
            return
        if phase != 'compatibility-cutover' or (
            previous['phase'] != 'compatibility-preparation'
        ):
            raise ValueError('Unexpected recovery transition')
    elif phase == 'compatibility-cutover':
        raise ValueError('Compatibility preparation marker required')
    raw = json.dumps(value).encode()
    if not exists:
        descriptor = os.open(
            path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        sync_directory(path.parent)
        return
    descriptor, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def clear_marker(path: Path, state: str, phase: str) -> None:
    marker = mapping(read_bytes(path, private=True))
    if set(marker) != {
        'stack', 'stateDirectory', 'imageOverrides', 'phase',
    } or marker.get('stateDirectory') != state or marker.get('phase') != phase:
        raise ValueError('Recovery marker changed; preserve it for review')
    os.unlink(path)
    sync_directory(path.parent)


def atomic_json(
    path: Path, value: Mapping[str, object], mode: int = 0o600,
) -> None:
    descriptor, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream)
            os.fchmod(stream.fileno(), mode)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def prepare_activation(
    directory: Path, environment: Mapping[str, str],
) -> None:
    directory.mkdir(mode=0o755)
    directory.chmod(0o755)
    atomic_json(directory / 'fish.json', {
        'releaseSha': environment['SOTTO_RELEASE_SHA'], 'fishEnabled': False,
    }, 0o444)
    for variable in ['APP_IMAGES', 'WORKER_IMAGES']:
        path = Path(environment[variable])
        overrides = mapping(read_bytes(path))
        services = overrides.get('services')
        if not isinstance(services, dict) or not services:
            raise ValueError('Candidate compose services required')
        for service in services.values():
            if not isinstance(service, dict):
                raise ValueError('Invalid candidate compose service')
            settings = service.get('environment', {})
            volumes = service.get('volumes', [])
            if not isinstance(settings, dict) or not isinstance(volumes, list):
                raise ValueError('Invalid candidate compose override')
            service['environment'] = {
                **settings,
                'SOTTO_PROVIDER_ACTIVATION_FILE':
                    '/run/sotto-provider-activation/fish.json',
                'SOTTO_RELEASE_SHA': environment['SOTTO_RELEASE_SHA'],
            }
            service['volumes'] = [*volumes, {
                'type': 'bind', 'source': str(directory.resolve()),
                'target': '/run/sotto-provider-activation',
                'read_only': True, 'bind': {'create_host_path': False},
            }]
        atomic_json(path, overrides)


def activate_provider(directory: Path, release: str) -> None:
    path = directory / 'fish.json'
    raw = read_bytes(path)
    expected = {'releaseSha': release, 'fishEnabled': False}
    record = mapping(raw)
    if (
        len(raw) > 1024 or type(record.get('fishEnabled')) is not bool
        or record != expected
    ):
        raise ValueError('Provider activation identity changed')
    atomic_json(path, {**expected, 'fishEnabled': True}, 0o444)


def runtime_command(arguments: list[str]) -> bytes:
    descriptors: tuple[int, ...]
    try:
        os.fstat(9)
        descriptors = (9,)
    except OSError:
        descriptors = ()
    return subprocess.run(
        ['docker', *arguments], capture_output=True, check=True,
        timeout=120, pass_fds=descriptors,
    ).stdout


def enabled_activation(directory: Path, release: str) -> None:
    if directory.resolve(strict=True) != directory:
        raise ValueError('Activation directory traverses a symlink')
    value = mapping(read_bytes(directory / 'fish.json'))
    if value != {'releaseSha': release, 'fishEnabled': True} or type(
        value.get('fishEnabled')
    ) is not bool:
        raise ValueError('Release-bound enabled provider activation required')


def runtime_assets(reference: str) -> dict[str, object]:
    source = read_bytes(Path(__file__).parent / 'runtime/provider-assets.cjs')
    raw = runtime_command([
        'run', '--rm', '--pull', 'never', '--network', 'none',
        '--read-only', '--entrypoint', 'node', reference, '-e', source.decode(),
    ])
    if len(raw) > LIMIT:
        raise ValueError('Runtime inventory size bound exceeded')
    value = mapping(raw)
    if set(value) != {'protectedHash', 'files'} or not isinstance(
        value['protectedHash'], str
    ) or not re.fullmatch(r'[a-f0-9]{64}', value['protectedHash']):
        raise ValueError('Actual protected runtime inventory required')
    files = value['files']
    if not isinstance(files, dict) or not files or any(
        not isinstance(path, str) or not isinstance(digest, str)
        or not re.fullmatch(r'[a-f0-9]{64}', digest)
        for path, digest in files.items()
    ):
        raise ValueError('Actual runtime file hashes required')
    return value


def bound_continuity(path: Path) -> dict[str, object]:
    bound = mapping(read_bytes(path, private=True))
    if set(bound) != {'review', 'evidence'} or not all(
        isinstance(value, str) for value in bound.values()
    ):
        raise ValueError('Exact validated review and evidence required')
    review = mapping(cast(str, bound['review']).encode())
    contracts = review.get('previousWorkerContracts')
    if not isinstance(contracts, dict):
        raise ValueError('Captured previous runtime contracts required')
    validate(
        review, cast(str, bound['evidence']).encode(),
        cast(str, review.get('candidateContract')),
        ''.join(f'{image} {digest}\n' for image, digest in contracts.items()).encode(),
        os.environ,
    )
    if review['schemaVersion'] != 2:
        raise ValueError('Provider continuity requires review schema 2')
    continuity = provider_activation(review)
    candidate = runtime_assets(os.environ['SOTTO_WORKERS_IMAGE_REF'])
    if candidate['protectedHash'] != continuity['candidateAssetsHash']:
        raise ValueError('Candidate runtime asset hash changed')
    current = cast(dict[str, str], candidate['files'])
    reviewed = cast(dict[str, dict[str, object]], continuity['reviewedRuntimeFiles'])
    for image in contracts:
        previous = runtime_assets(image)
        if previous['protectedHash'] != continuity['previousAssetsHash']:
            raise ValueError('Previous runtime asset hash changed')
        old = cast(dict[str, str], previous['files'])
        changed = {
            name: {'previousSha256': old.get(name),
                   'candidateSha256': current.get(name)}
            for name in old.keys() | current.keys()
            if old.get(name) != current.get(name)
        }
        if changed != reviewed:
            raise ValueError('Runtime changes differ from exact reviewed files')
    return continuity


def captured_runtime(path: Path) -> dict[str, tuple[str, str]]:
    value = mapping(read_bytes(path))
    images = service_images(path)
    identifiers = value.get('x-captured-containers')
    if identifiers is None:
        identifiers = {'web': value.get('x-captured-container')}
    if not isinstance(identifiers, dict) or set(identifiers) != set(images):
        raise ValueError('Captured runtime identities required')
    result: dict[str, tuple[str, str]] = {}
    for service, image in images.items():
        identifier = identifiers[service]
        if not isinstance(identifier, str) or not re.fullmatch(
            r'[a-f0-9]{64}', identifier
        ):
            raise ValueError('Full captured container ID required')
        result[service] = (identifier, image)
    return result


def inspect_enabled_runtime(
    identifier: str, image: str, release: str, project: str, service: str,
    directory: Path | None = None,
) -> None:
    rows: object = json.loads(runtime_command(['inspect', identifier]))
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        raise ValueError('Unique actual runtime required')
    row = rows[0]
    config, state = row.get('Config'), row.get('State')
    if not isinstance(config, dict) or not isinstance(state, dict):
        raise ValueError('Actual runtime configuration required')
    labels = config.get('Labels')
    if row.get('Id') != identifier or row.get('Image') != image or state.get(
        'Running'
    ) is not True or state.get('OOMKilled') is not False:
        raise ValueError('Healthy exact captured runtime required')
    if not isinstance(labels, dict) or any(labels.get(key) != value for key, value in {
        'org.opencontainers.image.revision': release,
        'com.docker.compose.project': project,
        'com.docker.compose.service': service,
    }.items()):
        raise ValueError('Runtime release or ownership changed')
    entries = config.get('Env')
    if not isinstance(entries, list) or not all(isinstance(item, str) for item in entries):
        raise ValueError('Runtime environment metadata required')
    for name, expected in {
        'SOTTO_RELEASE_SHA': release,
        'SOTTO_PROVIDER_ACTIVATION_FILE': '/run/sotto-provider-activation/fish.json',
    }.items():
        values = [entry.partition('=')[2] for entry in entries if entry.startswith(name + '=')]
        if values != [expected]:
            raise ValueError('Unique release-bound provider authority required')
    mounts = row.get('Mounts')
    if not isinstance(mounts, list):
        raise ValueError('Actual runtime mounts required')
    selected = [mount for mount in mounts if isinstance(mount, dict)
                and mount.get('Destination') == '/run/sotto-provider-activation']
    if len(selected) != 1 or selected[0].get('Type') != 'bind' or selected[0].get(
        'RW'
    ) is not False or not isinstance(selected[0].get('Source'), str):
        raise ValueError('Unique read-only provider activation bind required')
    source = Path(selected[0]['Source'])
    if not source.is_absolute() or (directory is not None and source != directory):
        raise ValueError('Runtime provider activation directory changed')
    enabled_activation(source, release)


def existing_continuity(bound: Path, old_slot: str) -> None:
    continuity = bound_continuity(bound)
    web = captured_runtime(Path(os.environ['PREVIOUS_APP_IMAGES']))
    workers = captured_runtime(Path(os.environ['PREVIOUS_WORKER_IMAGES']))
    if set(web) != {'web'} or set(workers) != WORKERS or old_slot not in {'blue', 'green'}:
        raise ValueError('Existing web and all three workers required')
    reviewed = cast(dict[str, dict[str, str]], continuity['previousRuntimes'])
    stack = os.environ['SOTTO_STACK']
    for service, (identifier, image) in {**web, **workers}.items():
        if reviewed[service] != {'containerId': identifier, 'imageId': image}:
            raise ValueError('Captured previous runtime differs from review')
        project = stack + '-' + old_slot if service == 'web' else stack
        inspect_enabled_runtime(identifier, image, cast(str, continuity['previousReleaseSha']), project, service)


def candidate_continuity(directory: Path, slot: str) -> None:
    if slot not in {'blue', 'green'}:
        raise ValueError('Exact candidate slot required')
    stack, release = os.environ['SOTTO_STACK'], os.environ['SOTTO_RELEASE_SHA']
    enabled_activation(directory, release)
    for service in ['web', *sorted(WORKERS)]:
        project = stack + '-' + slot if service == 'web' else stack
        identifiers = runtime_command([
            'ps', '-q', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + project,
            '--filter', 'label=com.docker.compose.service=' + service,
        ]).decode().split()
        if len(identifiers) != 1 or not re.fullmatch(r'[a-f0-9]{64}', identifiers[0]):
            raise ValueError('Unique candidate service required')
        reference = os.environ['SOTTO_WEB_IMAGE_REF' if service == 'web' else 'SOTTO_WORKERS_IMAGE_REF']
        image = runtime_command(['image', 'inspect', '--format', '{{.Id}}', reference]).decode().strip()
        inspect_enabled_runtime(identifiers[0], image, release, project, service, directory)


def overlap_continuity(bound: Path, directory: Path, old_slot: str, slot: str) -> None:
    continuity = bound_continuity(bound)
    web = captured_runtime(Path(os.environ['PREVIOUS_APP_IMAGES']))
    if set(web) != {'web'} or old_slot not in {'blue', 'green'}:
        raise ValueError('Captured previous web required')
    identifier, image = web['web']
    reviewed = cast(dict[str, dict[str, str]], continuity['previousRuntimes'])
    if reviewed['web'] != {'containerId': identifier, 'imageId': image}:
        raise ValueError('Captured previous web differs from review')
    inspect_enabled_runtime(identifier, image, cast(str, continuity['previousReleaseSha']),
                            os.environ['SOTTO_STACK'] + '-' + old_slot, 'web')
    candidate_continuity(directory, slot)


def main() -> int:
    try:
        arguments = sys.argv[1:]
        if arguments and arguments[0] == 'activation-mode' and len(arguments) == 2:
            bound = mapping(read_bytes(Path(arguments[1]), private=True))
            review = mapping(cast(str, bound['review']).encode())
            print(provider_activation(review)['mode'] if review.get('schemaVersion') == 2 else 'first-activation')
            return 0
        if arguments and arguments[0] == 'continuity-existing' and len(arguments) == 3:
            existing_continuity(Path(arguments[1]), arguments[2])
            return 0
        if arguments and arguments[0] == 'continuity-overlap' and len(arguments) == 5:
            overlap_continuity(Path(arguments[1]), Path(arguments[2]), arguments[3], arguments[4])
            return 0
        if arguments and arguments[0] == 'continuity-final' and len(arguments) == 4:
            bound_continuity(Path(arguments[1]))
            candidate_continuity(Path(arguments[2]), arguments[3])
            return 0
        if arguments and arguments[0] == 'enabled-activation' and len(arguments) == 3:
            enabled_activation(Path(arguments[1]), arguments[2])
            return 0
        if (
            arguments and arguments[0] == 'prepare-activation'
            and len(arguments) == 2
        ):
            prepare_activation(Path(arguments[1]), os.environ)
            return 0
        if arguments and arguments[0] == 'activate' and len(arguments) == 3:
            activate_provider(Path(arguments[1]), arguments[2])
            return 0
        if arguments and arguments[0] == 'marker' and len(arguments) == 6:
            record_marker(Path(arguments[1]), *arguments[2:])
            return 0
        if arguments and arguments[0] == 'clear' and len(arguments) == 4:
            clear_marker(Path(arguments[1]), *arguments[2:])
            return 0
        if len(arguments) != 5 or arguments[0] != 'validate':
            raise ValueError('Supply review, evidence, hash and inventory')
        raw = read_bytes(Path(arguments[1]), private=True)
        evidence = read_bytes(Path(arguments[2]), private=True)
        validate(
            mapping(raw), evidence, arguments[3],
            read_bytes(Path(arguments[4])), os.environ,
        )
        # Preserve the exact validated inputs without rereading mutable paths.
        print(json.dumps({
            'review': raw.decode(), 'evidence': evidence.decode(),
        }))
    except (ValueError, OSError, KeyError, UnicodeError, subprocess.SubprocessError) as error:
        print('Compatibility review rejected: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
