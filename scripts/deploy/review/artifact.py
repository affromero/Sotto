"""Collect and validate independently bound review-image build evidence."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re

from scripts.deploy.images.collect import collect_identity
from scripts.deploy.images.metadata import (
    SOURCE,
    digest,
    measurement,
    provenance,
    record,
    source_sha,
)

ORIGIN = 'https://demo.sotto.fm'
REPOSITORY = 'ghcr.io/affromero/sotto-review-web'
ORIGIN_LABEL = 'io.sotto.public-origin'


def review_reference(value: str) -> str:
    if not re.fullmatch(
            re.escape(REPOSITORY) + r'@sha256:[0-9a-f]{64}', value):
        raise ValueError('An immutable review image reference is required')
    return value


def validate(
    value: object, sha: str, reference: str,
    expected_provenance: dict[str, object],
) -> dict[str, object]:
    """Bind identities to independently verified Actions runs."""
    source_sha(sha)
    review_reference(reference)
    expected = provenance(expected_provenance)
    result = record(value, 'review receipt')
    if set(result) != {
            'schemaVersion', 'sha', 'reference', 'imageId', 'configDigest',
            'platform', 'source', 'revision', 'measurement', 'provenance',
            'purpose', 'publicOrigin', 'runtimeUid'}:
        raise ValueError('Exact review receipt fields are required')
    if (type(result['schemaVersion']) is not int
            or result['schemaVersion'] != 1
            or result['purpose'] != 'sotto-review-upgrade'
            or result['publicOrigin'] != ORIGIN
            or type(result['runtimeUid']) is not int
            or result['runtimeUid'] != 1000
            or result['sha'] != sha or result['revision'] != sha
            or result['source'] != SOURCE
            or result['platform'] != 'linux/amd64'
            or result['reference'] != reference):
        raise ValueError('Review build differs from admitted source or origin')
    image_id = digest(result['imageId'], 'image ID', 'sha256:')
    if image_id != reference.split('@')[1]:
        raise ValueError('Review image ID differs from its reference')
    digest(result['configDigest'], 'config digest', 'sha256:')
    measurement(result['measurement'])
    if provenance(result['provenance']) != expected:
        raise ValueError('Review receipt differs from verified Actions runs')
    return result


def collect(
    sha: str, reference: str, expected_provenance: dict[str, object],
) -> dict[str, object]:
    review_reference(reference)
    result = collect_identity(
        sha, reference, {ORIGIN_LABEL: ORIGIN}, expected_user='1000',
    )
    result.update({
        'purpose': 'sotto-review-upgrade', 'publicOrigin': ORIGIN,
        'runtimeUid': 1000,
    })
    return validate(result, sha, reference, expected_provenance)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=('collect', 'validate'))
    parser.add_argument('--release-sha', required=True)
    parser.add_argument('--reference', required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--run-id', type=int, required=True)
    parser.add_argument('--run-attempt', type=int, required=True)
    parser.add_argument('--source-run-id', type=int, required=True)
    args = parser.parse_args()
    expected: dict[str, object] = {
        'repository': 'affromero/Sotto',
        'workflow': '.github/workflows/deploy.yml',
        'runId': args.run_id, 'runAttempt': args.run_attempt,
        'sourceRunId': args.source_run_id,
    }
    if args.operation == 'collect':
        result = collect(args.release_sha, args.reference, expected)
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_text(json.dumps(result, indent=2) + '\n')
    else:
        validate(json.loads(args.receipt.read_bytes()), args.release_sha,
                 args.reference, expected)
        print('Review source, origin, image and Actions identities verified')


if __name__ == '__main__':
    main()
