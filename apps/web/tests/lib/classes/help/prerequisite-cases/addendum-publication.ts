import { randomUUID } from 'node:crypto';
import { it, expect, type Mock } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';
import type {
  SharedTestInstance,
  SharedTestIdentity,
} from '../../../../helpers/setup/shared-instance';
import {
  readPrerequisiteSource,
  readCurrentPrerequisiteAddendum,
  rejectExactPrerequisiteAnswers,
} from '@/lib/classes/help/content/prerequisite-source';
import {
  generatePrerequisiteAddendum,
  publishPrerequisiteAddendum,
  publishPrerequisiteAddendumInTransaction,
} from '@/lib/classes/help/content/prerequisite-generation';
import { admitPrerequisiteWork } from '@/lib/classes/help/lifecycle/prerequisite-admission';
import {
  publishPrerequisiteOutcome,
  recoverPrerequisiteOutcome,
  startPrerequisiteWork,
} from '@/lib/classes/help/prerequisite-outcome';
import { readPrerequisiteStatus } from '@/lib/classes/help/prerequisite-status';
import { acknowledgePrerequisite } from '@/lib/classes/help/lifecycle/prerequisite-acknowledgment';
import { captureAssessmentGenerationSource } from '@/lib/learning/classes/material/assessment-source';

export function registerAddendumPublicationCases(
  getContext: () => {
    instance: SharedTestInstance;
    identity: SharedTestIdentity;
    classId: string;
    questionId: string;
    provider: { generate: Mock };
  }
) {
  it('generates and independently reviews a bound addendum without private keys or learner work', async () => {
    const { instance, identity, classId, questionId, provider } = getContext();
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { options: ['Чай, пожалуйста', 'Спасибо'], correctIndex: 0 },
    });
    const candidate = {
      title: 'Pedir con cortesía',
      explanation: 'Nombra la bebida y usa una fórmula de cortesía.',
      examples: [
        {
          target: 'Вода, пожалуйста',
          meaning: 'Agua, por favor',
          explanation: 'La fórmula expresa una petición.',
        },
      ],
    };
    const approved = {
      prerequisitesCovered: true,
      accurate: true,
      understandable: true,
      answersConcealed: true,
      issues: [],
    };
    provider.generate
      .mockResolvedValueOnce({ content: JSON.stringify(candidate), model: 'fixture' })
      .mockResolvedValueOnce({ content: JSON.stringify(approved), model: 'fixture' });
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    await expect(
      sottoTransaction(instance.database, (database) =>
        rejectExactPrerequisiteAnswers(database, captured, captured.ownership, [
          'Ответ: Чай, пожалуйста',
        ])
      )
    ).rejects.toThrow('could not be prepared safely');
    const execution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    const result = await generatePrerequisiteAddendum(captured, execution);
    expect(result).toMatchObject(candidate);
    expect(result.directions.tasks).toHaveLength(13);
    const messages = JSON.stringify(provider.generate.mock.calls);
    for (const secret of [
      'PRIVATE_GUIDED_ANSWER',
      'PRIVATE_GUIDED_EXPLANATION',
      'PRIVATE_ASSESSMENT_EXPLANATION',
      'PRIVATE_DRAFT',
      'PRIVATE_OPTIONAL_OPENING',
      'correctIndex',
    ])
      expect(messages).not.toContain(secret);
    expect(provider.generate.mock.calls[1][0]).toContain('Independently review');
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        writingDrafts: { private: 'LATEST_DRAFT' },
        learnerAnswers: { secret: 2 },
        progressRevision: { increment: 1 },
      },
    });
    await publishPrerequisiteAddendum(captured, execution, result);
    const saved = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    expect(saved.learnerAnswers).toEqual({ secret: 2 });
    expect(saved.writingDrafts).toEqual({ private: 'LATEST_DRAFT' });
    expect(saved.adaptiveSeed).toMatchObject({
      teaching: { guidedPractice: { answer: 'PRIVATE_GUIDED_ANSWER' } },
      prerequisiteAddendum: { version: 1, sourceHash: captured.sourceHash, content: result },
    });
    const after = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    expect(after.sourceHash).toBe(captured.sourceHash);
    expect(after.hash).not.toBe(captured.hash);
    await instance.database.classSection.updateMany({
      where: { classId, skill: 'GRAMMAR' },
      data: { status: 'PASSED' },
    });
    const progressed = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    expect(progressed.sourceHash).toBe(after.sourceHash);
    expect(progressed.hash).not.toBe(after.hash);
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { status: 'PASSED' },
    });
    const passed = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    expect(passed.sourceHash).toBe(after.sourceHash);
    await instance.database.courseClass.update({
      where: { id: classId },
      data: { status: 'FAILED' },
    });
    const failed = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    expect(failed.sourceHash).toBe(after.sourceHash);
    expect(
      await sottoTransaction(instance.database, (database) =>
        readCurrentPrerequisiteAddendum(database, classId, identity.ownerId)
      )
    ).toEqual({ status: 'READY', content: result });
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { question: 'Una pregunta nueva.' },
    });
    expect(
      await sottoTransaction(instance.database, (database) =>
        readCurrentPrerequisiteAddendum(database, classId, identity.ownerId)
      )
    ).toEqual({ status: 'STALE' });
    await expect(publishPrerequisiteAddendum(captured, execution, result)).rejects.toThrow(
      'review is no longer valid'
    );
  });

  it('rejects the guided answer even when the reviewer approves it', async () => {
    const { instance, identity, classId, provider } = getContext();
    provider.generate
      .mockResolvedValueOnce({
        content: JSON.stringify({
          title: 'Pedir',
          explanation: 'Pide la bebida.',
          examples: [
            { target: 'PRIVATE_GUIDED_ANSWER', meaning: 'Té, por favor', explanation: 'Petición.' },
          ],
        }),
        model: 'fixture',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          prerequisitesCovered: true,
          accurate: true,
          understandable: true,
          answersConcealed: true,
          issues: [],
        }),
        model: 'fixture',
      });
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    await expect(
      generatePrerequisiteAddendum(captured, {
        userId: identity.ownerId,
        authorize: async () => ({ userId: identity.ownerId }),
      })
    ).rejects.toThrow('could not be prepared safely');
  });

  it.each([
    'La opción A es correcta.',
    'The correct answer is B.',
    '2 es la respuesta.',
    'La respuesta A es correcta.',
    'La respuesta: A.',
    'The answer C.',
  ])('rejects an option-selection disclosure even if review approves: %s', async (explanation) => {
    const { instance, identity, classId, provider } = getContext();
    provider.generate
      .mockResolvedValueOnce({
        content: JSON.stringify({
          title: 'Pedir',
          explanation,
          examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Un ejemplo.' }],
        }),
        model: 'fixture',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          prerequisitesCovered: true,
          accurate: true,
          understandable: true,
          answersConcealed: true,
          issues: [],
        }),
        model: 'fixture',
      });
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    await expect(
      generatePrerequisiteAddendum(captured, {
        userId: identity.ownerId,
        authorize: async () => ({ userId: identity.ownerId }),
      })
    ).rejects.toThrow('could not be prepared safely');
  });

  it('rolls back publication if its enclosing durable transaction fails', async () => {
    const { instance, identity, classId, provider } = getContext();
    provider.generate
      .mockResolvedValueOnce({
        content: JSON.stringify({
          title: 'Pedir',
          explanation: 'Nombra el objeto.',
          examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Un ejemplo.' }],
        }),
        model: 'fixture',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          prerequisitesCovered: true,
          accurate: true,
          understandable: true,
          answersConcealed: true,
          issues: [],
        }),
        model: 'fixture',
      });
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    const execution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    const result = await generatePrerequisiteAddendum(captured, execution);
    await expect(
      sottoTransaction(instance.database, async (database) => {
        await publishPrerequisiteAddendumInTransaction(database, captured, execution, result);
        throw new Error('Outcome receipt could not be saved');
      })
    ).rejects.toThrow('Outcome receipt could not be saved');
    expect(
      await sottoTransaction(instance.database, (database) =>
        readCurrentPrerequisiteAddendum(database, classId, identity.ownerId)
      )
    ).toEqual({ status: 'UNAVAILABLE' });
    await publishPrerequisiteAddendum(captured, execution, result);
    expect(
      await sottoTransaction(instance.database, (database) =>
        readCurrentPrerequisiteAddendum(database, classId, identity.ownerId)
      )
    ).toEqual({ status: 'READY', content: result });
  });

  it('recovers a committed lesson without repeating generation after acknowledgement is lost', async () => {
    const { instance, identity, classId, questionId, provider } = getContext();
    provider.generate
      .mockResolvedValueOnce({
        content: JSON.stringify({
          title: 'Pedir',
          explanation: 'Nombra el objeto.',
          examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Un ejemplo.' }],
        }),
        model: 'fixture',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          prerequisitesCovered: true,
          accurate: true,
          understandable: true,
          answersConcealed: true,
          issues: [],
        }),
        model: 'fixture',
      });
    const execution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    const record = await sottoTransaction(instance.database, (database) =>
      admitPrerequisiteWork(database, {
        id: randomUUID(),
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
        authorize: execution.authorize,
      })
    );
    const operation = { id: record.job.id, fingerprint: record.fingerprint };
    await sottoTransaction(instance.database, (database) =>
      startPrerequisiteWork(database, operation)
    );
    const content = await generatePrerequisiteAddendum(captured, execution);
    await expect(
      sottoTransaction(instance.database, async (database) => {
        await publishPrerequisiteOutcome(database, operation, execution, content);
        throw new Error('Lost transaction');
      })
    ).rejects.toThrow('Lost transaction');
    expect(
      await sottoTransaction(instance.database, (database) =>
        recoverPrerequisiteOutcome(database, operation)
      )
    ).toBe(false);
    expect(
      await sottoTransaction(instance.database, (database) =>
        readCurrentPrerequisiteAddendum(database, classId, identity.ownerId)
      )
    ).toEqual({ status: 'UNAVAILABLE' });
    await sottoTransaction(instance.database, (database) =>
      publishPrerequisiteOutcome(database, operation, execution, content)
    );
    expect(
      await sottoTransaction(instance.database, (database) =>
        recoverPrerequisiteOutcome(database, operation)
      )
    ).toBe(true);
    const assessmentSource = (userId: string, classAttempt = 1) =>
      sottoTransaction(instance.database, (database) =>
        captureAssessmentGenerationSource(database, authorizedLearnerExecution(userId), {
          classId,
          classAttempt,
        })
      );
    await expect(assessmentSource(identity.ownerId)).rejects.toThrow(
      'Review the prerequisite teaching'
    );
    const status = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteStatus(database, classId, identity.ownerId)
    );
    if (status.status !== 'READY') throw new Error('Prerequisite fixture is not ready');
    await sottoTransaction(instance.database, (database) =>
      acknowledgePrerequisite(database, {
        classId,
        userId: identity.ownerId,
        sourceHash: status.request.sourceHash,
        receiptId: status.receiptId,
      })
    );
    const source = await assessmentSource(identity.ownerId);
    expect(source).toMatchObject({
      classId,
      classAttempt: 1,
      teachingReceipt: { kind: 'ADDENDUM', receiptId: status.receiptId },
      prerequisite: content,
      thresholds: { GRAMMAR: 0.7, READING: 0.7, WRITING: 0.7 },
    });
    expect(JSON.stringify(source.source)).not.toContain('PRIVATE_GUIDED_ANSWER');
    expect(JSON.stringify(source.source)).not.toContain('PRIVATE_GUIDED_EXPLANATION');
    expect(JSON.stringify(source.source)).not.toContain('PRIVATE_ASSESSMENT_EXPLANATION');
    expect(JSON.stringify(source.source)).not.toContain('PRIVATE_OPTIONAL_OPENING');
    expect(JSON.stringify(source.source)).not.toContain('PRIVATE_DRAFT');
    expect(JSON.stringify(source.source)).not.toContain('correctIndex');
    const savedClass = await instance.database.courseClass.findUniqueOrThrow({
      where: { id: classId },
    });
    const savedSeed = savedClass.adaptiveSeed as Prisma.JsonObject;
    const savedAddendum = savedSeed.prerequisiteAddendum as Prisma.JsonObject;
    const acknowledgment = savedAddendum.acknowledgment as Prisma.JsonObject;
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        adaptiveSeed: {
          ...savedSeed,
          prerequisiteAddendum: {
            ...savedAddendum,
            acknowledgment: { ...acknowledgment, receiptId: randomUUID() },
          },
        } as Prisma.InputJsonValue,
      },
    });
    await expect(assessmentSource(identity.ownerId)).rejects.toThrow(
      'Review the prerequisite teaching'
    );
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        adaptiveSeed: {
          ...savedSeed,
          prerequisiteAddendum: {
            ...savedAddendum,
            content: { ...content, explanation: 'Unreviewed change.' },
          },
        } as Prisma.InputJsonValue,
      },
    });
    await expect(assessmentSource(identity.ownerId)).rejects.toThrow();
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        adaptiveSeed: savedSeed as Prisma.InputJsonValue,
      },
    });
    await expect(assessmentSource(identity.ownerId, 2)).rejects.toThrow('class or attempt changed');
    const other = await identity.household('Other learner');
    await expect(assessmentSource(other.id)).rejects.toThrow('class or attempt changed');
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { question: 'Una pregunta nueva.' },
    });
    await expect(assessmentSource(identity.ownerId)).rejects.toThrow();
    expect(
      await sottoTransaction(instance.database, (database) =>
        recoverPrerequisiteOutcome(database, operation)
      )
    ).toBe(true);
    expect(
      await sottoTransaction(instance.database, (database) =>
        recoverPrerequisiteOutcome(database, operation)
      )
    ).toBe(true);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(operation.id)
      )
    ).toMatchObject({ complete: true });
    expect(
      await sottoTransaction(instance.database, (database) =>
        readCurrentPrerequisiteAddendum(database, classId, identity.ownerId)
      )
    ).toEqual({ status: 'STALE' });
  });

  it('does not publish reviewed teaching after the assessment changes', async () => {
    const { instance, identity, classId, questionId, provider } = getContext();
    provider.generate
      .mockResolvedValueOnce({
        content: JSON.stringify({
          title: 'Pedir',
          explanation: 'Nombra el objeto.',
          examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Un ejemplo.' }],
        }),
        model: 'fixture',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          prerequisitesCovered: true,
          accurate: true,
          understandable: true,
          answersConcealed: true,
          issues: [],
        }),
        model: 'fixture',
      });
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    const execution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    const result = await generatePrerequisiteAddendum(captured, execution);
    await instance.database.lessonQuestion.update({
      where: { id: questionId },
      data: { correctIndex: 1 },
    });
    await expect(publishPrerequisiteAddendum(captured, execution, result)).rejects.toThrow(
      'changed'
    );
    const saved = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    expect(JSON.stringify(saved.adaptiveSeed)).not.toContain('prerequisiteAddendum');
  });

  it('publishes the reviewed bytes even if the caller mutates its object during authorization', async () => {
    const { instance, identity, classId, provider } = getContext();
    const candidate = {
      title: 'Pedir',
      explanation: 'Nombra el objeto.',
      examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Un ejemplo.' }],
    };
    provider.generate
      .mockResolvedValueOnce({ content: JSON.stringify(candidate), model: 'fixture' })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          prerequisitesCovered: true,
          accurate: true,
          understandable: true,
          answersConcealed: true,
          issues: [],
        }),
        model: 'fixture',
      });
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    const execution = {
      userId: identity.ownerId,
      authorize: async () => ({ userId: identity.ownerId }),
    };
    const result = await generatePrerequisiteAddendum(captured, execution);
    const reviewed = structuredClone(result);
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const publishing = publishPrerequisiteAddendum(
      captured,
      {
        userId: identity.ownerId,
        authorize: async () => {
          entered();
          await waiting;
          return { userId: identity.ownerId };
        },
      },
      result
    );
    await started;
    result.explanation = 'UNREVIEWED_CONTENT';
    result.directions.tasks[0]!.instruction = 'UNREVIEWED_DIRECTION';
    release();
    await publishing;
    const saved = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    expect(saved.adaptiveSeed).toMatchObject({ prerequisiteAddendum: { content: reviewed } });
  });

  it('does not publish an addendum that the independent reviewer rejects', async () => {
    const { instance, identity, classId, provider } = getContext();
    provider.generate
      .mockResolvedValueOnce({
        content: JSON.stringify({
          title: 'Pedir',
          explanation: 'Nombra el objeto.',
          examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Un ejemplo.' }],
        }),
        model: 'fixture',
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          prerequisitesCovered: false,
          accurate: true,
          understandable: true,
          answersConcealed: true,
          issues: ['Falta explicar la fórmula.'],
        }),
        model: 'fixture',
      });
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    await expect(
      generatePrerequisiteAddendum(captured, {
        userId: identity.ownerId,
        authorize: async () => ({ userId: identity.ownerId }),
      })
    ).rejects.toThrow('did not pass independent review');
  });

  it('rejects the result when the saved assessment changes during generation', async () => {
    const { instance, identity, classId, questionId, provider } = getContext();
    provider.generate
      .mockImplementationOnce(async () => {
        await instance.database.lessonQuestion.update({
          where: { id: questionId },
          data: { correctIndex: 1 },
        });
        return {
          content: JSON.stringify({
            title: 'Pedir',
            explanation: 'Nombra el objeto.',
            examples: [{ target: 'Вода', meaning: 'Agua', explanation: 'Un ejemplo.' }],
          }),
          model: 'fixture',
        };
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          prerequisitesCovered: true,
          accurate: true,
          understandable: true,
          answersConcealed: true,
          issues: [],
        }),
        model: 'fixture',
      });
    const captured = await sottoTransaction(instance.database, (database) =>
      readPrerequisiteSource(database, classId, identity.ownerId)
    );
    await expect(
      generatePrerequisiteAddendum(captured, {
        userId: identity.ownerId,
        authorize: async () => ({ userId: identity.ownerId }),
      })
    ).rejects.toThrow('changed');
  });
}
