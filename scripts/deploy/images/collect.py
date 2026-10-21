"""Collect measurements and actual runtime probes on the CI image builder."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from collections.abc import Mapping
from pathlib import Path

from scripts.deploy.images.measure_image import measure
from scripts.deploy.images.metadata import (
    SOURCE,
    digest,
    image_reference,
    record,
    source_sha,
    validate_receipt,
)
from scripts.deploy.images.probe import probe

DEPLOY = Path(__file__).resolve().parents[1]


def collect_identity(
    sha: str, reference: str,
    expected_labels: Mapping[str, str] | None = None,
    expected_user: str | None = None,
) -> dict[str, object]:
    source_sha(sha)
    inspected = json.loads(subprocess.check_output([
        'docker', 'image', 'inspect', reference,
    ], text=True))
    if not isinstance(inspected, list) or len(inspected) != 1:
        raise ValueError('Expected one actual local image')
    image = record(inspected[0], 'image inspection')
    config = record(image.get('Config'), 'image configuration')
    labels = record(config.get('Labels'), 'image labels')
    repo_digests = image.get('RepoDigests')
    if (not isinstance(repo_digests, list)
            or image.get('Os') != 'linux'
            or image.get('Architecture') != 'amd64'
            or labels.get('org.opencontainers.image.revision') != sha
            or labels.get('org.opencontainers.image.source') != SOURCE
            or reference not in repo_digests):
        raise ValueError('Actual image identity does not match this release')
    if expected_labels is not None and any(
            labels.get(key) != value
            for key, value in expected_labels.items()):
        raise ValueError('Actual image labels differ from the trusted build')
    if expected_user is not None and config.get('User') != expected_user:
        raise ValueError('Actual image runtime user differs from the build')
    actual_id = digest(image.get('Id'), 'actual image ID', 'sha256:')
    if actual_id != reference.split('@', 1)[1]:
        raise ValueError('Use a containerd image store for actual image IDs')
    raw = subprocess.check_output([
        'docker', 'buildx', 'imagetools', 'inspect', '--raw', reference,
    ])
    if 'sha256:' + hashlib.sha256(raw).hexdigest() != actual_id:
        raise ValueError('Registry manifest bytes do not match the image')
    manifest = record(json.loads(raw), 'registry image manifest')
    if manifest.get('schemaVersion') != 2 or 'manifests' in manifest:
        raise ValueError('Expected a single-platform image manifest')
    manifest_config = record(manifest.get('config'), 'manifest configuration')
    result: dict[str, object] = {
        'schemaVersion': 1, 'sha': sha, 'reference': reference,
        'imageId': actual_id, 'configDigest': digest(
            manifest_config.get('digest'), 'config digest', 'sha256:'),
        'platform': 'linux/amd64', 'source': SOURCE, 'revision': sha,
        'measurement': measure(reference),
        'provenance': {
            'repository': os.environ['GITHUB_REPOSITORY'],
            'workflow': '.github/workflows/deploy.yml',
            'runId': int(os.environ['GITHUB_RUN_ID']),
            'runAttempt': int(os.environ['GITHUB_RUN_ATTEMPT']),
            'sourceRunId': int(os.environ['SOURCE_RUN_ID']),
        },
    }
    return result


def collect(role: str, sha: str, reference: str) -> dict[str, object]:
    image_reference(role, reference)
    result = collect_identity(sha, reference)
    result['role'] = role
    if role == 'workers':
        result['runtime'] = {
            'schemaHash': probe(reference, DEPLOY / 'images/schema.cjs'),
            'rollingContract': probe(
                reference, DEPLOY / 'checks/rolling-contract.cjs'),
            'queueNames': json.loads(probe(
                reference, DEPLOY / 'images/queue-names.cjs', tsx=True)),
            'providerAssets': json.loads(probe(
                reference, DEPLOY / 'runtime/provider-assets.cjs')),
        }
    return validate_receipt(result, role, sha, reference)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--role', choices=('showcase', 'personal', 'workers'),
                        required=True)
    parser.add_argument('--release-sha', required=True)
    parser.add_argument('--reference', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = collect(args.role, args.release_sha, args.reference)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
