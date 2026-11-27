"""Retain and recover the exact completed shared review release."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
import time
from collections.abc import Callable, Mapping
from importlib import import_module
from pathlib import Path
from types import ModuleType
from typing import TYPE_CHECKING, cast

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.build_observer import bounded_bytes
from scripts.deploy.review.state import (
    atomic_json,
    private_json,
    sync_directory,
)
from scripts.deploy.review.topology import DIRECTORY, PROJECT, rows

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations

STARTUP_UNIT = Path('/etc/systemd/system/sotto-review-start.service')


def startup_unit(operations: HostOperations) -> bytes:
    """Start only the completed attempt from its admitted immutable source."""
    from scripts.deploy.review.runtime.operations import HOST_STATE

    root = operations.root
    attempt = operations.attempt.directory
    interpreter = Path(sys.executable).resolve()
    for path in (root, attempt, interpreter):
        if (not path.is_absolute() or path.resolve() != path
                or not re.fullmatch(r'/[A-Za-z0-9_./-]+', str(path))):
            raise ValueError('literal-absolute-startup-paths-required')
    if attempt.parent != HOST_STATE:
        raise ValueError('canonical-completed-attempt-required')
    command = (f'{interpreter} -m scripts.deploy.review.runtime.controller '
               f'--start-completed --attempt {attempt}')
    return f'''[Unit]
Description=Start the verified shared Sotto review release
Requires=docker.service sotto-review-egress.service
After=docker.service sotto-review-egress.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
User=sotto
UMask=0077
TimeoutStartSec=0
WorkingDirectory={root}
ExecStart={command}

[Install]
WantedBy=docker.service
'''.encode()


def startup_binding(operations: HostOperations) -> dict[str, object]:
    return {'path': str(STARTUP_UNIT),
            'sha256': hashlib.sha256(startup_unit(operations)).hexdigest(),
            'sourceRoot': str(operations.root),
            'attemptDirectory': str(operations.attempt.directory)}


def verify_startup_installation(operations: HostOperations) -> None:
    metadata = STARTUP_UNIT.lstat()
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0
            or stat.S_IMODE(metadata.st_mode) != 0o644
            or bounded_bytes(STARTUP_UNIT) != startup_unit(operations)):
        raise ValueError('completed-startup-unit-changed')
    properties = operations.command([
        'systemctl', 'show', '--property=FragmentPath',
        '--property=DropInPaths', STARTUP_UNIT.name,
    ]).decode().splitlines()
    if dict(line.split('=', 1) for line in properties) != {
        'FragmentPath': str(STARTUP_UNIT), 'DropInPaths': '',
    }:
        raise ValueError('completed-startup-unit-overridden')


def install_startup_unit(operations: HostOperations) -> None:
    operations.lock.validate()
    expected = startup_binding(operations)
    intent = operations.attempt.directory / 'startup-unit-intent.json'
    predecessor_unit = None
    if 'predecessor' in operations.manifest:
        if operations.attempt.state()['phase'] != 'PUBLIC_COMMITTED':
            raise ValueError('successor-startup-requires-committed-public-route')
        predecessor_unit = retained_predecessor_startup(operations)
    if intent.exists():
        if private_json(intent) != expected:
            raise ValueError('startup-unit-intent-changed')
    else:
        if predecessor_unit is None and (STARTUP_UNIT.exists() or STARTUP_UNIT.is_symlink()):
            raise ValueError('foreign-existing-completed-startup-unit')
        atomic_json(intent, expected)
    content = startup_unit(operations)
    if STARTUP_UNIT.exists() or STARTUP_UNIT.is_symlink():
        metadata = STARTUP_UNIT.lstat()
        if (not stat.S_ISREG(metadata.st_mode)
                or metadata.st_uid != 0
                or stat.S_IMODE(metadata.st_mode) != 0o644
                or bounded_bytes(STARTUP_UNIT) not in (content, predecessor_unit)):
            raise ValueError('pending-completed-startup-unit-changed')
    candidate = operations.attempt.directory / STARTUP_UNIT.name
    if candidate.exists():
        if bounded_bytes(candidate, private=True) != content:
            raise ValueError('private-completed-startup-unit-changed')
    else:
        operations.private_file(candidate, content)
    operations.command([
        'sudo', '-n', 'install', '-o', 'root', '-g', 'root', '-m', '0644',
        str(candidate), str(STARTUP_UNIT),
    ])
    operations.command(['sudo', '-n', 'systemctl', 'daemon-reload'])
    verify_startup_installation(operations)
    operations.command(['sudo', '-n', 'systemctl', 'enable',
                        STARTUP_UNIT.name])
    verify_startup_enabled(operations)
    atomic_json(operations.attempt.directory / 'startup-unit.json',
                {**expected, 'enabled': True})


def retained_predecessor_startup(operations: HostOperations) -> bytes:
    from scripts.deploy.review.runtime.inventory.predecessor import bind_predecessor

    phase = operations.attempt.state()['phase']
    if phase not in ('PRECHECK', 'PUBLIC_COMMITTED'):
        raise ValueError('successor-startup-capture-phase-invalid')
    previous = bind_predecessor(operations)
    expected = startup_unit(previous)
    receipt = private_json(previous.attempt.directory / 'startup-unit.json')
    if receipt != {**startup_binding(previous), 'enabled': True}:
        raise ValueError('predecessor-startup-installation-changed')
    path = operations.attempt.directory / 'predecessor-startup.service'
    if path.exists() or path.is_symlink():
        if bounded_bytes(path, private=True) != expected:
            raise ValueError('retained-predecessor-startup-changed')
    else:
        if phase != 'PRECHECK':
            raise ValueError('retained-predecessor-startup-required')
        verify_startup_unit(previous)
        operations.private_file(path, expected)
    return expected


def verify_startup_enabled(operations: HostOperations) -> None:
    verify_startup_installation(operations)
    relation = STARTUP_UNIT.parent / 'docker.service.wants' / STARTUP_UNIT.name
    metadata = relation.lstat()
    if (not stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0
            or relation.resolve() != STARTUP_UNIT
            or operations.command(['systemctl', 'is-enabled',
                                   STARTUP_UNIT.name]).strip() != b'enabled'):
        raise ValueError('completed-startup-relation-changed')


def verify_startup_unit(operations: HostOperations) -> None:
    expected = startup_binding(operations)
    if (private_json(operations.attempt.directory / 'startup-unit-intent.json')
            != expected
            or private_json(operations.attempt.directory / 'startup-unit.json')
            != {**expected, 'enabled': True}):
        raise ValueError('completed-startup-receipt-changed')
    verify_startup_enabled(operations)


def cutover(
    operations: HostOperations, *,
    continue_check: Callable[[], None] | None = None,
) -> None:
    from scripts.deploy.review.runtime import services
    from scripts.deploy.review.runtime.operations import (
        CADDY,
        HOST_STATE,
        MAINTENANCE,
    )

    operations.lock.validate()
    operations.attempt.verify_marker(HOST_STATE / 'unresolved.json')
    archive = operations.attempt.directory / 'import-archive-index.json'
    started_archive = any(operations.attempt.directory.glob(
        'archive-intent-finalized-imports-*.json',
    ))
    if archive.exists() or started_archive:
        if operations.attempt.state()['phase'] not in {
            'PUBLIC_COMMITTED', 'COMPLETE',
        }:
            raise ValueError('finalized-imports-before-public-commit')
        expected_release = read_retained_record(
            operations, fenced=bounded_bytes(CADDY) == MAINTENANCE,
            inspect_imports=verify_mixed_imports,
        )
        release = operations.attempt.directory / 'release-record.json'
        if release.exists() and private_json(release) != expected_release:
            raise ValueError('retained-completed-release-changed')
        operations.verify_images(require_imports=False, final_only=True)
    else:
        operations.verify_images()
    operations.verify_storage()
    operations.verify_egress()
    services.verify_candidate(operations, 'web')
    services.verify_candidate(operations, 'workers')
    original = bounded_bytes(operations.attempt.directory
                             / 'original-caddy.conf', private=True)
    expected = record(operations.manifest['originalFiles'], 'original files')
    if hashlib.sha256(original).hexdigest() != expected['caddyFragment']:
        raise ValueError('retained-public-routing-changed')
    actual = bounded_bytes(CADDY)
    private_json(operations.attempt.directory / 'workloads-verified.json')
    if actual == MAINTENANCE:
        operations.verify_fence()
    elif actual != original:
        raise ValueError('unknown-public-routing-state')
    install_public_routing(operations, original,
                           continue_check=continue_check)


def install_public_routing(
    operations: HostOperations, original: bytes,
    *, continue_check: Callable[[], None] | None = None,
) -> None:
    """Reload even when a prior install completed before its reload result."""
    from scripts.deploy.review.runtime import services

    try:
        if continue_check is not None:
            continue_check()
        operations.install_caddy(original)
        if continue_check is not None:
            continue_check()
        services.wait_health(operations, public=True)
    except BaseException:
        operations.fence()
        raise


def retention_context(
    operations: HostOperations,
) -> tuple[dict[str, str], set[str]]:
    from scripts.deploy.review.runtime.operations import RETENTION

    web = record(operations.manifest['finalWeb'], 'final web')
    workers = record(operations.manifest['finalWorker'], 'final workers')
    topology = record(operations.manifest['topology'], 'topology')
    original = record(topology['services'], 'original services')
    if 'predecessor' in operations.manifest:
        from scripts.deploy.review.runtime.inventory.predecessor import bind_predecessor

        predecessor = bind_predecessor(operations).manifest
        retained = [original['postgres'], original['redis'],
                    predecessor['finalWeb'], predecessor['finalWorker']]
    else:
        retained = list(original.values())
    identities = {cast(str, record(value, 'service')['imageId']) for value in retained}
    identities.update((cast(str, web['imageId']),
                       cast(str, workers['imageId'])))
    return {
        'SOTTO_STACK': PROJECT,
        'RETENTION_ATTEMPT_KEY': operations.attempt.directory.name,
        'PRODUCTION_IMAGE_RETENTION_DIR': str(RETENTION),
        'SOTTO_WEB_IMAGE_REF': cast(str, web['reference']),
        'SOTTO_WORKERS_IMAGE_REF': cast(str, workers['reference']),
    }, identities


def verify_retention_begin(
    operations: HostOperations,
) -> tuple[dict[str, str], tuple[str, ...], dict[str, object]]:
    """Check the canonical discovery against every admitted rollback image."""
    from scripts.deploy.review.runtime import services
    from scripts.deploy.review.runtime.inventory.predecessor import bind_predecessor

    operations.lock.validate()
    environment, identities = retention_context(operations)
    writers: tuple[str, ...] = ()
    if 'predecessor' in operations.manifest:
        previous = bind_predecessor(operations)
        writers = tuple(services.verify_candidate(previous, role)
                        for role in ('web', 'workers'))
    retention = import_module('scripts.deploy.production-retention')
    plan: dict[str, object] = retention.plan_begin(environment, review_writer_ids=writers)
    if plan['successful_images'] != sorted(identities):
        raise ValueError('canonical-review-protection-plan-differs-from-admission')
    operations.lock.validate()
    return environment, writers, plan


def before_fence(operations: HostOperations) -> None:
    from scripts.deploy.review.runtime.operations import RETENTION

    operations.verify_images()
    environment, writers, plan = verify_retention_begin(operations)
    canonical = RETENTION / (
        PROJECT + '-attempt-' + operations.attempt.directory.name + '.json'
    )
    intent = operations.attempt.directory / 'retention-begin.json'
    stable = RETENTION / (PROJECT + '.json')
    if intent.exists():
        retained = private_json(intent)
        expected = retained['record']
        if plan != expected:
            raise ValueError('retention-begin-recovery-state-changed')
    else:
        prior = private_json(stable) if stable.exists() else None
        previous = record(prior, 'previous stable')['protected_images'] \
            if prior is not None else []
        if not isinstance(previous, list):
            raise ValueError('previous-review-image-protection-invalid')
        expected = plan
        if canonical.exists() or canonical.is_symlink():
            raise ValueError('unknown-existing-review-retention-attempt')
        atomic_json(intent, {'record': expected, 'previousStable': prior})
        retained = private_json(intent)
    if not canonical.exists() and not canonical.is_symlink():
        prior = private_json(stable) if stable.exists() else None
        if prior != retained['previousStable']:
            raise ValueError('retention-begin-recovery-state-changed')
        import_module('scripts.deploy.production-retention').update_record(
            'begin', environment, review_writer_ids=writers, expected_begin=expected,
        )
        sync_directory(RETENTION)
    if private_json(canonical) != expected:
        raise ValueError('canonical-review-protection-not-established')
    captured: dict[str, object] = {}
    for image in rows(operations.manifest['images'], 'admitted image'):
        reference = cast(str, image['reference'])
        name = ('sotto-review-import-' + cast(str, image['sha']) + '-'
                + reference.rsplit(':', 1)[1] + '.json')
        raw = bounded_bytes(RETENTION / name, private=True)
        captured[name] = {'sha256': hashlib.sha256(raw).hexdigest(),
                          'record': record(json.loads(raw), 'import record')}
    path = operations.attempt.directory / 'admitted-imports.json'
    if path.exists():
        if private_json(path) != captured:
            raise ValueError('admitted-review-import-records-changed')
    else:
        atomic_json(path, captured)


def finalizer(operations: HostOperations) -> Callable[
    [dict[Path, bytes], Path], None,
]:
    asset = record(operations.manifest['importFinalizer'],
                   'canonical finalizer')
    relative = Path(cast(str, asset['relativePath']))
    if (relative.is_absolute() or '..' in relative.parts
            or relative.parts[:1] != ('review-stage-assets',)):
        raise ValueError('admitted-finalizer-asset-path-required')
    source = bounded_bytes(operations.root / relative)
    if hashlib.sha256(source).hexdigest() != asset['sha256']:
        raise ValueError('canonical-finalizer-source-changed')
    module = ModuleType('sotto_review_import_finalizer')
    exec(compile(source, str(relative), 'exec'), module.__dict__)
    return cast(Callable[[dict[Path, bytes], Path], None],
                module.archive_records)


def finalize(
    operations: HostOperations, *,
    continue_check: Callable[[], None] | None = None,
) -> None:
    from scripts.deploy.review.runtime import services
    from scripts.deploy.review.runtime.operations import RETENTION

    operations.lock.validate()
    operations.verify_egress()
    operations.verify_storage()
    services.verify_candidate(operations, 'web')
    services.verify_candidate(operations, 'workers')
    services.wait_health(operations, public=True)
    environment, identities = retention_context(operations)
    record_path = RETENTION / (
        PROJECT + '-attempt-' + operations.attempt.directory.name + '.json'
    )
    stable = RETENTION / (PROJECT + '.json')
    if record_path.exists():
        retained = private_json(operations.attempt.directory
                                / 'retention-begin.json')
        if private_json(record_path) != retained['record']:
            raise ValueError('successful-review-protection-changed')
        update = cast(Callable[[str, Mapping[str, str]], None], import_module(
            'scripts.deploy.production-retention',
        ).update_record)
        if continue_check is not None:
            continue_check()
        update('success', environment)
        sync_directory(RETENTION)
    if private_json(stable) != {'protected_images': sorted(identities)}:
        raise ValueError('stable-review-images-not-protected')
    captured = private_json(operations.attempt.directory
                            / 'admitted-imports.json')
    if continue_check is not None:
        continue_check()
    archive_imports(operations, captured)
    if continue_check is not None:
        continue_check()
    atomic_json(operations.attempt.directory / 'release-record.json', {
        'source': record(operations.manifest['finalWeb'], 'web')['sha'],
        'protectedImages': sorted(identities),
        'finalizedImportRecords': sorted(captured),
        'workloads': private_json(operations.attempt.directory
                                 / 'workloads-verified.json'),
        'browserVerification': 'required',
    })
    if continue_check is not None:
        continue_check()
    install_startup_unit(operations)


def archive_imports(
    operations: HostOperations, captured: dict[str, object],
) -> None:
    """Reconcile exact archives through the unchanged canonical tool."""
    from scripts.deploy.review.runtime.operations import RETENTION

    directories = archive_directories(operations, captured)
    originals: dict[Path, bytes] = {}
    index: dict[str, object] = {}
    for name, value in captured.items():
        if (not name.startswith('sotto-review-import-')
                or Path(name).name != name):
            raise ValueError('only-this-review-imports-can-finalize')
        expected = record(value, 'captured import')
        path = RETENTION / name
        for directory in directories:
            if name not in directories[directory]:
                continue
            archived = directory / name
            if not archived.exists() and not archived.is_symlink():
                continue
            if (hashlib.sha256(bounded_bytes(archived, private=True))
                    .hexdigest() != expected['sha256']):
                raise ValueError('retained-import-archive-changed')
            index[name] = str(archived.relative_to(
                operations.attempt.directory,
            ))
        if path.exists() or path.is_symlink():
            raw = bounded_bytes(path, private=True)
            if hashlib.sha256(raw).hexdigest() != expected['sha256']:
                raise ValueError('captured-review-import-changed')
            originals[path] = raw
        elif name not in index:
            raise ValueError('unresolved-import-archive-loss')
    if originals:
        archive = operations.attempt.directory / (
            'finalized-imports-' + str(time.time_ns())
        )
        atomic_json(operations.attempt.directory / (
            'archive-intent-' + archive.name + '.json'
        ), {'directory': archive.name, 'records': {
            path.name: hashlib.sha256(raw).hexdigest()
            for path, raw in originals.items()
        }})
        finalizer(operations)(originals, archive)
        index.update({path.name: str((archive / path.name).relative_to(
            operations.attempt.directory,
        )) for path in originals})
    if any((RETENTION / name).exists() or (RETENTION / name).is_symlink()
           for name in captured):
        raise ValueError('import-heads-not-canonically-finalized')
    atomic_json(operations.attempt.directory / 'import-archive-index.json',
                index)


def verify_completed(operations: HostOperations) -> None:
    """Verify the completed release without requiring archived import heads."""
    from scripts.deploy.review.runtime import services
    from scripts.deploy.review.runtime.policy import verify_queue_policy

    operations.lock.validate()
    operations.verify_tools()
    operations.verify_images(require_imports=False, final_only=True)
    operations.verify_storage()
    operations.verify_egress()
    services.verify_candidate(operations, 'web')
    services.verify_candidate(operations, 'workers')
    verify_queue_policy(operations)
    services.wait_health(operations, public=True)
    verify_completed_records(operations)
    verify_startup_unit(operations)


def verify_completed_records(
    operations: HostOperations, *, fenced: bool = False,
    active_fragment_sha256: str | None = None,
    successor: HostOperations | None = None,
) -> None:
    """Bind retained completion evidence without starting a container."""
    expected = read_completed_record(
        operations, fenced=fenced, active_fragment_sha256=active_fragment_sha256,
        successor=successor,
    )
    release = private_json(operations.attempt.directory
                           / 'release-record.json')
    if release != expected:
        raise ValueError('completed-release-receipt-changed')


def read_completed_record(
    operations: HostOperations, *, fenced: bool = False,
    active_fragment_sha256: str | None = None,
    successor: HostOperations | None = None,
) -> dict[str, object]:
    """Derive completion from exact retained imports and live ownership."""
    return read_retained_record(
        operations, fenced=fenced, inspect_imports=verify_archived_imports,
        active_fragment_sha256=active_fragment_sha256,
        successor=successor,
    )


def archive_directories(
    operations: HostOperations, captured: dict[str, object],
) -> dict[Path, dict[str, object]]:
    """Only pre-dispatch intents identify this attempt's archive copies."""
    base = operations.attempt.directory
    intents = sorted(base.glob('archive-intent-finalized-imports-*.json'))
    actual = set(base.glob('finalized-imports-*'))
    if len(intents) > 1000 or len(actual) > 1000:
        raise ValueError('bounded-owned-import-archives-required')
    admitted: dict[Path, dict[str, object]] = {}
    for path in intents:
        value = private_json(path)
        name = cast(str, value['directory'])
        records = record(value['records'], 'archive intent records')
        if (set(value) != {'directory', 'records'}
                or Path(name).name != name
                or not name.startswith('finalized-imports-')
                or path.name != 'archive-intent-'+name+'.json'
                or not records or not records.keys() <= captured.keys()
                or any(digest != record(captured[key], 'captured')['sha256']
                       for key, digest in records.items())):
            raise ValueError('canonical-archive-intent-changed')
        directory = base / name
        if not directory.exists() and not directory.is_symlink():
            continue
        metadata = directory.lstat()
        if (not stat.S_ISDIR(metadata.st_mode)
                or metadata.st_uid != os.geteuid()
                or metadata.st_mode & 0o077):
            raise ValueError('private-canonical-archive-directory-changed')
        admitted[directory] = records
    if actual != admitted.keys():
        raise ValueError('unadmitted-import-archive-directory')
    return admitted


def verify_mixed_imports(
    operations: HostOperations, captured: dict[str, object],
) -> None:
    """Read exact active heads or intent-bound copies without settling them."""
    from scripts.deploy.review.runtime.operations import RETENTION

    directories = archive_directories(operations, captured)
    for name, value in captured.items():
        if (Path(name).name != name
                or not name.startswith('sotto-review-import-')):
            raise ValueError('invalid-captured-import-name')
        expected = record(value, 'captured import')['sha256']
        paths = [RETENTION / name] + [directory / name
            for directory, records in directories.items() if name in records]
        found = False
        for path in paths:
            if not path.exists() and not path.is_symlink():
                continue
            if hashlib.sha256(bounded_bytes(path, private=True)).hexdigest() \
                    != expected:
                raise ValueError('retained-mixed-import-record-changed')
            found = True
        if not found:
            raise ValueError('retained-import-head-and-copy-missing')


def verify_archived_imports(
    operations: HostOperations, captured: dict[str, object],
) -> None:
    from scripts.deploy.review.runtime.operations import RETENTION

    directories = archive_directories(operations, captured)
    index = private_json(operations.attempt.directory
                         / 'import-archive-index.json')
    if set(index) != set(captured):
        raise ValueError('completed-import-archive-index-changed')
    for name, value in captured.items():
        if (Path(name).name != name
                or not name.startswith('sotto-review-import-')):
            raise ValueError('invalid-completed-import-name')
        expected = record(value, 'captured import')
        relative = Path(cast(str, index[name]))
        if (relative.is_absolute() or len(relative.parts) != 2
                or relative.name != name):
            raise ValueError('completed-import-archive-path-changed')
        archived = operations.attempt.directory / relative
        if (archived.parent not in directories
                or name not in directories[archived.parent]
                or hashlib.sha256(bounded_bytes(archived, private=True))
                .hexdigest() != expected['sha256']
                or (RETENTION / name).exists()
                or (RETENTION / name).is_symlink()):
            raise ValueError('completed-import-archive-changed')


def verify_retired_bootstrap(
    previous: HostOperations, successor: HostOperations | None,
    available: Mapping[str, object], identities: set[str],
) -> None:
    """Admit one sealed retirement without rewriting the completed receipt."""
    from scripts.deploy.review.runtime.inventory.predecessor import bind_predecessor

    if (successor is None or previous.lock is not successor.lock
            or 'predecessor' in previous.manifest):
        raise ValueError('completed-image-protection-changed')
    bound = bind_predecessor(successor)
    if (bound.attempt.directory != previous.attempt.directory
            or bound.attempt.manifest_hash != previous.attempt.manifest_hash):
        raise ValueError('completed-predecessor-binding-changed')
    topology = record(previous.manifest['topology'], 'predecessor topology')
    services = record(topology['services'], 'predecessor services')
    retired = record(services['web'], 'retired bootstrap web')
    image = digest(retired['imageId'], 'retired bootstrap image', 'sha256:')
    identity = digest(retired['id'], 'retired bootstrap container')
    kept = {digest(record(services[role], role)['imageId'], role, 'sha256:')
            for role in ('postgres', 'redis')}
    kept.update(digest(record(previous.manifest[role], role)['imageId'], role, 'sha256:')
                for role in ('finalWeb', 'finalWorker'))
    if (successor.attempt.manifest().get('retiredBootstrapImage') != image
            or image in kept or kept | {image} != identities
            or dict(available) != {'protected_images': sorted(kept)}):
        raise ValueError('completed-image-protection-changed')
    images = {digest(value, 'listed image', 'sha256:') for value in previous.docker(
        'image', 'ls', '--all', '--no-trunc', '--format', '{{.ID}}',
    ).decode().splitlines()}
    if image in images or not kept <= images:
        raise ValueError('retired-bootstrap-image-absence-not-proven')
    ids = previous.docker('ps', '-aq', '--no-trunc').decode().split()
    containers = previous.inspect(*ids) if ids else []
    if ({row['Id'] for row in containers} != set(ids)
            or not kept <= {row['Image'] for row in containers}
            or any(row['Id'] == identity or row['Image'] == image
                   or row['Name'] == retired['name'] for row in containers)):
        raise ValueError('retired-bootstrap-container-absence-not-proven')
    successor.lock.validate()


def read_retained_record(
    operations: HostOperations, *, fenced: bool,
    inspect_imports: Callable[[HostOperations, dict[str, object]], None],
    active_fragment_sha256: str | None = None,
    successor: HostOperations | None = None,
) -> dict[str, object]:
    """Share ownership proofs while keeping completion's imports strict."""
    from scripts.deploy.review.runtime.operations import (
        CADDY,
        MAINTENANCE,
        RETENTION,
    )

    original = bounded_bytes(operations.attempt.directory
                             / 'original-caddy.conf', private=True)
    expected_files = record(operations.manifest['originalFiles'], 'original')
    if active_fragment_sha256 is not None and fenced:
        raise ValueError('fenced-route-requires-maintenance-fragment')
    expected_live = (
        digest(active_fragment_sha256, 'admitted live Caddy fragment')
        if active_fragment_sha256 is not None
        else hashlib.sha256(MAINTENANCE if fenced else original).hexdigest()
    )
    if (hashlib.sha256(original).hexdigest() != expected_files['caddyFragment']
            or hashlib.sha256(bounded_bytes(CADDY)).hexdigest() != expected_live):
        raise ValueError('completed-public-routing-changed')
    _, identities = retention_context(operations)
    available = private_json(RETENTION / (PROJECT + '.json'))
    if available != {'protected_images': sorted(identities)}:
        verify_retired_bootstrap(operations, successor, available, identities)
    captured = private_json(operations.attempt.directory
                            / 'admitted-imports.json')
    inspect_imports(operations, captured)
    target = Path(DIRECTORY) / 'auth/codex'
    handed = private_json(operations.attempt.directory / 'auth-handover.json')
    metadata = target.lstat()
    parent = target.parent.lstat()
    if (not stat.S_ISDIR(metadata.st_mode)
            or stat.S_IMODE(metadata.st_mode) != 0o700
            or handed.get('identity') != [metadata.st_dev, metadata.st_ino]
            or handed.get('uid') != metadata.st_uid
            or handed.get('gid') != metadata.st_gid
            or metadata.st_uid != operations.manifest['runtimeUid']
            or metadata.st_gid != operations.manifest['runtimeGid']
            or not stat.S_ISDIR(parent.st_mode)
            or parent.st_mode & 0o077
            or parent.st_uid != metadata.st_uid
            or handed.get('inputsSha256')
            != operations.manifest['inputsSha256']):
        raise ValueError('completed-shared-auth-home-changed')
    for name in ('auth.json', 'config.toml'):
        current = (target / name).lstat()
        if (not stat.S_ISREG(current.st_mode)
                or stat.S_IMODE(current.st_mode) != 0o600
                or current.st_uid != metadata.st_uid
                or current.st_gid != metadata.st_gid):
            raise ValueError('completed-shared-auth-file-changed')
    return {
        'source': record(operations.manifest['finalWeb'], 'web')['sha'],
        'protectedImages': sorted(identities),
        'finalizedImportRecords': sorted(captured),
        'workloads': private_json(operations.attempt.directory
                                 / 'workloads-verified.json'),
        'browserVerification': 'required',
    }


def recover_completed(
    operations: HostOperations, *,
    continue_check: Callable[[], None] | None = None,
) -> None:
    """Recover public routing only after complete evidence passes under503."""
    from scripts.deploy.review.runtime import services
    from scripts.deploy.review.runtime.policy import verify_queue_policy

    operations.verify_fence()
    operations.verify_tools()
    operations.verify_images(require_imports=False, final_only=True)
    operations.verify_storage()
    operations.verify_egress()
    verify_completed_records(operations, fenced=True)
    verify_startup_unit(operations)
    identities = [services.verify_candidate(
        operations, role, require_running=False,
    ) for role in ('web', 'workers')]
    verify_queue_policy(operations)
    for identity in identities:
        state = record(operations.inspect(identity)[0]['State'], 'recovery')
        if not state.get('Running'):
            if continue_check is not None:
                continue_check()
            operations.docker('start', identity)
    services.wait_health(operations)
    original = bounded_bytes(operations.attempt.directory
                             / 'original-caddy.conf', private=True)
    try:
        install_public_routing(operations, original,
                               continue_check=continue_check)
        verify_completed(operations)
    except BaseException:
        operations.fence()
        raise


def start_completed(
    operations: HostOperations, *,
    continue_check: Callable[[], None] | None = None,
) -> None:
    """Start only the two fully bound containers from a completed attempt."""
    from scripts.deploy.review.runtime import services
    from scripts.deploy.review.runtime.operations import HOST_STATE
    from scripts.deploy.review.runtime.policy import verify_queue_policy

    operations.lock.validate()
    if operations.attempt.state()['status'] != 'complete':
        raise ValueError('completed-review-attempt-required')
    for marker in (
        HOST_STATE / 'unresolved.json',
        Path('/home/sotto/.local/state/sotto-deploy/unresolved.json'),
    ):
        if marker.exists() or marker.is_symlink():
            raise ValueError('unresolved-deployment-blocks-review-start')
    operations.verify_tools()
    operations.verify_images(require_imports=False, final_only=True)
    operations.verify_storage()
    operations.verify_egress()
    verify_completed_records(operations)
    verify_startup_unit(operations)
    identities = [services.verify_candidate(
        operations, role, require_running=False,
    ) for role in ('web', 'workers')]
    verify_queue_policy(operations)
    for identity in identities:
        state = record(operations.inspect(identity)[0]['State'], 'startup')
        if not state.get('Running'):
            if continue_check is not None:
                continue_check()
            operations.docker('start', identity)
    verify_completed(operations)
