"""Exercise delivery scope and exact-commit release admission."""

from __future__ import annotations

import glob
import fnmatch
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = ROOT / '.github/workflows'
SHA = 'a' * 40


def python_step(workflow: str, name: str) -> str:
    lines = (WORKFLOWS / workflow).read_text().splitlines()
    start = next(index for index, line in enumerate(lines)
                 if line.strip() == f'- name: {name}')
    command = next(index for index in range(start, len(lines))
                   if "python3 - <<'PY'" in lines[index])
    end = next(index for index in range(command + 1, len(lines))
               if lines[index].strip() == 'PY')
    return textwrap.dedent('\n'.join(lines[command + 1:end]))


class WorkflowScopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.git_environment = {
            key: value for key, value in os.environ.items()
            if not key.startswith('GIT_')
        }
        self.git('init', '--quiet')
        (self.root / 'README.md').write_text('Initial fixture\n')
        self.git('add', '.')
        self.commit()
        self.before = self.git('rev-parse', 'HEAD').strip()

    def git(self, *arguments: str) -> str:
        return subprocess.check_output(
            ['git', '-C', str(self.root), *arguments], text=True,
            env=self.git_environment, stderr=subprocess.STDOUT)

    def commit(self) -> None:
        self.git('-c', 'user.name=Workflow Test',
                 '-c', 'user.email=workflow@example.test',
                 'commit', '--quiet', '--allow-empty', '-m', 'Fixture')

    def add_paths(self, paths: list[str]) -> None:
        for path in paths:
            destination = self.root / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text('Changed fixture\n')
        self.git('add', '.')
        self.commit()

    def scope(self, event: str = 'push',
              before: str | None = None) -> dict[str, str]:
        output = self.root / 'scope-output'
        environment = {
            **self.git_environment,
            'BASE_SHA': self.before if before is None else before,
            'HEAD_SHA': self.git('rev-parse', 'HEAD').strip(),
            'GITHUB_SHA': self.git('rev-parse', 'HEAD').strip(),
            'EVENT_NAME': event,
            'SOTTO_PUBLIC_APP_URL': 'https://showcase.example.test',
            'SOTTO_PERSONAL_APP_URL': 'https://personal.example.test',
            'GITHUB_OUTPUT': str(output),
        }
        result = subprocess.run(
            ['python3', '-c', python_step(
                'ci.yml', 'Select runtime image work')],
            cwd=self.root, env=environment, text=True, capture_output=True,
            check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return dict(line.split('=', 1)
                    for line in output.read_text().splitlines())

    def test_native_and_docs_skip_backend_checks_and_images(self) -> None:
        self.add_paths([
            'apps/ios/Tests/CourseRefreshTests.swift',
            'apps/desktop/src/app.ts',
            'docs/learning.md',
        ])
        self.assertEqual(self.scope(), {'runtime': 'false', 'source': 'false'})

    def test_web_tests_validate_without_images(self) -> None:
        self.add_paths([
            'apps/web/tests/components/Class.test.tsx', 'vitest.config.ts',
        ])
        self.assertEqual(self.scope(), {'runtime': 'false', 'source': 'true'})

    def test_integration_harness_changes_validate_without_runtime_images(self) -> None:
        for path in ('e2e/native/run.mjs', 'e2e/android/process.mjs',
                     'e2e/run.mjs', 'e2e/provider.mjs'):
            with self.subTest(path=path):
                self.add_paths([path])
                self.assertEqual(self.scope(), {'runtime': 'false', 'source': 'true'})
                (self.root / 'scope-output').unlink()
                self.before = self.git('rev-parse', 'HEAD').strip()

    def test_hook_changes_validate_without_images(self) -> None:
        self.add_paths(['.pre-commit-config.yaml'])
        self.assertEqual(self.scope(), {'runtime': 'false', 'source': 'true'})

    def test_installer_env_templates_validate_and_build_images(self) -> None:
        for path in ('.env.example', '.env.oss.example'):
            with self.subTest(path=path):
                self.add_paths([path])
                self.assertEqual(self.scope(), {
                    'runtime': 'true', 'source': 'true',
                })
                (self.root / 'scope-output').unlink()
                self.before = self.git('rev-parse', 'HEAD').strip()

    def test_runtime_and_dependency_changes_require_images(self) -> None:
        for path in (
            'apps/web/src/app/page.tsx',
            'apps/web/prisma/schema.prisma',
            'packages/shared/src/contracts.ts',
            'services/local-stt/server.py',
            'scripts/deploy.sh',
            'vendor/braces/index.js',
            '.github/workflows/source-ci.yml',
            'prisma.config.ts',
            'tsconfig.base.json',
            'docker-compose.personal.yml',
            'package-lock.json',
            '.dockerignore',
            '.node-version',
            'Caddyfile',
        ):
            with self.subTest(path=path):
                self.add_paths([path])
                self.assertEqual(self.scope()['runtime'], 'true')
                (self.root / 'scope-output').unlink()
                self.before = self.git('rev-parse', 'HEAD').strip()

    def test_push_range_includes_earlier_runtime_changes(self) -> None:
        self.add_paths(['apps/web/src/lib/runtime.ts'])
        self.add_paths(['apps/ios/Sources/App.swift'])
        self.assertEqual(self.scope()['runtime'], 'true')

    def test_moving_runtime_code_to_docs_still_builds_images(self) -> None:
        self.add_paths(['apps/web/src/lib/runtime.ts'])
        self.before = self.git('rev-parse', 'HEAD').strip()
        (self.root / 'docs').mkdir()
        self.git('mv', 'apps/web/src/lib/runtime.ts',
                 'docs/removed-runtime.ts')
        self.commit()
        self.assertEqual(self.scope()['runtime'], 'true')

    def test_manual_and_initial_pushes_build_all_images(self) -> None:
        self.add_paths(['docs/learning.md'])
        self.assertEqual(
            self.scope(event='workflow_dispatch')['runtime'], 'true')
        (self.root / 'scope-output').unlink()
        self.assertEqual(self.scope(before='0' * 40)['runtime'], 'true')

    def test_native_pull_request_ignores_base_branch_changes(self) -> None:
        base_branch = self.git('branch', '--show-current').strip()
        self.git('checkout', '--quiet', '-b', 'native-feature')
        self.add_paths(['apps/ios/Sources/App.swift', 'docs/learning.md'])
        self.git('checkout', '--quiet', base_branch)
        self.add_paths(['apps/web/src/lib/runtime.ts'])
        self.before = self.git('rev-parse', 'HEAD').strip()
        self.git('checkout', '--quiet', 'native-feature')
        self.assertEqual(self.scope(event='pull_request'), {
            'runtime': 'false', 'source': 'false',
        })


class AndroidWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        parsed = subprocess.run([
            'node', '-e',
            ("process.stdout.write(JSON.stringify(require('yaml').parse("
             "require('node:fs').readFileSync(process.argv[1], 'utf8'))))"),
            str(WORKFLOWS / 'release-surfaces-ci.yml'),
        ], cwd=ROOT, text=True, capture_output=True, check=True)
        self.workflow = json.loads(parsed.stdout)

    def test_shared_inputs_and_android_recovery_trigger_native_workflow(self) -> None:
        for event in ('push', 'pull_request'):
            patterns = self.workflow['on'][event]['paths']
            for path in ('apps/android/app/MainActivity.kt',
                         'e2e/android/process.mjs',
                         'scripts/ci/android-results.py',
                         'e2e/native/run.mjs', 'e2e/run.mjs', 'e2e/provider.mjs',
                         'packages/shared/fixtures/play/contract.json',
                         'packages/shared/src/play/types.ts',
                         'packages/shared/src/contracts/play.ts',
                         'scripts/play/export-fixtures.ts',
                         'apps/web/src/lib/play/projection.ts'):
                with self.subTest(event=event, path=path):
                    self.assertTrue(any(fnmatch.fnmatch(path, pattern)
                                        for pattern in patterns))

    def test_android_jobs_prepare_sdk_before_using_command_line_tools(self) -> None:
        for name in ('android', 'android-device'):
            with self.subTest(job=name):
                steps = self.workflow['jobs'][name]['steps']
                setup = next(index for index, step in enumerate(steps)
                             if step.get('uses', '').startswith(
                                 'android-actions/setup-android@'))
                consumer = next(index for index, step in enumerate(steps)
                                if 'sdkmanager ' in step.get('run', '')
                                or 'android-emulator-runner@'
                                in step.get('uses', ''))
                self.assertLess(setup, consumer)
                packages = steps[setup]['with']['packages'].split()
                self.assertIn('platform-tools', packages)
                self.assertNotIn('tools', packages)
                self.assertRegex(steps[setup]['with']['cmdline-tools-version'], r'^\d+$')

    def test_android_build_produces_both_unsigned_distribution_formats(self) -> None:
        steps = self.workflow['jobs']['android']['steps']
        build = next(step['run'] for step in steps
                     if step.get('name') ==
                     'Validate Android and build unsigned distributions')
        for task in ('lint', 'testDebugUnitTest', 'assembleDebugAndroidTest',
                     'assembleRelease', 'bundleRelease'):
            self.assertIn(task, build.split())
        upload = next(step for step in steps if 'upload-artifact@'
                      in step.get('uses', ''))
        self.assertEqual(upload['if'], 'always()')
        self.assertIn('outputs/bundle/', upload['with']['path'])
        self.assertIn('test-results/', upload['with']['path'])

    def test_both_emulators_run_external_recovery_in_addition_to_connected_tests(self) -> None:
        job = self.workflow['jobs']['android-device']
        matrix = job['strategy']['matrix']['include']
        self.assertTrue({'36', '37.0'} <= {row['api'] for row in matrix})
        self.assertIn('pixel_tablet', {row['profile'] for row in matrix})
        runner = next(step for step in job['steps']
                      if 'android-emulator-runner@' in step.get('uses', ''))
        self.assertEqual(runner['with']['arch'], 'x86_64')
        self.assertEqual(job['env']['ANDROID_SERIAL'], 'emulator-5554')
        self.assertEqual(runner['with']['disk-size'], '6G')
        self.assertIn('-wipe-data', runner['with']['emulator-options'].split())
        script = runner['with']['script']
        connected = script.index('connectedDebugAndroidTest')
        verified = script.index('python3 scripts/ci/android-results.py ')
        recovery = script.index('node e2e/android/process.mjs "$ANDROID_SERIAL"')
        self.assertLess(connected, verified)
        self.assertLess(verified, recovery)
        upload = next(step for step in job['steps']
                      if 'upload-artifact@' in step.get('uses', ''))
        self.assertEqual(upload['if'], 'always()')
        self.assertIn('android-process/', upload['with']['path'])


class NativeResultBundleTests(unittest.TestCase):
    def test_failed_ios_tests_preserve_their_diagnostic_bundle(self) -> None:
        parsed = subprocess.run([
            'node', '-e',
            ("process.stdout.write(JSON.stringify(require('yaml').parse("
             "require('node:fs').readFileSync(process.argv[1], 'utf8'))))"),
            str(WORKFLOWS / 'release-surfaces-ci.yml'),
        ], cwd=ROOT, text=True, capture_output=True, check=True)
        steps = json.loads(parsed.stdout)['jobs']['ios']['steps']
        test = next(step for step in steps
                    if step.get('name') == 'Run app tests on iPhone and iPad')
        upload = next(
            step for step in steps
            if step.get('name') == 'Preserve failed iOS test results')
        self.assertEqual(upload['if'], 'failure()')
        self.assertIn('${{ github.run_attempt }}', upload['with']['name'])
        self.assertEqual(upload['with']['retention-days'], 7)
        self.assertEqual(upload['with']['if-no-files-found'], 'warn')

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runner_temp = root / 'runner temp'
            runner_temp.mkdir()
            binary = root / 'xcodebuild'
            binary.write_text(
                '#!' + sys.executable + '\n'
                'import json, os, pathlib, sys\n'
                'arguments = sys.argv[1:]\n'
                "pathlib.Path(os.environ['XCODE_ARGUMENTS']).write_text("
                'json.dumps(arguments))\n'
                'bundle = pathlib.Path(arguments['
                "arguments.index('-resultBundlePath') + 1])\n"
                'bundle.mkdir()\n'
                "(bundle / 'failure.txt').write_text("
                "'The test process terminated unexpectedly.')\n"
                'raise SystemExit(65)\n'
            )
            binary.chmod(0o700)
            arguments = root / 'arguments.json'
            result = subprocess.run(
                ['bash', '-e', '-o', 'pipefail', '-c', test['run']],
                cwd=ROOT, env={
                    **os.environ,
                    'PATH': str(root) + os.pathsep + os.environ['PATH'],
                    'RUNNER_TEMP': str(runner_temp),
                    'SOTTO_IPHONE_SIMULATOR': 'synthetic-phone',
                    'SOTTO_IPAD_SIMULATOR': 'synthetic-tablet',
                    'XCODE_ARGUMENTS': str(arguments),
                }, text=True, capture_output=True, check=False,
            )
            self.assertEqual(result.returncode, 65,
                             result.stdout + result.stderr)
            emitted = Path(upload['with']['path'].replace(
                '${{ runner.temp }}', str(runner_temp)))
            self.assertEqual((emitted / 'failure.txt').read_text(),
                             'The test process terminated unexpectedly.')
            actual = json.loads(arguments.read_text())
            destinations = [actual[index + 1]
                            for index, value in enumerate(actual)
                            if value == '-destination']
            self.assertEqual(destinations, [
                'platform=iOS Simulator,id=synthetic-phone',
                'platform=iOS Simulator,id=synthetic-tablet',
            ])
            self.assertIn('CODE_SIGN_IDENTITY=-', actual)


class DesktopArtifactTests(unittest.TestCase):
    def test_release_retains_each_platform_manifest_and_website_copy(
        self,
    ) -> None:
        parsed = subprocess.run([
            'node', '-e',
            ("process.stdout.write(JSON.stringify(require('yaml').parse("
             "require('node:fs').readFileSync(process.argv[1], 'utf8'))))"),
            str(WORKFLOWS / 'desktop-release.yml'),
        ], cwd=ROOT, text=True, capture_output=True, check=True)
        jobs = json.loads(parsed.stdout)['jobs']
        normalize = next(step for step in jobs['build']['steps']
                         if step.get('name') == 'Normalize desktop artifacts')
        upload = next(step for step in jobs['build']['steps']
                      if step.get('uses', '').startswith(
                          'actions/upload-artifact@'))
        download = next(step for step in jobs['release']['steps']
                        if step.get('uses', '').startswith(
                            'actions/download-artifact@'))
        publish = next(step for step in jobs['release']['steps']
                       if step.get('uses', '').startswith(
                           'softprops/action-gh-release@'))
        payloads = {
            'mac': {'Original Mac installer.dmg': b'mac installer'},
            'windows': {
                'Original Windows installer.msi': b'windows msi',
                'Original Windows setup.exe': b'windows setup',
            },
            'linux': {
                'Original Linux installer.AppImage': b'linux appimage',
                'Original Linux package.deb': b'linux deb',
            },
        }
        github_names = {
            'mac': {'Original Mac installer.dmg':
                    'Original.Mac.installer.dmg'},
            'windows': {
                'Original Windows installer.msi':
                'Original.Windows.installer.msi',
                'Original Windows setup.exe': 'Original.Windows.setup.exe',
            },
            'linux': {
                'Original Linux installer.AppImage':
                'Original.Linux.installer.AppImage',
                'Original Linux package.deb': 'Original.Linux.package.deb',
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release_root = root / 'release'
            release_root.mkdir()
            for platform, installers in payloads.items():
                workspace = root / platform
                bundle = workspace / (
                    'apps/desktop/src-tauri/target/release/bundle'
                )
                bundle.mkdir(parents=True)
                for filename, data in installers.items():
                    (bundle / filename).write_bytes(data)
                runner_temp = workspace / 'runner temp'
                replacements = {
                    '${{ matrix.slug }}': platform,
                    '${{ needs.prepare.outputs.release_version }}': 'v0.2.0',
                    '${{ needs.prepare.outputs.short_sha }}': SHA[:8],
                    '${{ runner.temp }}': str(runner_temp),
                }
                command = normalize['run']
                upload_path = upload['with']['path']
                artifact_name = upload['with']['name']
                for expression, value in replacements.items():
                    command = command.replace(expression, value)
                    upload_path = upload_path.replace(expression, value)
                    artifact_name = artifact_name.replace(expression, value)
                result = subprocess.run(
                    ['bash', '-e', '-o', 'pipefail', '-c', command],
                    cwd=workspace, env={
                        **os.environ, 'RUNNER_TEMP': str(runner_temp),
                        'RELEASE_SHA': SHA,
                    }, text=True, capture_output=True, check=False,
                )
                self.assertEqual(result.returncode, 0,
                                 result.stdout + result.stderr)
                website = runner_temp / (
                    'sotto-desktop-downloads/download/desktop'
                )
                version = website / 'v0.2.0' / platform
                expected_files = {
                    path.name: path.read_bytes() for path in version.iterdir()
                }
                for channel in (SHA[:8], 'latest'):
                    self.assertEqual({
                        path.name: path.read_bytes()
                        for path in (website / channel / platform).iterdir()
                    }, expected_files)
                website_manifest = json.loads(expected_files['manifest.json'])
                self.assertEqual(website_manifest['platform'], platform)
                self.assertEqual(set(expected_files), {'manifest.json'} | {
                    item['filename'] for item in website_manifest['files']
                })
                for filename, data in installers.items():
                    self.assertEqual(expected_files[filename], data)
                archive = root / f'{platform}.zip'
                with zipfile.ZipFile(archive, 'w') as zipped:
                    for filename in glob.glob(upload_path):
                        zipped.write(filename, Path(filename).name)
                extracted = release_root / download['with']['path']
                if not download['with'].get('merge-multiple', False):
                    extracted /= artifact_name
                with zipfile.ZipFile(archive) as zipped:
                    zipped.extractall(extracted)
            published: dict[str, bytes] = {}
            for filename in glob.glob(
                str(release_root / publish['with']['files']), recursive=True,
            ):
                path = Path(filename)
                if path.is_file():
                    self.assertNotIn(path.name, published,
                                     'Release asset names must be unique')
                    published[path.name] = path.read_bytes()
            manifests = [json.loads(data) for name, data in published.items()
                         if name.endswith('.json')]
            self.assertEqual({item['platform'] for item in manifests},
                             set(payloads))
            for manifest in manifests:
                self.assertEqual(manifest['version'], 'v0.2.0')
                self.assertEqual(manifest['commit']['sha'], SHA)
                self.assertIn(manifest['primary']['filename'], published)
                originals = payloads[manifest['platform']]
                for filename, data in originals.items():
                    expected_name = github_names[
                        manifest['platform']][filename]
                    self.assertEqual(published[expected_name], data)
                    self.assertNotIn(filename, published)
                for item in manifest['files']:
                    data = published[item['filename']]
                    self.assertEqual(item['href'], item['filename'])
                    self.assertEqual(item['size'], len(data))
                    self.assertIn(data, originals.values())

    def test_colliding_github_names_stop_before_upload_staging(self) -> None:
        parsed = subprocess.run([
            'node', '-e',
            ("process.stdout.write(JSON.stringify(require('yaml').parse("
             "require('node:fs').readFileSync(process.argv[1], 'utf8'))))"),
            str(WORKFLOWS / 'desktop-release.yml'),
        ], cwd=ROOT, text=True, capture_output=True, check=True)
        steps = json.loads(parsed.stdout)['jobs']['build']['steps']
        normalize = next(step for step in steps
                         if step.get('name') == 'Normalize desktop artifacts')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / 'apps/desktop/src-tauri/target/release/bundle'
            bundle.mkdir(parents=True)
            (bundle / 'Collision name.dmg').write_bytes(b'first installer')
            (bundle / 'Collision.name.dmg').write_bytes(b'second installer')
            runner_temp = root / 'runner temp'
            command = normalize['run'].replace(
                '${{ matrix.slug }}', 'mac').replace(
                '${{ needs.prepare.outputs.release_version }}', 'v0.2.0'
            ).replace('${{ needs.prepare.outputs.short_sha }}', SHA[:8])
            result = subprocess.run(
                ['bash', '-e', '-o', 'pipefail', '-c', command],
                cwd=root, env={
                    **os.environ, 'RUNNER_TEMP': str(runner_temp),
                    'RELEASE_SHA': SHA,
                }, text=True, capture_output=True, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            staged = runner_temp / 'sotto-desktop-downloads/github/mac'
            self.assertEqual(list(staged.iterdir()), [])
            website = runner_temp / (
                'sotto-desktop-downloads/download/desktop/v0.2.0/mac'
            )
            self.assertEqual((website / 'Collision name.dmg').read_bytes(),
                             b'first installer')
            self.assertEqual((website / 'Collision.name.dmg').read_bytes(),
                             b'second installer')


class ReleaseAdmissionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / 'delivery/verified').mkdir(parents=True)
        self.environment = {
            **os.environ,
            'RELEASE_SHA': SHA,
            'GITHUB_SHA': SHA,
            'GITHUB_REPOSITORY': 'affromero/Sotto',
            'GITHUB_EVENT_NAME': 'workflow_run',
            'GITHUB_OUTPUT': str(self.root / 'output'),
            'SOTTO_PUBLIC_APP_URL': 'https://showcase.example.test',
            'SOTTO_PERSONAL_APP_URL': 'https://personal.example.test',
        }

    def run_step(self, workflow: str,
                 name: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ['python3', '-c', python_step(workflow, name)],
            cwd=self.root, env=self.environment,
            text=True, capture_output=True, check=False)

    def admitted_run(self) -> dict[str, object]:
        return {
            'id': 123,
            'head_sha': SHA,
            'head_branch': 'main',
            'head_repository': {'full_name': 'affromero/Sotto'},
            'conclusion': 'success',
            'status': 'completed',
            'path': '.github/workflows/ci.yml',
        }

    def check_run(
        self, record: dict[str, object], workflow: str = 'oss-image.yml',
    ) -> subprocess.CompletedProcess[str]:
        (self.root / 'delivery/source-run.json').write_text(json.dumps(record))
        return self.run_step(
            workflow,
            'Find successful source validation for this exact main commit')

    def test_successful_trusted_exact_main_gate_is_admitted(self) -> None:
        for workflow in ('deploy.yml', 'oss-image.yml'):
            with self.subTest(workflow=workflow):
                (self.root / 'output').unlink(missing_ok=True)
                result = self.check_run(self.admitted_run(), workflow)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(
                    (self.root / 'output').read_text(), 'run_id=123\n')

    def test_failed_or_untrusted_source_runs_are_rejected(self) -> None:
        changes = [
            {'head_sha': 'b' * 40},
            {'head_branch': 'feature'},
            {'head_repository': {'full_name': 'contributor/Sotto'}},
            {'path': '.github/workflows/browser.yml'},
            {'conclusion': 'failure'},
            {'status': 'in_progress'},
        ]
        for workflow in ('deploy.yml', 'oss-image.yml'):
            for change in changes:
                with self.subTest(change=change, workflow=workflow):
                    result = self.check_run(
                        {**self.admitted_run(), **change}, workflow)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(
                        'No successful production source gate', result.stderr)

    def test_manual_dispatch_selects_only_an_exact_matching_gate(self) -> None:
        records = [
            {**self.admitted_run(), 'head_sha': 'b' * 40, 'id': 999},
            self.admitted_run(),
        ]
        (self.root / 'delivery/source-runs.json').write_text(
            json.dumps({'workflow_runs': records}))
        result = self.run_step(
            'oss-image.yml',
            'Find successful source validation for this exact main commit')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'output').read_text(), 'run_id=123\n')

    def check_artifact(
        self, record: dict[str, object],
    ) -> subprocess.CompletedProcess[str]:
        (self.root / 'delivery/verified/source-validation.json').write_text(
            json.dumps(record))
        return self.run_step(
            'oss-image.yml', 'Validate release revision and runtime scope')

    def test_verified_test_only_commit_skips_public_image_builds(self) -> None:
        result = self.check_artifact({
            'sha': SHA, 'runtime_changed': False, 'source_validated': True,
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'output').read_text(), 'runtime=false\n')

    def test_mismatched_or_malformed_gate_artifacts_are_rejected(self) -> None:
        for record in (
            {'sha': 'b' * 40, 'runtime_changed': True},
            {'sha': SHA, 'runtime_changed': 'false'},
            {'sha': SHA},
            {'sha': SHA, 'runtime_changed': True, 'source_validated': False},
            {'sha': SHA, 'runtime_changed': True, 'source_validated': 'true'},
        ):
            with self.subTest(record=record):
                result = self.check_artifact(record)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('does not match this release', result.stderr)

    def test_production_consumes_verified_sha_and_scope(self) -> None:
        (self.root / 'delivery/verified/source-validation.json').write_text(
            json.dumps({
                'sha': SHA, 'runtime_changed': False, 'source_validated': True,
            }))
        result = self.run_step(
            'deploy.yml', 'Validate release revision and runtime scope')
        self.assertEqual(result.returncode, 0, result.stderr)
        output = dict(line.split('=', 1) for line in
                      (self.root / 'output').read_text().splitlines())
        self.assertEqual(output, {
            'sha': SHA, 'runtime': 'false', 'publish': 'true',
        })

    def test_native_commit_without_backend_gate_skips_images(self) -> None:
        for workflow in ('deploy.yml', 'oss-image.yml'):
            with self.subTest(workflow=workflow):
                (self.root / 'output').unlink(missing_ok=True)
                artifact = (
                    self.root / 'delivery/verified/source-validation.json')
                artifact.write_text(
                    json.dumps({
                        'sha': SHA, 'runtime_changed': False,
                        'source_validated': False,
                    }))
                result = self.run_step(
                    workflow, 'Validate release revision and runtime scope')
                self.assertEqual(result.returncode, 0, result.stderr)
                output = (self.root / 'output').read_text()
                self.assertIn('runtime=false\n', output)

    def test_manual_rebuild_requires_actual_source_validation(self) -> None:
        self.environment['GITHUB_EVENT_NAME'] = 'workflow_dispatch'
        for workflow in ('deploy.yml', 'oss-image.yml'):
            for validated in (True, False):
                with self.subTest(workflow=workflow, validated=validated):
                    (self.root / 'output').unlink(missing_ok=True)
                    artifact = (
                        self.root / 'delivery/verified/source-validation.json')
                    artifact.write_text(
                        json.dumps({
                            'sha': SHA, 'runtime_changed': False,
                            'source_validated': validated,
                        }))
                    result = self.run_step(
                        workflow,
                        'Validate release revision and runtime scope')
                    if validated:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        output = (self.root / 'output').read_text()
                        self.assertIn('runtime=true\n', output)
                    else:
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn('Dispatch ci.yml on main', result.stderr)

    def test_checkouts_and_revisions_use_the_validated_commit(self) -> None:
        for workflow in ('deploy.yml', 'oss-image.yml'):
            with self.subTest(workflow=workflow):
                content = (WORKFLOWS / workflow).read_text()
                lines = content.splitlines()
                checkouts = [index for index, line in enumerate(lines)
                             if 'uses: actions/checkout@' in line]
                self.assertGreater(len(checkouts), 0)
                for index in checkouts:
                    self.assertIn('ref: ${{ env.RELEASE_SHA }}',
                                  '\n'.join(lines[index + 1:index + 4]))
                remaining = content.replace(
                    '${{ github.event.workflow_run.head_sha || github.sha }}',
                    '')
                self.assertNotIn('github.sha', remaining)
                self.assertNotIn('$GITHUB_SHA', content)

    def set_images(self) -> None:
        for role, repository in (
            ('SHOWCASE', 'sotto-web-prod'),
            ('PERSONAL', 'sotto-web-personal-prod'),
            ('WORKERS', 'sotto-workers-prod'),
        ):
            self.environment[f'{role}_IMAGE'] = (
                f'ghcr.io/affromero/{repository}@sha256:' + 'c' * 64)

    def test_release_record_pins_three_role_images(self) -> None:
        self.set_images()
        result = self.run_step(
            'deploy.yml', 'Record verified production image digests')
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads(
            (self.root / 'delivery/production-release.json').read_text())
        self.assertEqual(record['sha'], SHA)
        self.assertEqual(
            set(record['images']), {'showcase', 'personal', 'workers'})
        self.assertEqual(
            record['images']['workers'], self.environment['WORKERS_IMAGE'])

    def test_tags_and_crossed_role_digests_are_rejected(self) -> None:
        self.set_images()
        for image in (
            'ghcr.io/affromero/sotto-web-prod:latest',
            self.environment['WORKERS_IMAGE'],
            '',
        ):
            with self.subTest(image=image):
                self.environment['SHOWCASE_IMAGE'] = image
                result = self.run_step(
                    'deploy.yml', 'Record verified production image digests')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(
                    'Invalid immutable image reference', result.stderr)


if __name__ == '__main__':
    unittest.main()
