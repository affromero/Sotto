"""Manual releases must bind matching versions, notes, tags, and successful CI."""

import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

HELPER = Path(__file__).parents[1] / 'release/check.py'
spec = importlib.util.spec_from_file_location('release_check', HELPER)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git('init', '-b', 'main')
        for directory in ('.', 'apps/web', 'apps/desktop'):
            self.write_json(f'{directory}/package.json', {'name': directory, 'version': '0.1.0'})
        self.write_json('package-lock.json', {'version': '0.1.0', 'packages': {
            '': {'version': '0.1.0'}, 'apps/web': {'version': '0.1.0'},
        }})
        self.write_json('apps/desktop/package-lock.json', {
            'version': '0.1.0', 'packages': {'': {'version': '0.1.0'}},
        })
        self.write_json('apps/desktop/src-tauri/tauri.conf.json', {'version': '0.1.0'})
        for directory, name in (('apps/desktop/src-tauri', 'sotto-host'), ('tui', 'sotto-tui')):
            fields = f'name = "{name}"\nversion = "0.1.0"\n'
            self.write(f'{directory}/Cargo.toml', '[package]\n' + fields)
            self.write(f'{directory}/Cargo.lock', 'version = 4\n\n[[package]]\n' + fields)
        self.write('CHANGELOG.md', '# Changelog\n\n## [0.1.0] - 2026-09-26\n\n- Fix setup.\n\n## [0.0.2] - 2026-01-01\n\n- Earlier work.\n')
        self.write('tui/CHANGELOG.md', '# TUI changelog\n\n## [0.1.0] - 2026-09-26\n\n- Practice vocabulary.\n')
        self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')

    def git(self, *arguments):
        environment = dict(os.environ, GIT_AUTHOR_NAME='Release Tests',
                           GIT_AUTHOR_EMAIL='tests@example.com', GIT_COMMITTER_NAME='Release Tests',
                           GIT_COMMITTER_EMAIL='tests@example.com')
        return subprocess.run(['git', '-C', str(self.root), *arguments], check=True,
                              capture_output=True, text=True, env=environment).stdout.strip()

    def write(self, path, content):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def write_json(self, path, content):
        self.write(path, json.dumps(content))

    def commit(self):
        self.git('add', '.')
        self.git('commit', '-m', 'Release fixture')

    def test_app_release_reports_exact_commit_and_its_own_notes(self):
        metadata, notes = release.check(self.root, 'v0.1.0', 'desktop')
        self.assertEqual(metadata['sha'], self.git('rev-parse', 'HEAD'))
        self.assertEqual(metadata['make_latest'], 'true')
        self.assertIn('Fix setup', notes)
        self.assertNotIn('Earlier work', notes)

    def test_ancillary_releases_never_become_the_latest_app_release(self):
        for tag in ('desktop-v0.1.0', 'sotto-v0.1.0'):
            with self.subTest(tag=tag):
                metadata, _ = release.check(self.root, tag)
                self.assertEqual(metadata['make_latest'], 'false')

    def test_tui_uses_its_independent_version_and_changelog(self):
        self.write_json('package.json', {'version': '9.0.0'})
        metadata, notes = release.check(self.root, 'sotto-v0.1.0', 'tui')
        self.assertEqual(metadata['version'], '0.1.0')
        self.assertIn('Practice vocabulary', notes)
        self.assertNotIn('Fix setup', notes)

    def test_invalid_tags_and_wrong_release_surfaces_are_rejected(self):
        for tag in ('main', 'v01.0.0', 'v1٢.0.0', 'v0.1.0;echo test', 'v0.1.0\n', 'v0.1.0-rc.1'):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                release.check(self.root, tag)
        with self.assertRaisesRegex(ValueError, 'not a tui'):
            release.check(self.root, 'v0.1.0', 'tui')
        with self.assertRaisesRegex(ValueError, 'not a desktop'):
            release.check(self.root, 'sotto-v0.1.0', 'desktop')

    def test_canonical_tags_validate_web_versions_even_in_the_desktop_workflow(self):
        self.write_json('apps/web/package.json', {'version': '0.2.0'})
        with self.assertRaisesRegex(ValueError, 'apps/web/package.json'):
            release.check(self.root, 'v0.1.0', 'desktop')

    def test_lockfile_and_tauri_version_mismatches_are_rejected(self):
        for path in ('package-lock.json', 'apps/desktop/package-lock.json',
                     'apps/desktop/src-tauri/tauri.conf.json'):
            original = (self.root / path).read_text()
            with self.subTest(path=path):
                self.write_json(path, {'version': '0.2.0'})
                with self.assertRaises(ValueError):
                    release.check(self.root, 'v0.1.0')
            self.write(path, original)
        self.write('tui/Cargo.lock', '[[package]]\nname = "sotto-tui"\nversion = "0.2.0"\n')
        with self.assertRaisesRegex(ValueError, 'Cargo.lock'):
            release.check(self.root, 'sotto-v0.1.0')

    def test_missing_or_empty_notes_block_publication(self):
        for body in ('## [Unreleased]\n- Work pending.\n',
                     '## [0.1.0] - 2026-09-26\n### Fixed\n<!-- Fill this in -->\n'):
            with self.subTest(body=body):
                self.write('CHANGELOG.md', body)
                with self.assertRaises(ValueError):
                    release.check(self.root, 'v0.1.0')

    def test_manual_runs_require_an_existing_tag_at_the_checked_out_commit(self):
        with self.assertRaisesRegex(ValueError, 'does not exist'):
            release.check(self.root, 'v0.1.0', require_tag=True)
        self.git('tag', '-a', 'v0.1.0', '-m', 'Release fixture')
        release.check(self.root, 'v0.1.0', require_tag=True)
        self.write('another.txt', 'Another commit\n')
        self.commit()
        with self.assertRaisesRegex(ValueError, 'another commit'):
            release.check(self.root, 'v0.1.0')

    def test_dirty_or_unmerged_release_commits_are_rejected(self):
        self.git('tag', 'v0.1.0')
        self.write('untracked.txt', 'Not committed\n')
        with self.assertRaisesRegex(ValueError, 'clean checkout'):
            release.check(self.root, 'v0.1.0', require_tag=True)
        self.commit()
        self.git('tag', '-d', 'v0.1.0')
        self.git('tag', 'v0.1.0')
        with self.assertRaises(ValueError):
            release.check(self.root, 'v0.1.0', require_tag=True)

    def test_failed_or_missing_ci_blocks_publication(self):
        metadata, _ = release.check(self.root, 'v0.1.0')
        for response in ({'workflow_runs': []}, {'workflow_runs': [
            {'head_sha': metadata['sha'], 'conclusion': 'failure'},
        ]}):
            with self.subTest(response=response), patch.object(
                release, 'urlopen', return_value=io.StringIO(json.dumps(response))
            ), self.assertRaisesRegex(ValueError, 'must pass'):
                release.check_github(metadata, 'owner/repo')

    def test_successful_ci_allows_first_release_but_not_latest_rollback(self):
        metadata, _ = release.check(self.root, 'v0.1.0')
        success = {'workflow_runs': [{'head_sha': metadata['sha'], 'conclusion': 'success'}]}
        with patch.object(release, 'urlopen', side_effect=[
            io.StringIO(json.dumps(success)), io.StringIO(json.dumps(success)),
            HTTPError('https://api.github.com', 404, 'Not Found', {}, None),
        ]):
            release.check_github(metadata, 'owner/repo')
        with patch.object(release, 'urlopen', side_effect=[
            io.StringIO(json.dumps(success)), io.StringIO(json.dumps(success)),
            io.StringIO(json.dumps({'tag_name': 'v0.2.0'})),
        ]), self.assertRaisesRegex(ValueError, 'older'):
            release.check_github(metadata, 'owner/repo')

    def test_github_permission_errors_do_not_look_like_an_empty_release_history(self):
        with patch.object(release, 'urlopen', side_effect=HTTPError(
            'https://api.github.com', 403, 'Forbidden', {}, None
        )), self.assertRaisesRegex(ValueError, 'HTTP 403'):
            release.github_json('owner/repo', 'releases/latest', missing_ok=True)


if __name__ == '__main__':
    unittest.main()
