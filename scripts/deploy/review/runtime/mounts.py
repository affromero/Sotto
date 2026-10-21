"""Bind captured review mounts to their current physical storage objects."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from pathlib import PurePosixPath
from typing import cast

from scripts.deploy.images.metadata import record
from scripts.deploy.review.topology import rows

MOUNT_PROBE = '''import json,os,sys
request=json.load(sys.stdin)
sources={}
for source in request['sources']:
 resolved=os.path.realpath(source,strict=True)
 ancestors=[]
 cursor=resolved
 for depth in range(65):
  metadata=os.stat(cursor)
  ancestors.append([metadata.st_dev,metadata.st_ino])
  if cursor=="/": break
  cursor=os.path.dirname(cursor)
 else: raise ValueError("Mount ancestor bound exceeded")
 sources[source]={"path":resolved,"ancestors":ancestors}
mounted={}
for item in request['mounted']:
 pid=str(item['pid'])
 with open('/proc/'+pid+'/cgroup') as source:
  if item['id'] not in source.read(65536):
   raise ValueError("Captured container process changed")
 metadata=os.stat('/proc/'+pid+'/root'+item['destination'])
 mounted[item['key']]=[metadata.st_dev,metadata.st_ino]
print(json.dumps({'sources':sources,'mounted':mounted}))
'''


def physical_identity(value: object) -> list[int]:
    if (not isinstance(value, list) or len(value) != 2
            or any(type(item) is not int or item < 0 for item in value)):
        raise ValueError('physical-mount-identity-missing')
    return cast(list[int], value)


def resolve_mounts(
    containers: Sequence[Mapping[str, object]], protected: set[str],
    probe: Callable[[bytes], bytes], retained: Mapping[str, object] | None,
    admitted_writers: set[str] | None = None,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    sources: set[str] = set()
    mounted: list[dict[str, object]] = []
    protected_keys: set[str] = set()
    for container in containers:
        identity = str(container['Id'])
        state = record(container['State'], 'container state')
        for mount in rows(container.get('Mounts'), 'mount'):
            source, destination = mount.get('Source'), mount.get('Destination')
            for path in (source, destination):
                if (not isinstance(path, str) or len(path) > 4096
                        or not path.startswith('/')
                        or '..' in PurePosixPath(path).parts):
                    raise ValueError('bounded-absolute-mount-path-required')
            sources.add(cast(str, source))
            if identity not in protected:
                continue
            key = identity + ':' + cast(str, destination)
            if key in protected_keys:
                raise ValueError('duplicate-protected-mount')
            protected_keys.add(key)
            if state.get('Running') is True:
                pid = state.get('Pid')
                if type(pid) is not int or pid <= 0:
                    raise ValueError('captured-running-process-required')
                mounted.append({'key': key, 'id': identity, 'pid': pid,
                                'destination': destination})
            elif retained is None:
                raise ValueError('original-mounted-storage-proof-required')
    if len(sources) > 4000 or not protected_keys:
        raise ValueError('bounded-protected-mount-inventory-required')
    raw = record(json.loads(probe(json.dumps({
        'sources': sorted(sources), 'mounted': mounted,
    }).encode())), 'physical mount inventory')
    metadata = record(raw['sources'], 'mount sources')
    actual_mounted = record(raw['mounted'], 'mounted objects')
    if (set(metadata) != sources
            or set(actual_mounted) != {str(item['key']) for item in mounted}):
        raise ValueError('host-mount-source-inventory-changed')
    result: list[dict[str, object]] = []
    bindings: dict[str, object] = {}
    roots: list[list[list[int]]] = []
    for container in containers:
        identity = str(container['Id'])
        mapped: list[dict[str, object]] = []
        for mount in rows(container.get('Mounts'), 'mount'):
            resolved = record(metadata[cast(str, mount['Source'])], 'source')
            ancestors = [physical_identity(item) for item in cast(
                list[object], resolved['ancestors'],
            )]
            if not ancestors or len(ancestors) > 65:
                raise ValueError('physical-mount-identity-missing')
            if identity in protected:
                key = identity + ':' + cast(str, mount['Destination'])
                if key in actual_mounted:
                    if physical_identity(actual_mounted[key]) != ancestors[0]:
                        raise ValueError('original-mounted-source-changed')
                bindings[key] = {'source': resolved['path'],
                                 'identity': ancestors[0]}
                roots.append(ancestors)
            mapped.append({**mount, 'Source': resolved['path']})
        result.append({**container, 'Mounts': mapped})
    if retained is not None and dict(retained) != bindings:
        raise ValueError('retained-storage-object-changed')
    for container in containers:
        if (container['Id'] in protected
                or container['Id'] in (admitted_writers or set())):
            continue
        for mount in rows(container.get('Mounts'), 'mount'):
            if not mount.get('RW'):
                continue
            source = record(metadata[cast(str, mount['Source'])], 'source')
            ancestors = cast(list[list[int]], source['ancestors'])
            if any(ancestors[0] in root or root[0] in ancestors
                   for root in roots):
                raise ValueError('physical-review-storage-alias')
    return result, bindings
