"""Local checks select changed work and preserve tool failures."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest


HELPER = Path(__file__).resolve().parents[2] / 'ci/check-affected.mjs'


class AffectedChecksTests(unittest.TestCase):
    root: Path
    environment: dict[str, str]
    log: Path

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix='sotto-affected-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.log = self.root / 'npm-calls.jsonl'
        self.environment = dict(
            os.environ,
            GIT_AUTHOR_NAME='Delivery Tests',
            GIT_AUTHOR_EMAIL='tests@example.com',
            GIT_COMMITTER_NAME='Delivery Tests',
            GIT_COMMITTER_EMAIL='tests@example.com',
            SOTTO_AFFECTED_TEST_LOG=str(self.log),
        )
        local_names = subprocess.run(
            ['git', 'rev-parse', '--local-env-vars'],
            cwd=HELPER.parent,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()
        for name in local_names:
            self.environment.pop(name, None)
        self.environment.pop('PRE_COMMIT_FROM_REF', None)
        self.environment.pop('PRE_COMMIT_TO_REF', None)
        self.git('init', '-b', 'main')
        self.write('README.md', 'Fixture\n')
        self.git('add', 'README.md')
        self.commit()
        helper = self.root / 'scripts/ci/check-affected.mjs'
        helper.parent.mkdir(parents=True)
        shutil.copyfile(HELPER, helper)
        binaries = self.root / 'bin'
        binaries.mkdir()
        npm = binaries / 'npm'
        npm.write_text(
            '#!/usr/bin/env python3\n'
            'import json, os, sys\n'
            'with open(os.environ["SOTTO_AFFECTED_TEST_LOG"], "a") as log:\n'
            '    log.write(json.dumps(sys.argv[1:]) + "\\n")\n'
            'if os.environ.get("SOTTO_AFFECTED_TEST_FAIL"):\n'
            '    print("TypeScript boundary failed: test diagnostic", '
            'file=sys.stderr)\n'
            '    sys.exit(42)\n'
        )
        npm.chmod(0o700)
        self.environment['PATH'] = (
            str(binaries) + os.pathsep + self.environment['PATH']
        )

    def git(self, *arguments: str) -> str:
        return subprocess.run(
            ['git', '-c', 'core.hooksPath=/dev/null', *arguments],
            cwd=self.root,
            env=self.environment,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

    def write(self, path: str, content: str = 'export {};\n') -> None:
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def stage(self, *paths: str) -> None:
        for path in paths:
            self.write(path)
        self.git('add', '--', *paths)

    def commit(self) -> str:
        self.git('commit', '-m', 'Fixture change')
        return self.git('rev-parse', 'HEAD')

    def run_checks(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [shutil.which('node'),
             str(self.root / 'scripts/ci/check-affected.mjs'), *arguments],
            cwd=self.root,
            env=self.environment,
            capture_output=True,
            text=True,
            timeout=45,
        )

    def calls(self) -> list[list[str]]:
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def assert_passed(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def prepare_rust(self) -> None:
        self.write('tui/Cargo.toml',
                   '[package]\nname="affected-fixture"\n'
                   'version="0.1.0"\nedition="2021"\n')
        self.write('tui/src/main.rs', 'fn main() {}\n')
        subprocess.run(['cargo', 'generate-lockfile'], cwd=self.root / 'tui',
                       env=self.environment, check=True, capture_output=True)

    def test_docs_and_native_changes_skip_web_and_rust(self) -> None:
        self.stage('docs/setup.md', 'apps/ios/Sources/App.swift')
        result = self.run_checks()
        self.assert_passed(result)
        self.assertEqual(self.calls(), [])
        self.assertNotIn('cargo', result.stdout)

    def test_desktop_manifests_skip_server_workspaces(self) -> None:
        self.stage('apps/desktop/package.json',
                   'apps/desktop/package-lock.json')
        result = self.run_checks()
        self.assert_passed(result)
        self.assertEqual(self.calls(), [])
        self.assertNotIn('cargo', result.stdout)

    def test_staged_source_excludes_unstaged_files(self) -> None:
        source = 'apps/web/src/components/Space Name.tsx'
        self.stage(source)
        self.write('apps/web/src/lib/unrelated.ts')
        result = self.run_checks()
        self.assert_passed(result)
        commands = self.calls()
        self.assertIn(['run', 'type-check', '--workspace=@sotto/web'],
                      commands)
        tests = next(command for command in commands if 'related' in command)
        self.assertIn(str(self.root / source), tests)
        self.assertNotIn(str(self.root / 'apps/web/src/lib/unrelated.ts'),
                         tests)
        self.assertIn('--passWithNoTests', tests)
        self.assertNotIn('build', result.stdout)
        self.assertNotIn('cargo', result.stdout)

    def test_changed_tests_cannot_pass_with_no_tests(self) -> None:
        test = 'apps/web/tests/components/Class.test.tsx'
        self.stage(test)
        self.assert_passed(self.run_checks())
        tests = next(command for command in self.calls()
                     if 'related' in command)
        self.assertIn(str(self.root / test), tests)
        self.assertNotIn('--passWithNoTests', tests)

    def test_browser_changes_keep_types_without_running_vitest(self) -> None:
        self.stage('apps/web/e2e/vocabulary.spec.ts',
                   'apps/web/e2e/fixtures/source.json')
        self.assert_passed(self.run_checks())
        self.assertEqual(self.calls(), [
            ['run', 'type-check', '--workspace=@sotto/web'],
        ])

    def test_browser_changes_preserve_real_unit_test_checks(self) -> None:
        browser = 'apps/web/e2e/vocabulary.spec.ts'
        unit = 'apps/web/tests/components/Vocabulary.test.tsx'
        self.stage(browser, unit)
        self.assert_passed(self.run_checks())
        tests = next(command for command in self.calls()
                     if 'related' in command)
        self.assertIn(str(self.root / unit), tests)
        self.assertNotIn(str(self.root / browser), tests)
        self.assertNotIn('--passWithNoTests', tests)

    def test_deleted_browser_changes_do_not_trigger_unit_tests(self) -> None:
        browser = 'apps/web/e2e/vocabulary.spec.ts'
        self.stage(browser)
        self.commit()
        self.git('rm', browser)
        self.assert_passed(self.run_checks())
        self.assertEqual(self.calls(), [
            ['run', 'type-check', '--workspace=@sotto/web'],
        ])

    def test_deleted_source_runs_the_full_affected_workspace(self) -> None:
        source = 'apps/web/src/lib/removed.ts'
        self.stage(source)
        self.commit()
        self.git('rm', source)
        self.assert_passed(self.run_checks())
        self.assertIn(
            ['run', 'test', '--workspace=@sotto/web', '--', '--run',
             '--no-file-parallelism'], self.calls(),
        )
        self.assertFalse(any('related' in command for command in self.calls()))

    def test_rename_checks_both_paths_and_old_dependents(self) -> None:
        self.stage('apps/web/src/lib/before.ts')
        self.commit()
        self.git('mv', 'apps/web/src/lib/before.ts',
                 'apps/web/src/lib/after.ts')
        self.assert_passed(self.run_checks())
        self.assertTrue(any(command[:2] == ['run', 'test']
                            for command in self.calls()))
        self.assertFalse(any('related' in command for command in self.calls()))

    def test_dynamic_inputs_and_setup_run_full_tests(self) -> None:
        paths = (
            'apps/web/prompts/class.md',
            'apps/web/tests/fixtures/reference.txt',
            'apps/web/tests/setup/index.ts',
            'apps/web/prisma/migrations/change/migration.sql',
            'apps/web/vitest.config.ts',
        )
        for path in paths:
            for dependency_change in (False, True):
                with self.subTest(path=path, dependency_change=dependency_change):
                    self.git('reset')
                    self.log.unlink(missing_ok=True)
                    self.stage(path)
                    if dependency_change:
                        self.stage('package-lock.json')
                    self.assert_passed(self.run_checks())
                    self.assertTrue(any(command[:2] == ['run', 'test']
                                        for command in self.calls()))
                    self.assertFalse(any('related' in command
                                         for command in self.calls()))

    def test_shared_changes_check_shared_and_web_consumers(self) -> None:
        self.stage('packages/shared/src/theme.ts')
        result = self.run_checks()
        self.assert_passed(result)
        workspaces = {part for command in self.calls() for part in command
                      if part.startswith('--workspace=')}
        self.assertEqual(workspaces, {
            '--workspace=@sotto/shared', '--workspace=@sotto/web',
        })
        self.assertNotIn('cargo', result.stdout)

    def test_vocabulary_prompts_use_changed_consumer_and_integrity_tests(
        self,
    ) -> None:
        consumer = 'apps/web/src/lib/live-vocab.ts'
        test = 'apps/web/tests/lib/live-vocab.test.ts'
        integrity = 'apps/web/tests/lib/prompt-integrity.test.ts'
        self.write(integrity)
        for name in ('extract-reading-vocab', 'extract-source-vocab',
                     'repair-source-vocab'):
            for manifest in (False, True):
                with self.subTest(name=name, manifest=manifest):
                    self.git('reset')
                    self.log.unlink(missing_ok=True)
                    prompt = f'apps/web/prompts/live/{name}.md'
                    self.stage(prompt, consumer, test)
                    if manifest:
                        self.stage('package-lock.json')
                    self.assert_passed(self.run_checks())
                    related = next(call for call in self.calls()
                                   if 'related' in call)
                    for path in (consumer, test, integrity):
                        self.assertIn(str(self.root / path), related)
                    self.assertNotIn(str(self.root / prompt), related)
                    self.assertNotIn('--passWithNoTests', related)
                    self.assertFalse(any(call[:2] == ['run', 'test']
                                         for call in self.calls()))

    def test_prompt_exemption_requires_exact_staged_present_companions(
        self,
    ) -> None:
        prompt = 'apps/web/prompts/live/repair-source-vocab.md'
        consumer = 'apps/web/src/lib/live-vocab.ts'
        test = 'apps/web/tests/lib/live-vocab.test.ts'
        integrity = 'apps/web/tests/lib/prompt-integrity.test.ts'
        for companions in ((), (consumer,), (test,),
                           ('apps/web/src/lib/other.ts',
                            'apps/web/tests/lib/other.test.ts')):
            with self.subTest(companions=companions):
                self.git('reset')
                self.log.unlink(missing_ok=True)
                self.write(consumer)
                self.write(test)
                self.write(integrity)
                self.stage(prompt, *companions)
                self.assert_passed(self.run_checks())
                self.assertTrue(any(call[:2] == ['run', 'test']
                                    for call in self.calls()))
        for missing in (prompt, consumer, test, integrity):
            with self.subTest(missing=missing):
                self.git('reset')
                self.log.unlink(missing_ok=True)
                self.write(integrity)
                self.stage(prompt, consumer, test)
                (self.root / missing).unlink()
                self.assert_passed(self.run_checks())
                self.assertTrue(any(call[:2] == ['run', 'test']
                                    for call in self.calls()))

    def test_other_dynamic_inputs_keep_full_gate_with_vocabulary_prompts(
        self,
    ) -> None:
        for additional in (
            'apps/web/prompts/live/unknown.md',
            'apps/web/tests/fixtures/reference.txt',
            'apps/web/models/weights.bin',
            'apps/web/tests/setup/index.ts',
            'apps/web/prisma/migrations/change/migration.sql',
            'apps/web/vitest.config.ts',
        ):
            with self.subTest(additional=additional):
                self.git('reset')
                self.log.unlink(missing_ok=True)
                self.write('apps/web/tests/lib/prompt-integrity.test.ts')
                self.stage(
                    'apps/web/prompts/live/repair-source-vocab.md',
                    'apps/web/src/lib/live-vocab.ts',
                    'apps/web/tests/lib/live-vocab.test.ts',
                    additional,
                )
                self.assert_passed(self.run_checks())
                self.assertTrue(any(call[:2] == ['run', 'test']
                                    for call in self.calls()))
                self.assertFalse(any('related' in call
                                     for call in self.calls()))

    def test_tool_failure_is_returned_with_its_diagnostic(self) -> None:
        self.stage('apps/web/src/lib/example.ts')
        self.environment['SOTTO_AFFECTED_TEST_FAIL'] = '1'
        result = self.run_checks()
        self.assertEqual(result.returncode, 42)
        self.assertIn('TypeScript boundary failed: test diagnostic',
                      result.stderr)
        self.assertEqual(self.calls(),
                         [['run', 'type-check', '--workspace=@sotto/web']])

    def test_changed_python_test_excludes_unrelated_suites(self) -> None:
        selected = 'scripts/tests/test_selected.py'
        self.write(selected, 'import unittest\n'
                   'class Selected(unittest.TestCase):\n'
                   '    def test_delivery(self):\n'
                   '        self.assertTrue(True)\n')
        self.git('add', selected)
        self.write('scripts/tests/test_unrelated.py',
                   'raise RuntimeError("Unrelated suite must not run")\n')
        result = self.run_checks()
        self.assert_passed(result)
        self.assertIn('Ran 1 test', result.stderr)
        self.assertEqual(self.calls(), [])

    def test_packaged_python_test_imports_its_sibling_fixture(self) -> None:
        selected = 'scripts/tests/images/test_selected.py'
        self.write('scripts/tests/images/__init__.py', '')
        self.write('scripts/tests/images/fixtures.py', 'EXPECTED = "ready"\n')
        self.write(selected,
                   'import unittest\nfrom images.fixtures import EXPECTED\n'
                   'class Selected(unittest.TestCase):\n'
                   '    def test_delivery(self):\n'
                   '        self.assertEqual(EXPECTED, "ready")\n')
        self.git('add', selected)
        self.write('scripts/tests/test_unrelated.py',
                   'raise RuntimeError("Unrelated suite must not run")\n')
        result = self.run_checks()
        self.assert_passed(result)
        self.assertIn('Ran 1 test', result.stderr)
        self.assertEqual(self.calls(), [])

    def test_changed_python_failure_blocks_the_local_gate(self) -> None:
        selected = 'scripts/tests/test_selected.py'
        self.write(selected, 'import unittest\n'
                   'class Selected(unittest.TestCase):\n'
                   '    def test_delivery(self):\n'
                   '        self.fail("Changed Python behavior failed")\n')
        self.git('add', selected)
        result = self.run_checks()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Changed Python behavior failed', result.stderr)
        self.assertEqual(self.calls(), [])

    def test_hook_configuration_runs_its_own_behavior_tests(self) -> None:
        selected = 'scripts/tests/delivery/test_affected_checks.py'
        self.write('scripts/tests/delivery/__init__.py', '')
        self.write(selected, 'import unittest\n'
                   'class HookBehavior(unittest.TestCase):\n'
                   '    def test_delivery(self):\n'
                   '        self.fail("Hook behavior changed")\n')
        self.stage('.pre-commit-config.yaml')
        self.write('scripts/tests/test_unrelated.py',
                   'raise RuntimeError("Unrelated suite must not run")\n')
        result = self.run_checks()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Hook behavior changed', result.stderr)
        self.assertNotIn('Unrelated suite must not run', result.stderr)
        self.assertEqual(self.calls(), [])

    def check_nested_git_isolation(self, fail: bool) -> None:
        selected = 'scripts/tests/test_nested_git.py'
        self.write(selected, textwrap.dedent('''\
            import os
            from pathlib import Path
            import subprocess
            import tempfile
            import unittest

            class NestedGit(unittest.TestCase):
                def test_repository_is_owned_by_the_fixture(self):
                    local = subprocess.run(
                        ['git', 'rev-parse', '--local-env-vars'],
                        check=True, capture_output=True, text=True,
                    ).stdout.splitlines()
                    self.assertFalse(set(local).intersection(os.environ))
                    self.assertNotIn('PRE_COMMIT_FROM_REF', os.environ)
                    self.assertNotIn('PRE_COMMIT_TO_REF', os.environ)
                    with tempfile.TemporaryDirectory() as directory:
                        root = Path(directory)
                        def git(*arguments):
                            return subprocess.run(
                                ['git', *arguments], cwd=root,
                                check=True, capture_output=True, text=True,
                            ).stdout.strip()
                        git('init', '-b', 'fixture')
                        git('config', '--local', 'core.bare', 'false')
                        (root / 'owned.txt').write_text('Fixture content')
                        git('add', 'owned.txt')
                        git('-c', 'core.hooksPath=/dev/null', 'commit',
                            '-m', 'Nested fixture commit')
                        self.assertEqual(git('rev-parse', '--show-toplevel'),
                                         str(root.resolve()))
                        self.assertEqual(git('branch', '--show-current'),
                                         'fixture')
                    if os.environ.get('SOTTO_AFFECTED_NESTED_FAILURE'):
                        self.fail('Nested validation failure')
        '''))
        self.git('add', selected)
        original_index = self.root / '.git/index'
        hook_index = self.root / '.git/hook-index'
        shutil.copyfile(original_index, hook_index)
        # Only the hook's alternate index contains the selected Python test.
        self.git('reset', '--', selected)
        self.environment.update({
            'GIT_DIR': str(self.root / '.git'),
            'GIT_COMMON_DIR': str(self.root / '.git'),
            'GIT_INDEX_FILE': str(hook_index),
            'GIT_WORK_TREE': str(self.root),
            'GIT_PREFIX': 'scripts/',
            'PRE_COMMIT_FROM_REF': 'outer-hook-from',
            'PRE_COMMIT_TO_REF': 'outer-hook-to',
        })
        if fail:
            self.environment['SOTTO_AFFECTED_NESTED_FAILURE'] = '1'
        head = self.git('rev-parse', 'HEAD')
        index_before = original_index.read_bytes()
        hook_index_before = hook_index.read_bytes()
        config = self.root / '.git/config'
        config_before = config.read_bytes()
        result = self.run_checks()
        self.assertIn('Ran 1 test', result.stderr)
        if fail:
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Nested validation failure', result.stderr)
        else:
            self.assert_passed(result)
        self.assertEqual(self.git('rev-parse', 'HEAD'), head)
        self.assertEqual(original_index.read_bytes(), index_before)
        self.assertEqual(hook_index.read_bytes(), hook_index_before)
        self.assertEqual(config.read_bytes(), config_before)
        self.assertEqual(self.git('config', '--local', '--get', 'core.bare'),
                         'false')
        self.assertEqual(self.calls(), [])

    def test_successful_validation_has_its_own_git_context(self) -> None:
        self.check_nested_git_isolation(fail=False)

    def test_failed_validation_has_its_own_git_context(self) -> None:
        self.check_nested_git_isolation(fail=True)

    def test_web_only_push_does_not_repeat_local_tests_or_builds(self) -> None:
        before = self.git('rev-parse', 'HEAD')
        self.stage('apps/web/src/lib/example.ts')
        after = self.commit()
        self.environment['PRE_COMMIT_FROM_REF'] = before
        self.environment['PRE_COMMIT_TO_REF'] = after
        result = self.run_checks('--push')
        self.assert_passed(result)
        self.assertEqual(self.calls(), [])
        self.assertNotIn('cargo', result.stdout)

    def test_new_branch_excludes_unrelated_tui_history(self) -> None:
        self.stage('tui/README.md')
        self.commit()
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        self.git('switch', '-c', 'web-fix')
        self.stage('apps/web/src/lib/example.ts')
        self.commit()
        result = self.run_checks('--push')
        self.assert_passed(result)
        self.assertEqual(self.calls(), [])
        self.assertNotIn('cargo', result.stdout)

    @unittest.skipUnless(shutil.which('cargo'), 'Rust toolchain unavailable')
    def test_deleted_tui_source_is_checked_using_push_refs(self) -> None:
        self.prepare_rust()
        self.write('tui/src/removed.rs', '')
        self.git('add', 'tui')
        before = self.commit()
        self.git('rm', 'tui/src/removed.rs')
        after = self.commit()
        self.environment['PRE_COMMIT_FROM_REF'] = before
        self.environment['PRE_COMMIT_TO_REF'] = after
        result = self.run_checks('--push')
        self.assert_passed(result)
        self.assertIn('cargo build --locked', result.stdout)
        self.assertIn('cargo test --locked', result.stdout)
        self.assertEqual(self.calls(), [])

    @unittest.skipUnless(shutil.which('cargo'), 'Rust toolchain unavailable')
    def test_shared_contract_changes_check_the_tui_consumer(self) -> None:
        self.prepare_rust()
        for dependency_change in (False, True):
            with self.subTest(dependency_change=dependency_change):
                self.git('reset')
                self.stage('packages/shared/src/contracts/endpoints.ts')
                if dependency_change:
                    self.stage('package-lock.json')
                result = self.run_checks()
                self.assert_passed(result)
                self.assertIn('cargo fmt --check', result.stdout)
                self.assertIn('cargo clippy --all-targets --locked', result.stdout)

    @unittest.skipUnless(shutil.which('cargo'), 'Rust toolchain unavailable')
    def test_both_openapi_artifacts_check_shared_drift(self) -> None:
        self.prepare_rust()
        for path in ('packages/shared/openapi.codegen.json',
                     'tui/openapi.codegen.json'):
            with self.subTest(path=path):
                self.git('reset')
                self.log.unlink(missing_ok=True)
                self.stage(path)
                self.assert_passed(self.run_checks())
                self.assertIn(
                    ['run', 'test', '--workspace=@sotto/shared', '--',
                     '--run', '--no-file-parallelism'], self.calls(),
                )

    def test_dependency_manifests_keep_types_without_repeating_ci_suites(self) -> None:
        for path in ('package-lock.json', 'apps/web/package.json',
                     'packages/shared/package.json'):
            with self.subTest(path=path):
                self.git('reset')
                self.log.unlink(missing_ok=True)
                self.stage(path)
                result = self.run_checks()
                self.assert_passed(result)
                self.assertEqual(self.calls(), [
                    ['run', 'type-check', '--workspace=@sotto/web'],
                    ['run', 'type-check', '--workspace=@sotto/mcp'],
                    ['run', 'typecheck', '--workspace=groundcheck'],
                    ['run', 'typecheck', '--workspace=@sotto/learning-model'],
                ])
                self.assertNotIn('cargo', result.stdout)

    def test_dependency_changes_keep_focused_source_tests(self) -> None:
        manifest = 'apps/web/package.json'
        source = 'apps/web/src/lib/example.ts'
        test = 'apps/web/tests/lib/example.test.ts'
        for changed in ((source,), (test,), (source, test)):
            with self.subTest(changed=changed):
                self.git('reset')
                self.log.unlink(missing_ok=True)
                self.stage(manifest, *changed)
                result = self.run_checks()
                self.assert_passed(result)
                tests = [command for command in self.calls()
                         if 'related' in command]
                self.assertEqual(len(tests), 1)
                for path in changed:
                    self.assertIn(str(self.root / path), tests[0])
                self.assertNotIn(str(self.root / manifest), tests[0])
                self.assertEqual('--passWithNoTests' in tests[0],
                                 test not in changed)
                self.assertFalse(any(command[:2] == ['run', 'test']
                                     for command in self.calls()))
                self.assertNotIn('cargo', result.stdout)

    def test_dependency_only_push_keeps_full_validation_in_ci(self) -> None:
        before = self.git('rev-parse', 'HEAD')
        self.stage('package-lock.json')
        after = self.commit()
        self.environment['PRE_COMMIT_FROM_REF'] = before
        self.environment['PRE_COMMIT_TO_REF'] = after
        result = self.run_checks('--push')
        self.assert_passed(result)
        self.assertEqual(self.calls(), [])
        self.assertNotIn('cargo', result.stdout)

    def test_explicit_paths_cannot_escape_the_repository(self) -> None:
        result = self.run_checks('--files', '../outside.ts')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('outside the repository', result.stderr)
        self.assertEqual(self.calls(), [])


if __name__ == '__main__':
    unittest.main()
