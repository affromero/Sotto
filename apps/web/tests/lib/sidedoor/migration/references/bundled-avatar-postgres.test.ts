// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { SHARED_SESSION_COOKIE } from '@/lib/sidedoor/access/core/session-identity';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { readStorageMigrationReferencePage } from '@/lib/sidedoor/storage/migration/storage-migration-references';
import { planSottoStorageMigration } from '@/lib/sidedoor/storage/migration/storage-migration-dry-run';
import {
  createSharedTestInstance,
  type SharedTestIdentity,
  type SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;

suite('storage migration reference inventory for bundled avatars', () => {
  let instance: SharedTestInstance;
  let identity: SharedTestIdentity;

  beforeAll(async () => {
    instance = await createSharedTestInstance('migration_bundled_avatar');
  });
  beforeEach(async () => {
    identity = await instance.reset();
  });
  afterAll(async () => {
    await instance?.close();
  });

  it('skips shipped avatars while preserving unmanaged images across pages', async () => {
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { image: '/avatars/capybara.png' },
    });
    const users = Array.from({ length: 100 }, (_, index) => ({
      id: `avatar-${String(index).padStart(3, '0')}`,
      name: 'Inventory profile',
      email: `avatar-${index}@inventory.invalid`,
      image: index === 99 ? '/avatars/unknown.png' : '/avatars/sloth.png',
    }));
    users.push({
      id: 'avatar-100',
      name: 'External image',
      email: 'avatar-100@inventory.invalid',
      image: 'https://example.invalid/avatars/capybara.png',
    });
    await instance.database.user.createMany({ data: users });
    const request = new Request('http://localhost/api/v1/admin/storage/migrate', {
      headers: { cookie: `${SHARED_SESSION_COOKIE}=${identity.ownerToken}` },
    });
    const admission = await sottoTransaction(instance.database, (tx) =>
      resolveSottoRequest(tx, request)
    );
    if (!admission || admission.kind !== 'content') throw new Error('Missing owner admission');
    const first = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationReferencePage({ database, request, admission })
    );
    expect(first.cursor).not.toBeNull();
    const second = await sottoTransaction(instance.database, (database) =>
      readStorageMigrationReferencePage({ database, request, admission, after: first.cursor })
    );
    expect(second.cursor).toBeNull();
    expect([...first.references, ...second.references]).toEqual([
      expect.objectContaining({ id: 'avatar-099', attribution: 'unregistered' }),
      expect.objectContaining({ id: 'avatar-100', attribution: 'unregistered' }),
    ]);
  });

  it('allows a bundled avatar in a dry run but blocks the same path in an episode', async () => {
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { image: '/avatars/capybara.png' },
    });
    const request = new Request('http://localhost/api/v1/admin/storage/migrate', {
      headers: { cookie: `${SHARED_SESSION_COOKIE}=${identity.ownerToken}` },
    });
    const admission = await sottoTransaction(instance.database, (tx) =>
      resolveSottoRequest(tx, request)
    );
    if (!admission || admission.kind !== 'content') throw new Error('Missing owner admission');
    const configuration = {
      aiProvider: null,
      aiModel: null,
      aiBaseUrl: null,
      liveModel: null,
      sttProvider: null,
      sttBaseUrl: null,
      sttModel: null,
      ttsProvider: null,
      ttsBaseUrl: null,
      ttsVoices: null,
      storageProvider: 'r2',
      localStorageRoot: null,
      objectStorageEndpoint: 'https://r2.example',
      objectStorageBucket: 'media',
      objectStorageRegion: 'auto',
      objectStoragePublicUrl: null,
    };
    const options = {
      database: instance.database,
      request,
      admission,
      configuration,
      target: { ...configuration, storageProvider: 'local' },
    };
    expect(await planSottoStorageMigration(options)).toMatchObject({
      scanned: 0,
      failed: 0,
      hasBlockers: false,
    });
    const episode = await instance.database.episode.create({
      data: {
        userId: identity.ownerId,
        title: 'Audio',
        topic: 'Test',
        audioUrl: '/avatars/capybara.png',
      },
    });
    expect(await planSottoStorageMigration(options)).toMatchObject({
      scanned: 1,
      failed: 1,
      hasBlockers: true,
      errors: [{ id: episode.id, field: 'Episode.audioUrl', error: 'unregistered' }],
    });
  });
});
