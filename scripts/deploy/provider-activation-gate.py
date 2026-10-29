"""Detect explicit provider gates on the captured previous containers."""

from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import subprocess
import sys


spec = spec_from_file_location(
    'compatibility_review', Path(__file__).with_name('compatibility-review.py')
)
if spec is None or spec.loader is None:
    raise RuntimeError('Compatibility review helper is unavailable')
review = module_from_spec(spec)
spec.loader.exec_module(review)


def established_gate() -> bool:
    web = review.captured_runtime(Path(os.environ['PREVIOUS_APP_IMAGES']))
    workers = review.captured_runtime(Path(os.environ['PREVIOUS_WORKER_IMAGES']))
    if set(web) != {'web'} or set(workers) != review.WORKERS:
        raise ValueError('All four captured previous runtimes are required')
    runtimes = {**web, **workers}
    if len({identifier for identifier, _ in runtimes.values()}) != len(runtimes):
        raise ValueError('Distinct previous runtime containers are required')
    slot, stack = os.environ['OLD_SLOT'], os.environ['SOTTO_STACK']
    if slot not in {'blue', 'green'}:
        raise ValueError('Exact previous slot required')
    destination = Path('/run/sotto-provider-activation')
    found = False
    for service, (identifier, image) in runtimes.items():
        rows = json.loads(review.runtime_command(['inspect', identifier]))
        if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
            raise ValueError('Unique previous runtime inspection required')
        row = rows[0]
        config, state, mounts = row.get('Config'), row.get('State'), row.get('Mounts')
        if (row.get('Id') != identifier or row.get('Image') != image or
                not isinstance(config, dict) or not isinstance(state, dict) or
                state.get('Running') is not True or state.get('OOMKilled') is not False or
                not isinstance(mounts, list)):
            raise ValueError('Healthy captured previous runtime required')
        labels = config.get('Labels')
        project = stack + '-' + slot if service == 'web' else stack
        if (not isinstance(labels, dict) or
                labels.get('com.docker.compose.project') != project or
                labels.get('com.docker.compose.service') != service):
            raise ValueError('Captured runtime ownership required')
        entries = config.get('Env')
        if not isinstance(entries, list) or not all(isinstance(entry, str) for entry in entries):
            raise ValueError('Previous runtime environment required')
        if any(entry == 'SOTTO_PROVIDER_ACTIVATION_FILE' or
               entry.startswith('SOTTO_PROVIDER_ACTIVATION_FILE=') for entry in entries):
            found = True
        for mount in mounts:
            if not isinstance(mount, dict) or not isinstance(mount.get('Destination'), str):
                raise ValueError('Previous runtime mount destination required')
            target = Path(mount['Destination'])
            if target.anchor != '/' or '..' in target.parts:
                raise ValueError('Absolute previous runtime mount required')
            if target == destination or target in destination.parents or destination in target.parents:
                found = True
    return found


if __name__ == '__main__':
    try:
        print('true' if established_gate() else 'false')
    except (ValueError, OSError, KeyError, json.JSONDecodeError, subprocess.SubprocessError) as error:
        print('Provider gate inspection rejected: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
