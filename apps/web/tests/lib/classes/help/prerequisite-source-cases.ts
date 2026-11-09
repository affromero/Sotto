import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  readPrerequisiteSource,
  requirePrerequisiteSource,
} from '@/lib/classes/help/content/prerequisite-source';
import { admitPrerequisiteWork } from '@/lib/classes/help/lifecycle/prerequisite-admission';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { readPrerequisiteStatus } from '@/lib/classes/help/prerequisite-status';
import type { Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { assessmentFixture } from '../../learning-map/evidence/evidence-fixtures';
import type {
  SharedTestIdentity,
  SharedTestInstance,
} from '../../../helpers/setup/shared-instance';

export function prerequisiteSourceCases(
  fixture: () => {
    instance: SharedTestInstance;
    identity: SharedTestIdentity;
    classId: string;
    questionId: string;
    writingPromptId: string;
  }
) {
  it('rejects an oversized review before admitting provider work', async () => {
    const { instance, identity, classId } = fixture();
    const question = await instance.database.lessonQuestion.findFirstOrThrow({
      where: { section: { classId } },
    });
    await instance.database.lessonQuestion.update({
      where: { id: question.id },
      data: { question: 'a'.repeat(22_000) },
    });
    const operationId = randomUUID();
    await expect(
      sottoTransaction(instance.database, (database) =>
        admitPrerequisiteWork(database, {
          id: operationId,
          revision: randomUUID(),
          classId,
          userId: identity.ownerId,
          expiresAt: Date.now() + 60_000,
          selection: {
            provider: 'fixture',
            model: 'fixture',
            credentialFingerprint: null,
            moderationCredentialFingerprint: null,
          },
          authorize: async () => ({ userId: identity.ownerId }),
        })
      )
    ).rejects.toThrow('too large to review safely');
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(operationId)
      )
    ).toBeNull();
  });
  it('exposes speaking task mode without exposing private assessment criteria', async () => {
    const { instance, identity, classId } = fixture();
    const section = await instance.database.classSection.create({
      data: { classId, skill: 'SPEAKING', attempt: 1, status: 'READY', seed: 'speaking', spec: {} },
    });
    await instance.database.speakingPrompt.createMany({
      data: [
        { sectionId: section.id, order: 1, targetPhrase: 'Привет', translation: 'Hola' },
        {
          sectionId: section.id,
          order: 2,
          targetPhrase: 'Pide una bebida.',
          translation: 'Sé cortés.',
          learningObjectives: assessmentFixture('SPEAKING'),
        },
      ],
    });
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    expect(captured.source.sections.find((item) => item.id === section.id)?.speaking).toEqual([
      expect.objectContaining({ taskMode: 'READ_ALOUD' }),
      expect.objectContaining({ taskMode: 'COMMUNICATIVE' }),
    ]);
    expect(JSON.stringify(captured.source)).not.toContain('Formulate a polite request');
  });
  it('exposes only public task material and fences changes to private assessment content', async () => {
    const { instance, identity, classId, questionId, writingPromptId } = fixture();
    const read = () =>
      sottoTransaction(instance.database, (database) =>
        readPrerequisiteSource(database, classId, identity.ownerId)
      );
    const first = await read();
    const publicText = JSON.stringify(first.source);
    expect(publicText).toContain('Pide té con cortesía.');
    expect(publicText).not.toContain('PRIVATE_');
    expect(publicText).not.toContain('correctIndex');
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { writingDrafts: { private: 'CHANGED_DRAFT' }, progressRevision: { increment: 1 } },
    });
    expect((await read()).hash).toBe(first.hash);
    await sottoTransaction(instance.database, (database) =>
      requirePrerequisiteSource(database, first, first.ownership)
    );
    await instance.database.writingPrompt.update({
      where: { id: writingPromptId },
      data: { ideas: ['CHANGED_OPTIONAL_OPENING'] },
    });
    await expect(
      sottoTransaction(instance.database, (database) =>
        requirePrerequisiteSource(database, first, first.ownership)
      )
    ).rejects.toThrow('changed');
    const changed = await read();
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { correctIndex: 1 },
    });
    expect((await read()).hash).not.toBe(changed.hash);
  });
}

export async function assertTamperedDirectionsAreHidden(
  instance: SharedTestInstance,
  identity: SharedTestIdentity,
  classId: string
) {
  const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
  const tampered = JSON.parse(JSON.stringify(cls.adaptiveSeed)) as {
    prerequisiteAddendum: { content: { directions: { tasks: Array<{ instruction: string }> } } };
  };
  tampered.prerequisiteAddendum.content.directions.tasks[0]!.instruction = 'Unreviewed instruction';
  await instance.database.courseClass.update({
    where: { id: classId },
    data: { adaptiveSeed: tampered },
  });
  await expect(
    sottoTransaction(instance.database, (database) =>
      readPrerequisiteStatus(database, classId, identity.ownerId)
    )
  ).rejects.toThrow('already active or needs recovery');
  await instance.database.courseClass.update({
    where: { id: classId },
    data: { adaptiveSeed: cls.adaptiveSeed as Prisma.InputJsonValue },
  });
}
