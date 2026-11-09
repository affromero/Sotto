import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readingVocabularySchema, type SkillRequirements, type SkillType } from '@sotto/shared';
import { resolveStorageInput } from '../../../sidedoor/storage/core/storage-inputs';
import type { LearningDatabase } from '../../database';
import type { Prisma } from '@/generated/prisma/client';
import { currentClassSections } from '../progress/current-sections';
import { savedClassQuestionMaterialSchema } from './class-material';
import { PreparationConflictError } from '../../../classes/preparation-state';
import { requireStageGuard } from '../../../classes/staging/stage-guard';
import { learningScriptHash } from '../../script-hash';
import { extractReadingVocabulary } from '../../reading-vocabulary';
import { withClassGeneration } from './class-generation-state';
import type { SottoProviderExecution } from '../../../sidedoor/credentials/runtime/provider-execution';

export type RepairClass = Prisma.CourseClassGetPayload<{
  include: {
    course: true;
    lesson: true;
    sections: {
      include: {
        questions: true;
        prompts: true;
        writingPrompts: true;
        episode: { include: { script: true } };
      };
    };
  };
}>;

/** Hold trigger definitions stable while checking the fences used by quiz receipts. */
export async function requireRepairQuizFence(database: LearningDatabase) {
  await database.$executeRaw`LOCK TABLE "ClassSection", "LessonQuestion" IN ROW EXCLUSIVE MODE`;
  const [result] = await database.$queryRaw<
    Array<{ triggers: number; helper: number; origin: boolean }>
  >`
    WITH expected(table_name, trigger_name, trigger_type, old_table, new_table, function_name, body_hash) AS (
      VALUES
        ('ClassSection', 'ClassSection_formative_insert', 4, NULL::text, 'new_rows', 'touchFormativeSectionStatement', 'e48aa9d7d90c559e808c4447445f9a90'),
        ('ClassSection', 'ClassSection_formative_update', 16, 'old_rows', 'new_rows', 'touchFormativeSectionStatement', 'e48aa9d7d90c559e808c4447445f9a90'),
        ('ClassSection', 'ClassSection_formative_delete', 8, 'old_rows', NULL::text, 'touchFormativeSectionStatement', 'e48aa9d7d90c559e808c4447445f9a90'),
        ('LessonQuestion', 'LessonQuestion_formative_insert', 4, NULL::text, 'new_rows', 'touchFormativeChildStatement', '5c2a77e411271a76bbb14d28e861350e'),
        ('LessonQuestion', 'LessonQuestion_formative_update', 16, 'old_rows', 'new_rows', 'touchFormativeChildStatement', '5c2a77e411271a76bbb14d28e861350e'),
        ('LessonQuestion', 'LessonQuestion_formative_delete', 8, 'old_rows', NULL::text, 'touchFormativeChildStatement', '5c2a77e411271a76bbb14d28e861350e'),
        ('ClassSection', 'ClassSection_incarnation_guard', 23, NULL::text, NULL::text, 'guardClassQuizIncarnation', '849b3f72d4975c448a92250cbad3a453'),
        ('LessonQuestion', 'LessonQuestion_incarnation_guard', 23, NULL::text, NULL::text, 'guardClassQuizIncarnation', '849b3f72d4975c448a92250cbad3a453')
    )
    SELECT (
      SELECT count(*)::int FROM expected e
      JOIN pg_namespace n ON n.nspname = current_schema()
      JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name
      JOIN pg_trigger t ON t.tgrelid = c.oid AND t.tgname = e.trigger_name
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_language l ON l.oid = p.prolang
      WHERE t.tgenabled IN ('O', 'A') AND t.tgtype = e.trigger_type
        AND t.tgoldtable IS NOT DISTINCT FROM e.old_table
        AND t.tgnewtable IS NOT DISTINCT FROM e.new_table
        AND t.tgnargs = 0 AND t.tgconstraint = 0 AND NOT t.tgisinternal
        AND t.tgqual IS NULL AND t.tgattr::text = ''
        AND p.pronamespace = n.oid AND p.proname = e.function_name
        AND p.pronargs = 0 AND NOT p.prosecdef AND p.proconfig IS NULL
        AND l.lanname = 'plpgsql' AND md5(p.prosrc) = e.body_hash
    ) AS triggers,
    (
      SELECT count(*)::int FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = current_schema() AND p.proname = 'touchFormativeClasses'
        AND p.pronargs = 1 AND p.proargtypes = '1009'::oidvector
        AND NOT p.prosecdef AND p.proconfig IS NULL AND l.lanname = 'plpgsql'
        AND md5(p.prosrc) = '4919a655b6c2946dcdbcc7febcdb4b64'
    ) AS helper,
    current_setting('session_replication_role') = 'origin' AS origin
  `;
  if (!result || result.triggers !== 8 || result.helper !== 1 || !result.origin)
    throw new PreparationConflictError('The class quiz database fence is unavailable.');
}

function canonicalJson(value: Prisma.JsonValue): Prisma.JsonValue {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalJson(value[key]!)])
    );
  return value;
}

/** Bind all historical questions and saved answers used to construct a retry prompt. */
export function quizRetrySourceDigest(
  cls: Pick<
    Prisma.CourseClassGetPayload<{ include: { sections: { include: { questions: true } } } }>,
    'id' | 'courseId' | 'learnerAnswers' | 'sections'
  >,
  skill: SkillType,
  beforeAttempt: number
) {
  const sections = cls.sections
    .filter((section) => section.skill === skill && section.attempt < beforeAttempt)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((section) => ({
      id: section.id,
      incarnationId: section.incarnationId,
      skill: section.skill,
      attempt: section.attempt,
      withdrawn: section.withdrawn,
      status: section.status,
      score: section.score,
      passed: section.passed,
      passThreshold: section.passThreshold,
      seed: section.seed,
      spec: canonicalJson(section.spec),
      episodeId: section.episodeId,
      questions: [...section.questions]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((question) => ({
          id: question.id,
          incarnationId: question.incarnationId,
          order: question.order,
          skill: question.skill,
          question: question.question,
          options: canonicalJson(question.options),
          correctIndex: question.correctIndex,
          explanation: question.explanation,
          vocabIds: question.vocabIds,
          grammarKeys: question.grammarKeys,
          passageRef: question.passageRef,
          passageText: question.passageText,
          learningAssessment: canonicalJson(question.learningAssessment),
        })),
    }));
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        classId: cls.id,
        courseId: cls.courseId,
        skill,
        answers: canonicalJson(cls.learnerAnswers),
        sections,
      })
    )
    .digest('hex');
}

export async function readReadingRepairSnapshot(
  database: LearningDatabase,
  classId: string,
  attempt: number
) {
  await requireRepairQuizFence(database);
  await requireStageGuard(database, 'READING');
  await database.$queryRaw`SELECT id FROM "ClassSection" WHERE "classId" = ${classId} AND skill = 'READING' AND attempt < ${attempt} ORDER BY id FOR UPDATE`;
  const cls = await database.courseClass.findUniqueOrThrow({
    where: { id: classId },
    include: {
      sections: {
        where: { skill: 'READING', attempt: { lt: attempt } },
        include: { questions: true },
      },
    },
  });
  const current = currentClassSections(cls.sections);
  const passages = new Set(
    current.flatMap((item) => item.questions.map((question) => question.passageText))
  );
  return {
    readingVocabulary: cls.readingVocabulary,
    progressRevision: cls.progressRevision,
    digest: quizRetrySourceDigest(cls, 'READING', attempt),
    passage: current.length === 1 && passages.size === 1 ? ([...passages][0] ?? null) : null,
  };
}

/** Bind retained quiz rows to the repair that selected them. */
export function retainedQuizReceipt(cls: RepairClass, selectedSkills: readonly SkillType[]) {
  const retained = currentClassSections(cls.sections)
    .filter(
      (section) =>
        ['GRAMMAR', 'READING', 'LISTENING'].includes(section.skill) &&
        !selectedSkills.includes(section.skill)
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    version: 1 as const,
    sections: retained.map((section) => ({
      sectionId: section.id,
      digest: createHash('sha256')
        .update(
          JSON.stringify({
            id: section.id,
            incarnationId: section.incarnationId,
            classId: section.classId,
            skill: section.skill,
            attempt: section.attempt,
            withdrawn: section.withdrawn,
            status: section.status,
            seed: section.seed,
            spec: canonicalJson(section.spec),
            passThreshold: section.passThreshold,
            episodeId: section.episodeId,
            questions: [...section.questions]
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((question) => ({
                id: question.id,
                incarnationId: question.incarnationId,
                sectionId: question.sectionId,
                order: question.order,
                skill: question.skill,
                question: question.question,
                options: canonicalJson(question.options),
                correctIndex: question.correctIndex,
                explanation: question.explanation,
                vocabIds: question.vocabIds,
                grammarKeys: question.grammarKeys,
                passageRef: question.passageRef,
                passageText: question.passageText,
                learningAssessment: canonicalJson(question.learningAssessment),
                createdAt: question.createdAt.toISOString(),
              })),
          })
        )
        .digest('hex'),
    })),
  };
}

/** Called under the class generation lock before a repair creates a new section. */
export async function assertRepairQuizPreserved(
  database: LearningDatabase,
  classId: string,
  attempt: number,
  skills: readonly SkillType[],
  retry?: { sectionId: string; skill: SkillType }
) {
  const sections = await database.classSection.findMany({
    where: { classId, skill: { in: [...skills] } },
    include: { questions: true },
  });
  if (sections.some((section) => section.attempt >= attempt))
    throw new PreparationConflictError('A repair section already exists for this attempt.');
  for (const section of currentClassSections(sections)) {
    const shortQuiz = section.questions.some(
      (question) =>
        Array.isArray(question.options) &&
        question.options.length < 4 &&
        savedClassQuestionMaterialSchema.safeParse(question).success
    );
    if (!shortQuiz) continue;
    const sameSkill = sections.filter(
      (other) => other.skill === section.skill && other.attempt === section.attempt
    );
    if (retry?.sectionId === section.id && retry.skill === section.skill && sameSkill.length === 1)
      continue;
    throw new PreparationConflictError(
      'This class has saved quiz material that cannot be safely replaced during repair.'
    );
  }
}

export function classRepairSkills(cls: RepairClass, requirements: SkillRequirements): SkillType[] {
  const sections = currentClassSections(cls.sections);
  return (Object.keys(requirements.skills) as SkillType[]).filter((skill) => {
    const requirement = requirements.skills[skill];
    if (requirement.state !== 'REQUIRED') return false;
    const section = sections.find((candidate) => candidate.skill === skill);
    if (!section || section.passed === false || !['READY', 'PASSED'].includes(section.status))
      return true;
    const items =
      skill === 'SPEAKING'
        ? section.prompts
        : skill === 'WRITING'
          ? section.writingPrompts
          : section.questions;
    if (
      items.length !== requirement.expectedCount ||
      new Set(items.map((item) => item.id)).size !== items.length
    )
      return true;
    if (skill === 'SPEAKING')
      return section.prompts.some(
        (prompt) =>
          !prompt.targetPhrase.trim() ||
          !prompt.translation.trim() ||
          (requirements.referenceAudioRequired && !prompt.referenceTtsUrl?.trim())
      );
    if (skill === 'WRITING') return section.writingPrompts.some((prompt) => !prompt.task.trim());
    if (
      section.questions.some(
        (question) =>
          question.skill !== skill || !savedClassQuestionMaterialSchema.safeParse(question).success
      )
    )
      return true;
    if (skill === 'READING') {
      const passage = section.questions[0]?.passageText;
      return (
        !passage?.trim() || section.questions.some((question) => question.passageText !== passage)
      );
    }
    if (skill === 'LISTENING') {
      const episode = section.episode;
      if (
        !episode ||
        episode.deletedAt ||
        episode.userId !== cls.course.userId ||
        !episode.script ||
        !['READY', 'SCRIPT_READY', 'PENDING', 'GENERATING_AUDIO', 'STITCHING'].includes(
          episode.status
        ) ||
        (episode.status === 'READY' && !episode.audioUrl?.trim())
      )
        return true;
      try {
        return (
          !section.spec ||
          typeof section.spec !== 'object' ||
          Array.isArray(section.spec) ||
          section.spec.scriptHash !== learningScriptHash(episode.script.turns)
        );
      } catch {
        return true;
      }
    }
    return false;
  });
}

/** Extraction-only repair keeps questions, answers and existing productive evidence. */
export async function repairClassReadingMemory(
  cls: RepairClass,
  requirements: SkillRequirements,
  execution: SottoProviderExecution,
  attempt: number
) {
  if (requirements.skills.READING.state !== 'REQUIRED') return;
  const readings = currentClassSections(cls.sections).filter(
    (section) => section.skill === 'READING'
  );
  if (readings.length === 0) return;
  if (readings.length !== 1)
    throw new PreparationConflictError('The current reading material is ambiguous.');
  const reading = readings[0]!;
  const snapshot = (section: typeof reading) => ({
    id: section.id,
    incarnationId: section.incarnationId,
    classId: section.classId,
    skill: section.skill,
    attempt: section.attempt,
    withdrawn: section.withdrawn,
    status: section.status,
    seed: section.seed,
    spec: section.spec,
    questions: [...section.questions].sort((a, b) => a.id.localeCompare(b.id)),
  });
  const sourceSnapshot = snapshot(reading);
  const questions = reading.questions.map((question) => ({
    id: question.id,
    question: question.question,
    options: question.options as string[],
    correctIndex: question.correctIndex,
    passageText: question.passageText,
  }));
  const saved = readingVocabularySchema.safeParse(cls.readingVocabulary);
  const ids = new Set(questions.map((question) => question.id));
  const valid =
    saved.success &&
    questions.every((question) => question.passageText === saved.data.passageText) &&
    saved.data.sourceHash === createHash('sha256').update(saved.data.passageText).digest('hex') &&
    new Set(saved.data.words.map((word) => word.lemma)).size === saved.data.words.length &&
    saved.data.words.every(
      (word) =>
        saved.data.passageText.includes(word.sourceForm) &&
        new Set(word.questionIds).size === word.questionIds.length &&
        word.questionIds.every((id) => ids.has(id))
    );
  const vocabulary = valid
    ? saved.data
    : await extractReadingVocabulary({
        userId: execution.userId,
        execution,
        nativeLang: requirements.nativeLang,
        targetLang: requirements.targetLang,
        level: requirements.level,
        readingQuestionMode: 'saved',
        questions,
      });
  await withClassGeneration(execution, cls.id, attempt, async (database) => {
    await requireRepairQuizFence(database);
    const current = await database.courseClass.findUniqueOrThrow({
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
    const currentReadings = currentClassSections(current.sections).filter(
      (section) => section.skill === 'READING'
    );
    if (
      currentReadings.length !== 1 ||
      !isDeepStrictEqual(snapshot(currentReadings[0]!), sourceSnapshot) ||
      !isDeepStrictEqual(current.readingVocabulary, cls.readingVocabulary) ||
      !isDeepStrictEqual(current.skillRequirements, cls.skillRequirements)
    )
      throw new PreparationConflictError('The reading material changed during repair.');
    await database.courseClass.update({
      where: { id: cls.id },
      data: { readingVocabulary: vocabulary },
    });
  });
}

/** Storage attribution must survive a repair even when a URL remains populated. */
export async function selectClassRepairSkills(
  database: LearningDatabase,
  cls: RepairClass,
  requirements: SkillRequirements,
  allowRetainedShortQuiz = false
) {
  const skills = classRepairSkills(cls, requirements);
  const retainedShortQuiz = currentClassSections(cls.sections).some(
    (section) =>
      (!allowRetainedShortQuiz || skills.includes(section.skill)) &&
      section.questions.some(
        (question) =>
          Array.isArray(question.options) &&
          question.options.length < 4 &&
          savedClassQuestionMaterialSchema.safeParse(question).success
      )
  );
  if (retainedShortQuiz)
    throw new PreparationConflictError(
      'This class has saved quiz material that cannot be safely replaced during repair.'
    );
  if (!requirements.referenceAudioRequired || skills.includes('SPEAKING')) return skills;
  const prompts =
    currentClassSections(cls.sections).find((section) => section.skill === 'SPEAKING')?.prompts ??
    [];
  for (const prompt of prompts) {
    try {
      if (!prompt.referenceTtsUrl) throw new Error('Missing speaking reference');
      await resolveStorageInput(database, {
        consumer: `speaking-prompt:${prompt.id}:reference`,
        reference: prompt.referenceTtsUrl,
      });
    } catch {
      return [...skills, 'SPEAKING' as const];
    }
  }
  return skills;
}
