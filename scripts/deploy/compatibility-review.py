"""Bind independently reviewed runtime overlap to exact immutable images."""

import hashlib
import json
import os
from pathlib import Path
import re
import stat
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
    if set(review) != FIELDS or type(review['schemaVersion']) is not int:
        raise ValueError('Unexpected review schema')
    expected: dict[str, object] = {
        'schemaVersion': 1,
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


def main() -> int:
    try:
        arguments = sys.argv[1:]
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
    except (ValueError, OSError, KeyError, UnicodeError) as error:
        print('Compatibility review rejected: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
