import { isDeepStrictEqual } from 'node:util';
import { learningSkills, type SkillType } from '@sotto/shared';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import type { SottoProviderExecution } from '../../../sidedoor/credentials/runtime/provider-execution';
import { capturePrerequisiteOwnership } from '../../../classes/help/lifecycle/prerequisite-ownership';
import { assessmentFormativeRevision } from './assessment-formative-revision';
import { speakingTaskMode } from '../../../learning-map/evidence/communicative-speaking';
import { assertSelectedLearningAudio } from '../../../learning-map/evidence/audio';
import { learningAudioIdentitySchema } from '../../../learning-map/evidence/media-protocol';
import type { StorageInput } from '../../../sidedoor/storage/core/storage-inputs';
import { classRequirementsOrLegacy, readSkillRequirements } from '../../skill-requirements';
import { learningScriptTranscript } from '../../script-hash';
import { currentClassSections } from '../progress/current-sections';
import { assertLearningMaterial } from '../../session-evaluation';
import {
  assessmentMaterialDigest,
  assertAssessmentTaskIndependence,
  parseAssessmentMaterial,
  assessmentSpeakingCriteriaSchema,
  type AssessmentTask,
  type PrivateAssessmentMaterial,
} from './assessment-material';
import {
  assessmentListeningAudioIdentity,
  assessmentSpeakingReferenceIdentity,
  assessmentSpeakingReferenceSchema,
} from './assessment-audio';
import { fenceAssessmentStorageInputs } from '../lifecycle/assessment-storage-fence';
import { resolveOwnedClassStorage } from '../lifecycle/assessment-storage-relocation';
import { verifyAssessmentAudioRecovery } from '../audio/assessment-audio-recovery';
import { matchesPublishedStorageIdentity } from '@/lib/sidedoor/storage/migration/storage-publication';
import { AssessmentSourceConflict } from './assessment-source';
import { assessmentWritingTask } from '../writing/assessment-writing-task';
import { capturePriorAssessmentExposure } from '../history/assessment-prior-exposure';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';

type Ownership = Awaited<ReturnType<typeof capturePrerequisiteOwnership>>;
export type AssessmentAudioSource = {
  original: StorageInput;
  currentReference: string;
  contentSha256: string;
  contentBytes: number;
} & ({ kind: 'LISTENING'; sectionId: string } | { kind: 'SPEAKING'; promptId: string });
type Candidate =
  | {
      status: 'CAPTURED';
      material: PrivateAssessmentMaterial;
      digest: string;
      passThresholds: Partial<Record<SkillType, number>>;
      formativeIds: string[];
      formativeTasks: AssessmentTask[];
      priorAssessments: Awaited<ReturnType<typeof capturePriorAssessmentExposure>>;
      audioSources: AssessmentAudioSource[];
      prerequisiteAddendum: Awaited<ReturnType<typeof assessmentFormativeRevision>>['addendum'];
    }
  | { status: 'PREPARING_AUDIO' };

/**
 * Capture only. Publication must authenticate review, fence media and storage
 * registry writers, and revalidate the snapshot before sealing. Storage row
 * locks must remain held until the transaction that seals the material commits.
 */
export async function captureAssessmentCandidate(
  database: Prisma.TransactionClient,
  execution: SottoProviderExecution,
  expected: {
    classId: string;
    assessmentId: string;
    classAttempt: number;
    assessmentAttempt: number;
    materialVersion?: 2;
    generationOperationId: string;
    ownership: Ownership;
  }
): Promise<Candidate> {
  return captureAssessmentMaterial(database, execution, expected, 'GENERATING');
}

/** Capture a sealed assessment only after the caller has verified its durable outcome. */
export async function captureSealedAssessmentCandidate(
  database: Prisma.TransactionClient,
  execution: SottoProviderExecution,
  expected: {
    classId: string;
    assessmentId: string;
    classAttempt: number;
    assessmentAttempt: number;
    materialVersion?: 2;
    generationOperationId: string;
    ownership: Ownership;
  }
): Promise<Candidate> {
  return captureAssessmentMaterial(database, execution, expected, 'READY');
}

async function captureAssessmentMaterial(
  database: Prisma.TransactionClient,
  execution: SottoProviderExecution,
  expected: {
    classId: string;
    assessmentId: string;
    classAttempt: number;
    assessmentAttempt: number;
    materialVersion?: 2;
    generationOperationId: string;
    ownership: Ownership;
  },
  phase: 'GENERATING' | 'READY'
): Promise<Candidate> {
  execution.signal?.throwIfAborted();
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment capture requires a Serializable transaction');
  const actor = await execution.authorize(database);
  if (actor.userId !== execution.userId || actor.userId !== expected.ownership.userId)
    throw new Error('Assessment learner changed.');
  await database.$queryRaw`SELECT c.id FROM "CourseClass" c JOIN "Course" o ON o.id = c."courseId" WHERE c.id = ${expected.classId} AND o."userId" = ${actor.userId} FOR UPDATE OF c`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${expected.assessmentId} AND "classId" = ${expected.classId} AND "userId" = ${actor.userId} FOR UPDATE`;
  // Locks protect rows after acquisition. A transaction snapshot established
  // earlier can still miss a child committed before its parent lock; publication
  // must fence all source writers and revalidate the resulting snapshot.
  await database.$queryRaw`SELECT o.id FROM "Course" o JOIN "CourseClass" c ON c."courseId" = o.id WHERE c.id = ${expected.classId} AND o."userId" = ${actor.userId} FOR SHARE OF o`;
  await database.$queryRaw`SELECT l.id FROM "Lesson" l JOIN "CourseClass" c ON c."lessonId" = l.id JOIN "Course" o ON o.id = c."courseId" WHERE c.id = ${expected.classId} AND o."userId" = ${actor.userId} FOR SHARE OF l`;
  await database.$queryRaw`SELECT e.id FROM "Episode" e WHERE e."userId" = ${actor.userId} AND e.id IN (SELECT s."episodeId" FROM "ClassSection" s WHERE s."classId" = ${expected.classId} UNION SELECT a."episodeId" FROM "ClassAssessmentSection" a WHERE a."assessmentId" = ${expected.assessmentId}) ORDER BY e.id FOR UPDATE OF e`;
  // Held-out media writers touch their episode before changing child rows.
  // Lock only formative scripts here to avoid an episode/child lock inversion.
  await database.$queryRaw`SELECT s.id FROM "Script" s JOIN "Episode" e ON e.id = s."episodeId" WHERE e."userId" = ${actor.userId} AND e."assessmentAudioAssessmentId" IS NULL AND e.id IN (SELECT c."episodeId" FROM "ClassSection" c WHERE c."classId" = ${expected.classId}) ORDER BY s.id FOR UPDATE OF s`;
  const cls = await database.courseClass.findFirst({
    where: { id: expected.classId, course: { userId: actor.userId } },
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
  const assessment = await database.classAssessment.findUnique({
    where: { id: expected.assessmentId },
    include: {
      sections: {
        include: {
          questions: { orderBy: { order: 'asc' } },
          speakingPrompts: {
            orderBy: { order: 'asc' },
            include: { assessmentReference: true },
          },
          writingPrompts: { orderBy: { order: 'asc' } },
          episode: { include: { script: true } },
        },
      },
    },
  });
  if (
    !cls ||
    !assessment ||
    assessment.classId !== cls.id ||
    assessment.courseId !== cls.courseId ||
    assessment.userId !== actor.userId ||
    cls.attempt !== expected.classAttempt ||
    assessment.classAttempt !== expected.classAttempt ||
    assessment.assessmentAttempt !== expected.assessmentAttempt ||
    assessment.materialVersion !== (expected.materialVersion ?? 1) ||
    assessment.generationOperationId !== expected.generationOperationId ||
    assessment.status !== phase ||
    (phase === 'GENERATING' ? assessment.sealedAt !== null : assessment.sealedAt === null) ||
    !['AVAILABLE', 'IN_PROGRESS'].includes(cls.status)
  )
    throw new Error('Assessment class or generation changed.');
  const ownership = await capturePrerequisiteOwnership(
    database,
    cls.id,
    cls.courseId,
    actor.userId
  );
  if (!isDeepStrictEqual(ownership, expected.ownership))
    throw new Error('Assessment ownership changed.');
  const priorAssessments = await capturePriorAssessmentExposure(database, {
    classId: cls.id,
    courseId: cls.courseId,
    userId: actor.userId,
    classAttempt: expected.classAttempt,
    assessmentAttempt: expected.assessmentAttempt,
  });
  const requirements = classRequirementsOrLegacy(cls.skillRequirements, {
    nativeLang: cls.course.nativeLang,
    targetLang: cls.course.targetLang,
    level: cls.lesson.level,
  });
  if (
    requirements.scope !== 'CLASS' ||
    !isDeepStrictEqual(requirements, readSkillRequirements(assessment.requirements))
  )
    throw new Error('Assessment requirements changed.');
  const formative = await assessmentFormativeRevision(database, cls.id, actor.userId);
  const formativeRevision = formative.revision;
  if (
    assessment.formativeRevision !== formativeRevision ||
    assessment.teachingKind !== formative.teachingReceipt.kind ||
    assessment.teachingReceiptId !== formative.teachingReceipt.receiptId
  )
    throw new AssessmentSourceConflict('Assessment formative material changed.');
  const current = currentClassSections(cls.sections);
  if (current.some((section) => section.skill === 'LISTENING' && !section.episode?.script))
    throw new Error('Formative listening script is unavailable.');
  const passThresholds: Partial<Record<SkillType, number>> = {};
  for (const section of current) passThresholds[section.skill] = section.passThreshold;
  const formativeIds = current.flatMap((section) => [
    ...section.questions.map((item) => item.id),
    ...section.prompts.map((item) => item.id),
    ...section.writingPrompts.map((item) => item.id),
  ]);
  const formativeTasks: AssessmentTask[] = current.flatMap((section) => [
    ...section.questions.map((item) => ({
      skill: section.skill,
      task: item.question,
      options: z.array(z.string()).parse(item.options),
      context:
        item.passageText ??
        (section.skill === 'LISTENING' && section.episode?.script
          ? learningScriptTranscript(section.episode.script.turns)
          : null),
    })),
    ...section.prompts.map((item) => ({
      skill: section.skill,
      task: item.targetPhrase,
      mode: speakingTaskMode(item.learningObjectives),
    })),
    ...section.writingPrompts.map((item) => ({ skill: section.skill, task: item.task })),
  ]);
  for (const previous of priorAssessments) {
    formativeIds.push(...previous.tasks.map((task) => task.id));
    formativeTasks.push(
      ...previous.tasks.map((task) => ({
        skill: task.skill,
        task: task.task,
        ...('options' in task ? { options: task.options } : {}),
        ...('context' in task ? { context: task.context } : {}),
        ...('mode' in task ? { mode: task.mode } : {}),
      }))
    );
  }
  const sections: PrivateAssessmentMaterial['sections'] = [];
  const storageInputs: StorageInput[] = [];
  const audioSources: AssessmentAudioSource[] = [];
  for (const section of [...assessment.sections].sort(
    (a, b) => learningSkills.indexOf(a.skill) - learningSkills.indexOf(b.skill)
  )) {
    if (
      requirements.skills[section.skill].state !== 'REQUIRED' ||
      passThresholds[section.skill] !== section.passThreshold
    )
      throw new Error('Assessment skill or threshold changed.');
    if (section.skill === 'SPEAKING') {
      if (
        section.questions.length ||
        section.writingPrompts.length ||
        section.episodeId ||
        section.passageText ||
        section.audioIdentity
      )
        throw new Error('Assessment section has unexpected material.');
      const items = [];
      for (const prompt of section.speakingPrompts) {
        if (!prompt.assessmentRubric) throw new Error('Assessment speaking rubric is missing.');
        let referenceAudioId: string | null = null;
        if (prompt.assessmentReferenceIdentity !== null) {
          const reference = assessmentSpeakingReferenceSchema.parse(
            prompt.assessmentReferenceIdentity
          );
          if (
            prompt.referenceTtsUrl !== reference.reference.reference ||
            !prompt.assessmentReference ||
            (reference.provenance &&
              (reference.provenance.operationId !== expected.generationOperationId ||
                reference.provenance.inputDigest !==
                  learningProviderInputHash({
                    task: prompt.targetPhrase,
                    language: cls.course.targetLang,
                  })))
          )
            throw new Error('Assessment speaking reference changed.');
          referenceAudioId = assessmentSpeakingReferenceIdentity(reference, {
            assessmentId: assessment.id,
            promptId: prompt.id,
            userId: actor.userId,
          });
          if (phase === 'GENERATING') {
            if (prompt.assessmentReference.currentUrl !== reference.reference.reference)
              throw new Error('Assessment speaking reference changed.');
            storageInputs.push(reference.reference);
          } else {
            const proof = await resolveOwnedClassStorage(database, {
              classId: cls.id,
              courseId: cls.courseId,
              userId: actor.userId,
              original: reference.reference,
              currentReference: prompt.assessmentReference.currentUrl,
            });
            if (
              !matchesPublishedStorageIdentity(proof, {
                original: reference.reference,
                currentReference: prompt.assessmentReference.currentUrl,
                contentSha256: reference.contentSha256,
                contentBytes: reference.contentBytes,
              })
            )
              throw new Error('Sealed assessment speaking reference attribution changed.');
          }
          audioSources.push({
            kind: 'SPEAKING',
            promptId: prompt.id,
            original: reference.reference,
            currentReference: prompt.assessmentReference.currentUrl,
            contentSha256: reference.contentSha256,
            contentBytes: reference.contentBytes,
          });
        } else if (prompt.referenceTtsUrl !== null || prompt.assessmentReference !== null)
          throw new Error('Assessment speaking reference is unverified.');
        items.push({
          id: prompt.id,
          task: prompt.targetPhrase,
          mode: z.enum(['READ_ALOUD', 'COMMUNICATIVE']).parse(prompt.assessmentTaskMode),
          referenceAudioId,
          privateRubric: prompt.assessmentRubric,
          ...(prompt.assessmentCriteria !== null
            ? { privateCriteria: assessmentSpeakingCriteriaSchema.parse(prompt.assessmentCriteria) }
            : {}),
          privateGuidance: prompt.assessmentGuidance ?? prompt.translation,
          privateTranslation: prompt.translation,
          privateIpa: prompt.ipa,
          privateLearningObjectives: z.json().nullable().parse(prompt.learningObjectives),
        });
      }
      sections.push({
        id: section.id,
        skill: 'SPEAKING',
        passThreshold: section.passThreshold,
        items,
      });
      continue;
    }
    if (section.skill === 'WRITING') {
      if (
        section.questions.length ||
        section.speakingPrompts.length ||
        section.episodeId ||
        section.passageText ||
        section.audioIdentity
      )
        throw new Error('Assessment section has unexpected material.');
      sections.push({
        id: section.id,
        skill: 'WRITING',
        passThreshold: section.passThreshold,
        items: section.writingPrompts.map(assessmentWritingTask),
      });
      continue;
    }
    if (section.speakingPrompts.length || section.writingPrompts.length)
      throw new Error('Assessment section has unexpected material.');
    let audio: Extract<
      PrivateAssessmentMaterial['sections'][number],
      { passageText: unknown }
    >['audio'] = null;
    if (section.skill === 'LISTENING') {
      const episode = section.episode;
      if (
        !episode ||
        section.audioReservationEpisodeId !== episode.id ||
        section.audioReservationOperationId !== expected.generationOperationId ||
        episode.userId !== actor.userId ||
        episode.deletedAt ||
        episode.visibility !== 'PRIVATE' ||
        episode.source !== 'CLASS' ||
        episode.language !== requirements.targetLang ||
        episode.status === 'FAILED'
      )
        throw new Error('Assessment listening media is unavailable.');
      if (
        (await database.classSection.findFirst({
          where: { episodeId: episode.id },
          select: { id: true },
        })) ||
        (await database.examSection.findFirst({
          where: { episodeId: episode.id },
          select: { id: true },
        })) ||
        (await database.practiceSession.findFirst({
          where: { episodeId: episode.id },
          select: { id: true },
        }))
      )
        throw new Error('Assessment listening media is already used by another activity.');
      if (episode.status !== 'READY') {
        if (phase === 'READY') throw new Error('Sealed assessment audio is unavailable.');
        execution.signal?.throwIfAborted();
        return { status: 'PREPARING_AUDIO' };
      }
      if (!episode.script || episode.script.soundCues !== null || !section.audioIdentity)
        throw new Error('Assessment listening media is unverified.');
      const selected = learningAudioIdentitySchema.parse(section.audioIdentity);
      if (phase === 'GENERATING') {
        await assertSelectedLearningAudio(database, selected);
        storageInputs.push(selected.reference);
      } else {
        if (!episode.audioUrl || !episode.lastCompletedStitchKey)
          throw new Error('Sealed assessment audio is unavailable.');
        await verifyAssessmentAudioRecovery(database, {
          episodeId: episode.id,
          userId: actor.userId,
          generationKey: selected.audioGenerationKey,
          audioUrl: selected.reference.reference,
          version: selected.version,
          stitchKey: episode.lastCompletedStitchKey,
          association: {
            id: section.id,
            assessmentId: assessment.id,
            classId: cls.id,
            classAttempt: assessment.classAttempt,
            currentClassAttempt: cls.attempt,
            assessmentAttempt: assessment.assessmentAttempt,
          },
          signal: execution.signal,
        });
        const proof = await resolveOwnedClassStorage(database, {
          classId: cls.id,
          courseId: cls.courseId,
          userId: actor.userId,
          episodeId: episode.id,
          original: selected.reference,
          currentReference: episode.audioUrl,
        });
        if (
          !matchesPublishedStorageIdentity(proof, {
            original: selected.reference,
            currentReference: episode.audioUrl,
            contentSha256: selected.contentSha256,
            contentBytes: selected.contentBytes,
          })
        )
          throw new Error('Sealed assessment audio attribution changed.');
      }
      if (!episode.audioUrl) throw new Error('Assessment listening media is unavailable.');
      audioSources.push({
        kind: 'LISTENING',
        sectionId: section.id,
        original: selected.reference,
        currentReference: episode.audioUrl,
        contentSha256: selected.contentSha256,
        contentBytes: selected.contentBytes,
      });
      audio = {
        episodeId: episode.id,
        mediaIdentity: assessmentListeningAudioIdentity(selected, {
          episodeId: episode.id,
          userId: actor.userId,
          turns: episode.script.turns,
        }),
        privateTranscript: learningScriptTranscript(episode.script.turns),
      };
    } else if (section.episodeId || section.audioIdentity)
      throw new Error('Assessment section has unexpected audio.');
    sections.push({
      id: section.id,
      skill: section.skill,
      passThreshold: section.passThreshold,
      items: section.questions.map((question) => ({
        id: question.id,
        question: question.question,
        options: z.array(z.string()).parse(question.options),
        correctIndex: question.correctIndex,
        explanation: question.explanation,
      })),
      passageText: section.passageText,
      audio,
    });
  }
  assertLearningMaterial(
    requirements,
    sections.map((section) => ({
      skill: section.skill,
      itemIds: section.items.map((item) => item.id),
      ...('passageText' in section
        ? {
            passageText: section.passageText,
            audio:
              section.skill === 'LISTENING'
                ? (assessment.sections.find((candidate) => candidate.id === section.id)?.episode ??
                  null)
                : null,
          }
        : {}),
      ...(section.skill === 'SPEAKING'
        ? {
            referenceAudioUrls: section.items.map((item) => item.referenceAudioId),
            speakingTaskModes: section.items.map((item) => item.mode),
          }
        : {}),
    })),
    true
  );
  await fenceAssessmentStorageInputs(database, storageInputs);
  const speakingItems = sections.flatMap((section) =>
    section.skill === 'SPEAKING' ? section.items : []
  );
  const withCriteria = speakingItems.filter((item) => item.privateCriteria !== undefined).length;
  const materialVersion = expected.materialVersion ?? 1;
  if (
    (materialVersion === 1 && withCriteria !== 0) ||
    (materialVersion === 2 && withCriteria !== speakingItems.length)
  )
    throw new Error('Assessment speaking criteria are incomplete.');
  const material: PrivateAssessmentMaterial = {
    version: materialVersion,
    id: assessment.id,
    classId: cls.id,
    courseId: cls.courseId,
    userId: actor.userId,
    classAttempt: assessment.classAttempt,
    assessmentAttempt: assessment.assessmentAttempt,
    formativeRevision,
    requirements,
    sections,
  };
  execution.signal?.throwIfAborted();
  const canonical = parseAssessmentMaterial(material);
  if (!isDeepStrictEqual(material, canonical))
    throw new Error('Assessment material is not canonical.');
  assertAssessmentTaskIndependence(canonical, formativeIds, formativeTasks);
  return {
    status: 'CAPTURED',
    material: canonical,
    digest: assessmentMaterialDigest(canonical),
    passThresholds,
    formativeIds,
    formativeTasks,
    priorAssessments,
    audioSources,
    prerequisiteAddendum: formative.addendum,
  };
}
