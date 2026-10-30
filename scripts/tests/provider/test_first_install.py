"""Exercise first installation against disposable deployment boundaries."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from scripts.tests.test_deploy_script import BOUNDARY, SHA


class FirstInstallationTests(unittest.TestCase):
    def run_install(self, slot=None, mutate_source=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            source = Path(__file__).parents[3]
            shutil.copytree(source / 'scripts/deploy', root / 'scripts/deploy')
            for name in ('deploy.sh', 'smoke-prod.sh'):
                shutil.copyfile(source / 'scripts' / name, root / 'scripts' / name)
            shutil.copyfile(source / 'Caddyfile', root / 'Caddyfile')
            (root / 'caddy.conf').write_text('reverse_proxy localhost:3000\n')
            (root / '.env').write_text('previous compose configuration\n')
            if slot is not None:
                (root / '.sotto-test-deploy-slot').write_text(slot)
            state = {
                'capacity': 0, 'pulled': False, 'web': None, 'old_web': None,
                'workers': None, 'public_health': [], 'verified_workers': [],
                'premature_route': False, 'active_route': 'old', 'old_slot': 'none',
                'new_slot': 'blue', 'candidate_port': 3000, 'running': {},
                'worker_ids': {}, 'queue_flags': {}, 'active': 0,
                'journal_pending': False, 'unsafe_stops': [], 'unsafe_starts': [],
                'stopped': [], 'worker_generation': 'none',
            }
            (root / 'state.json').write_text(json.dumps(state))
            binaries = root / 'bin'
            binaries.mkdir()
            for name in ('git', 'docker', 'sudo', 'curl', 'sleep', 'flock', 'capacity', 'sha256sum'):
                path = binaries / name
                path.write_text('#!' + sys.executable + '\n' + BOUNDARY)
                path.chmod(0o755)
            environment = dict(os.environ, HOME=str(root), TEST_ROOT=str(root), TEST_FAILURE='first-install',
                PATH=str(binaries) + os.pathsep + os.environ['PATH'],
                TMPDIR=str(root),
                SOTTO_ENV_FILE=str(root / '.env.production'),
                PRODUCTION_DEPLOY_LOCK=str(root / 'deploy.lock'),
                PRODUCTION_CAPACITY_CHECKER=str(binaries / 'capacity'))
            environment.pop('SOTTO_COMPATIBILITY_REVIEW_FILE', None)
            environment.pop('SOTTO_COMPATIBILITY_EVIDENCE_FILE', None)
            values = {'NEXT_PUBLIC_APP_URL': 'https://fixture.example', 'SELF_HOSTED': 'false',
                'BYOK_ENCRYPTION_KEY': '0' * 32, 'SOTTO_STACK': 'sotto-test',
                'REDIS_PASSWORD': 'fixture-redis-password', 'SOTTO_RELEASE_SHA': SHA,
                'SOTTO_WEB_IMAGE_REF': 'fixture/web@sha256:' + 'c' * 64,
                'SOTTO_WORKERS_IMAGE_REF': 'fixture/workers@sha256:' + 'c' * 64,
                'SOTTO_BACKUP_DIR': str(root / 'backups'),
                'PRODUCTION_IMAGE_RETENTION_DIR': str(root / 'retention'),
                'CADDY_SITE_PATH': str(root / 'caddy.conf'), 'DATABASE_URL': 'postgresql://fixture',
                **{name: '1048576' for name in ('SOTTO_WEB_IMAGE_BYTES', 'SOTTO_WEB_TRANSFER_BYTES',
                    'SOTTO_WORKERS_IMAGE_BYTES', 'SOTTO_WORKERS_TRANSFER_BYTES', 'SOTTO_BACKUP_BYTES')}}
            if mutate_source:
                review, evidence = root / 'review.json', root / 'evidence.txt'
                review.write_text('{}'); evidence.write_text('fixture')
                values.update(SOTTO_COMPATIBILITY_REVIEW_FILE=str(review),
                              SOTTO_COMPATIBILITY_EVIDENCE_FILE=str(evidence),
                              SOTTO_IMAGE_SOURCE='unsupported')
            content = ''.join(key + '=' + value + '\n' for key, value in values.items())
            if mutate_source:
                content += 'printf "CHANGED_AFTER_SNAPSHOT=1\\n" >> "$SOTTO_ENV_FILE"\n'
            (root / '.env.production').write_text(content)
            result = subprocess.run(['bash', str(root / 'scripts/deploy.sh')], env=environment,
                text=True, capture_output=True, timeout=60)
            output = result.stdout + result.stderr
            after = json.loads((root / 'state.json').read_text())
            after['compose_env'] = (root / '.env').read_text()
            after['source_env'] = (root / '.env.production').read_text()
            after['env_snapshots'] = list(root.glob('sotto-deploy-env.*'))
            calls = [json.loads(line) for line in (root / 'calls.jsonl').read_text().splitlines()]
            slot_file = root / '.sotto-test-deploy-slot'
            return result.returncode, output, after, calls, slot_file.read_text() if slot_file.exists() else None

    def test_missing_slot_blocks_even_an_empty_stack_before_services_start(self):
        status, output, after, calls, slot = self.run_install()
        self.assertNotEqual(status, 0, output)
        self.assertIn('deployment slot is missing', output)
        self.assertIsNone(after['web'], output)
        self.assertIsNone(after['workers'], output)
        self.assertIsNone(slot, output)
        self.assertEqual(after['compose_env'], 'previous compose configuration\n')
        self.assertEqual(after['env_snapshots'], [])
        self.assertFalse(any(call[0] == 'docker' and 'up' in call for call in calls), output)

    def test_invalid_slot_stops_before_starting_services(self):
        status, output, after, calls, _ = self.run_install(slot='unexpected\n')
        self.assertNotEqual(status, 0, output)
        self.assertIn('deployment slot is invalid', output)
        self.assertIsNone(after['web'], output)
        self.assertIsNone(after['workers'], output)
        self.assertEqual(after['compose_env'], 'previous compose configuration\n')
        self.assertEqual(after['env_snapshots'], [])
        self.assertFalse(any(call[0] == 'docker' and 'up' in call for call in calls), output)

    def test_compose_uses_the_same_private_snapshot_when_source_changes(self):
        status, output, after, _, _ = self.run_install(slot='blue\n', mutate_source=True)
        self.assertNotEqual(status, 0, output)
        self.assertIn('CHANGED_AFTER_SNAPSHOT=1', after['source_env'])
        self.assertFalse(after['compose_env'].endswith('CHANGED_AFTER_SNAPSHOT=1\n'))
        self.assertEqual(after['env_snapshots'], [])


if __name__ == '__main__':
    unittest.main()
