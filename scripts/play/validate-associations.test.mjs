import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateAppleAssociation, validateAndroidAssociation } from './validate-associations.mjs';

const appID = 'TESTTEAM01.fm.sotto.app';
const certificate = Array(32).fill('AB').join(':');
const assetlinks = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'fm.sotto.app',
      sha256_cert_fingerprints: [certificate],
    },
  },
];

test('Apple links accept the supplied identity and only the invitation route', () => {
  assert.doesNotThrow(() =>
    validateAppleAssociation(
      { applinks: { details: [{ appIDs: [appID], components: [{ '/': '/play/join' }] }] } },
      appID
    )
  );
  for (const path of ['*', '/api/*', '/play/*']) {
    assert.throws(
      () => validateAppleAssociation({ applinks: { details: [{ appID, paths: [path] }] } }, appID),
      /limited/
    );
  }
  assert.throws(() => validateAppleAssociation({ applinks: { details: [] } }, appID), /identifier/);
  assert.throws(
    () =>
      validateAppleAssociation(
        { applinks: { details: [{ appIDs: appID, components: [{ '/': '/play/join' }] }] } },
        appID
      ),
    /identifier/
  );
  for (const entry of [
    { appIDs: [appID], paths: ['/play/join'] },
    { appID: 123, appIDs: [appID], components: [{ '/': '/play/join' }] },
  ]) {
    assert.throws(
      () => validateAppleAssociation({ applinks: { details: [entry] } }, appID),
      /Pair/
    );
  }
  assert.throws(
    () =>
      validateAppleAssociation(
        { applinks: { details: [{ appID, paths: ['/play/join'], components: [{ '/': '*' }] }] } },
        appID
      ),
    /either/
  );
  assert.throws(
    () =>
      validateAppleAssociation(
        {
          applinks: {
            details: [{ appIDs: [appID], components: [{ '/': '/play/join', exclude: true }] }],
          },
        },
        appID
      ),
    /positively/
  );
});

test('Android links require delegation to the actual package and installed certificate', () => {
  assert.doesNotThrow(() => validateAndroidAssociation(assetlinks, 'fm.sotto.app', [certificate]));
  assert.throws(
    () => validateAndroidAssociation(assetlinks, 'fm.sotto.other', [certificate]),
    /package/
  );
  assert.throws(
    () => validateAndroidAssociation(assetlinks, 'fm.sotto.app', [Array(32).fill('CD').join(':')]),
    /missing/
  );
  assert.throws(
    () => validateAndroidAssociation(assetlinks, 'fm.sotto.app', ['upload-key']),
    /SHA-256/
  );
  assert.throws(
    () =>
      validateAndroidAssociation(
        [{ ...assetlinks[0], relation: 'delegate_permission/common.handle_all_urls' }],
        'fm.sotto.app',
        [certificate]
      ),
    /delegate/
  );
});

test('the operator command validates actual files and rejects oversized or malformed content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sotto-associations-'));
  try {
    const path = join(root, 'assetlinks.json');
    const command = () =>
      spawnSync(
        process.execPath,
        [
          new URL('./validate-associations.mjs', import.meta.url).pathname,
          '--assetlinks',
          path,
          '--android-package',
          'fm.sotto.app',
          '--android-sha256',
          certificate,
        ],
        { encoding: 'utf8' }
      );
    await writeFile(path, JSON.stringify(assetlinks));
    assert.equal(command().status, 0);
    await writeFile(path, '{}');
    assert.notEqual(command().status, 0);
    await writeFile(path, ' '.repeat(131_073));
    const result = command();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /128 KiB/);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('the operator refuses symlinks, directories and pipes without waiting for data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sotto-association-files-'));
  const document = join(root, 'assetlinks.json');
  const link = join(root, 'link.json');
  const pipe = join(root, 'pipe.json');
  try {
    await writeFile(document, JSON.stringify(assetlinks));
    await symlink(document, link);
    const created = spawnSync('mkfifo', [pipe], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    for (const path of [link, root, pipe]) {
      const result = spawnSync(
        process.execPath,
        [
          new URL('./validate-associations.mjs', import.meta.url).pathname,
          '--assetlinks',
          path,
          '--android-package',
          'fm.sotto.app',
          '--android-sha256',
          certificate,
        ],
        { encoding: 'utf8', timeout: 5000 }
      );
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Association validation/);
    }
  } finally {
    await rm(root, { recursive: true });
  }
});
