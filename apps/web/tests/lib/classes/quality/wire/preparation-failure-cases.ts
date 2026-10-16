import { expect, it } from 'vitest';
import { z } from 'zod';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import {
  classPreparationStore,
  readPreparationActivity,
  recordClassPreparationFailure,
} from '@/lib/classes/preparation';
import type { ClassPreparation } from '@/lib/classes/preparation-state';
import { generationFailureSchema } from '@/lib/classes/quality/generation-failure';
import {
  readLearningFailure,
  writeLearningFailure,
} from '@/lib/classes/quality/teaching-failure-store';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type { SharedTestInstance } from '../../../../helpers/setup/shared-instance';
import { lessonFailureFixture } from './failure-fixture';

interface FailureContext {
  instance: SharedTestInstance;
  courseId: string;
  execution: SottoProviderExecution;
  running: () => Promise<ClassPreparation>;
  lesson: () => Promise<{ id: string }>;
}

export function registerLearningFailureWireTests(context: () => FailureContext) {
  it('seals the compatible lesson diagnostic once and refuses a changed diagnosis', async () => {
    const { instance, courseId, execution, running, lesson } = context();
    const admitted = await running();
    const cls = await instance.database.courseClass.create({
      data: { courseId, lessonId: (await lesson()).id, status: 'GENERATING', order: 1 },
    });
    const operation = await sottoTransaction(instance.database, (database) =>
      classPreparationStore(database, courseId).transact((state) => {
        if (!state) throw new Error('Missing synthetic preparation');
        state.classId = cls.id;
        return state;
      })
    );
    const parent = await sottoTransaction(instance.database, (database) =>
      sottoJobOutbox(database).read(admitted.id)
    );
    if (!parent) throw new Error('Missing synthetic outbox');
    const { failure } = lessonFailureFixture();
    const original = structuredClone(failure);
    await sottoTransaction(instance.database, (database) =>
      recordClassPreparationFailure(
        database,
        operation,
        parent.fingerprint,
        false,
        'generation_failed',
        failure
      )
    );
    const failed = await classPreparationStore(instance.database, courseId).read();
    if (!failed) throw new Error('Missing failed preparation');
    const readSnapshot = () =>
      sottoTransaction(instance.database, (database) =>
        sottoJobSnapshot(database).read(admitted.id, parent.fingerprint, 0)
      );
    const first = await readSnapshot();
    const stored = z.object({ failure: generationFailureSchema }).parse(first.items[0]).failure;
    expect(stored.teachingFailure).toEqual({ ...failure.teachingFailure, kind: 'explanations' });
    expect(stored.protocolEvidence).toEqual([
      { ...failure.protocolEvidence![0], kind: 'explanations' },
    ]);
    expect(
      await sottoTransaction(instance.database, (database) => readLearningFailure(database, failed))
    ).toEqual(stored);
    await sottoTransaction(instance.database, (database) =>
      writeLearningFailure(database, failed, parent.fingerprint, failure)
    );
    expect(await readSnapshot()).toEqual(first);
    expect(failure).toEqual(original);
    const changed = structuredClone(failure);
    changed.teachingFailure!.reviews[0].verdict.items[0].feedback = [
      'A different teaching diagnosis.',
    ];
    await expect(
      sottoTransaction(instance.database, (database) =>
        writeLearningFailure(database, failed, parent.fingerprint, changed)
      )
    ).rejects.toThrow('sealed diagnostic');
    expect(await readSnapshot()).toEqual(first);
    const activity = await readPreparationActivity(courseId, execution);
    expect(activity).toMatchObject({
      status: 'FAILED',
      failureReason: expect.stringContaining('teaching review'),
    });
    expect(JSON.stringify(activity)).not.toContain('Synthetic teaching');
  });
}
