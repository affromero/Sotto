"""The bundled Android notices retain actual dependency attribution."""

from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[3]
GENERATOR = ROOT / 'apps/android/licenses/generate.py'


def archive(entries: dict[str, bytes]) -> bytes:
    output = BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for name, content in entries.items():
            target.writestr(name, content)
    return output.getvalue()


class AndroidNoticeTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.licenses = self.root / 'apps/android/licenses'
        self.licenses.mkdir(parents=True)
        (self.root / 'LICENSE').write_text('First-party fixture license')
        (self.root / 'THIRD_PARTY_NOTICES.md').write_text('Repository notices')
        for name in ('Apache-2.0.txt', 'checker-qual-LICENSE.txt',
                     'libyuv-LICENSE.txt'):
            (self.licenses / name).write_bytes(
                (ROOT / 'apps/android/licenses' / name).read_bytes()
            )
        (self.licenses / 'supplements.json').write_text('{}')
        self.export = self.root / 'apps/android/app/build/legal/artifacts.json'
        self.export.parent.mkdir(parents=True)
        self.output = self.root / 'apps/android/app/src/main/assets/legal'

    def generate(self, content: bytes, license: str = 'Apache-2.0',
                 url: str | None = None) -> (
        subprocess.CompletedProcess[str]
    ):
        artifact = self.root / 'component.aar'
        artifact.write_bytes(content)
        urls = {
            'Apache-2.0': 'https://www.apache.org/licenses/LICENSE-2.0',
            'The MIT License': 'http://opensource.org/licenses/MIT',
            'BSD-3-Clause': 'https://opensource.org/licenses/BSD-3-Clause',
        }
        self.export.write_text(json.dumps([{
            'id': 'example:component:1', 'file': str(artifact),
            'licenses': [
                {'name': license, 'url': url or urls.get(license, 'unknown')},
            ],
        }]))
        return subprocess.run(
            [sys.executable, str(GENERATOR), '--root', str(self.root)],
            capture_output=True, text=True, check=False,
        )

    def test_nested_component_notices_keep_copyright_and_regenerate_stably(
        self,
    ) -> None:
        content = archive({
            'classes.jar': archive({
                'META-INF/NOTICE': b'Copyright Main Authors',
            }),
            'libs/extra.jar': archive({
                'META-INF/NOTICE.txt': b'Copyright Nested Authors',
            }),
        })
        first = self.generate(content)
        self.assertEqual(first.returncode, 0, first.stderr)
        notices = (self.output / 'notices.txt').read_bytes()
        manifest = (self.output / 'dependencies.json').read_bytes()
        self.assertIn(b'Copyright Main Authors', notices)
        self.assertIn(b'Copyright Nested Authors', notices)
        self.assertIn(b'libs/extra.jar!/META-INF/NOTICE.txt', notices)
        self.assertNotIn(str(self.root).encode(), notices + manifest)
        second = self.generate(content)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual((self.output / 'notices.txt').read_bytes(), notices)
        self.assertEqual(
            (self.output / 'dependencies.json').read_bytes(), manifest,
        )

    def test_unknown_or_unattributed_licenses_fail_before_writing(
        self,
    ) -> None:
        licenses = ('Unreviewed License', 'The MIT License', 'BSD-3-Clause')
        for license in licenses:
            with self.subTest(license=license):
                result = self.generate(archive({'classes.jar': archive({})}),
                                       license)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('notice generation failed', result.stderr)
                self.assertFalse(self.output.exists())

    def test_oversized_nested_archive_is_rejected(self) -> None:
        content = archive({'libs/oversized.jar': b'x' * (33 * 1024 * 1024)})
        result = self.generate(content)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Oversized', result.stderr)

    def test_truncated_terms_and_conflicting_declarations_are_rejected(
        self,
    ) -> None:
        cases = (
            ('The MIT License', None,
             b'Copyright Example. Permission is hereby granted.'),
            ('BSD-3-Clause', None,
             b'Copyright Example. Redistribution and use. Neither the name.'),
            ('Apache License 3.0', 'https://example.com/2.0', b''),
            ('Apache-2.0', 'https://example.com/mit', b''),
        )
        for license, url, notice in cases:
            with self.subTest(license=license, url=url):
                result = self.generate(archive({'LICENSE.txt': notice}),
                                       license, url)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(self.output.exists())

    def test_complete_mit_and_bsd_attribution_are_retained(self) -> None:
        for license, file in (('The MIT License', 'checker-qual-LICENSE.txt'),
                              ('BSD-3-Clause', 'libyuv-LICENSE.txt')):
            with self.subTest(license=license):
                notice = (self.licenses / file).read_bytes()
                result = self.generate(archive({'LICENSE.txt': notice}),
                                       license)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn(notice.strip(),
                              (self.output / 'notices.txt').read_bytes())

    def test_complete_terms_without_actual_ownership_are_rejected(self) -> None:
        cases = (
            ('The MIT License', 'checker-qual-LICENSE.txt',
             'Permission is hereby granted'),
            ('BSD-3-Clause', 'libyuv-LICENSE.txt', 'Redistribution and use'),
        )
        for license, file, opening in cases:
            with self.subTest(license=license):
                notice = (self.licenses / file).read_text()
                body = notice[notice.index(opening):].encode()
                result = self.generate(archive({'LICENSE.txt': body}),
                                       license)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Missing full attribution', result.stderr)

    def test_inventory_tracks_artifact_and_root_notice_changes(self) -> None:
        content = archive({'META-INF/NOTICE': b'Original attribution'})
        result = self.generate(content)
        self.assertEqual(result.returncode, 0, result.stderr)
        first = json.loads((self.output / 'dependencies.json').read_text())
        updated = archive({'META-INF/NOTICE': b'Updated attribution'})
        result = self.generate(updated)
        self.assertEqual(result.returncode, 0, result.stderr)
        second = json.loads((self.output / 'dependencies.json').read_text())
        self.assertNotEqual(first['artifacts'], second['artifacts'])
        self.assertNotEqual(first['notices'], second['notices'])
        (self.root / 'THIRD_PARTY_NOTICES.md').write_text('New root notice')
        result = self.generate(content)
        self.assertEqual(result.returncode, 0, result.stderr)
        third = json.loads((self.output / 'dependencies.json').read_text())
        self.assertNotEqual(first['rootNotices'], third['rootNotices'])
        self.assertNotEqual(first['notices'], third['notices'])


if __name__ == '__main__':
    unittest.main()
