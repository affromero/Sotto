"""Exercise the self-host configuration snapshot with the real Compose parser."""

import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(shutil.which('docker') and shutil.which('node'), 'Docker and Node are required')
class ComposeSnapshotTests(unittest.TestCase):
    def test_frozen_model_survives_external_env_changes_and_dollar_signs(self):
        available = subprocess.run(['docker', 'compose', 'version'], capture_output=True)
        if available.returncode:
            self.skipTest('Docker Compose is unavailable')
        source = (ROOT / 'scripts/sotto-host').read_text()
        script = source.split('// __SOTTO_FREEZE_CONFIG__', 1)[1].split("\n  ' <", 1)[0]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / '.env').write_text("POSTGRES_PASSWORD=fixture\nBYOK_ENCRYPTION_KEY='one$literal'\n")
            extra = path / 'extra.env'
            extra.write_text("ONE='value$test'\nTWO='value$$test'\nTHREE='value${TEST}'\nQUOTE='a\"b'\nMULTI='a\nb'\n")
            extension = path / 'extension.yml'
            extension.write_text('services:\n  shared:\n    environment:\n      FROM_EXTENSION: original\n')
            override = path / 'override.yml'
            override.write_text("services:\n  web:\n    extends:\n      file: extension.yml\n      service: shared\n    env_file: [extra.env]\n    labels:\n      'fixture$key': '$$literal'\n")

            def render(files):
                command = ['docker', 'compose', '--project-directory', str(path), '--env-file', str(path / '.env')]
                for file in files:
                    command.extend(['-f', str(file)])
                result = subprocess.run(command + ['config', '--format', 'json'], text=True, capture_output=True, check=True)
                return json.loads(result.stdout)

            expected = render([ROOT / 'docker-compose.selfhost.yml', override])
            frozen = subprocess.run(['node', '-e', script], input=json.dumps(expected), text=True, capture_output=True, check=True)
            snapshot = path / 'frozen.json'
            snapshot.write_text(frozen.stdout)
            extra.write_text("ONE='changed'\n")
            override.write_text('services: {}\n')
            extension.unlink()
            self.assertEqual(render([snapshot]), expected)

    def test_frozen_model_does_not_reread_included_compose_files(self):
        available = subprocess.run(['docker', 'compose', 'version'], capture_output=True)
        if available.returncode:
            self.skipTest('Docker Compose is unavailable')
        source = (ROOT / 'scripts/sotto-host').read_text()
        script = source.split('// __SOTTO_FREEZE_CONFIG__', 1)[1].split("\n  ' <", 1)[0]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / '.env').write_text('POSTGRES_PASSWORD=fixture\nBYOK_ENCRYPTION_KEY=fixture\n')
            included = path / 'included.yml'
            included.write_text('services:\n  extra:\n    image: alpine:3.22\n    environment:\n      SAMPLE: original\n')
            main = path / 'main.yml'
            main.write_text('include:\n  - included.yml\nservices: {}\n')

            def render(files):
                command = ['docker', 'compose', '--project-directory', str(path), '--env-file', str(path / '.env')]
                for file in files:
                    command.extend(['-f', str(file)])
                return json.loads(subprocess.run(command + ['config', '--format', 'json'], text=True, capture_output=True, check=True).stdout)

            expected = render([ROOT / 'docker-compose.selfhost.yml', main])
            frozen = subprocess.run(['node', '-e', script], input=json.dumps(expected), text=True, capture_output=True, check=True)
            snapshot = path / 'frozen.json'
            snapshot.write_text(frozen.stdout)
            included.unlink()
            self.assertEqual(render([snapshot]), expected)


if __name__ == '__main__':
    unittest.main()
