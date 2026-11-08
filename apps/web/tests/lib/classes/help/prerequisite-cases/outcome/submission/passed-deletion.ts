import { expect } from 'vitest';
import { LocalStorageCleanup } from 'thesidedoor-core/storage';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { capturedLocalBackend } from '@/lib/storage/sidedoor/captured-local';
import { LOCAL_STORAGE_URL_PREFIX } from '@/lib/r2';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import {
  assessmentFenceBackend,
  assessmentFenceStore,
} from '@/lib/learning/classes/lifecycle/assessment-fence';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../../../helpers/setup/shared-instance';

interface PassedSubmissionContext {
  root: string;
  instance: SharedTestInstance;
  cls: { courseId: string };
  identity: SharedTestIdentity;
  classId: string;
  operation: { id: string; fingerprint: string };
  writing: { items: unknown[] };
  other: { id: string };
}

export async function checkPassedAssessmentDeletion({
  root,
  instance,
  cls,
  identity,
  classId,
  operation,
  writing,
  other,
}: PassedSubmissionContext) {
  const {
    inspectPrerequisiteDeletion,
    admitPrerequisiteClassDeletion,
    recoverPrerequisiteClassDeletion,
  } = await import('@/lib/classes/help/prerequisite-deletion');
  const backend = await capturedLocalBackend(
    await LocalStorageCleanup.capture(root),
    root,
    LOCAL_STORAGE_URL_PREFIX,
    () => {}
  );
  const { admitLearningStorageDeletion } =
    await import('@/lib/sidedoor/access/deletion/learning-deletion');
  const course = await instance.database.course.findUniqueOrThrow({
    where: { id: cls.courseId },
  });
  const owner = await instance.database.user.findUniqueOrThrow({
    where: { id: identity.ownerId },
  });
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await assessmentFenceStore(assessmentFenceBackend(tx, classId)).transact((state) => {
        state.current = null;
      });
      const inventory = await inspectPrerequisiteDeletion(
        tx,
        classId,
        cls.courseId,
        identity.ownerId
      );
      expect(inventory.assessmentOperations).toEqual([operation]);
      expect(inventory.writingOperations).toHaveLength(writing.items.length);
      throw new Error('Roll back retired assessment fence');
    })
  ).rejects.toThrow('Roll back retired assessment fence');
  for (const parent of ['course', 'profile'] as const) {
    await expect(
      sottoTransaction(instance.database, async (tx) => {
        const inventory = await inspectPrerequisiteDeletion(
          tx,
          classId,
          cls.courseId,
          identity.ownerId
        );
        await admitLearningStorageDeletion({
          database: tx,
          scope:
            parent === 'course'
              ? { kind: 'course', id: course.id, episodeIds: [] }
              : { kind: 'profile', id: owner.id },
          subjects: [
            parent === 'course'
              ? {
                  subjectId: `course:${course.id}`,
                  generation: course.createdAt.getTime(),
                }
              : {
                  subjectId: `profile:${owner.id}`,
                  generation: owner.createdAt.getTime(),
                },
          ],
          currentBackend: backend,
        });
        if (parent === 'course') await tx.course.delete({ where: { id: course.id } });
        else await tx.user.delete({ where: { id: owner.id } });
        for (const item of inventory.writingOperations) {
          expect(await sottoJobOutbox(tx).receipt(item.id)).toMatchObject({
            status: 'erased',
          });
          expect(
            await tx.sidedoorState.findUnique({
              where: { id: `${SIDEDOOR_STATE_ID}:writing-grant:${item.id}` },
            })
          ).toBeNull();
        }
        throw new Error('Roll back broader deletion');
      })
    ).rejects.toThrow('Roll back broader deletion');
  }
  const deleted = await sottoTransaction(instance.database, async (tx) => {
    const inventory = await inspectPrerequisiteDeletion(
      tx,
      classId,
      cls.courseId,
      identity.ownerId
    );
    expect(inventory.assessmentOperations).toEqual([operation]);
    expect(inventory.writingOperations).toHaveLength(writing.items.length);
    await admitPrerequisiteClassDeletion(tx, inventory, backend);
    await tx.courseClass.delete({ where: { id: classId } });
    return inventory.writingOperations;
  });
  expect(await instance.database.writingResponse.count()).toBe(0);
  for (const item of deleted) {
    expect(
      await sottoTransaction(instance.database, (tx) => sottoJobOutbox(tx).receipt(item.id))
    ).toMatchObject({ status: 'erased', fingerprint: item.fingerprint });
    expect(
      await instance.database.sidedoorState.findUnique({
        where: { id: `${SIDEDOOR_STATE_ID}:assessment-writing-launch:${item.id}` },
      })
    ).toBeNull();
    expect(
      await instance.database.sidedoorState.findUnique({
        where: { id: `${SIDEDOOR_STATE_ID}:writing-grant:${item.id}` },
      })
    ).toBeNull();
  }
  expect(
    await sottoTransaction(instance.database, (tx) =>
      recoverPrerequisiteClassDeletion(tx, classId, identity.ownerId)
    )
  ).toMatchObject({ id: expect.any(String) });
  expect(
    await sottoTransaction(instance.database, (tx) =>
      recoverPrerequisiteClassDeletion(tx, classId, other.id)
    )
  ).toBeNull();
  await expect(
    sottoTransaction(instance.database, async (tx) => {
      await tx.user.update({
        where: { id: identity.ownerId },
        data: { createdAt: new Date(owner.createdAt.getTime() + 1) },
      });
      expect(await recoverPrerequisiteClassDeletion(tx, classId, identity.ownerId)).toBeNull();
      throw new Error('Roll back recreated profile');
    })
  ).rejects.toThrow('Roll back recreated profile');
}
