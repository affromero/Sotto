import { createHash } from 'node:crypto';
import type { Job } from 'bullmq';
import { it, expect, vi } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import { sampleTeaching } from '../../../../helpers/learning/class-teaching';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { regenerateCurrentClass } from '@/lib/class-service';
import {
  requestClassPreparation,
  cancelClassPreparation,
  classPreparationStore,
} from '@/lib/classes/preparation';
import { processClassPreparation } from '@/workers/classes/class-preparation.worker';
import {
  classRepairSkills,
  selectClassRepairSkills,
  repairClassReadingMemory,
} from '@/lib/learning/classes/formative/class-repair';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type {
  SharedTestInstance,
  SharedTestIdentity,
} from '../../../../helpers/setup/shared-instance';
import type { createRepairTarget } from './repair-target';

export function registerRepairFinalizationCases(
  getContext: () => {
    instance: SharedTestInstance;
    identity: SharedTestIdentity;
    courseId: string;
    execution: SottoProviderExecution;
    repairTarget: () => ReturnType<typeof createRepairTarget>;
    providerBoundary: { generate: null | ReturnType<typeof vi.fn> };
    queuedJob: (operationId: string) => Promise<Job<{ operationId: string; fingerprint: string }>>;
  }
) {
  it('rejects a sourced passage changed after loading the repair context', async () => {
    const { instance, identity, execution, repairTarget } = getContext();
    const { cls, requirements } = await repairTarget();
    const reading = await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'READING',
        seed: 'saved-reading',
        status: 'READY',
        spec: {},
        questions: {
          create: {
            order: 1,
            skill: 'READING',
            question: 'What does Mia say?',
            options: ['Hallo', 'Tschüss', 'Morgen', 'Gestern'],
            correctIndex: 0,
            explanation: 'Mia says Hallo.',
            passageText: 'Mia sagt Hallo.',
          },
        },
      },
      include: { questions: true },
    });
    await instance.database.courseClass.update({
      where: { id: cls.id },
      data: {
        status: 'GENERATING',
        attempt: 8,
        sourceUrl: 'https://example.test/lesson',
        adaptiveSeed: {
          teaching: sampleTeaching,
          intro: {
            purpose: 'Greet someone.',
            about: 'Greetings.',
            focus: ['Greeting'],
            examples: [],
            tips: [],
          },
        },
      },
    });
    let changed = false;
    const racingExecution: SottoProviderExecution = {
      ...execution,
      stageClassReading: async () => {
        throw new Error('Unexpected staging.');
      },
      authorize: async (database) => {
        const actor = await execution.authorize(database);
        if (!changed) {
          changed = true;
          await database.lessonQuestion.update({
            where: { id: reading.questions[0]!.id },
            data: { passageText: 'Mia sagt Tschüss.' },
          });
        }
        return actor;
      },
    };
    vi.stubGlobal('fetch', () => {
      throw new Error('Provider must not be called.');
    });
    await expect(
      regenerateCurrentClass(cls.id, identity.ownerId, racingExecution, undefined, {
        repair: true,
        skills: ['READING'],
        requirements,
        attempt: 8,
      })
    ).rejects.toThrow('The saved reading passage changed before repair.');
    expect(
      await instance.database.classSection.findFirst({
        where: { classId: cls.id, skill: 'READING', attempt: 8 },
      })
    ).toBeNull();
    expect(
      (
        await instance.database.lessonQuestion.findUniqueOrThrow({
          where: { id: reading.questions[0]!.id },
        })
      ).passageText
    ).toBe('Mia sagt Tschüss.');
  });

  it.each(['unchanged', 'changed'] as const)(
    'repairs saved reading memory only when its source is %s during extraction',
    async (source) => {
      const { instance, execution, repairTarget, providerBoundary } = getContext();
      const { cls, requirements } = await repairTarget();
      const passageText = 'Mia sagt Hallo.';
      const section = await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'READING',
          seed: 'saved',
          spec: {},
          status: 'READY',
          questions: {
            create: {
              order: 1,
              skill: 'READING',
              question: 'What does Hallo mean?',
              options: ['hello', 'goodbye'],
              correctIndex: 0,
              explanation: 'Mia says Hallo.',
              passageText,
            },
          },
        },
        include: { questions: true },
      });
      const question = section.questions[0]!;
      const answers = { 'historical-answer': 1, [question.id]: 0 };
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: { status: 'GENERATING', learnerAnswers: answers },
      });
      const material = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: cls.id },
        include: {
          course: true,
          lesson: true,
          sections: {
            include: {
              questions: true,
              prompts: true,
              writingPrompts: true,
              episode: { include: { script: true } },
            },
          },
        },
      });
      providerBoundary.generate = vi.fn(async (_system, _messages, settings) => {
        const name = settings?.jsonSchema?.name;
        if (name === 'reading_vocabulary_extraction') {
          if (source === 'changed')
            await instance.database.lessonQuestion.update({
              where: { id: question.id },
              data: { question: 'A revised question?' },
            });
          return {
            model: 'fixture',
            content: JSON.stringify({
              words: [
                {
                  lemma: 'Hallo',
                  gloss: 'hello',
                  pos: 'expression',
                  sourceSpan: { startWordIndex: 2, endWordIndex: 2 },
                  questionIndices: [0],
                },
              ],
            }),
          };
        }
        if (name === 'reading_vocabulary_quality')
          return {
            model: 'fixture',
            content: JSON.stringify({
              items: [
                {
                  index: 0,
                  metadata: { acceptable: true, issues: [], feedback: [] },
                  associations: [
                    {
                      questionIndex: 0,
                      canAnswerWithoutWord: false,
                      reasoning: 'The greeting is needed.',
                    },
                  ],
                },
              ],
            }),
          };
        if (name === 'reading_vocabulary_counterfactual')
          return {
            model: 'fixture',
            content: JSON.stringify({
              decisions: [
                {
                  questionIndex: 0,
                  decision: 'WORD_MEANING_REQUIRED',
                  answerIndex: null,
                  reasoning: 'The greeting meaning is required.',
                },
              ],
            }),
          };
        throw new Error(`Unexpected provider request: ${name}`);
      });
      const repair = repairClassReadingMemory(material, requirements, execution, cls.attempt);
      if (source === 'changed') {
        await expect(repair).rejects.toThrow('The reading material changed during repair.');
        const saved = await instance.database.courseClass.findUniqueOrThrow({
          where: { id: cls.id },
        });
        expect(saved.readingVocabulary).toBeNull();
        expect(saved.learnerAnswers).toEqual(answers);
        return;
      }
      await repair;
      const saved = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: cls.id },
      });
      expect(saved.learnerAnswers).toEqual(answers);
      expect(saved.writingDrafts).toEqual(cls.writingDrafts);
      expect(saved.readingVocabulary).toMatchObject({
        passageText,
        sourceHash: createHash('sha256').update(passageText).digest('hex'),
        words: [{ lemma: 'Hallo', sourceForm: 'Hallo', questionIds: [question.id] }],
      });
      expect(
        await instance.database.lessonQuestion.findUniqueOrThrow({ where: { id: question.id } })
      ).toMatchObject({ sectionId: section.id, options: ['hello', 'goodbye'], correctIndex: 0 });
    }
  );

  it.each([
    { options: ['Hallo', 'Tschüss', 'Morgen', 'Gestern'], correctIndex: 4 },
    { options: ['Hallo', 'Tschüss'], correctIndex: 3 },
  ])(
    'rejects invalid preserved reading keys before extraction or memory publication: %j',
    async (invalid) => {
      const { instance, courseId, execution, repairTarget } = getContext();
      const { cls, requirements } = await repairTarget();
      const section = await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'READING',
          seed: 'preserved',
          spec: {},
          status: 'READY',
          questions: {
            create: {
              order: 1,
              skill: 'READING',
              question: 'What does Mia say?',
              options: invalid.options,
              correctIndex: invalid.correctIndex,
              explanation: 'Mia says Hallo.',
              passageText: 'Mia sagt Hallo.',
            },
          },
        },
        include: { questions: true },
      });
      const material = await instance.database.courseClass.findUniqueOrThrow({
        where: { id: cls.id },
        include: {
          course: true,
          lesson: true,
          sections: {
            include: {
              questions: true,
              prompts: true,
              writingPrompts: true,
              episode: { include: { script: true } },
            },
          },
        },
      });
      const fetch = vi.fn(() => {
        throw new Error('Invalid keys must not reach a provider.');
      });
      vi.stubGlobal('fetch', fetch);
      await expect(
        repairClassReadingMemory(material, requirements, execution, cls.attempt)
      ).rejects.toThrow('private question keys');
      expect(fetch).not.toHaveBeenCalled();
      expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
      expect(
        await instance.database.lessonQuestion.findMany({
          where: { sectionId: section.id },
          orderBy: { order: 'asc' },
        })
      ).toEqual(section.questions);
      expect(
        (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } }))
          .readingVocabulary
      ).toBeNull();
    }
  );

  it('settles a cancelled queued repair without deleting learner history or the active gate', async () => {
    const { instance, courseId, execution, repairTarget } = getContext();
    const { cls, grammar } = await repairTarget();
    await requestClassPreparation(courseId, execution, {
      intent: { kind: 'REPAIR', classId: cls.id, expectedAttempt: cls.attempt },
    });
    const cancelled = await cancelClassPreparation(courseId, execution);
    expect(cancelled?.status).toBe('CANCELLED');
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
    ).toMatchObject({
      status: 'FAILED',
      attempt: 8,
      learnerAnswers: cls.learnerAnswers,
      writingDrafts: cls.writingDrafts,
    });
    expect(
      await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })
    ).toMatchObject({ activeClassId: cls.id });
    expect(await instance.database.lessonQuestion.count({ where: { sectionId: grammar.id } })).toBe(
      5
    );
  });

  it('retains a failed repair outcome and learner history after worker cleanup', async () => {
    const { instance, courseId, execution, repairTarget, queuedJob } = getContext();
    const { cls, grammar, writing } = await repairTarget();
    const writingHistory = await instance.database.writingPrompt.findUniqueOrThrow({
      where: { id: writing.writingPrompts[0].id },
      include: { responses: true },
    });
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { message: 'Private provider rejection' } }, { status: 400 })
    );
    const admitted = await requestClassPreparation(courseId, execution, {
      intent: { kind: 'REPAIR', classId: cls.id, expectedAttempt: cls.attempt },
    });
    const job = await queuedJob(admitted.id);
    await processClassPreparation(job);
    await processClassPreparation(job);
    expect(await classPreparationStore(instance.database, courseId).read()).toMatchObject({
      id: admitted.id,
      status: 'FAILED',
      failure: 'generation_failed',
    });
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
    ).toMatchObject({
      status: 'FAILED',
      attempt: 8,
      learnerAnswers: cls.learnerAnswers,
      writingDrafts: cls.writingDrafts,
    });
    expect(
      await instance.database.course.findUniqueOrThrow({ where: { id: courseId } })
    ).toMatchObject({ activeClassId: cls.id });
    expect(
      await instance.database.lessonQuestion.findMany({
        where: { sectionId: grammar.id },
        orderBy: { order: 'asc' },
      })
    ).toEqual(grammar.questions);
    expect(
      await instance.database.writingPrompt.findUniqueOrThrow({
        where: { id: writing.writingPrompts[0].id },
        include: { responses: true },
      })
    ).toEqual(writingHistory);
    expect(
      await sottoTransaction(instance.database, (database) =>
        sottoJobOutbox(database).read(admitted.id)
      )
    ).toMatchObject({ complete: true });
  });

  it('rejects a competing repair intent without leaving another claimed attempt', async () => {
    const { instance, courseId, execution, repairTarget } = getContext();
    const { cls } = await repairTarget();
    const first = await requestClassPreparation(courseId, execution, {
      intent: { kind: 'REPAIR', classId: cls.id, expectedAttempt: cls.attempt },
    });
    await expect(
      requestClassPreparation(courseId, execution, {
        intent: { kind: 'REGENERATE', classId: cls.id, expectedAttempt: cls.attempt },
      })
    ).rejects.toThrow(/active preparation/);
    expect(
      await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
    ).toMatchObject({ attempt: 8 });
    expect((await classPreparationStore(instance.database, courseId).read())?.id).toBe(first.id);
  });

  it('keeps an unsubmitted complete section while repairing partial and missing skills', async () => {
    const { instance, repairTarget } = getContext();
    const { cls, requirements } = await repairTarget();
    const material = await instance.database.courseClass.findUniqueOrThrow({
      where: { id: cls.id },
      include: {
        course: true,
        lesson: true,
        sections: {
          include: {
            questions: true,
            prompts: true,
            writingPrompts: true,
            episode: { include: { script: true } },
          },
        },
      },
    });
    expect(classRepairSkills(material, requirements)).toEqual(['READING', 'WRITING']);
    const grammar = material.sections.find((section) => section.skill === 'GRAMMAR')!;
    await instance.database.classSection.update({
      where: { id: grammar.id },
      data: { passed: false },
    });
    grammar.passed = false;
    expect(classRepairSkills(material, requirements)).toEqual(['GRAMMAR', 'READING', 'WRITING']);
  });

  it('repairs speaking when populated reference URLs lack owned storage attribution', async () => {
    const { instance, repairTarget } = getContext();
    const { cls } = await repairTarget();
    const requirements = createSkillRequirements({
      scope: 'CLASS',
      nativeLang: 'en',
      targetLang: 'de',
      level: 'A1',
      ttsProvider: 'local',
      sttProvider: 'local',
    });
    await instance.database.classSection.create({
      data: {
        classId: cls.id,
        skill: 'SPEAKING',
        status: 'READY',
        seed: 'saved',
        spec: {},
        prompts: {
          create: Array.from({ length: 4 }, (_, index) => ({
            order: index + 1,
            targetPhrase: 'Hallo Mia.',
            translation: 'Hello Mia.',
            referenceTtsUrl: `/foreign/${index}.mp3`,
          })),
        },
      },
    });
    const material = await instance.database.courseClass.findUniqueOrThrow({
      where: { id: cls.id },
      include: {
        course: true,
        lesson: true,
        sections: {
          include: {
            questions: true,
            prompts: true,
            writingPrompts: true,
            episode: { include: { script: true } },
          },
        },
      },
    });
    expect(classRepairSkills(material, requirements)).not.toContain('SPEAKING');
    expect(
      await instance.database.$transaction((database) =>
        selectClassRepairSkills(database, material, requirements)
      )
    ).toContain('SPEAKING');
  });
}
