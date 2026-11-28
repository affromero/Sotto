"""Remove the empty directory bound to one stopped assessment execution."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import PurePosixPath
from typing import TYPE_CHECKING

from scripts.deploy.images.metadata import digest, record
from scripts.deploy.review.runtime.inventory.queue_snapshot import approved_assessment_cleanup
from scripts.deploy.review.topology import EXECUTIONS, PROJECT, rows

if TYPE_CHECKING:
    from scripts.deploy.review.runtime.operations import HostOperations


REMOVE_EMPTY_WORKSPACE = """
import json
import os
import stat
import sys
request = json.load(sys.stdin)
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
mount = os.open('/', flags)
try:
 for part in request['source'].split('/')[1:]:
  child = os.open(part, flags, dir_fd=mount)
  os.close(mount)
  mount = child
 root = os.open('executions', flags, dir_fd=mount)
 try:
  def identity(info):
   return [str(info.st_dev), str(info.st_ino)]
  if identity(os.fstat(root)) != request['root']:
   raise ValueError('assessment workspace root changed')
  leaf = request['leaf']
  metadata = os.stat(leaf, dir_fd=root, follow_symlinks=False)
  if not stat.S_ISDIR(metadata.st_mode) or identity(metadata) != request['directory']:
   raise ValueError('assessment workspace directory changed')
  os.rmdir(leaf, dir_fd=root)
  os.fsync(root)
 finally:
  os.close(root)
finally:
 os.close(mount)
"""


def workspace_removal(
    encoded: object, proof: dict[str, object], source_path: str,
) -> dict[str, object]:
    """Translate an exact SDK workspace identity into a bounded host request."""
    if (not isinstance(encoded, str) or len(encoded) > 4096
            or hashlib.sha256(encoded.encode()).hexdigest() != proof['workspaceSha256']):
        raise ValueError('exact-stopped-assessment-workspace-required')
    root_path = PurePosixPath(source_path)
    if (not root_path.is_absolute() or '..' in root_path.parts
            or str(root_path) != source_path or len(root_path.parts) < 3):
        raise ValueError('invalid-review-execution-volume-source')
    identity = record(json.loads(encoded), 'assessment workspace')
    execution = record(proof['binding'], 'assessment execution binding')['id']
    if (not isinstance(execution, str)
            or not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', execution)
            or identity.get('executionId') != execution):
        raise ValueError('assessment workspace execution changed')
    leaf = 'execution-' + execution
    root = EXECUTIONS + '/executions'

    def device_inode(key: str, path: str) -> list[str]:
        directory = record(identity[key], 'assessment workspace ' + key)
        if directory.get('root') != path:
            raise ValueError('assessment workspace path changed')
        values = [directory.get('device'), directory.get('inode')]
        if any(not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,20}', value)
               for value in values):
            raise ValueError('assessment workspace physical identity changed')
        return [str(value) for value in values]

    return {'source': source_path, 'leaf': leaf, 'root': device_inode('root', root),
            'directory': device_inode('directory', root + '/' + leaf)}


def remove_assessment_workspace(
    previous: HostOperations, successor: HostOperations, encoded: object,
) -> None:
    """Recheck the fence and remove a single empty directory on the retained volume."""
    recovery = approved_assessment_cleanup(previous, successor)
    proof = record(recovery['proof'], 'assessment recovery proof')
    topology = record(previous.manifest['topology'], 'review topology')
    web = record(record(topology['services'], 'review services')['web'], 'review web')
    matches = [mount for mount in rows(web['mounts'], 'review web mounts')
               if mount.get('Destination') == EXECUTIONS and mount.get('Type') == 'volume'
               and mount.get('Name') == PROJECT + '_executions']
    if len(matches) != 1 or not isinstance(source := matches[0].get('Source'), str):
        raise ValueError('exact-review-execution-volume-required')
    request = workspace_removal(encoded, proof, source)
    successor.lock.validate()
    successor.command(
        ['sudo', '-n', '/usr/bin/python3', '-c', REMOVE_EMPTY_WORKSPACE],
        content=json.dumps(request).encode(),
    )
    successor.verify_fence()
