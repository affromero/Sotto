"""Exercise detection against captured runtime and Docker inspection data."""

from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).parents[2] / 'deploy/provider-activation-gate.py'
SPEC = spec_from_file_location('provider_activation_gate', SCRIPT)
assert SPEC is not None and SPEC.loader is not None
GATE = module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


class ProviderActivationGateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.image = 'sha256:' + 'a' * 64
        self.identifiers = {
            name: str(index) * 64
            for index, name in enumerate(
                ('web', 'workers-heavy', 'workers-pipeline', 'workers-light'), 1
            )
        }
        self.rows = {
            identifier: {
                'Id': identifier, 'Image': self.image,
                'Config': {
                    'Env': ['NODE_ENV=production'],
                    'Labels': {
                        'org.opencontainers.image.revision': 'd' * 40,
                        'com.docker.compose.project': (
                            'sotto-test-blue' if name == 'web' else 'sotto-test'
                        ),
                        'com.docker.compose.service': name,
                    },
                },
                'State': {'Running': True, 'OOMKilled': False},
                'Mounts': [{'Destination': '/app/data'}],
            }
            for name, identifier in self.identifiers.items()
        }
        self.write_inventory()

    def write_inventory(self, app_names=('web',), worker_names=None):
        if worker_names is None:
            worker_names = ('workers-heavy', 'workers-pipeline', 'workers-light')
        app = self.root / 'app.json'
        workers = self.root / 'workers.json'
        app.write_text(json.dumps({
            'services': {name: {'image': self.image} for name in app_names},
            'x-captured-containers': {name: self.identifiers[name] for name in app_names},
        }))
        workers.write_text(json.dumps({
            'services': {name: {'image': self.image} for name in worker_names},
            'x-captured-containers': {name: self.identifiers[name] for name in worker_names},
        }))
        self.environment = {
            'PREVIOUS_APP_IMAGES': str(app),
            'PREVIOUS_WORKER_IMAGES': str(workers),
            'SOTTO_STACK': 'sotto-test',
            'OLD_SLOT': 'blue',
        }

    def detect(self):
        def docker(command, **options):
            self.assertEqual(command[:2], ['docker', 'inspect'])
            self.assertTrue(options.get('check'), 'Docker inspection errors must fail closed')
            return subprocess.CompletedProcess(
                command, 0, json.dumps([self.rows[command[2]]]).encode(), b''
            )

        with patch.dict(os.environ, self.environment), patch.object(
            GATE.review.subprocess, 'run', side_effect=docker
        ):
            return GATE.established_gate()

    def test_unconfigured_activation_reports_no_explicit_gate(self):
        self.assertFalse(self.detect())

    def test_legacy_runtime_without_revision_label_remains_ungated(self):
        for row in self.rows.values():
            del row['Config']['Labels']['org.opencontainers.image.revision']
        self.assertFalse(self.detect())

    def test_activation_environment_in_any_runtime_requires_review(self):
        self.rows[self.identifiers['workers-heavy']]['Config']['Env'].append(
            'SOTTO_PROVIDER_ACTIVATION_FILE=/run/sotto-provider-activation/fish.json'
        )
        self.assertTrue(self.detect())

    def test_mount_covering_activation_path_requires_review(self):
        for target in ('/run', '/run/sotto-provider-activation',
                       '/run/sotto-provider-activation/fish.json'):
            with self.subTest(target=target):
                self.rows[self.identifiers['web']]['Mounts'] = [{'Destination': target}]
                self.assertTrue(self.detect())

    def test_malformed_inspection_metadata_fails_closed(self):
        row = self.rows[self.identifiers['web']]
        for key, invalid in [('Config', {'Env': [None]}),
                             ('Mounts', [{'Destination': '../relative'}]),
                             ('State', {'Running': False, 'OOMKilled': False})]:
            with self.subTest(key=key):
                saved = row[key]
                row[key] = invalid
                with self.assertRaises(ValueError):
                    self.detect()
                row[key] = saved

    def test_captured_runtime_identity_mismatch_fails_closed(self):
        self.rows[self.identifiers['web']]['Image'] = 'sha256:' + 'b' * 64
        with self.assertRaises(ValueError):
            self.detect()

    def test_runtime_owned_by_another_project_fails_closed(self):
        labels = self.rows[self.identifiers['web']]['Config']['Labels']
        labels['com.docker.compose.project'] = 'another-blue'
        with self.assertRaises(ValueError):
            self.detect()

    def test_worker_inventory_cannot_replace_the_captured_web(self):
        self.write_inventory(worker_names=tuple(self.identifiers))
        with self.assertRaises(ValueError):
            self.detect()

    def test_distinct_services_cannot_share_a_captured_container(self):
        self.identifiers['workers-heavy'] = self.identifiers['web']
        self.write_inventory()
        with self.assertRaises(ValueError):
            self.detect()


if __name__ == '__main__':
    unittest.main()
