// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  prepareStorageBackend,
  prepareStorageReference,
  StorageBackendRegistry,
  StorageReferenceRegistry,
} from 'thesidedoor-core/storage';
import type { PrismaClient } from '@/generated/prisma/client';
import { captureStorageBackend } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { captureFocusTargetStorage } from '@/lib/sidedoor/storage/core/focus-target-storage';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', () => {
  const database = new Proxy(
    {},
    {
      get(_target, property) {
        if (!boundary.database) throw new Error('Test database is not initialized');
        const value = boundary.database[property as keyof PrismaClient];
        return typeof value === 'function' ? value.bind(boundary.database) : value;
      },
    }
  );
  return { prisma: database, prismaUnfiltered: database };
});
vi.mock('@/lib/visual-cue-keys', () => ({ getVisualCueKey: async () => 'test-key' }));

import { addVisualCue } from '@/lib/learning-targets';
import { deleteCourseCompletely } from '@/lib/course-deletion';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('visual cue replacement storage ownership', () => {
  let instance: SharedTestInstance;
  beforeAll(async () => {
    instance = await createSharedTestInstance('visual_replace');
    boundary.database = instance.database;
  });
  afterAll(async () => {
    boundary.database = null;
    vi.unstubAllGlobals();
    await instance?.close();
  });

  it('retires the old stored visual consumer when publishing a provider image', async () => {
    const identity = await instance.reset();
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'es', targetLang: 'ru' } },
      create: { nativeLang: 'es', targetLang: 'ru', title: 'Russian' },
      update: {},
    });
    const course = await instance.database.course.create({
      data: {
        userId: identity.ownerId,
        curriculumId: curriculum.id,
        nativeLang: 'es',
        targetLang: 'ru',
      },
    });
    const target = await instance.database.learnerFocusTarget.create({
      data: { courseId: course.id, kind: 'WORD', text: 'чай', normalizedText: 'чай' },
    });
    const otherTarget = await instance.database.learnerFocusTarget.create({
      data: { courseId: course.id, kind: 'WORD', text: 'вода', normalizedText: 'вода' },
    });
    const backend = await captureStorageBackend();
    const key = `visual-cues/${randomUUID()}.png`;
    const reference = await backend.writeBuffer(key, Buffer.from('stored image'), 'image/png');
    const consumer = `focus-target:${target.id}:visual`;
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const registered = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
        registered
      );
      const ownership = await captureFocusTargetStorage(database, target.id);
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [
          { consumer, previousReference: null },
          { consumer: `focus-target:${otherTarget.id}:visual`, previousReference: null },
        ],
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: '/api/v1/storage',
          target: { backendId: registered.id, binding: registered.binding, key },
          scopes: ownership.scopes,
        }),
      });
      await database.learnerFocusTarget.update({
        where: { id: target.id },
        data: { visualCueUrl: reference },
      });
      await database.learnerFocusTarget.update({
        where: { id: otherTarget.id },
        data: { visualCueUrl: reference },
      });
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          photos: [{ src: { landscape: 'https://images.pexels.com/new.jpg' } }],
        }),
      })
    );
    await addVisualCue(
      course.id,
      identity.ownerId,
      target.id,
      authorizedLearnerExecution(identity.ownerId)
    );
    const result = await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const registry = new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID);
      return {
        reference: await registry.readReference(reference),
        retirements: await registry.listRetirements(),
      };
    });
    expect(result.reference?.asset.consumers).not.toContain(consumer);
    expect(result.reference?.asset.consumers).toContain(`focus-target:${otherTarget.id}:visual`);
    expect(await backend.has(key)).toBe(true);
    expect(result.retirements.retirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ consumer, previousReference: reference, status: 'pending' }),
      ])
    );
    expect(
      await instance.database.learnerFocusTarget.findUniqueOrThrow({ where: { id: target.id } })
    ).toMatchObject({
      visualCueUrl: 'https://images.pexels.com/new.jpg',
    });
    await deleteCourseCompletely(course.id);
    expect(await backend.has(key)).toBe(false);
  }, 60_000);
});
