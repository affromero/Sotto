import { randomUUID } from 'node:crypto';
import { it, expect } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import { setSiteConfig } from '@/lib/site-config';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  requestClassPreparation,
  cancelClassPreparation,
  classPreparationStore,
  settleCancelledPreparation,
} from '@/lib/classes/preparation';
import { hasUnsettledSpeakingReferenceWrites } from '@/lib/classes/speaking/speaking-write-settlement';
import {
  StorageBackendRegistry,
  StorageWriteJournal,
  prepareStorageBackend,
  prepareStorageWrite,
  storageBackendBinding,
} from 'thesidedoor-core/storage';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type {
  SharedTestInstance,
  SharedTestIdentity,
} from '../../../../helpers/setup/shared-instance';
import type { createRepairTarget } from './repair-target';

export function registerSpeakingCleanupCases(
  getContext: () => {
    instance: SharedTestInstance;
    identity: SharedTestIdentity;
    courseId: string;
    execution: SottoProviderExecution;
    repairTarget: () => ReturnType<typeof createRepairTarget>;
  }
) {
  it('keeps speaking repair cleanup fenced until its retained storage intent is resolved', async () => {
    const { instance, courseId } = getContext();
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    const location = {
      kind: 'object' as const,
      endpoint: 'https://storage.example',
      bucket: 'private',
    };
    const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, {
      kind: 'object',
      location,
      binding: storageBackendBinding(location),
    });
    const speaking = prepareStorageWrite({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `course:${courseId}`,
      generation: course.createdAt.getTime(),
      target: {
        backendId: backend.id,
        binding: backend.binding,
        key: `speaking-ref/prompt/${randomUUID()}.bin`,
      },
    });
    const unrelated = prepareStorageWrite({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `course:${courseId}`,
      generation: course.createdAt.getTime(),
      target: {
        backendId: backend.id,
        binding: backend.binding,
        key: `worksheet/${randomUUID()}.pdf`,
      },
    });
    const neverCreated = prepareStorageWrite({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `course:${courseId}`,
      generation: course.createdAt.getTime(),
      target: {
        backendId: backend.id,
        binding: backend.binding,
        key: `speaking-ref/other/${randomUUID()}.bin`,
      },
    });
    const journal = (database: Parameters<typeof hasUnsettledSpeakingReferenceWrites>[0]) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      return {
        writes: new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID),
        registry: new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID),
      };
    };
    await sottoTransaction(instance.database, async (database) => {
      const { writes, registry } = journal(database);
      await registry.register(backend);
      await writes.begin(unrelated, course.createdAt.getTime());
      expect(await hasUnsettledSpeakingReferenceWrites(database, courseId)).toBe(false);
      await writes.begin(neverCreated, course.createdAt.getTime());
      expect(await hasUnsettledSpeakingReferenceWrites(database, courseId)).toBe(true);
      await writes.finish(neverCreated, { kind: 'not_created' });
      expect(await hasUnsettledSpeakingReferenceWrites(database, courseId)).toBe(false);
      await writes.begin(speaking, course.createdAt.getTime());
      expect(await hasUnsettledSpeakingReferenceWrites(database, courseId)).toBe(true);
      await writes.finish(speaking, { kind: 'uncertain' });
      expect(await hasUnsettledSpeakingReferenceWrites(database, courseId)).toBe(true);
      await writes.resolveUncertain(speaking, { kind: 'stopped_writer', id: 'verified-stop' });
      expect(await hasUnsettledSpeakingReferenceWrites(database, courseId)).toBe(true);
    });
  });
  it('does not complete a cancelled speaking repair while its storage write is unresolved', async () => {
    const { instance, identity, courseId, execution, repairTarget } = getContext();
    const { cls } = await repairTarget();
    await setSiteConfig(
      {
        ttsProvider: 'local',
        ttsBaseUrl: 'http://local-tts:8000',
        sttProvider: 'local',
        sttBaseUrl: 'http://local-stt:8000',
      },
      identity.ownerId
    );
    await instance.database.user.update({
      where: { id: identity.ownerId },
      data: { preferredTtsProvider: 'local' },
    });
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'en',
      targetLang: 'de',
      level: 'A1',
      ttsProvider: 'local',
      sttProvider: 'local',
    });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: { skillRequirements: requirements },
    });
    const operation = await requestClassPreparation(courseId, execution, {
      intent: { kind: 'REPAIR', classId: cls.id, expectedAttempt: cls.attempt },
    });
    expect(operation.intent?.skills).toContain('SPEAKING');
    const course = await instance.database.course.findUniqueOrThrow({ where: { id: courseId } });
    const location = {
      kind: 'object' as const,
      endpoint: 'https://storage.example',
      bucket: 'private',
    };
    const backend = prepareStorageBackend(SIDEDOOR_STATE_ID, {
      kind: 'object',
      location,
      binding: storageBackendBinding(location),
    });
    const intent = prepareStorageWrite({
      namespace: SIDEDOOR_STATE_ID,
      subjectId: `course:${courseId}`,
      generation: course.createdAt.getTime(),
      target: {
        backendId: backend.id,
        binding: backend.binding,
        key: `speaking-ref/prompt/${randomUUID()}.bin`,
      },
    });
    const journal = (database: Parameters<typeof hasUnsettledSpeakingReferenceWrites>[0]) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      return {
        writes: new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID),
        registry: new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID),
      };
    };
    await sottoTransaction(instance.database, async (database) => {
      const { writes, registry } = journal(database);
      await registry.register(backend);
      await writes.begin(intent, course.createdAt.getTime());
    });
    expect((await cancelClassPreparation(courseId, execution))?.status).toBe('UNRESOLVED');
    expect(
      (
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).read(operation.id)
        )
      )?.complete
    ).toBe(false);
    await sottoTransaction(instance.database, (database) =>
      journal(database).writes.finish(intent, { kind: 'not_created' })
    );
    const settled = await sottoTransaction(instance.database, async (database) => {
      const current = await classPreparationStore(database, courseId).read();
      if (!current) throw new Error('Missing operation');
      return settleCancelledPreparation(database, current);
    });
    expect(settled.status).toBe('CANCELLED');
    expect(
      (
        await sottoTransaction(instance.database, (database) =>
          sottoJobOutbox(database).read(operation.id)
        )
      )?.complete
    ).toBe(true);
  });
}
