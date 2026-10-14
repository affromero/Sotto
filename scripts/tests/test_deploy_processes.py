"""Exercise graceful worker retirement and executable compatibility boundaries."""

import importlib.util
import hashlib
import json
import os
from pathlib import Path
import signal
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from urllib.error import URLError
from urllib.request import urlopen
from unittest.mock import ANY, patch


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('deploy_processes', ROOT / 'scripts/deploy/stop-workers.py')
PROCESSES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROCESSES)
REVIEW_SPEC = importlib.util.spec_from_file_location(
    'compatibility_review', ROOT / 'scripts/deploy/compatibility-review.py')
REVIEW = importlib.util.module_from_spec(REVIEW_SPEC)
REVIEW_SPEC.loader.exec_module(REVIEW)
WORKER = 'a' * 64
MAIN = 'node --max-old-space-size=1024 --import tsx src/workers/index.ts'
ESBUILD = '/app/node_modules/@esbuild/linux-x64/bin/esbuild --service=0.25.0 --ping'
PROCESS_TABLE = f'PID PPID COMMAND\n101 1 {MAIN}\n102 101 {ESBUILD}\n'


def observation(running=True, code=0, oom=False, identity=WORKER):
    return json.dumps([{'Id': identity, 'State': {
        'Running': running, 'ExitCode': code, 'OOMKilled': oom,
    }}])


class DockerBoundary:
    def __init__(self, observations, processes=PROCESS_TABLE):
        self.observations = iter(observations)
        self.processes = processes
        self.inspected = []
        self.commands = []

    def __call__(self, *arguments):
        self.commands.append(arguments)
        if arguments == ('top', WORKER, '-eo', 'pid,ppid,args'):
            return self.processes
        if arguments == ('inspect', WORKER):
            self.inspected.append(arguments[1])
            result = next(self.observations)
            if isinstance(result, Exception):
                raise result
            return result
        raise AssertionError(f'Unexpected Docker boundary arguments: {arguments}')


class WorkerRetirementTests(unittest.TestCase):
    def test_worker_and_owned_esbuild_exit_gracefully_without_a_kill_deadline(self):
        docker = DockerBoundary([observation(), observation(running=False)])
        with patch.object(PROCESSES.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as stop:
            PROCESSES.stop_worker(WORKER, docker)
        stop.assert_called_once_with(['docker', 'stop', '--time', '-1', WORKER], check=False, pass_fds=ANY)
        self.assertEqual(docker.inspected, [WORKER, WORKER])

    def test_provider_and_unrecognized_children_are_never_signalled(self):
        invalid = [
            PROCESS_TABLE + '103 101 codex exec --json\n',
            PROCESS_TABLE + '103 101 ffmpeg -i input.wav output.wav\n',
            PROCESS_TABLE + '103 101 python worker.py\n',
            PROCESS_TABLE.replace('102 101', '102 999'),
            PROCESS_TABLE + f'103 1 {MAIN}\n',
            'PID PPID COMMAND\n',
            'PID PPID COMMAND\n101 malformed\n',
        ]
        for processes in invalid:
            with self.subTest(processes=processes):
                docker = DockerBoundary([observation()], processes)
                with patch.object(PROCESSES.subprocess, 'run') as stop:
                    with self.assertRaises(ValueError):
                        PROCESSES.stop_worker(WORKER, docker)
                    stop.assert_not_called()

    def test_only_full_immutable_ids_can_be_retired(self):
        for identity in ['workers-light', 'a' * 12, 'a' * 63, 'a' * 65, 'A' * 64, 'g' * 64, '']:
            with self.subTest(identity=identity):
                with patch.object(PROCESSES.subprocess, 'run') as stop:
                    with self.assertRaises(ValueError):
                        PROCESSES.stop_worker(identity, DockerBoundary([observation()]))
                    stop.assert_not_called()

    def test_foreign_inspect_identity_cannot_authorize_a_stop(self):
        docker = DockerBoundary([observation(identity='b' * 64)])
        with patch.object(PROCESSES.subprocess, 'run') as stop:
            with self.assertRaises(ValueError):
                PROCESSES.stop_worker(WORKER, docker)
            stop.assert_not_called()

    def test_foreign_identity_after_stop_cannot_prove_settlement(self):
        docker = DockerBoundary([observation(), observation(running=False, identity='b' * 64)])
        with patch.object(PROCESSES.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)):
            with self.assertRaises(ValueError):
                PROCESSES.stop_worker(WORKER, docker)

    def test_abnormal_or_oom_exit_cannot_prove_graceful_settlement(self):
        for final in [observation(running=False, code=143), observation(running=False, code=137),
                      observation(running=False, oom=True)]:
            with self.subTest(final=final):
                docker = DockerBoundary([observation(), final])
                with patch.object(PROCESSES.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)):
                    with self.assertRaises(ValueError):
                        PROCESSES.stop_worker(WORKER, docker)

    def test_stopped_or_oom_worker_is_rejected_before_signalling(self):
        for before in [observation(running=False), observation(oom=True)]:
            with self.subTest(before=before):
                with patch.object(PROCESSES.subprocess, 'run') as stop:
                    with self.assertRaises(ValueError):
                        PROCESSES.stop_worker(WORKER, DockerBoundary([before]))
                    stop.assert_not_called()

    def test_interrupted_stop_client_observes_same_worker_until_settled_without_replay(self):
        docker = DockerBoundary([
            observation(),
            subprocess.CalledProcessError(1, ['docker', 'inspect', WORKER]),
            'unavailable inspection JSON',
            observation(),
            observation(running=False),
        ])
        with patch.object(PROCESSES.subprocess, 'run', return_value=subprocess.CompletedProcess([], -15)) as stop:
            with patch.object(PROCESSES.time, 'sleep'):
                PROCESSES.stop_worker(WORKER, docker)
        stop.assert_called_once_with(['docker', 'stop', '--time', '-1', WORKER], check=False, pass_fds=ANY)
        self.assertEqual(docker.inspected, [WORKER] * 5)

    def test_stop_client_inherits_the_existing_deployment_lock_descriptor(self):
        try:
            original = os.dup(9)
        except OSError:
            original = None
        with tempfile.TemporaryFile() as lock:
            os.dup2(lock.fileno(), 9)
            try:
                docker = DockerBoundary([observation(), observation(running=False)])
                with patch.object(PROCESSES.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as stop:
                    PROCESSES.stop_worker(WORKER, docker)
                stop.assert_called_once_with(
                    ['docker', 'stop', '--time', '-1', WORKER], check=False, pass_fds=(9,))
            finally:
                if original is not None:
                    os.dup2(original, 9)
                    os.close(original)
                elif lock.fileno() != 9:
                    os.close(9)

    def test_successful_stop_client_does_not_mask_a_running_worker(self):
        docker = DockerBoundary([observation(), observation()])
        with patch.object(PROCESSES.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)):
            with self.assertRaises(ValueError):
                PROCESSES.stop_worker(WORKER, docker)

    def test_web_can_exit_normally_or_after_graceful_sigterm_without_worker_process_rules(self):
        for code in [0, 143]:
            with self.subTest(code=code):
                docker = DockerBoundary([observation(), observation(running=False, code=code)])
                with patch.object(PROCESSES.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)):
                    PROCESSES.stop_container(WORKER, docker, worker=False)
                self.assertNotIn(('top', WORKER, '-eo', 'pid,ppid,args'), docker.commands)
                self.assertEqual(docker.inspected, [WORKER, WORKER])

    def test_web_abnormal_exit_and_oom_still_reject_settlement(self):
        for final in [observation(running=False, code=137), observation(running=False, code=1),
                      observation(running=False, code=143, oom=True)]:
            with self.subTest(final=final):
                docker = DockerBoundary([observation(), final])
                with patch.object(PROCESSES.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)):
                    with self.assertRaises(ValueError):
                        PROCESSES.stop_container(WORKER, docker, worker=False)

    def test_web_identity_is_bound_before_any_stop(self):
        docker = DockerBoundary([observation(identity='b' * 64)])
        with patch.object(PROCESSES.subprocess, 'run') as stop:
            with self.assertRaises(ValueError):
                PROCESSES.stop_container(WORKER, docker, worker=False)
            stop.assert_not_called()


class OverlapMemoryTests(unittest.TestCase):
    def test_overlap_accepts_exact_headroom_and_rejects_one_kibibyte_less(self):
        for total, reserve in [(1000, 100), (8 * 1024 * 1024, 512 * 1024)]:
            candidate = 100
            with self.subTest(total=total):
                PROCESSES.require_overlap_memory(
                    f'MemTotal: {total} kB\nMemAvailable: {candidate + reserve} kB\n', candidate * 1024)
                with self.assertRaises(ValueError):
                    PROCESSES.require_overlap_memory(
                        f'MemTotal: {total} kB\nMemAvailable: {candidate + reserve - 1} kB\n', candidate * 1024)

    def test_unknown_or_missing_memory_accounting_blocks_overlap(self):
        for memory in ['', 'MemTotal: 1000 kB\n', 'MemAvailable: 500 kB\n',
                       'MemTotal: 1000 MB\nMemAvailable: 500 kB\n']:
            with self.subTest(memory=memory):
                with self.assertRaises(ValueError):
                    PROCESSES.require_overlap_memory(memory, 1024)
        with self.assertRaises(ValueError):
            PROCESSES.require_overlap_memory('MemTotal: 1000 kB\nMemAvailable: 500 kB\n', 0)


class CompatibilityReviewTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='sotto-review-')
        self.root = Path(self.directory.name)
        self.image = 'sha256:' + 'b' * 64
        self.contracts = (self.image + ' ' + 'd' * 64 + '\n').encode()
        self.evidence = b'Independent exact-image overlap review evidence.'
        self.environment = {
            'SOTTO_STACK': 'sotto-personal',
            'SOTTO_RELEASE_SHA': 'a' * 40,
            'SOTTO_WEB_IMAGE_REF': 'fixture/web@sha256:' + 'c' * 64,
            'SOTTO_WORKERS_IMAGE_REF': 'fixture/workers@sha256:' + 'c' * 64,
            'PREVIOUS_APP_IMAGES': str(self.root / 'web.json'),
            'PREVIOUS_WORKER_IMAGES': str(self.root / 'workers.json'),
        }
        (self.root / 'web.json').write_text(json.dumps({
            'services': {'web': {'image': self.image}},
        }))
        (self.root / 'workers.json').write_text(json.dumps({
            'services': {'workers-heavy': {'image': self.image}},
        }))
        self.review = {
            'schemaVersion': 1,
            'procedure': 'compatible-runtime-overlap',
            'stack': self.environment['SOTTO_STACK'],
            'releaseSha': self.environment['SOTTO_RELEASE_SHA'],
            'candidateWebImage': self.environment['SOTTO_WEB_IMAGE_REF'],
            'candidateWorkersImage': self.environment['SOTTO_WORKERS_IMAGE_REF'],
            'previousWebImage': self.image,
            'previousWorkerContracts': {self.image: 'd' * 64},
            'candidateContract': 'e' * 64,
            'reviewer': 'Independent reviewer',
            'evidenceSha256': hashlib.sha256(self.evidence).hexdigest(),
        }

    def tearDown(self):
        self.directory.cleanup()

    def validate(self, review=None, evidence=None):
        REVIEW.validate(
            self.review if review is None else review,
            self.evidence if evidence is None else evidence,
            'e' * 64, self.contracts, self.environment,
        )

    def test_review_matches_only_the_exact_images_and_runtime_pair(self):
        self.validate()
        for field, value in {
            'schemaVersion': True,
            'procedure': 'skip-contract-check',
            'stack': 'sotto',
            'releaseSha': 'f' * 40,
            'candidateWebImage': 'fixture/web:main',
            'candidateWorkersImage': 'fixture/workers:main',
            'previousWebImage': 'sha256:' + 'f' * 64,
            'previousWorkerContracts': {self.image: 'f' * 64},
            'candidateContract': 'f' * 64,
            'reviewer': ' ',
            'evidenceSha256': 'f' * 64,
        }.items():
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.validate({**self.review, field: value})
        with self.assertRaises(ValueError):
            self.validate({**self.review, 'approved': True})
        with self.assertRaises(ValueError):
            self.validate(evidence=b'Changed evidence')

    def test_extra_previous_worker_cannot_reuse_a_review(self):
        (self.root / 'workers.json').write_text(json.dumps({
            'services': {
                'workers-heavy': {'image': self.image},
                'workers-light': {'image': 'sha256:' + 'f' * 64},
            },
        }))
        with self.assertRaisesRegex(ValueError, 'inventory changed'):
            self.validate()

    def test_duplicate_json_fields_and_public_or_symlinked_files_fail(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            REVIEW.mapping(b'{"schemaVersion":1,"schemaVersion":1}')
        path = self.root / 'review.json'
        path.write_text(json.dumps(self.review))
        path.chmod(0o600)
        self.assertEqual(REVIEW.read_bytes(path, private=True), path.read_bytes())
        path.chmod(0o640)
        with self.assertRaisesRegex(ValueError, 'private'):
            REVIEW.read_bytes(path, private=True)
        path.chmod(0o600)
        link = self.root / 'link.json'
        link.symlink_to(path)
        with self.assertRaises(OSError):
            REVIEW.read_bytes(link, private=True)

    def test_cli_preserves_exact_validated_record_and_evidence_bytes(self):
        raw = json.dumps(self.review, indent=2).encode() + b'\n'
        for name, content in [
            ('review.json', raw), ('evidence.txt', self.evidence),
            ('contracts.txt', self.contracts),
        ]:
            path = self.root / name
            path.write_bytes(content)
            path.chmod(0o600)
        result = subprocess.run([
            sys.executable, str(ROOT / 'scripts/deploy/compatibility-review.py'),
            'validate',
            str(self.root / 'review.json'), str(self.root / 'evidence.txt'),
            'e' * 64, str(self.root / 'contracts.txt'),
        ], env={**os.environ, **self.environment}, capture_output=True,
            text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        accepted = json.loads(result.stdout)
        self.assertEqual(accepted['review'].encode(), raw)
        self.assertEqual(accepted['evidence'].encode(), self.evidence)

    def test_recovery_marker_advances_durably_and_only_its_attempt_can_clear(self):
        marker = self.root / 'unresolved.json'
        state = str(self.root / 'attempt-one')
        REVIEW.record_marker(marker, state, '/private/overrides', 'sotto-personal',
                             'compatibility-preparation')
        self.assertEqual(json.loads(marker.read_text())['phase'],
                         'compatibility-preparation')
        with self.assertRaises(ValueError):
            REVIEW.clear_marker(marker, '/different/attempt',
                                'compatibility-preparation')
        REVIEW.record_marker(marker, state, '/private/overrides', 'sotto-personal',
                             'compatibility-cutover')
        self.assertEqual(json.loads(marker.read_text())['phase'],
                         'compatibility-cutover')
        with self.assertRaises(ValueError):
            REVIEW.clear_marker(marker, state, 'compatibility-preparation')
        REVIEW.record_marker(marker, state, '/private/overrides', 'sotto-personal',
                             'unresolved')
        self.assertEqual(json.loads(marker.read_text())['phase'],
                         'compatibility-cutover')
        REVIEW.clear_marker(marker, state, 'compatibility-cutover')
        self.assertFalse(marker.exists())

    def test_activation_mount_preserves_environment_and_is_read_only(self):
        for variable, filename, service in [
            ('APP_IMAGES', 'candidate-web.json', 'web'),
            ('WORKER_IMAGES', 'candidate-workers.json', 'workers-heavy'),
        ]:
            path = self.root / filename
            path.write_text(json.dumps({'services': {service: {
                'image': 'fixture@sha256:' + 'c' * 64,
                'environment': {'KEEP': 'preserved'},
                'volumes': [{'type': 'volume', 'source': 'data',
                             'target': '/app/storage'}],
            }}}))
            self.environment[variable] = str(path)
        directory = self.root / 'provider-activation'
        REVIEW.prepare_activation(directory, self.environment)
        self.assertFalse(json.loads((directory / 'fish.json').read_text())['fishEnabled'])
        self.assertEqual(directory.stat().st_mode & 0o777, 0o755)
        self.assertEqual((directory / 'fish.json').stat().st_mode & 0o777, 0o444)
        for variable, service in [('APP_IMAGES', 'web'),
                                  ('WORKER_IMAGES', 'workers-heavy')]:
            value = json.loads(Path(self.environment[variable]).read_text())
            selected = value['services'][service]
            self.assertEqual(selected['environment']['KEEP'], 'preserved')
            self.assertEqual(selected['volumes'][0]['source'], 'data')
            self.assertTrue(Path(selected['volumes'][1]['source']).samefile(directory))
            self.assertTrue(selected['volumes'][1]['read_only'])
        with self.assertRaises(ValueError):
            REVIEW.activate_provider(directory, 'f' * 40)
        self.assertFalse(json.loads((directory / 'fish.json').read_text())['fishEnabled'])
        REVIEW.activate_provider(directory, 'a' * 40)
        self.assertTrue(json.loads((directory / 'fish.json').read_text())['fishEnabled'])


@unittest.skipUnless(sys.platform == 'linux' and shutil.which('node'),
                     'Linux procfd traversal and Node are required for the executable contract')
class RollingContractTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='sotto-rolling-contract-')
        self.root = Path(self.directory.name)
        paths = [
            'apps/web/src/lib/sidedoor/authority.ts',
            'apps/web/src/lib/queue.ts',
            'apps/web/src/lib/redis.ts',
            'apps/web/src/workers/index.ts',
            'node_modules/.package-lock.json',
            'packages/shared/src/contracts.ts',
            'packages/learning-model/src/lesson.ts',
        ]
        for name in ['thesidedoor', 'thesidedoor-core']:
            paths.extend([f'node_modules/{name}/package.json', f'node_modules/{name}/dist/index.js'])
        paths.extend(f'node_modules/thesidedoor-flock/{name}' for name in
                     ['package.json', 'index.cjs', 'binding.gyp', 'fs-ext.cc'])
        for path in paths:
            self.write(path, f'fixture payload {path}\n')
        source = (ROOT / 'scripts/deploy/checks/rolling-contract.cjs').read_text()
        self.assertEqual(source.count("'/app'"), 1)
        self.source = source.replace("'/app'", json.dumps(str(self.root)))

    def tearDown(self):
        self.directory.cleanup()

    def write(self, relative, content):
        target = self.root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def contract(self):
        return subprocess.run(['node', '-e', self.source], capture_output=True, text=True, check=False)

    def digest(self):
        result = self.contract()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout, r'^[a-f0-9]{64}\n$')
        return result.stdout

    def test_same_payload_matches_without_requiring_nonexistent_flock_dist(self):
        before = self.digest()
        self.assertFalse((self.root / 'node_modules/thesidedoor-flock/dist').exists())
        self.assertEqual(self.digest(), before)

    def test_changed_payload_or_added_authority_changes_the_contract(self):
        before = self.digest()
        self.write('apps/web/src/lib/queue.ts', 'changed queue contract\n')
        changed = self.digest()
        self.assertNotEqual(changed, before)
        self.write('apps/web/src/lib/sidedoor/new-authority.ts', 'new authority\n')
        authority = self.digest()
        self.assertNotEqual(authority, changed)
        self.write('apps/web/src/workers/index.ts', 'changed worker executable\n')
        worker = self.digest()
        self.assertNotEqual(worker, authority)
        self.write('node_modules/.package-lock.json', 'changed installed dependency identity\n')
        self.assertNotEqual(self.digest(), worker)

    def test_missing_executable_payload_rejects_the_contract(self):
        (self.root / 'node_modules/thesidedoor-core/dist/index.js').unlink()
        result = self.contract()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')

    def test_workspace_packages_and_core_local_flock_match_runtime_resolution(self):
        before = self.digest()
        for name in ['thesidedoor', 'thesidedoor-core']:
            target = self.root / 'apps/web/node_modules' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(self.root / 'node_modules' / name), target)
        core = 'apps/web/node_modules/thesidedoor-core'
        target = self.root / core / 'node_modules/thesidedoor-flock'
        target.parent.mkdir(parents=True)
        shutil.move(str(self.root / 'node_modules/thesidedoor-flock'), target)
        workspace = self.digest()
        self.assertNotEqual(workspace, before)
        self.write('node_modules/thesidedoor-flock/index.cjs', 'shadowed flock')
        self.assertEqual(self.digest(), workspace)
        self.write(core + '/node_modules/thesidedoor-flock/index.cjs',
                   'changed selected native lock implementation')
        self.assertNotEqual(self.digest(), workspace)

    def test_symlinked_or_incomplete_workspace_package_cannot_use_root_copy(self):
        target = self.root / 'apps/web/node_modules/thesidedoor-core'
        target.parent.mkdir(parents=True)
        target.symlink_to(self.root / 'node_modules/thesidedoor-core')
        self.assertNotEqual(self.contract().returncode, 0)
        target.unlink()
        target.mkdir()
        self.assertNotEqual(self.contract().returncode, 0)

    def test_symlinked_authority_rejects_the_contract(self):
        target = self.root / 'apps/web/src/lib/sidedoor/authority.ts'
        target.unlink()
        target.symlink_to(self.root / 'apps/web/src/lib/queue.ts')
        result = self.contract()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, '')

    def test_replaced_authority_path_reads_the_original_open_file(self):
        before = self.digest()
        target = self.root / 'apps/web/src/lib/sidedoor/authority.ts'
        outside = self.root / 'outside-authority.ts'
        outside.write_text('malicious authority outside the executable contract\n')
        self.source = '''(() => {
  const boundary = require('node:fs');
  const originalRead = boundary.readFileSync;
  const target = %s;
  boundary.readFileSync = function (input, ...options) {
    const actual = typeof input === 'number'
      ? boundary.readlinkSync('/proc/self/fd/' + input) : String(input);
    if (actual === target && !boundary.lstatSync(target).isSymbolicLink()) {
      boundary.unlinkSync(target);
      boundary.symlinkSync(%s, target);
    }
    return originalRead.call(this, input, ...options);
  };
})();
''' % (json.dumps(str(target)), json.dumps(str(outside))) + self.source
        self.assertEqual(self.digest(), before)
        self.assertTrue(target.is_symlink())
        self.assertEqual(target.resolve(), outside)
        self.assertEqual(target.read_text(), outside.read_text())

    def test_replaced_authority_directory_enumerates_the_original_open_directory(self):
        before = self.digest()
        target = self.root / 'apps/web/src/lib/sidedoor'
        retained = self.root / 'original-authority-directory'
        outside = self.root / 'outside-authority-directory'
        outside.mkdir()
        (outside / 'authority.ts').write_text('malicious replacement authority\n')
        self.source = '''(() => {
  const boundary = require('node:fs');
  const originalRead = boundary.readdirSync;
  const target = %s;
  boundary.readdirSync = function (input, ...options) {
    const actual = typeof input === 'number'
      ? boundary.readlinkSync('/proc/self/fd/' + input)
      : String(input).startsWith('/proc/self/fd/')
        ? boundary.readlinkSync(String(input)) : String(input);
    if (actual === target && !boundary.lstatSync(target).isSymbolicLink()) {
      boundary.renameSync(target, %s);
      boundary.symlinkSync(%s, target);
    }
    return originalRead.call(this, input, ...options);
  };
})();
''' % (json.dumps(str(target)), json.dumps(str(retained)), json.dumps(str(outside))) + self.source
        self.assertEqual(self.digest(), before)
        self.assertTrue(target.is_symlink())
        self.assertEqual(target.resolve(), outside)
        self.assertEqual((retained / 'authority.ts').read_text(),
                         'fixture payload apps/web/src/lib/sidedoor/authority.ts\n')


@unittest.skipUnless((ROOT / 'node_modules/next/dist/bin/next').is_file(), 'Installed Next is required')
class NextGracefulShutdownTests(unittest.TestCase):
    def test_production_sigterm_finishes_inflight_http_before_exiting_143(self):
        with tempfile.TemporaryDirectory(prefix='.sotto-next-shutdown-', dir=ROOT) as directory:
            fixture = Path(directory)
            (fixture / 'pages/api').mkdir(parents=True)
            (fixture / 'package.json').write_text(json.dumps({'name': 'shutdown-fixture', 'private': True}))
            (fixture / 'next.config.js').write_text('module.exports = { experimental: { cpus: 1 } };\n')
            (fixture / 'pages/index.js').write_text('export default function Page() { return "ready"; }\n')
            (fixture / 'pages/api/slow.js').write_text(
                'import fs from "node:fs";\n'
                'export default async function handler(req, res) {\n'
                '  fs.writeFileSync(process.env.SHUTDOWN_STARTED, "started");\n'
                '  await new Promise(resolve => setTimeout(resolve, 800));\n'
                '  res.status(200).json({ completed: true });\n'
                '}\n'
            )
            environment = {key: os.environ[key] for key in ['PATH', 'TMPDIR', 'SYSTEMROOT'] if key in os.environ}
            environment.update(NODE_ENV='production', NEXT_TELEMETRY_DISABLED='1', HOME=str(fixture))
            built = subprocess.run(
                ['node', str(ROOT / 'node_modules/next/dist/bin/next'), 'build', '--webpack'],
                cwd=fixture, env=environment, text=True, capture_output=True, timeout=120, check=False,
            )
            self.assertEqual(built.returncode, 0, built.stdout + built.stderr)
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0))
                port = listener.getsockname()[1]
            marker = fixture / 'request-started'
            environment['SHUTDOWN_STARTED'] = str(marker)
            source = (
                'const { startServer } = require(' + json.dumps(str(ROOT / 'node_modules/next/dist/server/lib/start-server')) + ');'
                'startServer({ dir: ' + json.dumps(str(fixture)) + ', port: ' + str(port) + ', '
                'hostname: "127.0.0.1", isDev: false, allowRetry: false }).catch(error => { console.error(error); process.exit(1); });'
            )
            server = subprocess.Popen(['node', '-e', source], cwd=fixture, env=environment,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            responses = []

            def request():
                try:
                    with urlopen(f'http://127.0.0.1:{port}/api/slow', timeout=15) as response:
                        responses.append((response.status, json.load(response)))
                except Exception as error:
                    responses.append(error)

            pending = threading.Thread(target=request)
            try:
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline and server.poll() is None:
                    try:
                        with urlopen(f'http://127.0.0.1:{port}/', timeout=1) as response:
                            if response.status == 200:
                                break
                    except (OSError, URLError):
                        time.sleep(0.02)
                else:
                    self.fail('Next did not become ready')
                pending.start()
                deadline = time.monotonic() + 10
                while not marker.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(marker.exists(), 'HTTP handler did not start')
                self.assertEqual(responses, [])
                server.send_signal(signal.SIGTERM)
                output, errors = server.communicate(timeout=20)
                pending.join(timeout=5)
                self.assertFalse(pending.is_alive())
                self.assertEqual(responses, [(200, {'completed': True})])
                self.assertEqual(server.returncode, 143, output + errors)
            finally:
                if server.poll() is None:
                    server.kill()
                server.communicate(timeout=5)
                if pending.ident is not None:
                    pending.join(timeout=20)


if __name__ == '__main__':
    unittest.main()
