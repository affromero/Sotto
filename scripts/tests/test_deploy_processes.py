"""Exercise graceful worker retirement and executable compatibility boundaries."""

import importlib.util
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
