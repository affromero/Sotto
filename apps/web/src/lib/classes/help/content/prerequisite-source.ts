import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { classTeachingSchema } from '@sotto/shared';
import type { Prisma } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '../lifecycle/prerequisite-ownership';
import { currentClassSections } from '@/lib/learning/classes/progress/current-sections';
import { savedClassQuestionMaterialSchema } from '@/lib/learning/classes/formative/class-material';
import { learningScriptHash } from '@/lib/learning/script-hash';
import { classRequirementsOrLegacy } from '@/lib/learning/skill-requirements';
import { assertLearningMaterial } from '@/lib/learning/session-evaluation';
import { speakingTaskMode } from '@/lib/learning-map/evidence/communicative-speaking';
import { teachingFromSeed } from '@/lib/classes/lesson/teaching';
import { storedPrerequisiteAddendumSchema } from '../lifecycle/prerequisite-contract';

export class PrerequisiteSourceConflict extends Error {
  constructor(message = 'The saved lesson changed. Reopen the class and try again.') {
    super(message);
    this.name = 'PrerequisiteSourceConflict';
  }
}

/** A local disclosure check refused the candidate without identifying any answer. */
export class PrerequisiteDisclosureError extends PrerequisiteSourceConflict {
  constructor() {
    super('Prerequisite teaching could not be prepared safely.');
    this.name = 'PrerequisiteDisclosureError';
  }
}

const publicTeachingSchema = classTeachingSchema.omit({ guidedPractice: true }).extend({
  guidedPractice: classTeachingSchema.shape.guidedPractice.omit({
    answer: true,
    explanation: true,
  }),
});
const turnSchema = z.object({ speaker: z.string().min(1), text: z.string().min(1) });
const publicTurnSchema = turnSchema.strict();
const publicQuestionSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    options: z.array(z.string()).min(2).max(4),
    passageText: z.string().nullable(),
  })
  .strict();
export const prerequisitePublicSourceSchema = z
  .object({
    course: z
      .object({
        nativeLang: z.string().regex(/^[a-z]{2}$/),
        targetLang: z.string().regex(/^[a-z]{2}$/),
      })
      .strict(),
    lesson: z
      .object({ level: z.string().min(1), title: z.string().min(1), objective: z.string().min(1) })
      .strict(),
    teaching: publicTeachingSchema,
    sections: z
      .array(
        z
          .object({
            id: z.string().min(1),
            skill: z.enum(['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING']),
            attempt: z.number().int().positive(),
            status: z.string().min(1),
            questions: z.array(publicQuestionSchema),
            speaking: z.array(
              z
                .object({
                  id: z.string().min(1),
                  targetPhrase: z.string().min(1),
                  translation: z.string().min(1),
                  ipa: z.string().nullable(),
                  taskMode: z.enum(['READ_ALOUD', 'COMMUNICATIVE']),
                })
                .strict()
            ),
            writing: z.array(
              z
                .object({
                  id: z.string().min(1),
                  task: z.string().min(1),
                  guidance: z.string().nullable(),
                })
                .strict()
            ),
            listening: z.array(publicTurnSchema).nullable(),
          })
          .strict()
      )
      .min(1)
      .max(5),
  })
  .strict()
  .refine((value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 262144);

/** Capture the owned, learner-visible inputs without learner work or answer keys. */
export async function readPrerequisiteSource(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  const cls = await database.courseClass.findFirst({
    where: { id: classId, course: { userId } },
    select: {
      id: true,
      courseId: true,
      attempt: true,
      status: true,
      sourceTitle: true,
      sourceUrl: true,
      adaptiveSeed: true,
      skillRequirements: true,
      submission: { select: { id: true, userId: true, attempt: true, passed: true } },
      course: { select: { nativeLang: true, targetLang: true } },
      lesson: { select: { level: true, title: true, objective: true } },
      sections: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          skill: true,
          attempt: true,
          withdrawn: true,
          status: true,
          spec: true,
          questions: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              skill: true,
              question: true,
              options: true,
              passageText: true,
              correctIndex: true,
              explanation: true,
            },
          },
          prompts: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              targetPhrase: true,
              translation: true,
              ipa: true,
              referenceTtsUrl: true,
              learningObjectives: true,
            },
          },
          writingPrompts: {
            orderBy: { order: 'asc' },
            select: { id: true, task: true, guidance: true, ideas: true },
          },
          episode: {
            select: {
              id: true,
              userId: true,
              deletedAt: true,
              status: true,
              audioUrl: true,
              script: { select: { version: true, turns: true } },
            },
          },
        },
      },
    },
  });
  if (!cls || !['AVAILABLE', 'IN_PROGRESS', 'SUBMITTED', 'PASSED', 'FAILED'].includes(cls.status))
    throw new PrerequisiteSourceConflict('The saved class is unavailable for prerequisite repair.');
  const teaching = teachingFromSeed(cls.adaptiveSeed);
  if (!teaching) throw new PrerequisiteSourceConflict('The class has no saved teaching.');
  let requirements;
  try {
    if (cls.skillRequirements === null && (cls.sourceTitle || cls.sourceUrl))
      throw new PrerequisiteSourceConflict('The original sourced lesson level is unavailable.');
    requirements = classRequirementsOrLegacy(cls.skillRequirements, {
      nativeLang: cls.course.nativeLang,
      targetLang: cls.course.targetLang,
      level: cls.lesson.level,
    });
  } catch {
    throw new PrerequisiteSourceConflict('The saved class requirements are invalid.');
  }
  if (
    !requirements ||
    requirements.scope !== 'CLASS' ||
    requirements.nativeLang !== cls.course.nativeLang ||
    requirements.targetLang !== cls.course.targetLang
  )
    throw new PrerequisiteSourceConflict('The saved class requirements are unavailable.');
  const sections = currentClassSections(cls.sections);
  if (
    sections.length === 0 ||
    new Set(sections.map((section) => section.skill)).size !== sections.length ||
    sections.some(
      (section) =>
        !['READY', 'IN_PROGRESS', 'SUBMITTED', 'PASSED', 'FAILED'].includes(section.status) ||
        section.questions.some(
          (question) =>
            question.skill !== section.skill ||
            !savedClassQuestionMaterialSchema.safeParse(question).success
        ) ||
        (section.skill === 'SPEAKING'
          ? section.prompts.length === 0
          : section.skill === 'WRITING'
            ? section.writingPrompts.length === 0
            : section.questions.length === 0) ||
        (section.skill === 'LISTENING' &&
          (!section.episode?.script ||
            section.episode.userId !== userId ||
            section.episode.deletedAt !== null ||
            !z.array(turnSchema).min(1).safeParse(section.episode.script.turns).success ||
            !z
              .object({ scriptHash: z.literal(learningScriptHash(section.episode.script.turns)) })
              .safeParse(section.spec).success))
    )
  )
    throw new PrerequisiteSourceConflict('The current class sections are incomplete or ambiguous.');
  try {
    assertLearningMaterial(
      requirements,
      sections.map((section) => ({
        skill: section.skill,
        itemIds:
          section.skill === 'SPEAKING'
            ? section.prompts.map((prompt) => prompt.id)
            : section.skill === 'WRITING'
              ? section.writingPrompts.map((prompt) => prompt.id)
              : section.questions.map((question) => question.id),
        passageText: section.questions.find((question) => question.passageText)?.passageText,
        audio: section.episode?.deletedAt ? null : section.episode,
        referenceAudioUrls: section.prompts.map((prompt) => prompt.referenceTtsUrl),
        speakingTaskModes: section.prompts.map((prompt) =>
          speakingTaskMode(prompt.learningObjectives)
        ),
      }))
    );
  } catch {
    throw new PrerequisiteSourceConflict('The required class material is incomplete.');
  }
  const source = prerequisitePublicSourceSchema.parse({
    course: cls.course,
    lesson: {
      ...cls.lesson,
      level: requirements.level,
      objective: cls.sourceTitle ?? cls.lesson.objective,
    },
    teaching: publicTeachingSchema.parse({
      ...teaching,
      guidedPractice: {
        prompt: teaching.guidedPractice.prompt,
        hint: teaching.guidedPractice.hint,
      },
    }),
    sections: sections.map((section) => ({
      id: section.id,
      skill: section.skill,
      attempt: section.attempt,
      status: section.status,
      questions: section.questions.map(({ id, question, options, passageText }) =>
        publicQuestionSchema.parse({ id, question, options, passageText })
      ),
      speaking: section.prompts.map(
        ({ id, targetPhrase, translation, ipa, learningObjectives }) => ({
          id,
          targetPhrase,
          translation,
          ipa,
          taskMode: speakingTaskMode(learningObjectives),
        })
      ),
      // Optional openings are not available before the learner chooses to reveal them.
      writing: section.writingPrompts.map(({ id, task, guidance }) => ({ id, task, guidance })),
      listening: section.episode?.script
        ? z.array(turnSchema).parse(section.episode.script.turns)
        : null,
    })),
  });
  const ownership = await capturePrerequisiteOwnership(database, classId, cls.courseId, userId);
  if (!cls.adaptiveSeed || typeof cls.adaptiveSeed !== 'object' || Array.isArray(cls.adaptiveSeed))
    throw new PrerequisiteSourceConflict();
  const { prerequisiteAddendum, ...baseSeed } = cls.adaptiveSeed;
  const sourceHash = createHash('sha256')
    .update(
      JSON.stringify({
        attempt: cls.attempt,
        sourceTitle: cls.sourceTitle,
        sourceUrl: cls.sourceUrl,
        adaptiveSeed: baseSeed,
        requirements: cls.skillRequirements,
        course: cls.course,
        lesson: cls.lesson,
        sections: sections.map((section) => ({
          id: section.id,
          skill: section.skill,
          attempt: section.attempt,
          spec: section.spec,
          questions: section.questions,
          writingPrompts: section.writingPrompts,
          episode: section.episode
            ? {
                id: section.episode.id,
                userId: section.episode.userId,
                deletedAt: section.episode.deletedAt,
                script: section.episode.script,
              }
            : null,
          prompts: section.prompts.map((prompt) => ({
            id: prompt.id,
            targetPhrase: prompt.targetPhrase,
            translation: prompt.translation,
            ipa: prompt.ipa,
            learningObjectives: prompt.learningObjectives,
          })),
        })),
      })
    )
    .digest('hex');
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        sourceHash,
        status: cls.status,
        submission: cls.submission,
        sectionStates: sections.map(({ id, status, episode, prompts }) => ({
          id,
          status,
          audioStatus: episode?.status,
          audioUrl: episode?.audioUrl,
          referenceAudioUrls: prompts.map((prompt) => prompt.referenceTtsUrl),
        })),
        prerequisiteAddendum,
      })
    )
    .digest('hex');
  return {
    classId,
    courseId: cls.courseId,
    userId,
    ownership,
    sourceHash,
    hash,
    source,
    status: cls.status,
    canRepair:
      ['AVAILABLE', 'IN_PROGRESS'].includes(cls.status) ||
      (cls.status === 'FAILED' &&
        cls.submission?.attempt === cls.attempt &&
        cls.submission.userId === userId &&
        cls.submission.passed === false),
    storedAddendum: prerequisiteAddendum,
  };
}

/** Revalidate the original owner and exact class material before dispatch or publication. */
export async function requirePrerequisiteSource(
  database: Prisma.TransactionClient,
  expected: Pick<
    Awaited<ReturnType<typeof readPrerequisiteSource>>,
    'classId' | 'userId' | 'sourceHash' | 'hash'
  >,
  ownership: Awaited<ReturnType<typeof readPrerequisiteSource>>['ownership']
) {
  const current = await readPrerequisiteSource(database, expected.classId, expected.userId);
  if (
    current.hash !== expected.hash ||
    current.sourceHash !== expected.sourceHash ||
    !isDeepStrictEqual(current.ownership, ownership)
  )
    throw new PrerequisiteSourceConflict();
  return current;
}

/** Return saved teaching only while its source material still matches. */
export async function readCurrentPrerequisiteAddendum(
  database: Prisma.TransactionClient,
  classId: string,
  userId: string
) {
  const current = await readPrerequisiteSource(database, classId, userId);
  const stored = current.storedAddendum;
  if (stored === undefined) return { status: 'UNAVAILABLE' as const };
  const parsed = storedPrerequisiteAddendumSchema.safeParse(stored);
  if (!parsed.success)
    throw new PrerequisiteSourceConflict('The saved prerequisite lesson is invalid.');
  if (parsed.data.sourceHash !== current.sourceHash) return { status: 'STALE' as const };
  return { status: 'READY' as const, content: parsed.data.content };
}

function normalizedWords(value: string) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{Cf}/gu, '')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Reject guided answers and explicit practice selections without exposing private keys. */
export async function rejectExactPrerequisiteAnswers(
  database: Prisma.TransactionClient,
  expected: Pick<
    Awaited<ReturnType<typeof readPrerequisiteSource>>,
    'classId' | 'userId' | 'sourceHash' | 'hash'
  >,
  ownership: Awaited<ReturnType<typeof readPrerequisiteSource>>['ownership'],
  visibleFields: readonly string[]
) {
  await requirePrerequisiteSource(database, expected, ownership);
  const cls = await database.courseClass.findFirstOrThrow({
    where: { id: expected.classId, course: { userId: expected.userId } },
    select: {
      adaptiveSeed: true,
      sections: {
        select: {
          skill: true,
          attempt: true,
          withdrawn: true,
          questions: { select: { options: true, correctIndex: true } },
        },
      },
    },
  });
  const teaching = teachingFromSeed(cls.adaptiveSeed);
  if (!teaching) throw new PrerequisiteSourceConflict();
  const answers = [teaching.guidedPractice.answer];
  const formativeAnswers: string[] = [];
  for (const section of currentClassSections(cls.sections))
    for (const question of section.questions) {
      const options = z.array(z.string()).min(2).max(4).parse(question.options);
      const answer = options[question.correctIndex];
      if (!answer) throw new PrerequisiteSourceConflict('The saved answer key is invalid.');
      formativeAnswers.push(answer);
    }
  const visible = visibleFields.map(normalizedWords);
  const joined = visible.join(' ');
  const pointsToOption =
    visibleFields.some((field) =>
      /\b(?:[Rr]espuesta|[Aa]nswer)\s*(?::\s*[a-dA-D1-4]\b|\s+[A-D1-4](?=\s*[.!?,;:]|\s*$))/u.test(
        field
      )
    ) ||
    /(?:^| )(?:opcion|alternativa|option|choice) (?:(?:correcta|correct|es|is|la|the) ){0,4}[a-d1-4](?: |$)/u.test(
      joined
    ) ||
    /(?:^| )(?:respuesta|answer) (?:(?:correcta|correct) )?(?:es|is) (?:(?:la|the|opcion|option) )?[b-d1-4](?: |$)/u.test(
      joined
    ) ||
    /(?:^| )(?:elige|selecciona|seleccione|choose|select|выберите|выбери) (?:(?:la|the|opcion|option) )?[b-d1-4](?: |$)/u.test(
      joined
    ) ||
    /(?:^| )(?:correcta|correct) (?:es|is) (?:(?:la|the) )?[b-d1-4](?: |$)/u.test(joined) ||
    visibleFields.some((field) =>
      /(?:^|[^\p{L}\p{N}])(?:[Ee]lige|[Ss]elecciona|[Ss]eleccione|[Cc]hoose|[Ss]elect|[Вв]ыберите|[Вв]ыбери|(?:[Rr]espuesta|[Aa]nswer|[Cc]orrecta|[Cc]orrect)\s+(?:(?:es|is)\s+)?)(?:\s+)?A(?=$|[^\p{L}\p{N}])/u.test(
        field
      )
    ) ||
    /(?:^| )(?:respuesta|answer) [a-d1-4] (?:es|is) (?:la |the )?(?:correcta|correct)(?: |$)/u.test(
      joined
    ) ||
    /(?:^| )[a-d1-4] (?:es|is) (?:la |the )?(?:correcta|correct|respuesta|answer)(?: |$)/u.test(
      joined
    );
  const selectionCue =
    /(?:^| )(?:answer|respuesta|ответ|choose|select|elige|selecciona|seleccione|выберите|выбери|correct choice|correct option|opcion correcta|respuesta correcta)(?: |$)/gu;
  const containsAnswer = (text: string, answer: string) => {
    const normalized = normalizedWords(answer);
    if (!normalized) return true;
    return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u.test(
      normalized
    )
      ? text.replaceAll(' ', '').includes(normalized.replaceAll(' ', ''))
      : ` ${text} `.includes(` ${normalized} `);
  };
  const selectsAnswer = (text: string, answer: string) => {
    const normalized = normalizedWords(answer);
    if (/^[a-z0-9]$/u.test(normalized)) return false;
    const unspaced =
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u.test(
        normalized
      );
    for (const cue of text.matchAll(selectionCue)) {
      const tail = text
        .slice(cue.index + cue[0].length)
        .replace(/^(?:(?:is|es|это|la|the|option|opcion|correct|correcta) )*/u, '');
      if (
        unspaced
          ? tail.replaceAll(' ', '').startsWith(normalized.replaceAll(' ', ''))
          : tail === normalized || tail.startsWith(`${normalized} `)
      )
        return true;
    }
    return (
      ` ${text} `.includes(` ${normalized} es la opcion correcta `) ||
      ` ${text} `.includes(` ${normalized} is the correct option `)
    );
  };
  const identifiesFormativeAnswer = formativeAnswers.some((answer) =>
    visible.some((field, index) => {
      if (
        /(?:answer|respuesta|ответ)\s*:/iu.test(visibleFields[index]!) &&
        containsAnswer(field, answer)
      )
        return true;
      if (selectsAnswer(field, answer)) return true;
      return index + 1 < visible.length && selectsAnswer(`${field} ${visible[index + 1]}`, answer);
    })
  );
  if (
    pointsToOption ||
    identifiesFormativeAnswer ||
    answers.some((answer) => containsAnswer(joined, answer))
  )
    throw new PrerequisiteDisclosureError();
}
