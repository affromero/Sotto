"""Reject replaced review storage and foreign physical writer aliases."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from typing import cast

from scripts.deploy.review.runtime.mounts import resolve_mounts


class ReviewMountTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.storage = self.root / 'storage'
        self.storage.mkdir()
        self.containers: list[dict[str, object]] = [{
            'Id': 'a' * 64, 'State': {'Running': True, 'Pid': os.getpid()},
            'Mounts': [{'Source': str(self.storage),
                        'Destination': '/app/storage', 'RW': True}],
        }]
        self.original = [self.storage.stat().st_dev,
                         self.storage.stat().st_ino]

    def probe(self, content: bytes) -> bytes:
        """Model the privileged view using actual filesystem objects."""
        request = json.loads(content)
        sources = {}
        for source in request['sources']:
            resolved = Path(source).resolve(strict=True)
            ancestors = [[path.stat().st_dev, path.stat().st_ino]
                         for path in [resolved, *resolved.parents]]
            sources[source] = {'path': str(resolved), 'ancestors': ancestors}
        mounted = {item['key']: self.original for item in request['mounted']}
        return json.dumps({'sources': sources, 'mounted': mounted}).encode()

    def test_captured_inode_survives_stop_but_replaced_source_refuses(
        self,
    ) -> None:
        actual, binding = resolve_mounts(self.containers, {'a' * 64},
                                         self.probe, None)
        self.assertEqual(actual[0]['Mounts'], self.containers[0]['Mounts'])
        self.containers[0]['State'] = {'Running': False, 'Pid': 0}
        self.assertEqual(resolve_mounts(self.containers, {'a' * 64},
                                        self.probe, binding)[1], binding)
        self.storage.rename(self.root / 'old-storage')
        self.storage.mkdir()
        with self.assertRaisesRegex(ValueError, 'retained-storage-object'):
            resolve_mounts(self.containers, {'a' * 64}, self.probe, binding)

    def test_live_mount_must_still_match_host_leaf_before_retirement(
        self,
    ) -> None:
        self.storage.rename(self.root / 'old-storage')
        self.storage.mkdir()
        with self.assertRaisesRegex(ValueError, 'original-mounted-source'):
            resolve_mounts(self.containers, {'a' * 64}, self.probe, None)

    def test_foreign_parent_child_and_symlink_writers_are_rejected(
        self,
    ) -> None:
        child = self.storage / 'child'
        child.mkdir()
        alias = self.root / 'alias'
        alias.symlink_to(self.storage, target_is_directory=True)
        for source in (self.root, child, alias):
            foreign: dict[str, object] = {
                'Id': 'b' * 64, 'State': {'Running': True, 'Pid': 2},
                'Mounts': [{'Source': str(source), 'Destination': '/foreign',
                            'RW': True}],
            }
            with self.subTest(source=source), self.assertRaisesRegex(
                ValueError, 'physical-review-storage-alias',
            ):
                resolve_mounts([*self.containers, foreign], {'a' * 64},
                               self.probe, None)

    def test_stopped_container_requires_prior_mounted_proof(self) -> None:
        self.containers[0]['State'] = {'Running': False, 'Pid': 0}
        with self.assertRaisesRegex(ValueError, 'mounted-storage-proof'):
            resolve_mounts(self.containers, {'a' * 64}, self.probe, None)

    def test_readonly_alias_is_allowed_and_missing_source_refuses(
        self,
    ) -> None:
        foreign: dict[str, object] = {
            'Id': 'b' * 64, 'State': {'Running': False, 'Pid': 0},
            'Mounts': [{'Source': str(self.root), 'Destination': '/readonly',
                        'RW': False}],
        }
        actual, _ = resolve_mounts([*self.containers, foreign], {'a' * 64},
                                   self.probe, None)
        self.assertEqual(actual[1]['Mounts'], foreign['Mounts'])
        mounts = cast(list[dict[str, object]], foreign['Mounts'])
        mounts[0]['Source'] = str(self.root / 'missing')
        with self.assertRaises(FileNotFoundError):
            resolve_mounts([*self.containers, foreign], {'a' * 64},
                           self.probe, None)
