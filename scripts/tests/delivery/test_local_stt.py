"""Exercise image admission and evidence retention at the Docker boundary."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
RUNNER = ROOT / 'scripts/deploy/smoke-local-stt-image.sh'
SOURCE = 'a' * 40


class LocalSttQualificationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.evidence = self.root / 'evidence'
        self.log = self.root / 'commands.jsonl'
        binary = self.root / 'bin'
        binary.mkdir()
        docker = binary / 'docker'
        docker.write_text('#!' + sys.executable + '\n' + r'''
import json, os, pathlib, sys
args = sys.argv[1:]
with open(os.environ['COMMAND_LOG'], 'a') as output:
    output.write(json.dumps(args) + '\n')
mode = os.environ['QUALIFICATION_MODE']
if args[:2] == ['image', 'inspect']:
    if '--format' not in args:
        print('[]')
    elif args[3] == '{{.Id}}':
        print('sha256:fixed-image')
    elif args[3] == '{{.Os}}/{{.Architecture}}':
        print('linux/arm64' if mode == 'platform' else 'linux/amd64')
    else:
        print('b' * 40 if mode == 'source' else 'a' * 40)
elif args[0] == 'create':
    print('qualification-container')
elif args[0] == 'start':
    print(json.dumps({'version': 1 if mode == 'receipt' else 2,
                      'qualificationPassed': mode != 'failed'}))
    if mode == 'failed':
        raise SystemExit(7)
elif args[0] == 'inspect':
    print(json.dumps([{'Image': 'sha256:fixed-image', 'RestartCount': 0,
        'State': {'ExitCode': 7 if mode == 'failed' else 0,
                  'OOMKilled': mode == 'oom'}}]))
elif args[0] == 'cp':
    if mode == 'copy':
        raise SystemExit(3)
    destination = pathlib.Path(args[-1])
    destination.mkdir()
    if destination.name == 'fixtures':
        (destination / 'sample.wav').write_bytes(b'public-audio')
    else:
        (destination / 'server.log').write_text('partial server evidence')
elif args[0] not in ['run', 'rm']:
    raise SystemExit('Unexpected Docker operation: ' + repr(args))
''')
        docker.chmod(0o700)
        decoder = binary / 'ffmpeg'
        decoder.write_text('#!/bin/sh\nexit 0\n')
        decoder.chmod(0o700)
        self.environment = {
            **os.environ,
            'PATH': str(binary) + os.pathsep + os.environ['PATH'],
            'COMMAND_LOG': str(self.log),
        }

    def qualify(self, mode: str = 'success') -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ['bash', str(RUNNER), 'candidate:tag', SOURCE, str(self.evidence)],
            cwd=ROOT, env={**self.environment, 'QUALIFICATION_MODE': mode},
            text=True, capture_output=True,
        )

    def test_qualified_image_is_pinned_before_metadata_checks(self) -> None:
        result = self.qualify()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        commands = [json.loads(line) for line in self.log.read_text().splitlines()]
        inspections = [command for command in commands
                       if command[:2] == ['image', 'inspect']]
        self.assertEqual(inspections[0][-1], 'candidate:tag')
        self.assertTrue(all(command[-1] == 'sha256:fixed-image'
                            for command in inspections[1:]))
        self.assertTrue((self.evidence / 'fixtures/sample.wav').is_file())
        self.assertTrue((self.evidence / 'stt-copied/server.log').is_file())
        create = next(command for command in commands if command[0] == 'create')
        self.assertIn('--read-only', create)
        self.assertEqual(create[create.index('--network') + 1], 'none')
        self.assertIn('sha256:fixed-image', create)

    def test_source_and_platform_mismatches_reject_before_container_creation(self) -> None:
        for mode in ('source', 'platform'):
            with self.subTest(mode=mode):
                result = self.qualify(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.evidence.exists())
                commands = [json.loads(line) for line in self.log.read_text().splitlines()]
                self.assertFalse(any(command[0] == 'create' for command in commands))
                self.log.unlink()

    def test_failed_model_and_oom_preserve_partial_outputs_before_rejection(self) -> None:
        for mode in ('failed', 'oom', 'receipt'):
            with self.subTest(mode=mode):
                self.evidence = self.root / mode
                result = self.qualify(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue((self.evidence / 'stt-exit.json').is_file())
                self.assertEqual((self.evidence / 'stt-copied/server.log').read_text(),
                                 'partial server evidence')
                self.assertTrue((self.evidence / 'fixtures/sample.wav').is_file())

    def test_copy_failure_is_not_reported_as_success(self) -> None:
        result = self.qualify('copy')
        self.assertNotEqual(result.returncode, 0)
        receipt = json.loads((self.evidence / 'stt-exit.json').read_text())
        self.assertEqual(receipt['copyExitCode'], 3)
        self.assertTrue((self.evidence / 'stt-container.json').is_file())


if __name__ == '__main__':
    unittest.main()
