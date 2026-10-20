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
        identity_fields = {'containerId', 'imageId'}
        if not isinstance(runtime, dict) or set(runtime) not in (
            identity_fields, identity_fields | {'activationMode'},
        ):
            raise ValueError('Exact previous runtime identity required')
        if runtime.get('activationMode', 'release-record') not in (
            'release-record', 'implicit-enabled',
        ):
            raise ValueError('Exact previous provider activation mode required')
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


def command_output(arguments: list[str], timeout: int | None = 120) -> bytes:
    descriptors: tuple[int, ...]
    try:
        os.fstat(9)
        descriptors = (9,)
    except OSError:
        descriptors = ()
    return subprocess.run(
        arguments, capture_output=True, check=True,
        timeout=timeout, pass_fds=descriptors,
    ).stdout


def runtime_command(arguments: list[str]) -> bytes:
    return command_output(['docker', *arguments])


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
    *, activation_mode: str = 'release-record',
) -> None:
    if activation_mode not in {'release-record', 'implicit-enabled'} or (
        activation_mode == 'implicit-enabled' and directory is not None
    ):
        raise ValueError('Reviewed previous provider activation mode required')
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
    release_name = 'SOTTO_RELEASE_SHA'
    releases = [entry for entry in entries
                if entry == release_name or entry.startswith(release_name + '=')]
    if releases != [release_name + '=' + release]:
        if activation_mode != 'implicit-enabled' or releases:
            raise ValueError('Unique release-bound provider authority required')
        images: object = json.loads(runtime_command(['image', 'inspect', image]))
        if (not isinstance(images, list) or len(images) != 1
                or not isinstance(images[0], dict)):
            raise ValueError('Unique immutable previous image required')
        image_config = images[0].get('Config')
        image_labels = (
            image_config.get('Labels')
            if isinstance(image_config, dict) else None
        )
        if (images[0].get('Id') != image or not isinstance(image_labels, dict)
                or image_labels.get('org.opencontainers.image.revision') != release
                or image_labels.get('org.opencontainers.image.source')
                != 'https://github.com/affromero/Sotto'):
            raise ValueError('Immutable previous image release provenance differs')
    mounts = row.get('Mounts')
    if not isinstance(mounts, list):
        raise ValueError('Actual runtime mounts required')
    activation_name = 'SOTTO_PROVIDER_ACTIVATION_FILE'
    activation = [entry for entry in entries if entry == activation_name
                  or entry.startswith(activation_name + '=')]
    destination = Path('/run/sotto-provider-activation')
    if activation_mode == 'implicit-enabled':
        if activation:
            raise ValueError('Implicit provider activation must be unconfigured')
        for mount in mounts:
            if not isinstance(mount, dict) or not isinstance(
                mount.get('Destination'), str,
            ):
                raise ValueError('Actual runtime mount destination required')
            target = Path(mount['Destination'])
            if target.anchor != '/' or '..' in target.parts or (
                target == destination or target in destination.parents
                or destination in target.parents
            ):
                raise ValueError('Implicit provider activation has a covering mount')
        return
    if activation != [activation_name + '=' + str(destination / 'fish.json')]:
        raise ValueError('Unique release-bound provider authority required')
    selected = [mount for mount in mounts if isinstance(mount, dict)
                and mount.get('Destination') == str(destination)]
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
        runtime = reviewed[service]
        if {key: runtime[key] for key in ('containerId', 'imageId')} != {
            'containerId': identifier, 'imageId': image,
        }:
            raise ValueError('Captured previous runtime differs from review')
        project = stack + '-' + old_slot if service == 'web' else stack
        inspect_enabled_runtime(
            identifier, image, cast(str, continuity['previousReleaseSha']),
            project, service,
            activation_mode=runtime.get('activationMode', 'release-record'),
        )


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
    runtime = reviewed['web']
    if {key: runtime[key] for key in ('containerId', 'imageId')} != {
        'containerId': identifier, 'imageId': image,
    }:
        raise ValueError('Captured previous web differs from review')
    inspect_enabled_runtime(identifier, image, cast(str, continuity['previousReleaseSha']),
                            os.environ['SOTTO_STACK'] + '-' + old_slot, 'web',
                            activation_mode=runtime.get('activationMode', 'release-record'))
    candidate_continuity(directory, slot)


def schema_transition(
    review: Mapping[str, object], evidence: bytes, bound: Mapping[str, object],
    continuity: Mapping[str, object], candidate: str, previous: bytes,
    environment: Mapping[str, str],
) -> None:
    fields = {
        'schemaVersion', 'procedure', 'stack', 'releaseSha',
        'candidateWebImage', 'candidateWorkersImage', 'candidateSchemaHash',
        'previousSchemaHashes', 'compatibilityReviewSha256',
        'reviewer', 'evidenceSha256',
    }
    version = review.get('schemaVersion')
    if version == 2:
        fields.add('queueTransition')
    if set(review) != fields or type(version) is not int or (
        version not in {1, 2}
        or review['procedure'] != 'fenced-schema-migration'
    ):
        raise ValueError('Exact fenced schema transition review required')
    if version == 2:
        validate_queue_transition(review['queueTransition'])
    expected: dict[str, object] = {
        'stack': environment['SOTTO_STACK'],
        'releaseSha': environment['SOTTO_RELEASE_SHA'],
        'candidateWebImage': environment['SOTTO_WEB_IMAGE_REF'],
        'candidateWorkersImage': environment['SOTTO_WORKERS_IMAGE_REF'],
        'candidateSchemaHash': candidate,
        'evidenceSha256': hashlib.sha256(evidence).hexdigest(),
        'compatibilityReviewSha256': hashlib.sha256(
            cast(str, bound['review']).encode()
        ).hexdigest(),
    }
    old = {}
    for line in previous.decode().splitlines():
        image, digest = line.split()
        if image in old or not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
            raise ValueError('Unique previous schema image required')
        if not re.fullmatch(r'[a-f0-9]{64}', digest):
            raise ValueError('Exact previous schema hash required')
        old[image] = digest
    contracts = mapping(cast(str, bound['review']).encode())[
        'previousWorkerContracts'
    ]
    if not old or set(old) != set(cast(dict[str, object], contracts)):
        raise ValueError('Previous schema inventory differs from runtime review')
    if not re.fullmatch(r'[a-f0-9]{64}', candidate) or all(
        digest == candidate for digest in old.values()
    ):
        raise ValueError('Reviewed schema change required')
    expected['previousSchemaHashes'] = old
    if any(review[field] != value for field, value in expected.items()):
        raise ValueError('Schema review differs from exact deployment inputs')
    if not isinstance(review['reviewer'], str) or not review['reviewer'].strip():
        raise ValueError('Independent schema reviewer required')
    if not evidence.strip() or continuity.get('mode') != 'preserve-existing':
        raise ValueError('Existing provider continuity and schema evidence required')
    files = cast(dict[str, dict[str, object]], continuity['reviewedRuntimeFiles'])
    added = 0
    for name, pair in files.items():
        if not name.startswith('apps/web/prisma/migrations/'):
            continue
        if pair['previousSha256'] is not None or not re.fullmatch(
            r'apps/web/prisma/migrations/[A-Za-z0-9_]+/migration.sql', name
        ) or pair['candidateSha256'] is None:
            raise ValueError('Previously published migration files must remain unchanged')
        added += 1
    if not 1 <= added <= 16:
        raise ValueError('Bounded added migration inventory required')


def validate_queue_transition(value: object) -> dict[str, list[str]]:
    fields = {'previousQueues', 'candidateQueues', 'addedQueues'}
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError('Exact additive queue transition review required')
    for names in value.values():
        if (not isinstance(names, list) or not names or len(names) > 100
                or any(not isinstance(name, str) or not re.fullmatch(
                    r'[a-z][a-z-]*', name) for name in names)
                or names != sorted(set(names))):
            raise ValueError('Bounded sorted unique queue names required')
    previous, candidate = set(value['previousQueues']), set(value['candidateQueues'])
    if not previous < candidate or value['addedQueues'] != sorted(candidate - previous):
        raise ValueError('Only exact additive queue transitions are supported')
    return cast(dict[str, list[str]], value)


def unchanged_queue_contract(
    bound: Mapping[str, object], transition: object = None,
) -> None:
    review = mapping(cast(str, bound['review']).encode())
    contracts = cast(dict[str, str], review['previousWorkerContracts'])
    directory = Path(__file__).parent / 'images'
    inventories = []
    for image in [os.environ['SOTTO_WORKERS_IMAGE_REF'], *contracts]:
        try:
            raw = command_output([
                sys.executable, str(directory / 'probe.py'),
                '--reference', image,
                '--source', str(directory / 'queue-names.cjs'), '--tsx',
            ], timeout=None)
        except subprocess.CalledProcessError as error:
            detail = error.stderr.decode(errors='replace').strip()
            raise ValueError('Queue inventory probe failed: ' + detail) from None
        names = json.loads(raw)
        if not isinstance(names, list) or not names or any(
            not isinstance(name, str) for name in names
        ) or len(names) != len(set(names)):
            raise ValueError('Complete unique queue inventory required')
        inventories.append(sorted(names))
    if transition is None:
        if any(names != inventories[0] for names in inventories):
            raise ValueError('Schema transition requires unchanged queue names')
        return
    reviewed = validate_queue_transition(transition)
    if (inventories[0] != reviewed['candidateQueues']
            or any(names != reviewed['previousQueues'] for names in inventories[1:])):
        raise ValueError('Image queue inventories differ from the reviewed transition')


def schema_drift(status: str, directory: Path) -> None:
    if status not in {'0', '2'}:
        raise ValueError('Prisma schema comparison failed')
    preparation = mapping(read_bytes(
        directory / 'schema-preparation.json', private=True,
    ))
    report = mapping(read_bytes(directory / 'schema-index.json', private=True))
    if report.get('connectionIdentity') != preparation.get('applicationConnectionIdentity'):
        raise ValueError('Index proof database connection changed')
    proof = report.get('indexProof')
    schema = cast(dict[str, object], preparation['databaseIdentity'])['schemaName']
    if not isinstance(proof, dict) or proof.get('schemaName') != schema:
        raise ValueError('Exact schema index proof required')
    quoted = proof.get('quotedSchema')
    if not isinstance(quoted, str) or not (
        quoted == schema or (
            quoted.startswith('"') and quoted.endswith('"')
            and quoted[1:-1].replace('""', '"') == schema
        )
    ):
        raise ValueError('Exact PostgreSQL schema identifier required')
    expected = {
        'schemaName': schema, 'quotedSchema': quoted,
        'tableName': 'SidedoorState',
        'indexName': 'SidedoorState_id_pattern_idx',
        'accessMethod': 'btree',
        'isValid': True, 'isReady': True, 'isLive': True,
        'isUnique': False, 'isPrimary': False, 'isExclusion': False,
        'keyCount': 1, 'attributeCount': 1,
        'noExpressions': True, 'noPredicate': True,
        'columnName': 'id', 'operatorClass': 'text_pattern_ops',
        'operatorNamespace': 'pg_catalog', 'ordering': 0,
        'defaultCollation': True, 'sameSchema': True,
        'definition': 'CREATE INDEX "SidedoorState_id_pattern_idx" ON '
        + quoted + '."SidedoorState" USING btree (id text_pattern_ops)',
    }
    if proof != expected or any(
        type(proof[key]) is not type(value)
        for key, value in expected.items()
    ):
        raise ValueError('Shared-state index definition or validity differs')
    sql = read_bytes(directory / 'schema-drift.sql', private=True)
    known = (
        b'-- DropIndex\nDROP INDEX "SidedoorState_id_pattern_idx";\n\n'
        b'-- CreateIndex\nCREATE INDEX "SidedoorState_id_pattern_idx" '
        b'ON "SidedoorState"("id" text_pattern_ops);\n'
    )
    if status == '2' and sql not in {known, known + b'\n'}:
        raise ValueError('Database drift differs from verified Prisma BTree limitation')
    if status == '0' and sql.strip() not in {
        b'', b'-- This is an empty migration.',
    }:
        raise ValueError('Unexpected SQL from an empty schema comparison')
    atomic_json(directory / 'schema-drift-proof.json', {
        'diffExitCode': int(status), 'sdkLimitationVerified': status == '2',
        'sqlSha256': hashlib.sha256(sql).hexdigest(), 'indexProof': proof,
        'preparationSha256': hashlib.sha256(read_bytes(
            directory / 'schema-preparation.json', private=True,
        )).hexdigest(),
    })
    print('Prisma schema comparison and PostgreSQL index integrity verified.'
          + (' Exact BTree introspection limitation recorded.' if status == '2' else ''))


def schema_connections(bound: Path, old_slot: str) -> dict[str, object]:
    existing_continuity(bound, old_slot)
    runtimes = captured_runtime(Path(os.environ['PREVIOUS_WORKER_IMAGES']))
    runtimes.update(captured_runtime(Path(os.environ['PREVIOUS_APP_IMAGES'])))
    configurations = []
    containers = {}
    for service, (identifier, _) in runtimes.items():
        rows = json.loads(runtime_command(['inspect', identifier]))
        entries = rows[0]['Config']['Env']
        if any(entry.startswith('PG') and entry.partition('=')[2] for entry in entries):
            raise ValueError('PostgreSQL environment overrides require separate review')
        configuration = []
        for name in ('DATABASE_URL', 'REDIS_URL'):
            values = [entry.partition('=')[2] for entry in entries
                      if entry.partition('=')[0] == name]
            if len(values) != 1 or not values[0]:
                raise ValueError('Unique previous database and Redis configuration required')
            configuration.append(values[0])
        configurations.append(configuration)
        containers[service] = identifier
    if any(value != configurations[0] for value in configurations):
        raise ValueError('Previous database or Redis configuration differs')
    return {'configurationMatches': True, 'containers': containers}


def schema_preparation(directory: Path) -> None:
    def read(name: str) -> dict[str, object]:
        return mapping(read_bytes(directory / name, private=True))

    queues = read('queues-original.json')
    if read('schema-connection-proof.json') != queues:
        raise ValueError('Candidate queue connection or original pause state differs')
    app = read('schema-app-database.json')
    direct = read('schema-direct-database.json')
    previous = read('schema-previous-database.json')
    configurations = read('schema-previous-connections.json')
    containers = configurations.get('containers')
    if configurations.get('configurationMatches') is not True or not isinstance(
        containers, dict
    ) or set(containers) != WORKERS | {'web'} or previous.get(
        'controlContainerId'
    ) not in [containers[service] for service in WORKERS]:
        raise ValueError('Captured previous database proof required')
    identity = app.get('databaseIdentity')
    if not isinstance(identity, dict) or set(identity) != {
        'databaseName', 'schemaName', 'serverAddress', 'serverPort', 'databaseOid',
    } or identity != direct.get('databaseIdentity') or identity != previous.get('databaseIdentity'):
        raise ValueError('App and migration database/schema identities differ')
    if app.get('connectionIdentity') != queues.get('connectionIdentity'):
        raise ValueError('Application database proof differs from queue identity')
    if previous.get('connectionIdentity') != queues.get('connectionIdentity'):
        raise ValueError('Previous database proof differs from queue identity')
    proof = {
        'schemaVersion': 1,
        'releaseSha': os.environ['SOTTO_RELEASE_SHA'],
        'stack': os.environ['SOTTO_STACK'],
        'queueManifest': queues,
        'databaseIdentity': identity,
        'applicationConnectionIdentity': app['connectionIdentity'],
        'migrationConnectionIdentity': direct['connectionIdentity'],
        'previousConnectionIdentity': previous['connectionIdentity'],
        'previousControlContainerId': previous['controlContainerId'],
        'previousConfiguration': configurations,
        'schemaReviewSha256': hashlib.sha256(
            read_bytes(directory / 'schema-review.json', private=True)
        ).hexdigest(),
        'runtimeReviewSha256': hashlib.sha256(
            read_bytes(directory / 'compatibility-review.json', private=True)
        ).hexdigest(),
    }
    atomic_json(directory / 'schema-preparation.json', proof)


def stopped_continuity(bound: Path, old_slot: str) -> dict[str, object]:
    continuity = bound_continuity(bound)
    runtimes = captured_runtime(Path(os.environ['PREVIOUS_WORKER_IMAGES']))
    runtimes.update(captured_runtime(Path(os.environ['PREVIOUS_APP_IMAGES'])))
    if set(runtimes) != WORKERS | {'web'} or old_slot not in {'blue', 'green'}:
        raise ValueError('All four previous runtimes required')
    reviewed = cast(dict[str, dict[str, str]], continuity['previousRuntimes'])
    proof: dict[str, object] = {}
    for service, (identifier, image) in runtimes.items():
        if (identifier, image) != (
            reviewed[service]['containerId'], reviewed[service]['imageId']
        ):
            raise ValueError('Stopped runtime differs from review')
        rows = json.loads(runtime_command(['inspect', identifier]))
        if not isinstance(rows, list) or len(rows) != 1:
            raise ValueError('Unique stopped runtime required')
        row = rows[0]
        state = row.get('State', {})
        if row.get('Id') != identifier or row.get('Image') != image or (
            state.get('Running') is not False
            or state.get('OOMKilled') is not False
            or state.get('ExitCode') not in ((0, 143) if service == 'web' else (0,))
        ):
            raise ValueError('Graceful captured runtime settlement required')
        project = os.environ['SOTTO_STACK']
        if service == 'web':
            project += '-' + old_slot
        running = runtime_command([
            'ps', '-q', '--no-trunc', '--filter',
            'label=com.docker.compose.project=' + project,
            '--filter', 'label=com.docker.compose.service=' + service,
        ])
        if running.strip():
            raise ValueError('A replacement previous service remains running')
        proof[service] = {
            'containerId': identifier, 'imageId': image,
            'exitCode': state['ExitCode'],
        }
    return proof


def main() -> int:
    try:
        arguments = sys.argv[1:]
        if arguments and arguments[0] == 'schema-drift' and len(arguments) == 3:
            schema_drift(arguments[1], Path(arguments[2]))
            return 0
        if arguments and arguments[0] == 'schema-connections' and len(arguments) == 3:
            print(json.dumps(schema_connections(Path(arguments[1]), arguments[2])))
            return 0
        if arguments and arguments[0] == 'schema-validate' and len(arguments) == 6:
            raw = read_bytes(Path(arguments[1]), private=True)
            evidence = read_bytes(Path(arguments[2]), private=True)
            bound = mapping(read_bytes(Path(arguments[3]), private=True))
            continuity = bound_continuity(Path(arguments[3]))
            review = mapping(raw)
            schema_transition(
                review, evidence, bound, continuity, arguments[4],
                read_bytes(Path(arguments[5])), os.environ,
            )
            unchanged_queue_contract(bound, review.get('queueTransition'))
            print(json.dumps({'review': raw.decode(), 'evidence': evidence.decode()}))
            return 0
        if arguments and arguments[0] == 'schema-preparation' and len(arguments) == 2:
            schema_preparation(Path(arguments[1]))
            return 0
        if arguments and arguments[0] == 'continuity-stopped' and len(arguments) in (3, 4):
            proof = stopped_continuity(Path(arguments[1]), arguments[2])
            if len(arguments) == 4:
                atomic_json(Path(arguments[3]), proof)
            return 0
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
