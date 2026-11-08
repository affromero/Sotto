import { createHash } from 'node:crypto';
import type { Job } from 'bullmq';
import { expect, it, vi } from 'vitest';
import { requestClassPreparation, classPreparationStore } from '@/lib/classes/preparation';
import { repairClassReadingMemory } from '@/lib/learning/classes/formative/class-repair';
import { processClassPreparation } from '@/workers/classes/class-preparation.worker';
import { getClassForUser } from '@/lib/class-service';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import type {
  SharedTestInstance,
  SharedTestIdentity,
} from '../../../../helpers/setup/shared-instance';
import { sampleTeaching } from '../../../../helpers/learning/class-teaching';
import {
  emptyTeachingCriticFixture,
  shapeTeachingProviderFixture,
} from '../../quality/intro-provider-fixture';
import type { createRepairTarget } from './repair-target';

export function registerRepairPublicationCases(
  getContext: () => {
    instance: SharedTestInstance;
    identity: SharedTestIdentity;
    courseId: string;
    execution: SottoProviderExecution;
    providerBoundary: { generate: null | ReturnType<typeof vi.fn> };
    repairTarget: () => ReturnType<typeof createRepairTarget>;
    queuedJob: (operationId: string) => Promise<Job<{ operationId: string; fingerprint: string }>>;
  }
) {
  it.each([
    'unchanged',
    'changed',
    'two choices',
    'three choices',
    'mixed two',
    'mixed three',
    'quiz two',
    'quiz three',
    'quiz invalid',
    'grammar prestart changed',
    'grammar evidence changed',
    'grammar score changed',
    'grammar legacy',
    'grammar stage changed',
    'grammar evidence staged',
    'grammar staged answer',
    'grammar sibling failure',
    'reading success',
    'reading failure',
    'reading changed',
    'reading source changed',
    'parallel failure',
    'stage changed',
    'writing source changed',
    'writing prestart changed',
    'writing stage changed',
    'writing staged response',
    'writing legacy',
  ] as const)(
    'publishes an extraction-memory-only repair only when retained quiz material is %s',
    async (source) => {
      const { instance, identity, courseId, execution, providerBoundary, repairTarget, queuedJob } =
        getContext();
      const { cls, grammar, writing, requirements } = await repairTarget();
      const mixedWriting =
        source === 'mixed two' ||
        source === 'mixed three' ||
        source === 'parallel failure' ||
        source === 'stage changed' ||
        source === 'writing source changed' ||
        source === 'writing prestart changed' ||
        source === 'writing stage changed' ||
        source === 'writing staged response' ||
        source === 'writing legacy';
      const mixedReading =
        source === 'reading success' ||
        source === 'reading failure' ||
        source === 'reading changed' ||
        source === 'reading source changed' ||
        source === 'parallel failure' ||
        source === 'stage changed' ||
        source === 'writing stage changed' ||
        source === 'writing staged response' ||
        source === 'grammar stage changed' ||
        source === 'grammar evidence staged' ||
        source === 'grammar staged answer' ||
        source === 'grammar sibling failure';
      const mixedQuiz =
        source === 'quiz two' ||
        source === 'quiz three' ||
        source === 'quiz invalid' ||
        source === 'grammar prestart changed' ||
        source === 'grammar evidence changed' ||
        source === 'grammar score changed' ||
        source === 'grammar legacy' ||
        source === 'grammar stage changed' ||
        source === 'grammar evidence staged' ||
        source === 'grammar staged answer' ||
        source === 'grammar sibling failure';
      const mixed = mixedWriting || mixedQuiz || mixedReading;
      let learnerAnswers =
        mixedWriting || mixedReading
          ? { 'historical-answer': 1, [grammar.questions[0]!.id]: 1 }
          : cls.learnerAnswers;
      if (mixedWriting || mixedReading)
        await instance.database.courseClass.update({
          where: { id: cls.id },
          data: { learnerAnswers: learnerAnswers! },
        });
      const shortOptions =
        source === 'two choices' ||
        source === 'mixed two' ||
        mixedReading ||
        source === 'quiz two' ||
        source === 'quiz invalid'
          ? ['Hallo', 'Tschüss']
          : ['Hallo', 'Tschüss', 'Morgen'];
      if (
        source === 'two choices' ||
        source === 'three choices' ||
        mixedWriting ||
        (mixedReading && !mixedQuiz)
      )
        await instance.database.lessonQuestion.update({
          where: { id: grammar.questions[0]!.id },
          data: {
            options: shortOptions,
          },
        });
      if (mixedQuiz)
        await instance.database.classSection.update({
          where: { id: grammar.id },
          data: { status: 'FAILED' },
        });
      if (!mixedWriting)
        await instance.database.writingPrompt.createMany({
          data: [2, 3].map((order) => ({
            sectionId: writing.id,
            order,
            task: 'Reply to a greeting.',
          })),
        });
      const passageText = 'Mia sagt Hallo.';
      const reading = await instance.database.classSection.create({
        data: {
          classId: cls.id,
          skill: 'READING',
          seed: 'saved-reading',
          status: 'READY',
          spec: {},
          questions: {
            create: Array.from({ length: 5 }, (_, order) => ({
              skill: 'READING' as const,
              order: order + 1,
              passageText,
              question: 'What does Mia say?',
              options: ['Hallo', 'Tschüss', 'Morgen', 'Gestern'],
              correctIndex: 0,
              explanation: 'Mia says Hallo.',
            })),
          },
        },
        include: { questions: true },
      });
      if (mixedReading)
        await instance.database.classSection.update({
          where: { id: reading.id },
          data: { status: 'FAILED' },
        });
      if (mixedQuiz && !mixedReading) {
        await instance.database.lessonQuestion.update({
          where: { id: reading.questions[0]!.id },
          data: { options: shortOptions },
        });
        learnerAnswers = { 'historical-answer': 1, [reading.questions[0]!.id]: 1 };
        await instance.database.courseClass.update({
          where: { id: cls.id },
          data: { learnerAnswers },
        });
      }
      await instance.database.courseClass.update({
        where: { id: cls.id },
        data: {
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
          readingVocabulary: {
            passageText,
            sourceHash: createHash('sha256').update(passageText).digest('hex'),
            words: [
              {
                lemma: 'Hallo',
                gloss: 'hello',
                pos: 'expression',
                sourceForm: 'Hallo',
                questionIds: [],
              },
            ],
          },
        },
      });
      let admittedOperationId = '';
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        if (mixed && new URL(request.url).pathname.endsWith('/moderations'))
          return Response.json({
            results: [{ flagged: false, categories: {}, category_scores: {} }],
          });
        throw new Error('Unexpected provider request.');
      });
      if (mixed)
        providerBoundary.generate = vi.fn(async (system, messages, settings) => {
          if (settings?.jsonSchema?.name === 'class_section_questions')
            return {
              model: 'fixture',
              content: JSON.stringify({
                passage: mixedReading ? passageText : '',
                questions: Array.from({ length: 5 }, (_, index) => ({
                  taskContext: 'Choose a greeting.',
                  question: `Which is a greeting? ${index + 1}`,
                  options:
                    source === 'quiz invalid'
                      ? ['Hallo', 'Tschüss']
                      : ['Hallo', 'Tschüss', 'Morgen', 'Gestern'],
                  correctIndex: 0,
                  explanation: 'Hallo is a greeting.',
                  passageRef: '',
                })),
              }),
            };
          if (settings?.jsonSchema?.name === 'reading_vocabulary_extraction') {
            if (
              source === 'grammar stage changed' ||
              source === 'grammar sibling failure' ||
              source === 'grammar evidence staged' ||
              source === 'grammar staged answer'
            ) {
              let staged: { sectionId: string } | null = null;
              for (let attempt = 0; attempt < 250 && !staged; attempt++) {
                staged = await instance.database.classGrammarStage.findUnique({
                  where: { operationId: admittedOperationId },
                  select: { sectionId: true },
                });
                if (!staged) await new Promise((resolve) => setTimeout(resolve, 20));
              }
              if (!staged) throw new Error('The grammar stage did not commit.');
              if (source === 'grammar sibling failure')
                throw new Error('The parallel reading stage failed.');
              if (source === 'grammar staged answer') {
                if (!evidenceSubmissionId) throw new Error('Missing saved submission.');
                const question = await instance.database.lessonQuestion.findFirstOrThrow({
                  where: { sectionId: staged.sectionId },
                });
                await instance.database.sectionAnswer.create({
                  data: {
                    submissionId: evidenceSubmissionId,
                    sectionId: staged.sectionId,
                    questionId: question.id,
                    selectedIndex: 0,
                    isCorrect: true,
                  },
                });
              } else if (source === 'grammar evidence staged') {
                if (!evidenceId) throw new Error('Missing graded evidence.');
                await instance.database.sectionAnswer.update({
                  where: { id: evidenceId },
                  data: { selectedIndex: 1, isCorrect: false },
                });
              } else {
                const question = await instance.database.lessonQuestion.findFirstOrThrow({
                  where: { sectionId: staged.sectionId },
                });
                await instance.database.lessonQuestion.update({
                  where: { id: question.id },
                  data: { question: 'Changed staged grammar.' },
                });
              }
            }
            if (source === 'reading failure') throw new Error('Vocabulary extraction failed.');
            if (source === 'writing stage changed' || source === 'writing staged response') {
              let staged: { id: string } | null = null;
              for (let attempt = 0; attempt < 250 && !staged; attempt++) {
                staged = await instance.database.classSection.findFirst({
                  where: { classId: cls.id, skill: 'WRITING', attempt: 8 },
                  select: { id: true },
                });
                if (!staged) await new Promise((resolve) => setTimeout(resolve, 20));
              }
              if (!staged) throw new Error('The writing stage did not commit.');
              const prompt = await instance.database.writingPrompt.findFirstOrThrow({
                where: { sectionId: staged.id },
              });
              if (source === 'writing stage changed')
                await instance.database.writingPrompt.update({
                  where: { id: prompt.id },
                  data: { task: 'Changed after staging.' },
                });
              else
                await instance.database.writingResponse.create({
                  data: {
                    promptId: prompt.id,
                    sectionId: staged.id,
                    userId: identity.ownerId,
                    text: 'A response that must survive.',
                  },
                });
            }
            if (source === 'reading source changed')
              await instance.database.lessonQuestion.update({
                where: { id: reading.questions[0]!.id },
                data: { question: 'Changed during extraction.' },
              });
            if (source === 'reading changed')
              await instance.database.courseClass.update({
                where: { id: cls.id },
                data: { readingVocabulary: { changed: true } },
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
          if (settings?.jsonSchema?.name === 'reading_vocabulary_quality')
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
          if (settings?.jsonSchema?.name === 'reading_vocabulary_counterfactual')
            return {
              model: 'fixture',
              content: JSON.stringify({
                decisions: [
                  {
                    questionIndex: 0,
                    decision: 'WORD_MEANING_REQUIRED',
                    answerIndex: null,
                    reasoning: 'The greeting is needed.',
                  },
                ],
              }),
            };
          if (settings?.jsonSchema?.name === 'class_section_quality') {
            const input = JSON.parse(messages[0].content) as {
              questions: Array<{ index: number; options: string[] }>;
            };
            return {
              model: 'fixture',
              content: JSON.stringify({
                passageFindings: [],
                issues: [],
                questions: input.questions.map((question) => ({
                  index: question.index,
                  acceptableOptionIndices: [question.options.indexOf('Hallo')],
                  issues: [],
                })),
              }),
            };
          }
          if (settings?.jsonSchema?.name === 'class_writing_prompts') {
            if (source === 'writing source changed')
              await instance.database.writingResponse.updateMany({
                where: { promptId: writing.writingPrompts[0]!.id },
                data: { text: 'Updated while generating.' },
              });
            if (source === 'parallel failure' || source === 'stage changed') {
              let staged: { id: string } | null = null;
              for (let attempt = 0; attempt < 250 && !staged; attempt++) {
                staged = await instance.database.classSection.findFirst({
                  where: { classId: cls.id, skill: 'READING', attempt: 8 },
                  select: { id: true },
                });
                if (!staged) await new Promise((resolve) => setTimeout(resolve, 20));
              }
              if (!staged) throw new Error('The reading stage did not commit.');
              if (source === 'parallel failure')
                throw new Error('The parallel writing stage failed.');
              const question = await instance.database.lessonQuestion.findFirstOrThrow({
                where: { sectionId: staged.id },
              });
              await instance.database.lessonQuestion.update({
                where: { id: question.id },
                data: { question: 'Changed after staging.' },
              });
            }
            return {
              model: 'fixture',
              content: JSON.stringify({
                prompts: ['Hello', 'Thanks', 'Goodbye'].map((sourceText, index) => ({
                  taskType: 'translation',
                  task: 'Translate into German.',
                  sourceText,
                  modelAnswer: ['Hallo', 'Danke', 'Tschüss'][index],
                  guidance: null,
                  ideas: null,
                  starterText: null,
                  correctionReason: null,
                })),
              }),
            };
          }
          if (settings?.jsonSchema?.name === 'class_teaching_critic')
            return shapeTeachingProviderFixture(
              system,
              messages,
              settings,
              emptyTeachingCriticFixture(messages, settings)
            );
          if (settings?.jsonSchema?.name === 'class_teaching_adjudicator') {
            const input = JSON.parse(messages[0].content) as { items: Array<{ index: number }> };
            return shapeTeachingProviderFixture(system, messages, settings, {
              model: 'fixture',
              content: JSON.stringify({
                items: input.items.map(({ index }) => ({
                  index,
                  acceptable: true,
                  issues: [],
                  feedback: [],
                })),
              }),
            });
          }
          throw new Error(`Unexpected provider schema: ${settings?.jsonSchema?.name}`);
        });
      let evidenceId: string | undefined;
      let evidenceSubmissionId: string | undefined;
      if (
        source === 'grammar evidence changed' ||
        source === 'grammar evidence staged' ||
        source === 'grammar staged answer'
      ) {
        const submission = await instance.database.classSubmission.create({
          data: {
            classId: cls.id,
            userId: identity.ownerId,
            answers: {
              create: {
                sectionId: grammar.id,
                questionId: grammar.questions[0]!.id,
                selectedIndex: 0,
                isCorrect: true,
              },
            },
          },
          include: { answers: true },
        });
        evidenceId = submission.answers[0]!.id;
        evidenceSubmissionId = submission.id;
      }
      const admitted = await requestClassPreparation(courseId, execution, {
        intent: { kind: 'REPAIR', classId: cls.id, expectedAttempt: cls.attempt },
      });
      admittedOperationId = admitted.id;
      if (source === 'grammar legacy')
        await classPreparationStore(instance.database, courseId).transact((current) => {
          if (!current?.intent) throw new Error('Missing repair');
          delete current.intent.grammarSourceHash;
        });
      if (source === 'grammar prestart changed')
        await instance.database.lessonQuestion.update({
          where: { id: grammar.questions[0]!.id },
          data: { question: 'Changed before generation.' },
        });
      if (source === 'grammar score changed')
        await instance.database.classSection.update({
          where: { id: grammar.id },
          data: { score: 0.5 },
        });
      if (evidenceId && source === 'grammar evidence changed')
        await instance.database.sectionAnswer.update({
          where: { id: evidenceId },
          data: { selectedIndex: 1, isCorrect: false },
        });
      if (source === 'writing legacy')
        await classPreparationStore(instance.database, courseId).transact((current) => {
          if (!current?.intent) throw new Error('Missing repair');
          delete current.intent.writingSourceHash;
        });
      if (source === 'writing prestart changed')
        await instance.database.writingResponse.updateMany({
          where: { promptId: writing.writingPrompts[0]!.id },
          data: { text: 'Updated before generation.' },
        });
      expect(admitted.intent?.skills).toEqual(
        source === 'grammar stage changed' ||
          source === 'grammar sibling failure' ||
          source === 'grammar evidence staged' ||
          source === 'grammar staged answer'
          ? ['GRAMMAR', 'READING']
          : source === 'parallel failure' ||
              source === 'stage changed' ||
              source === 'writing stage changed' ||
              source === 'writing staged response'
            ? ['READING', 'WRITING']
            : mixedWriting
              ? ['WRITING']
              : mixedQuiz
                ? ['GRAMMAR']
                : mixedReading
                  ? ['READING']
                  : []
      );
      const prepared = await instance.database.courseClass.findUniqueOrThrow({
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
      if (!mixedReading)
        await repairClassReadingMemory(prepared, requirements, execution, prepared.attempt);
      expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
      if (source === 'changed')
        await instance.database.lessonQuestion.update({
          where: { id: grammar.questions[0]!.id },
          data: { question: 'A revised greeting question?' },
        });
      await processClassPreparation(await queuedJob(admitted.id));
      await processClassPreparation(await queuedJob(admitted.id));
      if (
        source === 'changed' ||
        source === 'quiz invalid' ||
        source === 'reading failure' ||
        source === 'reading changed' ||
        source === 'reading source changed' ||
        source === 'parallel failure' ||
        source === 'stage changed' ||
        source === 'writing source changed' ||
        source === 'writing prestart changed' ||
        source === 'writing stage changed' ||
        source === 'writing staged response' ||
        source === 'writing legacy' ||
        source === 'grammar prestart changed' ||
        source === 'grammar evidence changed' ||
        source === 'grammar score changed' ||
        source === 'grammar legacy' ||
        source === 'grammar stage changed' ||
        source === 'grammar evidence staged' ||
        source === 'grammar staged answer' ||
        source === 'grammar sibling failure'
      ) {
        expect((await classPreparationStore(instance.database, courseId).read())?.status).toBe(
          'FAILED'
        );
        expect(
          (await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } }))
            .learnerAnswers
        ).toEqual(learnerAnswers);
        expect(await instance.database.learnerVocab.count({ where: { courseId } })).toBe(0);
        if (source === 'writing legacy') {
          expect(
            await instance.database.classWritingStage.findUnique({
              where: { operationId: admitted.id },
            })
          ).toBeNull();
          expect(
            await instance.database.writingResponse.findFirstOrThrow({
              where: { promptId: writing.writingPrompts[0]!.id },
            })
          ).toMatchObject({ text: 'Hallo.', overallScore: 0.9 });
        }
        if (source === 'writing source changed' || source === 'writing prestart changed') {
          expect(
            await instance.database.classSection.findFirst({
              where: { classId: cls.id, skill: 'WRITING', attempt: 8 },
            })
          ).toBeNull();
          expect(
            await instance.database.writingResponse.findFirstOrThrow({
              where: { promptId: writing.writingPrompts[0]!.id },
            })
          ).toMatchObject({
            text:
              source === 'writing source changed'
                ? 'Updated while generating.'
                : 'Updated before generation.',
          });
        }
        if (source === 'quiz invalid') {
          const partial = await instance.database.classSection.findFirst({
            where: { classId: cls.id, skill: 'GRAMMAR', attempt: 8 },
          });
          expect(partial).toBeNull();
          expect(
            await instance.database.classSection.findUniqueOrThrow({ where: { id: grammar.id } })
          ).toMatchObject({ withdrawn: false, attempt: grammar.attempt });
          expect(
            await instance.database.lessonQuestion.findUniqueOrThrow({
              where: { id: reading.questions[0]!.id },
            })
          ).toMatchObject({ sectionId: reading.id, options: shortOptions });
        }
        if (
          source === 'grammar prestart changed' ||
          source === 'grammar evidence changed' ||
          source === 'grammar score changed' ||
          source === 'grammar legacy'
        ) {
          expect(
            await instance.database.classGrammarStage.findUnique({
              where: { operationId: admitted.id },
            })
          ).toBeNull();
          expect(
            await instance.database.classSection.findFirst({
              where: { classId: cls.id, skill: 'GRAMMAR', attempt: 8 },
            })
          ).toBeNull();
          if (evidenceId)
            expect(
              await instance.database.sectionAnswer.findUniqueOrThrow({ where: { id: evidenceId } })
            ).toMatchObject({ selectedIndex: 1, isCorrect: false });
        }
        if (
          source === 'grammar stage changed' ||
          source === 'grammar sibling failure' ||
          source === 'grammar evidence staged' ||
          source === 'grammar staged answer'
        ) {
          const stage = await instance.database.classGrammarStage.findUniqueOrThrow({
            where: { operationId: admitted.id },
          });
          expect(
            await instance.database.classSection.findUniqueOrThrow({
              where: { id: stage.sectionId },
            })
          ).toMatchObject({ withdrawn: true });
          await expect(
            instance.database.classSection.update({
              where: { id: stage.sectionId },
              data: { withdrawn: false },
            })
          ).rejects.toThrow();
          const visible = await getClassForUser(cls.id, identity.ownerId, instance.database);
          expect(visible?.sections.find((section) => section.skill === 'GRAMMAR')?.id).toBe(
            grammar.id
          );
          if (source === 'grammar evidence staged')
            expect(
              await instance.database.sectionAnswer.findUniqueOrThrow({ where: { id: evidenceId } })
            ).toMatchObject({ selectedIndex: 1, isCorrect: false });
          if (source === 'grammar staged answer')
            expect(
              await instance.database.sectionAnswer.findFirst({
                where: { sectionId: stage.sectionId },
              })
            ).not.toBeNull();
        }
        if (mixedReading) {
          expect(
            await instance.database.classSection.findFirst({
              where: { classId: cls.id, skill: 'READING', attempt: 8, withdrawn: false },
            })
          ).toBeNull();
          const saved = await instance.database.courseClass.findUniqueOrThrow({
            where: { id: cls.id },
          });
          if (source === 'reading changed')
            expect(saved.readingVocabulary).toEqual({ changed: true });
          else expect(saved.readingVocabulary).toEqual(prepared.readingVocabulary);
          if (
            source === 'stage changed' ||
            source === 'writing stage changed' ||
            source === 'writing staged response'
          )
            expect(
              await instance.database.classSection.findFirst({
                where: { classId: cls.id, skill: 'WRITING', attempt: 8, withdrawn: false },
              })
            ).toBeNull();
          if (source === 'writing staged response')
            expect(
              await instance.database.writingResponse.findFirst({
                where: { text: 'A response that must survive.' },
              })
            ).not.toBeNull();
          if (source === 'stage changed') {
            const stage = await instance.database.classWritingStage.findUniqueOrThrow({
              where: { operationId: admitted.id },
              include: { section: true },
            });
            expect(stage.section).toMatchObject({
              classId: cls.id,
              skill: 'WRITING',
              attempt: 8,
              withdrawn: true,
            });
            await expect(
              instance.database.classSection.update({
                where: { id: stage.sectionId },
                data: { withdrawn: false },
              })
            ).rejects.toThrow('Staged writing must be released before activation');
            await instance.database.courseClass.delete({ where: { id: cls.id } });
            expect(
              await instance.database.classWritingStage.findUnique({
                where: { operationId: admitted.id },
              })
            ).toBeNull();
            expect(
              await instance.database.classReadingStage.findUnique({
                where: { operationId: admitted.id },
              })
            ).toBeNull();
          }
          if (source === 'parallel failure') {
            const stage = await instance.database.classReadingStage.findUniqueOrThrow({
              where: { operationId: admitted.id },
              include: { section: true },
            });
            expect(stage.section).toMatchObject({
              classId: cls.id,
              skill: 'READING',
              attempt: 8,
              withdrawn: true,
            });
            await expect(
              instance.database.classSection.update({
                where: { id: stage.sectionId },
                data: { withdrawn: false },
              })
            ).rejects.toThrow('Staged reading must be released before activation');
            await instance.database.courseClass.delete({ where: { id: cls.id } });
            expect(
              await instance.database.classReadingStage.findUnique({
                where: { operationId: admitted.id },
              })
            ).toBeNull();
          }
        }
        if (source === 'grammar sibling failure') {
          await instance.database.courseClass.delete({ where: { id: cls.id } });
          expect(
            await instance.database.classGrammarStage.findUnique({
              where: { operationId: admitted.id },
            })
          ).toBeNull();
        }
        return;
      }
      expect((await classPreparationStore(instance.database, courseId).read())?.status).toBe(
        'COMPLETED'
      );
      expect(
        await instance.database.courseClass.findUniqueOrThrow({ where: { id: cls.id } })
      ).toMatchObject({
        status: 'IN_PROGRESS',
        attempt: 8,
        learnerAnswers,
        writingDrafts: cls.writingDrafts,
        adaptiveSeed: { teaching: sampleTeaching },
      });
      expect(await instance.database.classSection.count({ where: { classId: cls.id } })).toBe(
        mixed ? 4 : 3
      );
      if (mixedWriting) {
        const generated = await instance.database.classSection.findFirstOrThrow({
          where: { classId: cls.id, skill: 'WRITING', attempt: 8 },
          include: { writingPrompts: true },
        });
        expect(generated.writingPrompts).toHaveLength(3);
        expect(
          await instance.database.writingResponse.findFirst({
            where: { promptId: writing.writingPrompts[0]!.id },
          })
        ).toMatchObject({ text: 'Hallo.', overallScore: 0.9 });
      }
      if (mixedQuiz) {
        const generated = await instance.database.classSection.findFirstOrThrow({
          where: { classId: cls.id, skill: 'GRAMMAR', attempt: 8 },
          include: { questions: true },
        });
        expect(generated.questions).toHaveLength(5);
        expect(generated.withdrawn).toBe(false);
        expect(
          await instance.database.classGrammarStage.findUnique({
            where: { operationId: admitted.id },
          })
        ).toBeNull();
        expect(
          generated.questions.every(
            (question) => Array.isArray(question.options) && question.options.length === 4
          )
        ).toBe(true);
        expect(
          await instance.database.lessonQuestion.findUniqueOrThrow({
            where: { id: reading.questions[0]!.id },
          })
        ).toMatchObject({ sectionId: reading.id, options: shortOptions });
      }
      if (mixedReading) {
        const generated = await instance.database.classSection.findFirstOrThrow({
          where: { classId: cls.id, skill: 'READING', attempt: 8 },
          include: { questions: true },
        });
        const saved = await instance.database.courseClass.findUniqueOrThrow({
          where: { id: cls.id },
        });
        const vocabulary = saved.readingVocabulary as { words: Array<{ questionIds: string[] }> };
        expect(generated.questions.map((question) => question.id)).toContain(
          vocabulary.words[0]!.questionIds[0]
        );
        expect(
          await instance.database.classReadingStage.findUnique({
            where: { operationId: admitted.id },
          })
        ).toBeNull();
      }
      if (source === 'two choices' || source === 'three choices' || mixedWriting || mixedReading)
        expect(
          await instance.database.lessonQuestion.findUniqueOrThrow({
            where: { id: grammar.questions[0]!.id },
          })
        ).toMatchObject({
          sectionId: grammar.id,
          options: shortOptions,
        });
      expect(
        await instance.database.learnerVocab.findFirst({ where: { courseId, lemma: 'Hallo' } })
      ).toMatchObject({ translation: 'hello', reps: 0 });
    }
  );
}
