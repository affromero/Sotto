"""Exercise storage admission when Docker changes during inspection."""

from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.review.runtime.mounts import MOUNT_PROBE
from scripts.deploy.review.runtime.operations import HostOperations
from scripts.tests.review.runtime.migration_fixture import (
    MigrationFixture, interleaved_inventories,
)


class StorageInventoryTests(unittest.TestCase):
    def test_inventory_changes_do_not_create_or_replace_storage_receipt(self) -> None:
        for change in ('new-container', 'started-container', 'restart'):
            for existing in (False, True):
                with self.subTest(change=change, existing=existing):
                    with tempfile.TemporaryDirectory() as directory:
                        with MigrationFixture(Path(directory), interleaved_inventories()) as host:
                            foreign = copy.deepcopy(host.original)
                            foreign['Id'] = 'd' * 64
                            foreign['Name'] = '/foreign'
                            foreign['Mounts'] = []
                            foreign['State'] = {'Running': False, 'Pid': 0}
                            if change == 'started-container':
                                host.helpers[str(foreign['Id'])] = foreign
                            operations = host.reconstruct()
                            receipt = host.attempt.directory / 'original-mount-objects.json'
                            if existing:
                                operations.verify_storage()
                                original = receipt.read_bytes()
                            command = host.command

                            def changing_command(arguments, **kwargs):
                                result = command(arguments, **kwargs)
                                if list(arguments)[-2:] == ['-c', MOUNT_PROBE]:
                                    if change == 'new-container':
                                        host.helpers[str(foreign['Id'])] = foreign
                                    elif change == 'started-container':
                                        foreign['State'] = {'Running': True, 'Pid': 456}
                                    else:
                                        host.original['State']['Pid'] = 456
                                return result

                            with patch.object(HostOperations, 'command',
                                              side_effect=changing_command):
                                with self.assertRaisesRegex(ValueError, 'inventory-changed'):
                                    operations.verify_storage()
                            if existing:
                                self.assertEqual(receipt.read_bytes(), original)
                            else:
                                self.assertFalse(receipt.exists())
