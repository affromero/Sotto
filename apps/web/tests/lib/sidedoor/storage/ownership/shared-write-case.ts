import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  prepareStorageBackend,
  prepareStorageReference,
  prepareStorageWrite,
  StorageBackendRegistry,
  StorageReferenceRegistry,
  StorageWriteJournal,
} from 'thesidedoor-core/storage';
import { captureStorageBackend } from '@/lib/r2';
import { setSiteConfig } from '@/lib/site-config';
import { admitLearningStorageDeletion } from '@/lib/sidedoor/access/deletion/learning-deletion';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../../helpers/setup/shared-instance';

export function registerSharedWriteCase(
  getContext: () => { instance: SharedTestInstance; identity: SharedTestIdentity; roots: string[] }
) {
  it('preserves a shared asset even when the deleted course retains a write intent for it', async () => {
    const { instance, identity, roots } = getContext();
    const root = await mkdtemp(join(tmpdir(), 'sotto-cleanup-shared-write-'));
    roots.push(root);
    await setSiteConfig({ storageProvider: 'local', localStorageRoot: root }, identity.ownerId);
    const curriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'fr', targetLang: 'de' } },
      create: { nativeLang: 'fr', targetLang: 'de', title: 'German' },
      update: {},
    });
    const secondCurriculum = await instance.database.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'fr', targetLang: 'es' } },
      create: { nativeLang: 'fr', targetLang: 'es', title: 'Spanish' },
      update: {},
    });
    const makeCourse = (selected: typeof curriculum) =>
      instance.database.course.create({
        data: {
          userId: identity.ownerId,
          curriculumId: selected.id,
          nativeLang: 'fr',
          targetLang: selected.targetLang,
        },
      });
    const [removedCourse, retainedCourse] = await Promise.all([
      makeCourse(curriculum),
      makeCourse(secondCurriculum),
    ]);
    const makeFocus = (courseId: string) =>
      instance.database.learnerFocusTarget.create({
        data: { courseId, kind: 'WORD', text: 'Tee', normalizedText: 'tee' },
      });
    const [removedFocus, retainedFocus] = await Promise.all([
      makeFocus(removedCourse.id),
      makeFocus(retainedCourse.id),
    ]);
    const backend = await captureStorageBackend();
    const key = `visual-cues/${randomUUID()}.png`;
    const reference = await backend.writeBuffer(
      key,
      new TextEncoder().encode('shared'),
      'image/png'
    );
    await sottoTransaction(instance.database, async (database) => {
      const executor = {
        query: (sql: string, values: readonly unknown[]) =>
          database.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...values),
      };
      const registered = prepareStorageBackend(SIDEDOOR_STATE_ID, backend.descriptor);
      await new StorageBackendRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).register(
        registered
      );
      const target = { backendId: registered.id, binding: registered.binding, key };
      const scopes = [removedCourse, retainedCourse].map((course) => ({
        subjectId: `course:${course.id}`,
        generation: course.createdAt.getTime(),
      }));
      const intent = prepareStorageWrite({ namespace: SIDEDOOR_STATE_ID, ...scopes[0]!, target });
      const writes = new StorageWriteJournal(executor, 'postgres', SIDEDOOR_STATE_ID);
      await writes.begin(intent, scopes[0]!.generation);
      await new StorageReferenceRegistry(executor, 'postgres', SIDEDOOR_STATE_ID).replaceMany({
        consumers: [removedFocus, retainedFocus].map((focus) => ({
          consumer: `focus-target:${focus.id}:visual`,
          previousReference: null,
        })),
        next: prepareStorageReference({
          namespace: SIDEDOOR_STATE_ID,
          operationId: randomUUID(),
          reference,
          localRoutePrefix: '/api/v1/storage',
          target,
          scopes,
        }),
      });
      await writes.finish(intent, { kind: 'unreferenced' });
      await database.learnerFocusTarget.updateMany({
        where: { id: { in: [removedFocus.id, retainedFocus.id] } },
        data: { visualCueUrl: reference },
      });
    });
    await expect(
      sottoTransaction(instance.database, async (database) => {
        await admitLearningStorageDeletion({
          database,
          scope: { kind: 'course', id: removedCourse.id, episodeIds: [] },
          subjects: [
            {
              subjectId: `course:${removedCourse.id}`,
              generation: removedCourse.createdAt.getTime(),
            },
          ],
          currentBackend: backend,
        });
        await database.course.delete({ where: { id: removedCourse.id } });
      })
    ).rejects.toThrow('Storage write intent targets an asset with surviving consumers');
    expect(await readFile(join(root, key), 'utf8')).toBe('shared');
    expect(
      await instance.database.course.findUnique({ where: { id: removedCourse.id } })
    ).not.toBeNull();
    expect(
      await instance.database.learnerFocusTarget.findUniqueOrThrow({
        where: { id: retainedFocus.id },
      })
    ).toMatchObject({ visualCueUrl: reference });
  });
}
