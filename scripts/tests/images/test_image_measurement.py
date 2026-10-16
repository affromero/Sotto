"""Measure actual archive entries rather than Docker's displayed image size."""

from __future__ import annotations

import gzip
import importlib.util
import shutil
import subprocess
import sys
import tarfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import patch

from images.fixtures import ROOT, ReceiptFixture, image_archive, tar_bytes


class ImageMeasurementTests(ReceiptFixture):
    module: ModuleType

    def setUp(self) -> None:
        super().setUp()
        spec = importlib.util.spec_from_file_location(
            'sotto_image_measurement',
            ROOT / 'scripts/deploy/images/measure_image.py')
        assert spec is not None and spec.loader is not None
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def archive(self, compressed: bool = False) -> Path:
        directory = tarfile.TarInfo('directory')
        directory.type = tarfile.DIRTYPE
        link = tarfile.TarInfo('symlink')
        link.type = tarfile.SYMTYPE
        link.linkname = 'file'
        hardlink = tarfile.TarInfo('hardlink')
        hardlink.type = tarfile.LNKTYPE
        hardlink.linkname = 'file'
        layer = tar_bytes([
            (tarfile.TarInfo('file'), b'x' * 4097),
            (directory, b''), (link, b''), (hardlink, b''),
        ])
        if compressed:
            layer = gzip.compress(layer)
        path = self.root / 'image.tar'
        image_archive(path, layer)
        return path

    def test_layer_allocation_counts_blocks_links_and_unique_layers(
        self,
    ) -> None:
        for compressed in (False, True):
            with self.subTest(compressed=compressed):
                self.assertEqual(self.module.archive_layers(
                    self.archive(compressed)), (16384, 3))

    def test_other_architecture_and_special_entries_are_rejected(self) -> None:
        path = self.root / 'image.tar'
        image_archive(path, tar_bytes([(tarfile.TarInfo('file'), b'x')]),
                      architecture='arm64')
        with self.assertRaisesRegex(ValueError, 'Linux amd64'):
            self.module.archive_layers(path)
        special = tarfile.TarInfo('device')
        special.type = tarfile.CHRTYPE
        image_archive(path, tar_bytes([(special, b'')]))
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            self.module.archive_layers(path)

    def test_transfer_and_expansion_keep_both_conservative_bounds(
        self,
    ) -> None:
        archive = self.archive()

        def docker_save(
            command: list[str], check: bool,
        ) -> subprocess.CompletedProcess[str]:
            if not check:
                raise ValueError('Docker save failures must stop measurement')
            shutil.copyfile(archive, command[command.index('-o') + 1])
            return subprocess.CompletedProcess(command, 0)

        for history, expanded in (('0\n8192\n', 16384), ('50000\n', 50000)):
            with self.subTest(history=history):
                with patch('subprocess.check_output', return_value=history):
                    with patch('subprocess.run', side_effect=docker_save):
                        measured = self.module.measure('local:test')
                self.assertEqual(measured['expanded_bytes'], expanded)
                self.assertEqual(measured['layer_file_count'], 3)
                self.assertEqual(measured['compressed_bytes'],
                                 archive.stat().st_size)

    def test_unavailable_history_or_save_failure_stops_measurement(
        self,
    ) -> None:
        for history in ('', '0\n', 'unavailable\n'):
            with self.subTest(history=history):
                with patch('subprocess.check_output', return_value=history):
                    with self.assertRaises(ValueError):
                        self.module.measure('local:test')
        with patch('subprocess.check_output', return_value='4096\n'):
            failure = subprocess.CalledProcessError(1, ['docker', 'save'])
            with patch('subprocess.run', side_effect=failure):
                with self.assertRaises(subprocess.CalledProcessError):
                    self.module.measure('local:test')

    def test_cli_reports_failure_without_a_partial_receipt(self) -> None:
        from images.fixtures import environment

        env = environment()
        env['PATH'] = str(self.root)
        result = subprocess.run([
            sys.executable,
            str(ROOT / 'scripts/deploy/images/measure_image.py'),
            'not-present:test',
        ], env=env, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main()
