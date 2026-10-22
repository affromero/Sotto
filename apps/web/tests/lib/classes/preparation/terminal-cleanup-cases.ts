import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { ClassPreparation } from '@/lib/classes/preparation-state';
import {
  cancelClassPreparation,
  classPreparationStore,
  recordClassPreparationFailure,
  requestClassPreparation,
  readClassPreparation,
  preparationProgress,
} from '@/lib/classes/preparation';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobExecutions } from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { SharedTestInstance } from '../../../helpers/setup/shared-instance';

interface Context {
  instance: SharedTestInstance;
  courseId: string;
  execution: SottoProviderExecution;
  running: () => Promise<ClassPreparation>;
  lesson: () => Promise<{ id: string }>;
}

export function registerTerminalCleanupTests(context: () => Context) {
  it.each([{}, { sourceUrl: 'https://example.com/article' }, { topic: 'Sustainable travel' }])(
    'restores the exact admitted initial source without persisting projection fields: %j',
    async (source) => {
      const { instance, courseId, execution } = context();
      const operation = await requestClassPreparation(courseId, execution, source);
      const restored = await readClassPreparation(courseId, execution.userId);
      expect(restored && preparationProgress(restored)).toMatchObject({
        operationId: operation.id,
        initialPreparation: { sourceUrl: source.sourceUrl ?? null, topic: source.topic ?? null },
      });
      const stored = await classPreparationStore(instance.database, courseId).read();
      expect(stored).not.toHaveProperty('initialPreparation');
    }
  );

  async function fixture(active = false) {
    const { instance, courseId, running, lesson } = context();
    const operation = await running();
    const cls = await instance.database.courseClass.create({
      data: { courseId, lessonId: (await lesson()).id, order: 1, status: 'GENERATING' },
    });
    const binding = await sottoTransaction(instance.database, async (database) => {
      const current = await classPreparationStore(database, courseId).transact((state) => {
        if (!state) throw new Error('Missing preparation fixture');
        state.classId = cls.id;
        return state;
      });
      const receipt = await sottoJobOutbox(database).read(operation.id);
      if (!receipt) throw new Error('Missing preparation receipt');
      const execution = {
        id: randomUUID(),
        parentId: operation.id,
        fingerprint: receipt.fingerprint,
        executorId: randomUUID(),
      };
      if (active) await sottoJobExecutions(database).begin(execution);
      await recordClassPreparationFailure(database, current, receipt.fingerprint, false);
      return execution;
    });
    return { cls, binding, target: { operationId: operation.id, classId: cls.id } };
  }

  it('removes only the exact unpublished failed class after execution drains and can confirm removal again', async () => {
    const { instance, courseId, execution, lesson } = context();
    const { cls, binding, target } = await fixture(true);
    const other = await instance.database.courseClass.create({
      data: { courseId, lessonId: (await lesson()).id, order: 2, status: 'AVAILABLE' },
    });
    await instance.database.course.update({
      where: { id: courseId },
      data: { activeClassId: cls.id },
    });
    await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/cleanup/i);
    await expect(
      requestClassPreparation(courseId, execution, {
        expectedPreviousPreparation: target,
      })
    ).rejects.toThrow(/cleanup/i);
    expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toMatchObject(
      { status: 'GENERATING' }
    );
    await sottoTransaction(instance.database, (database) =>
      sottoJobExecutions(database).settle(binding)
    );
    for (let confirmation = 0; confirmation < 2; confirmation++) {
      expect(await cancelClassPreparation(courseId, execution, target)).toMatchObject({
        id: target.operationId,
        status: 'FAILED',
      });
      expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toBeNull();
    }
    expect(
      await instance.database.courseClass.findUnique({ where: { id: other.id } })
    ).toMatchObject({ status: 'AVAILABLE' });
    expect(await instance.database.course.findUnique({ where: { id: courseId } })).toMatchObject({
      activeClassId: null,
    });
  });

  it.each(['FAILED', 'CANCELLED'] as const)(
    'retries an exact %s initial preparation without retaining its unpublished class',
    async (status) => {
      const { instance, courseId, execution } = context();
      const { cls, target } = await fixture();
      await sottoTransaction(instance.database, (database) =>
        classPreparationStore(database, courseId).transact((state) => {
          if (!state) throw new Error('Missing preparation fixture');
          state.status = status;
        })
      );
      const next = await requestClassPreparation(courseId, execution, {
        expectedPreviousPreparation: target,
      });
      expect(next.id).not.toBe(target.operationId);
      expect(next.status).toBe('QUEUED');
      expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toBeNull();
    }
  );

  it.each(['operation', 'class', 'RUNNING', 'UNRESOLVED', 'published'] as const)(
    'rejects stale or unsafe %s targets without deleting or admitting work',
    async (change) => {
      const { instance, courseId, execution } = context();
      const { cls, target } = await fixture();
      if (change === 'operation') target.operationId = randomUUID();
      else if (change === 'class') target.classId = randomUUID();
      else
        await sottoTransaction(instance.database, (database) =>
          classPreparationStore(database, courseId).transact((state) => {
            if (!state) throw new Error('Missing preparation fixture');
            if (change === 'published') state.result = 'created';
            else state.status = change;
          })
        );
      await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/changed/i);
      await expect(
        requestClassPreparation(courseId, execution, { expectedPreviousPreparation: target })
      ).rejects.toThrow(/changed/i);
      expect(
        await instance.database.courseClass.findUnique({ where: { id: cls.id } })
      ).toMatchObject({ status: 'GENERATING' });
      expect(
        (await instance.database.courseClass.findMany({ where: { courseId } })).map((row) => row.id)
      ).toEqual([cls.id]);
    }
  );

  it('keeps failed regeneration material outside initial preparation cleanup and next admission', async () => {
    const { instance, courseId, execution, lesson } = context();
    const cls = await instance.database.courseClass.create({
      data: { courseId, lessonId: (await lesson()).id, order: 1, status: 'FAILED' },
    });
    const operation = await requestClassPreparation(courseId, execution, {
      intent: { kind: 'REGENERATE', classId: cls.id, expectedAttempt: 1 },
    });
    await sottoTransaction(instance.database, async (database) => {
      const receipt = await sottoJobOutbox(database).read(operation.id);
      if (!receipt) throw new Error('Missing preparation receipt');
      await recordClassPreparationFailure(database, operation, receipt.fingerprint, false);
    });
    const target = { operationId: operation.id, classId: cls.id };
    await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/changed/);
    await expect(
      requestClassPreparation(courseId, execution, { expectedPreviousPreparation: target })
    ).rejects.toThrow(/changed/);
    expect(await instance.database.courseClass.findUnique({ where: { id: cls.id } })).toMatchObject(
      { status: 'GENERATING', attempt: 2 }
    );
    expect(await readClassPreparation(courseId, execution.userId)).not.toHaveProperty(
      'initialPreparation'
    );
  });

  it.each(['AVAILABLE', 'FAILED'] as const)(
    'retains a %s class that is no longer an unpublished generation',
    async (status) => {
      const { instance, courseId, execution } = context();
      const { cls, target } = await fixture();
      await instance.database.courseClass.update({ where: { id: cls.id }, data: { status } });
      await expect(cancelClassPreparation(courseId, execution, target)).rejects.toThrow(/cleanup/);
      await expect(
        requestClassPreparation(courseId, execution, { expectedPreviousPreparation: target })
      ).rejects.toThrow(/changed/);
      expect(
        await instance.database.courseClass.findUnique({ where: { id: cls.id } })
      ).toMatchObject({ status });
    }
  );

  it.each(
    (['REGENERATE', 'REPAIR'] as const).flatMap((kind) =>
      (['FAILED', 'CANCELLED', 'UNRESOLVED'] as const).map((status) => ({ kind, status }))
    )
  )(
    'reconciles $status $kind only after confirmed execution cleanup and preserves its material',
    async ({ kind, status }) => {
      const { instance, courseId, execution, lesson } = context();
      const cls = await instance.database.courseClass.create({
        data: { courseId, lessonId: (await lesson()).id, order: 1, status: 'FAILED' },
      });
      const operation = await requestClassPreparation(courseId, execution, {
        intent: { kind, classId: cls.id, expectedAttempt: 1 },
      });
      const section = await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'GRAMMAR',
          attempt: 2,
          status: 'READY',
          seed: 'retained-worked-example',
          spec: { example: 'Ich finde das gut, weil es hilft.' },
        },
      });
      const binding = await sottoTransaction(instance.database, async (database) => {
        const receipt = await sottoJobOutbox(database).read(operation.id);
        if (!receipt) throw new Error('Missing preparation receipt');
        const active = {
          id: randomUUID(),
          parentId: operation.id,
          fingerprint: receipt.fingerprint,
          executorId: randomUUID(),
        };
        await sottoJobExecutions(database).begin(active);
        await classPreparationStore(database, courseId).transact((state) => {
          if (!state) throw new Error('Missing preparation fixture');
          state.status = status === 'CANCELLED' ? 'CANCELLING' : 'RUNNING';
        });
        await recordClassPreparationFailure(
          database,
          operation,
          receipt.fingerprint,
          status === 'UNRESOLVED'
        );
        return active;
      });
      expect(await readClassPreparation(courseId, execution.userId)).toMatchObject({
        id: operation.id,
        status,
      });
      expect(
        await instance.database.courseClass.findUnique({ where: { id: cls.id } })
      ).toMatchObject({ status: 'GENERATING', attempt: 2 });
      await sottoTransaction(instance.database, (database) =>
        sottoJobExecutions(database).settle(binding)
      );
      expect(await readClassPreparation(courseId, execution.userId)).toMatchObject({
        id: operation.id,
        status,
      });
      expect(
        await instance.database.courseClass.findUnique({ where: { id: cls.id } })
      ).toMatchObject({
        status: status === 'UNRESOLVED' ? 'GENERATING' : 'FAILED',
        attempt: 2,
      });
      expect(
        await instance.database.classSection.findUnique({ where: { id: section.id } })
      ).toMatchObject({
        status: 'READY',
        seed: 'retained-worked-example',
        spec: { example: 'Ich finde das gut, weil es hilft.' },
      });
    }
  );
}
