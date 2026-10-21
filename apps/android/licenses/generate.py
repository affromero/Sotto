"""Bundle notices from exact Gradle release artifacts and source licenses."""

import argparse
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import sys
from typing import TypedDict
import zipfile


class License(TypedDict):
    name: str
    url: str


class Artifact(TypedDict):
    id: str
    file: str
    licenses: list[License]


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def inventory(path: Path) -> list[Artifact]:
    value: object = json.loads(path.read_text())
    if not isinstance(value, list) or not value:
        raise ValueError('Artifact inventory must be a nonempty array')
    result: list[Artifact] = []
    seen: set[str] = set()
    for entry in value:
        if not isinstance(entry, dict):
            raise ValueError('Invalid artifact inventory entry')
        identity, file = entry.get('id'), entry.get('file')
        declared = entry.get('licenses')
        if (not isinstance(identity, str) or not isinstance(file, str)
                or not isinstance(declared, list) or not declared):
            raise ValueError('Artifact identity, file and licenses required')
        key = identity + '|' + Path(file).name
        if key in seen:
            raise ValueError(f'Duplicate artifact: {key}')
        seen.add(key)
        licenses: list[License] = []
        for license in declared:
            if not isinstance(license, dict):
                raise ValueError(f'Invalid license metadata: {identity}')
            name, url = license.get('name'), license.get('url')
            if not isinstance(name, str) or not isinstance(url, str):
                raise ValueError(f'Invalid license metadata: {identity}')
            licenses.append({'name': name, 'url': url})
        result.append({'id': identity, 'file': file, 'licenses': licenses})
    return sorted(result, key=lambda entry: entry['id'] + '|' + entry['file'])


def archive_notices(data: bytes) -> dict[str, str]:
    notices: dict[str, str] = {}
    expanded = 0
    entries = 0

    def inspect(content: bytes, prefix: str, depth: int) -> None:
        nonlocal expanded, entries
        if depth > 3:
            raise ValueError('Nested archive limit exceeded')
        with zipfile.ZipFile(BytesIO(content)) as archive:
            contents = sorted(archive.infolist(), key=lambda row: row.filename)
            for item in contents:
                entries += 1
                expanded += item.file_size
                if entries > 50000 or expanded > 256 * 1024 * 1024:
                    raise ValueError('Archive expansion limit exceeded')
                basename = Path(item.filename).name
                notice = bool(re.fullmatch(
                    r'(LICENSE|NOTICE|COPYRIGHT|COPYING)([._-].*)?',
                    basename, flags=re.IGNORECASE,
                ))
                nested = (item.filename == 'classes.jar'
                          or (item.filename.startswith('libs/')
                              and item.filename.endswith('.jar')))
                if not notice and not nested:
                    continue
                if item.file_size > 32 * 1024 * 1024:
                    raise ValueError(f'Oversized legal archive: {basename}')
                value = archive.read(item)
                source = prefix + item.filename
                if notice:
                    text = value.decode('utf-8-sig')
                    text = text.replace('\r\n', '\n').strip()
                    if not text:
                        raise ValueError(f'Empty legal notice: {source}')
                    notices[source] = text
                if nested:
                    inspect(value, source + '!/', depth + 1)

    inspect(data, '', 0)
    return notices


def verify_licenses(
    artifact: Artifact, notices: dict[str, str], license_root: Path,
) -> None:
    apache_names = {
        'apache 2.0', 'apache-2.0', 'apache license, version 2.0',
        'the apache license, version 2.0',
        'the apache software license, version 2.0',
    }
    apache_urls = {
        f'{scheme}://{host}/licenses/{suffix}'
        for scheme in ('http', 'https')
        for host in ('apache.org', 'www.apache.org')
        for suffix in ('license-2.0', 'license-2.0.txt')
    }
    bodies = {
        'mit': ('checker-qual-LICENSE.txt', 'Permission is hereby granted'),
        'bsd-3-clause': ('libyuv-LICENSE.txt', 'Redistribution and use'),
    }
    for license in artifact['licenses']:
        name = ' '.join(license['name'].lower().split())
        url = license['url'].lower().rstrip('/')
        if name in apache_names and url in apache_urls:
            continue
        if (name in ('mit', 'the mit license', 'mit license')
                and url in ('http://opensource.org/licenses/mit',
                            'https://opensource.org/licenses/mit')):
            kind = 'mit'
        elif (name == 'bsd-3-clause'
              and url in ('http://opensource.org/licenses/bsd-3-clause',
                          'https://opensource.org/licenses/bsd-3-clause')):
            kind = 'bsd-3-clause'
        else:
            raise ValueError(
                f"Unreviewed or conflicting license: {artifact['id']}: "
                f'{license}'
            )
        file, opening = bodies[kind]
        canonical = (license_root / file).read_text()
        body = canonical[canonical.index(opening):]
        normalized = ' '.join(body.split()).lower()
        complete = False
        for text in notices.values():
            if normalized not in ' '.join(text.split()).lower():
                continue
            index = text.lower().find(opening.lower())
            header = text[:index] if index >= 0 else ''
            ownership = re.search(
                r'^\s*(?:\*\s*)?copyright\s+(?:\(c\)\s*)?'
                r'\d{4}[^\n]*[a-z]', header,
                flags=re.IGNORECASE | re.MULTILINE,
            )
            if ownership:
                complete = True
                break
        if not complete:
            raise ValueError(f"Missing full attribution: {artifact['id']}")


def generate(root: Path, records: list[Artifact]) -> tuple[str, str]:
    source_license = (root / 'LICENSE').read_bytes()
    source_notices = (root / 'THIRD_PARTY_NOTICES.md').read_bytes()
    license_root = root / 'apps/android/licenses'
    apache = (license_root / 'Apache-2.0.txt').read_text().strip()
    supplements: object = json.loads(
        (license_root / 'supplements.json').read_text()
    )
    if not isinstance(supplements, dict):
        raise ValueError('License supplements must map exact artifact IDs')
    if set(supplements) - {record['id'] for record in records}:
        raise ValueError('Unused license supplement requires review')
    if 'END OF TERMS AND CONDITIONS' not in apache:
        raise ValueError('Complete Apache 2.0 license is required')
    sections = [
        'Sotto Android license notices',
        'First-party Sotto code: root LICENSE\n\n'
        + source_license.decode().strip(),
        'Repository third-party notices (components vary by artifact)\n\n'
        + source_notices.decode().strip(),
    ]
    artifact_hashes: list[str] = []
    retained: dict[str, tuple[str, list[str]]] = {}
    index: list[str] = []
    for artifact in records:
        path = Path(artifact['file'])
        data = path.read_bytes()
        notices = archive_notices(data)
        extra: object = supplements.get(artifact['id'], [])
        if not isinstance(extra, list):
            raise ValueError('Invalid license supplement list')
        for name in extra:
            if not isinstance(name, str) or Path(name).name != name:
                raise ValueError('License supplement must be a local filename')
            notices['reviewed-supplement/' + name] = (
                license_root / name
            ).read_text().strip()
        verify_licenses(artifact, notices, license_root)
        identity = artifact['id'] + '|' + path.name
        artifact_hashes.append(identity + '|' + digest(data))
        declarations = '\n'.join(
            f"  {license['name']}: {license['url']}"
            for license in artifact['licenses']
        )
        index.append(identity + '\n' + declarations)
        for source, text in notices.items():
            key = digest(text.encode())
            if key not in retained:
                retained[key] = (text, [])
            retained[key][1].append(identity + '!/' + source)
    sections.append('Resolved release dependencies\n\n' + '\n\n'.join(index))
    sections.append('Apache License 2.0 (dependencies declaring Apache 2.0)'
                    '\nSource: https://www.apache.org/licenses/LICENSE-2.0.txt'
                    '\n\n' + apache)
    for key in sorted(retained):
        text, sources = retained[key]
        sections.append('Bundled dependency notice\n'
                        + '\n'.join(sorted(sources)) + '\n\n' + text)
    output = ('\n\n' + '=' * 72 + '\n\n').join(sections) + '\n'
    manifest = {
        'schema': 1,
        'artifacts': sorted(artifact_hashes),
        'rootLicense': digest(source_license),
        'rootNotices': digest(source_notices),
        'notices': digest(output.encode()),
        'sources': sorted(
            path.name + '|' + digest(path.read_bytes())
            for path in license_root.iterdir()
            if path.suffix in ('.txt', '.json')
        ),
    }
    return output, json.dumps(manifest, indent=2, sort_keys=True) + '\n'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path,
                        default=Path(__file__).resolve().parents[3])
    root = parser.parse_args().root
    records = inventory(root / 'apps/android/app/build/legal/artifacts.json')
    notices, manifest = generate(root, records)
    target = root / 'apps/android/app/src/main/assets/legal'
    target.mkdir(parents=True, exist_ok=True)
    (target / 'notices.txt').write_text(notices)
    (target / 'dependencies.json').write_text(manifest)
    print(f'Bundled notices for {len(records)} release artifacts')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(f'Android notice generation failed: {error}', file=sys.stderr)
        raise SystemExit(1) from error
