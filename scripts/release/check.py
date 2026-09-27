"""Validate a prepared manual release without creating tags or publishing assets."""

import argparse
from datetime import date
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

TAG = re.compile(r'(?P<prefix>v|desktop-v|sotto-v)(?P<version>(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))\Z')


def git(root, *arguments):
    result = subprocess.run(['git', '-C', str(root), *arguments], text=True, capture_output=True)
    if result.returncode:
        raise ValueError(result.stderr.strip() or 'Git validation failed')
    return result.stdout.strip()


def read_json(root, path):
    return json.loads((root / path).read_text())


def require_version(actual, expected, label):
    if actual != expected:
        raise ValueError(f'{label} has version {actual!r}; expected {expected}')


def json_versions(root, version, packages, lock_path):
    lock = read_json(root, lock_path)
    require_version(lock.get('version'), version, lock_path)
    for directory, key in packages:
        manifest = str(Path(directory) / 'package.json')
        require_version(read_json(root, manifest).get('version'), version, manifest)
        require_version(lock.get('packages', {}).get(key, {}).get('version'), version,
                        f'{lock_path} packages[{key!r}]')


def toml_string(section, key):
    found = re.search(r'^' + re.escape(key) + r'\s*=\s*"([^"\n]+)"\s*(?:#.*)?$', section, re.M)
    if not found:
        raise ValueError(f'Expected a literal TOML {key}')
    return found.group(1)


def crate_version(root, directory, version):
    manifest = (root / directory / 'Cargo.toml').read_text()
    package = re.search(r'^\[package\]\s*\n(.*?)(?=^\[|\Z)', manifest, re.M | re.S)
    if not package:
        raise ValueError(f'{directory}/Cargo.toml has no package section')
    name = toml_string(package.group(1), 'name')
    require_version(toml_string(package.group(1), 'version'), version, f'{directory}/Cargo.toml')
    entries = re.findall(r'^\[\[package\]\]\s*\n(.*?)(?=^\[\[|\Z)',
                         (root / directory / 'Cargo.lock').read_text(), re.M | re.S)
    own = [entry for entry in entries if toml_string(entry, 'name') == name]
    if len(own) != 1:
        raise ValueError(f'{directory}/Cargo.lock must contain exactly one {name} package')
    require_version(toml_string(own[0], 'version'), version, f'{directory}/Cargo.lock ({name})')


def release_notes(root, path, version):
    content = (root / path).read_text()
    heading = re.compile(r'^## \[' + re.escape(version) + r'\] - (\d{4}-\d{2}-\d{2})\s*$', re.M)
    matches = list(heading.finditer(content))
    if len(matches) != 1:
        raise ValueError(f'{path} needs one dated [{version}] release section')
    match = matches[0]
    date.fromisoformat(match.group(1))
    next_heading = re.search(r'^## ', content[match.end():], re.M)
    end = match.end() + next_heading.start() if next_heading else len(content)
    body = re.sub(r'<!--.*?-->', '', content[match.end():end], flags=re.S)
    meaningful = [line.strip() for line in body.splitlines()
                  if line.strip() and not line.lstrip().startswith('#')]
    if not meaningful or not any(re.search(r'\w', line) for line in meaningful):
        raise ValueError(f'{path} [{version}] has no release notes')
    return content[match.start():end].strip() + '\n'


def check(root, tag, surface=None, require_tag=False):
    match = TAG.fullmatch(tag)
    if not match:
        raise ValueError('Use a stable tag: vX.Y.Z, desktop-vX.Y.Z, or sotto-vX.Y.Z')
    prefix, version = match.group('prefix', 'version')
    family = {'v': 'app', 'desktop-v': 'desktop', 'sotto-v': 'tui'}[prefix]
    if surface and ((surface == 'tui') != (family == 'tui')):
        raise ValueError(f'{tag} is not a {surface} release')
    if family == 'app':
        json_versions(root, version, [('.', ''), ('apps/web', 'apps/web')], 'package-lock.json')
    if family in ('app', 'desktop'):
        json_versions(root, version, [('apps/desktop', '')], 'apps/desktop/package-lock.json')
        require_version(read_json(root, 'apps/desktop/src-tauri/tauri.conf.json').get('version'),
                        version, 'apps/desktop/src-tauri/tauri.conf.json')
        crate_version(root, 'apps/desktop/src-tauri', version)
    else:
        crate_version(root, 'tui', version)
    notes = release_notes(root, 'tui/CHANGELOG.md' if family == 'tui' else 'CHANGELOG.md', version)
    sha = git(root, 'rev-parse', 'HEAD')
    existing = subprocess.run(['git', '-C', str(root), 'show-ref', '--verify', '--quiet',
                               f'refs/tags/{tag}'], capture_output=True)
    if existing.returncode not in (0, 1):
        raise ValueError('Could not inspect the local release tag')
    if existing.returncode == 0:
        if git(root, 'rev-parse', f'refs/tags/{tag}^{{commit}}') != sha:
            raise ValueError(f'{tag} points at another commit')
    elif require_tag:
        raise ValueError(f'{tag} does not exist; manual workflow runs require an existing tag')
    if require_tag:
        if git(root, 'status', '--porcelain'):
            raise ValueError('Release validation requires a clean checkout')
        git(root, 'merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main')
    return {'tag': tag, 'version': version, 'family': family, 'sha': sha,
            'short_sha': sha[:8], 'make_latest': 'true' if family == 'app' else 'false'}, notes


def github_json(repository, path, missing_ok=False):
    token = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'sotto-release-check',
               'X-GitHub-Api-Version': '2022-11-28'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    request = Request(f'https://api.github.com/repos/{repository}/{path}', headers=headers)
    try:
        with urlopen(request, timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        if missing_ok and error.code == 404:
            return None
        raise ValueError(f'GitHub release validation failed with HTTP {error.code}') from error


def check_github(metadata, repository):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('A GitHub owner/repository is required')
    workflows = {'app': ['deploy.yml', 'release-surfaces-ci.yml'],
                 'desktop': ['release-surfaces-ci.yml'], 'tui': ['sotto-ci.yml']}
    for workflow in workflows[metadata['family']]:
        result = github_json(repository, f'actions/workflows/{workflow}/runs?head_sha={metadata["sha"]}&per_page=1')
        runs = result.get('workflow_runs', [])
        if not runs or runs[0].get('head_sha') != metadata['sha'] or runs[0].get('conclusion') != 'success':
            raise ValueError(f'{workflow} must pass for release commit {metadata["sha"]}')
    if metadata['family'] in ('app', 'desktop'):
        latest = github_json(repository, 'releases/latest', missing_ok=True)
        latest_tag = TAG.fullmatch(latest.get('tag_name', '')) if latest else None
        if latest_tag and latest_tag.group('prefix') == 'v':
            previous = tuple(map(int, latest_tag.group('version').split('.')))
            current = tuple(map(int, metadata['version'].split('.')))
            if current < previous:
                raise ValueError('Refusing to publish an older desktop/app release over the latest release')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tag')
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--surface', choices=['desktop', 'tui'])
    parser.add_argument('--require-tag', action='store_true')
    parser.add_argument('--github', help='Require successful CI and prevent latest-release rollback')
    parser.add_argument('--notes-file', type=Path)
    parser.add_argument('--github-output', type=Path)
    args = parser.parse_args()
    try:
        metadata, notes = check(args.root, args.tag, args.surface, args.require_tag)
        if args.github:
            check_github(metadata, args.github)
        if args.notes_file:
            args.notes_file.write_text(notes)
        if args.github_output:
            with args.github_output.open('a') as output:
                output.write(''.join(f'{key}={value}\n' for key, value in metadata.items()))
        print(json.dumps(metadata, indent=2))
    except (ValueError, OSError, KeyError) as error:
        print(f'Release validation failed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
