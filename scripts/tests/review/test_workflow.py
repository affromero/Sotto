"""Verify isolated build routing and failure before review publication."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest
from typing import cast

from images.fixtures import ROOT, SHA, environment, field


class ReviewWorkflowTests(unittest.TestCase):
    def workflow(self) -> dict[str, object]:
        result = subprocess.run([
            'node', '-e',
            "process.stdout.write(JSON.stringify(require('yaml').parse("
            "require('node:fs').readFileSync(process.argv[1], 'utf8'))))",
            str(ROOT / '.github/workflows/deploy.yml'),
        ], cwd=ROOT, text=True, capture_output=True, check=True)
        return cast(dict[str, object], json.loads(result.stdout))

    def test_review_dispatch_is_isolated_from_production(self) -> None:
        workflow = self.workflow()
        trigger = field(field(workflow, 'on'), 'workflow_dispatch')
        option = field(field(trigger, 'inputs'), 'review_only')
        self.assertEqual(option['type'], 'boolean')
        self.assertIs(option['default'], False)
        group = cast(str, field(workflow, 'concurrency')['group'])
        self.assertIn("inputs.review_only && 'review-images'", group)
        self.assertIn("|| 'production-images'", group)
        self.assertIn('${{ github.ref }}', group)
        jobs = field(workflow, 'jobs')
        for name in ['worker-base', 'showcase', 'personal', 'workers',
                     'release-record', 'local-stt']:
            with self.subTest(job=name):
                self.assertIn("needs.ci.outputs.publish == 'true'",
                              cast(str, field(jobs, name)['if']))
        review = field(jobs, 'review')
        self.assertEqual(review['if'],
                         "needs.ci.outputs.review == 'true'")
        steps = cast(list[dict[str, object]], review['steps'])
        build = next(
            step for step in steps
            if step.get('name') == 'Build isolated review web candidate'
        )
        settings = field(build, 'with')
        self.assertEqual(settings['platforms'], 'linux/amd64')
        self.assertIn('NEXT_PUBLIC_APP_URL=https://demo.sotto.fm',
                      cast(str, settings['build-args']).splitlines())
        self.assertIn('RUNTIME_UID=1000',
                      cast(str, settings['build-args']).splitlines())
        self.assertEqual(settings['labels'],
                         'io.sotto.public-origin=https://demo.sotto.fm')

    def test_failed_smoke_command_cannot_publish_or_collect(self) -> None:
        review = field(field(self.workflow(), 'jobs'), 'review')
        steps = cast(list[dict[str, object]], review['steps'])
        publish = next(
            step for step in steps
            if step.get('name') == 'Verify and publish isolated review web'
        )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            executable = root / 'docker'
            executable.write_text(f'#!{sys.executable}\n' + textwrap.dedent('''
                import json, os, sys
                from pathlib import Path
                args = sys.argv[1:]
                with Path(os.environ['DOCKER_COMMANDS']).open('a') as stream:
                    stream.write(json.dumps(args) + '\\n')
                if args[:2] == ['image', 'inspect']:
                    print(os.environ['RELEASE_SHA'])
                elif args[0] == 'run':
                    print('Smoke boundary refused image', file=sys.stderr)
                    raise SystemExit(65)
                elif args[0] not in ['volume', 'rm']:
                    raise RuntimeError('Unexpected Docker operation')
            '''))
            executable.chmod(0o700)
            commands = root / 'commands.jsonl'
            receipt = root / 'review.json'
            script = cast(str, publish['run']).replace(
                'delivery/review-release.json', str(receipt),
            )
            result = subprocess.run(
                ['bash', '-e', '-o', 'pipefail', '-c', script],
                cwd=ROOT, env={
                    **environment(), 'RELEASE_SHA': SHA,
                    'PATH': str(root) + os.pathsep + os.environ['PATH'],
                    'DOCKER_COMMANDS': str(commands),
                }, text=True, capture_output=True,
            )
            self.assertEqual(result.returncode, 65,
                             result.stdout + result.stderr)
            operations = [json.loads(line)
                          for line in commands.read_text().splitlines()]
            self.assertTrue(any(args[0] == 'run' for args in operations))
            self.assertFalse(any(args[0] == 'push' for args in operations))
            self.assertFalse(receipt.exists())
