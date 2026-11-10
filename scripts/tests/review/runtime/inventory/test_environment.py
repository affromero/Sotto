"""Exercise successor environment admission without a historical image."""

import json
import unittest
from hashlib import sha256
from importlib import import_module

from scripts.deploy.review.state import atomic_json, checksum
from scripts.deploy.review.runtime.inventory.environment import admit_successor_environment
from scripts.deploy.review.topology import AUTH_HOME, PUBLIC_ENVIRONMENT

class SuccessorEnvironmentTests(unittest.TestCase):
    def setUp(self) -> None:
        fixture_type = import_module(
            'scripts.tests.review.runtime.inventory.test_predecessor',
        ).PredecessorCaptureTests
        self.fixture = fixture_type('runTest')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.previous = self.fixture.previous
        self.successor = self.fixture.successor
        self.directory = self.previous.attempt.directory
        original = {'DATABASE_URL': 'postgresql://fixture/secret',
                    'REDIS_URL': 'redis://fixture/0',
                    'BYOK_ENCRYPTION_KEY': 'fixture-secret',
                    'NODE_OPTIONS': '--fixture', 'PORT': '1234'}
        web = self.previous.manifest['topology']['services']['web']
        web['environmentHash'] = checksum(original)
        self.original_bytes = ''.join(f'{k}={v}\n' for k, v in sorted(original.items())).encode()
        self.previous.private_file(self.directory / 'original.env', self.original_bytes)
        base = dict(original)
        base.update(PUBLIC_ENVIRONMENT)
        base.update({'COMMIT_SHA': 'a' * 40, 'HOME': '/home/sotto',
                     'CODEX_HOME': AUTH_HOME, 'PORT': '3000',
                     'SOTTO_PRIVACY_CONTACT_EMAIL': 'me@afromero.co'})
        document = {'name': 'fixture', 'services': {}}
        for role in ('web', 'workers'):
            values = dict(base)
            if role == 'workers':
                values.update({'WORKER_PROFILE': 'all', 'WORKER_PRESET': 'full',
                               'WORKER_QUEUES': '', 'WORKER_EXCLUDE_QUEUES': ''})
            candidate = self.fixture.fixture.candidates[role]
            candidate['Config']['Env'] = [f'{k}={v}' for k, v in values.items()]
            atomic_json(self.directory / ('candidate-' + role + '.json'),
                        self.previous.writer_binding(candidate))
            image_key = 'finalWeb' if role == 'web' else 'finalWorker'
            document['services'][role] = {
                'container_name': candidate['Name'].lstrip('/'),
                'image': self.previous.manifest[image_key]['reference'],
                'environment': values,
            }
        raw = json.dumps(document, sort_keys=True).encode()
        self.previous.private_file(self.directory / 'candidate-compose.json', raw)
        for role in ('web', 'workers'):
            desired = document['services'][role]
            atomic_json(self.directory / ('candidate-' + role + '-intent.json'), {
                'name': desired['container_name'], 'reference': desired['image'],
                'composeHash': sha256(raw).hexdigest(),
            })

    def test_admits_exact_preserved_settings_and_overrides(self) -> None:
        values, proof = admit_successor_environment(self.previous, self.successor)
        self.assertEqual(values['PORT'], '3000')
        self.assertEqual(values['DATABASE_URL'], 'postgresql://fixture/secret')
        self.assertEqual(values['WORKER_PROFILE'], 'all')
        self.assertNotIn('fixture-secret', json.dumps(proof))

    def test_refuses_changed_original_and_duplicate_keys(self) -> None:
        path = self.directory / 'original.env'
        path.write_bytes(self.original_bytes.replace(b'fixture-secret', b'changed'))
        with self.assertRaisesRegex(ValueError, 'original-environment-changed'):
            admit_successor_environment(self.previous, self.successor)
        path.write_bytes(self.original_bytes + b'PORT=9\n')
        with self.assertRaisesRegex(ValueError, 'environment-format-changed'):
            admit_successor_environment(self.previous, self.successor)

    def test_refuses_changed_candidate_environment(self) -> None:
        self.fixture.fixture.candidates['workers']['Config']['Env'].append('UNADMITTED=1')
        with self.assertRaises(ValueError):
            admit_successor_environment(self.previous, self.successor)

    def test_refuses_substituted_live_credential_without_disclosing_it(self) -> None:
        candidate = self.fixture.fixture.candidates['workers']
        candidate['Config']['Env'] = [
            'DATABASE_URL=postgresql://attacker/secret'
            if item.startswith('DATABASE_URL=') else item
            for item in candidate['Config']['Env']
        ]
        atomic_json(self.directory / 'candidate-workers.json',
                    self.previous.writer_binding(candidate))
        with self.assertRaisesRegex(ValueError, 'live-environment-changed') as raised:
            admit_successor_environment(self.previous, self.successor)
        self.assertNotIn('secret', str(raised.exception))

    def test_refuses_changed_compose_and_public_permissions(self) -> None:
        path = self.directory / 'candidate-compose.json'
        content = path.read_bytes()
        path.write_bytes(content + b' ')
        with self.assertRaises(ValueError):
            admit_successor_environment(self.previous, self.successor)
        path.write_bytes(content)
        path.chmod(0o644)
        with self.assertRaises(ValueError):
            admit_successor_environment(self.previous, self.successor)

    def test_refuses_symlinked_original_environment(self) -> None:
        path = self.directory / 'original.env'
        target = self.directory / 'renamed-original.env'
        path.rename(target)
        path.symlink_to(target)
        with self.assertRaises(OSError):
            admit_successor_environment(self.previous, self.successor)

    def test_refuses_a_worker_from_a_different_source(self) -> None:
        self.previous.manifest['finalWorker']['sha'] = 'f' * 40
        with self.assertRaises(ValueError):
            admit_successor_environment(self.previous, self.successor)

    def test_refuses_candidate_compose_with_changed_credentials(self) -> None:
        path = self.directory / 'candidate-compose.json'
        document = json.loads(path.read_bytes())
        document['services']['workers']['environment']['BYOK_ENCRYPTION_KEY'] = 'substituted'
        raw = json.dumps(document, sort_keys=True).encode()
        path.write_bytes(raw)
        for role in ('web', 'workers'):
            intent_path = self.directory / ('candidate-' + role + '-intent.json')
            intent = json.loads(intent_path.read_bytes())
            atomic_json(intent_path, {**intent, 'composeHash': sha256(raw).hexdigest()})
        with self.assertRaisesRegex(ValueError, 'candidate-environment-changed'):
            admit_successor_environment(self.previous, self.successor)


if __name__ == '__main__':
    unittest.main()
