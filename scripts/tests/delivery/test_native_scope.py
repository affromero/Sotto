"""Native checks follow actual changed paths, including deleted files."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest


HELPER = Path(__file__).resolve().parents[2] / 'ci/native-scope.mjs'


class NativeScopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.git('init', '-b', 'main')
        self.write('README.md', 'fixture')
        self.commit()
        self.base = self.git('rev-parse', 'HEAD')

    def git(self, *args: str) -> str:
        env = dict({key: value for key, value in os.environ.items()
                    if not key.startswith('GIT_')},
                   GIT_AUTHOR_NAME='Delivery Tests',
                   GIT_AUTHOR_EMAIL='tests@example.com',
                   GIT_COMMITTER_NAME='Delivery Tests',
                   GIT_COMMITTER_EMAIL='tests@example.com')
        return subprocess.check_output(
            ['git', *args], cwd=self.root, env=env, text=True,
            stderr=subprocess.PIPE,
        ).strip()

    def write(self, path: str, content: str = 'fixture') -> None:
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def commit(self) -> None:
        self.git('add', '.')
        self.git('commit', '-m', 'Fixture change')

    def scope(self, *args: str) -> dict[str, str]:
        result = subprocess.run(
            ['node', str(HELPER), '--base', self.base, *args],
            cwd=self.root, capture_output=True, text=True, check=True,
            env={key: value for key, value in os.environ.items()
                 if not key.startswith('GIT_')},
        )
        return dict(line.split('=') for line in result.stdout.splitlines())

    def test_ios_only_change_selects_ios_without_desktop(self) -> None:
        self.write('apps/ios/Tests/ProfileTests.swift')
        self.commit()
        self.assertEqual(self.scope(), {'desktop': 'false', 'ios': 'true'})

    def test_desktop_icon_source_selects_desktop(self) -> None:
        self.write('apps/web/public/brand/sotto-mark.svg')
        self.commit()
        self.assertEqual(self.scope(), {'desktop': 'true', 'ios': 'false'})

    def test_web_change_selects_neither_native_surface(self) -> None:
        self.write('apps/web/src/page.tsx')
        self.commit()
        self.assertEqual(self.scope(), {'desktop': 'false', 'ios': 'false'})

    def test_deleted_native_file_still_requires_its_checks(self) -> None:
        self.write('apps/desktop/src/deleted.ts')
        self.commit()
        self.base = self.git('rev-parse', 'HEAD')
        (self.root / 'apps/desktop/src/deleted.ts').unlink()
        self.commit()
        self.assertEqual(self.scope(), {'desktop': 'true', 'ios': 'false'})

    def test_rename_across_surfaces_checks_both(self) -> None:
        self.write('apps/ios/Shared.swift')
        self.commit()
        self.base = self.git('rev-parse', 'HEAD')
        (self.root / 'apps/desktop/src').mkdir(parents=True)
        self.git('mv', 'apps/ios/Shared.swift', 'apps/desktop/src/Shared.swift')
        self.commit()
        self.assertEqual(self.scope(), {'desktop': 'true', 'ios': 'true'})

    def test_pull_request_ignores_unrelated_base_branch_changes(self) -> None:
        self.git('checkout', '-b', 'feature')
        self.write('apps/ios/Feature.swift')
        self.commit()
        head = self.git('rev-parse', 'HEAD')
        self.git('checkout', 'main')
        self.write('apps/desktop/src/unrelated.ts')
        self.commit()
        self.base = self.git('rev-parse', 'HEAD')
        self.assertEqual(self.scope('--event', 'pull_request', '--head', head),
                         {'desktop': 'false', 'ios': 'true'})

    def test_manual_and_missing_baselines_select_all(self) -> None:
        for args in (('--all',), ('--base', ''), ('--base', '0' * 40)):
            with self.subTest(args=args):
                self.assertEqual(self.scope(*args),
                                 {'desktop': 'true', 'ios': 'true'})

    def test_selector_changes_require_both_surfaces(self) -> None:
        self.write('scripts/ci/native-scope.mjs')
        self.commit()
        self.assertEqual(self.scope(), {'desktop': 'true', 'ios': 'true'})

    def test_invalid_baseline_fails_instead_of_skipping_checks(self) -> None:
        result = subprocess.run(
            ['node', str(HELPER), '--base', 'missing-ref'],
            cwd=self.root, capture_output=True, text=True,
            env={key: value for key, value in os.environ.items()
                 if not key.startswith('GIT_')},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')
        self.assertIn('failed', result.stderr)
