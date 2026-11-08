import { isDeepStrictEqual } from 'node:util';
import { learningSkills } from '@sotto/shared';
import { delegationGrantBinding } from 'thesidedoor-core/runtime/delegation';
import { prepareJob } from 'thesidedoor-core/runtime/outbox';
import type { Prisma } from '@/generated/prisma/client';
import {
  requireModeratedPrerequisitePayload,
  requirePrerequisiteBaseCapacity,
} from '@/lib/classes/help/content/prerequisite-json';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { SIDEDOOR_STATE_ID } from '@/lib/sidedoor/access/state/store';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoJobOutbox } from '@/lib/sidedoor/jobs/core/job-delivery';
import { captureAssessmentGenerationSource } from '../material/assessment-source';
import { requireAssessmentPracticeComplete } from '../practice/assessment-practice';
import { capturePriorAssessmentExposure } from '../history/assessment-prior-exposure';
import { readAloudPolicyForPractice } from '../speaking/assessment-speaking-policy';
import {
  admitAssessmentFence,
  assessmentFenceBackend,
  assessmentFenceSchema,
  assessmentFenceStore,
  assessmentWorkSchema,
  AssessmentFenceConflict,
  recordAssessmentFence,
  type AssessmentFence,
} from '../lifecycle/assessment-fence';

export function assessmentProviderBudget(skillCount: number) {
  if (!Number.isSafeInteger(skillCount) || skillCount < 1 || skillCount > learningSkills.length)
    throw new AssessmentFenceConflict();
  return 1 + 3 * (skillCount + 1) + 3;
}

export class AssessmentSpeakingPolicyUnavailable extends Error {
  constructor() {
    super('This speaking assessment cannot yet be graded with the current practice format.');
    this.name = 'AssessmentSpeakingPolicyUnavailable';
  }
}

/** Reserve review capacity before any provider work is admitted. */
export function requirePriorAssessmentReviewCapacity(input: {
  lesson: unknown;
  prerequisite: unknown;
  priorTasks: unknown;
}) {
  const payload = requireModeratedPrerequisitePayload(JSON.stringify(input));
  requirePrerequisiteBaseCapacity(payload);
}

/** Admit learner-requested work only after the current formative practice is complete. */
export async function admitLearnerAssessmentWork(
  database: Prisma.TransactionClient,
  input: Parameters<typeof admitAssessmentWork>[1]
) {
  input.execution.signal?.throwIfAborted();
  const actor = await input.execution.authorize(database);
  if (actor.userId !== input.execution.userId) throw new AssessmentFenceConflict();
  await requireAssessmentPracticeComplete(database, {
    classId: input.classId,
    classAttempt: input.classAttempt,
    userId: actor.userId,
  });
  return admitAssessmentWork(database, { ...input, canonicalSpeaking: true });
}

/** Admit privately. The caller commits this together with the grant and outbox before delivery. */
export async function admitAssessmentWork(
  database: Prisma.TransactionClient,
  input: {
    id: string;
    revision: string;
    assessmentId: string;
    classId: string;
    classAttempt: number;
    assessmentAttempt: number;
    materialVersion?: 2;
    canonicalSpeaking?: boolean;
    expiresAt: number;
    selection: AssessmentFence['selection'];
    cliBinding?: AssessmentFence['cliBinding'];
    execution: SottoProviderExecution;
  }
) {
  if (input.assessmentAttempt !== 1) throw new AssessmentFenceConflict();
  const selection = structuredClone(input.selection);
  const source = await captureAssessmentGenerationSource(database, input.execution, {
    classId: input.classId,
    classAttempt: input.classAttempt,
  });
  const skills = learningSkills.filter(
    (skill) => source.requirements.skills[skill].state === 'REQUIRED'
  );
  if (!skills.length) throw new AssessmentFenceConflict();
  const priorAssessments = await capturePriorAssessmentExposure(database, {
    classId: source.classId,
    courseId: source.courseId,
    userId: source.userId,
    classAttempt: source.classAttempt,
    assessmentAttempt: input.assessmentAttempt,
  });
  if (priorAssessments.length) throw new AssessmentFenceConflict();
  if (priorAssessments.length) {
    requirePriorAssessmentReviewCapacity({
      lesson: source.source,
      prerequisite: source.prerequisite,
      priorTasks: priorAssessments.map((prior) => prior.tasks),
    });
  }
  for (const skill of skills) {
    const requirement = source.requirements.skills[skill];
    if (requirement.state !== 'REQUIRED') throw new AssessmentFenceConflict();
    const payload = requireModeratedPrerequisitePayload(
      JSON.stringify({
        source: source.source,
        prerequisite: source.prerequisite,
        skill,
        count: requirement.expectedCount,
        ...(priorAssessments.length
          ? { priorTasks: priorAssessments.map((prior) => prior.tasks) }
          : {}),
      })
    );
    requirePrerequisiteBaseCapacity(payload);
  }
  const subject = source.ownership.scopes.find(
    (scope) => scope.subjectId === `profile:${source.userId}`
  );
  const resource = source.ownership.scopes.find(
    (scope) => scope.subjectId === `course:${source.courseId}`
  );
  if (!subject || !resource) throw new AssessmentFenceConflict();
  const spec = {
    id: input.id,
    revision: input.revision,
    instanceId: source.ownership.instanceId,
    subject: { id: subject.subjectId, generation: subject.generation },
    resource: { id: resource.subjectId, generation: resource.generation },
    operationId: input.id,
    action: 'assessment-parent-provider-request',
    expiresAt: input.expiresAt,
    maxRequests: assessmentProviderBudget(skills.length),
  };
  const backend = assessmentFenceBackend(database, source.classId);
  const current = (await assessmentFenceStore(backend).read()).current;
  const speaking = source.source.sections.find((section) => section.skill === 'SPEAKING');
  const speakingPolicy = current
    ? current.speakingPolicy
    : input.canonicalSpeaking &&
        !input.materialVersion &&
        source.requirements.skills.SPEAKING.state === 'REQUIRED'
      ? readAloudPolicyForPractice(speaking?.speaking ?? [])
      : undefined;
  if (
    input.canonicalSpeaking &&
    !current &&
    source.requirements.skills.SPEAKING.state === 'REQUIRED' &&
    !speakingPolicy
  )
    throw new AssessmentSpeakingPolicyUnavailable();
  const proposed = assessmentFenceSchema.parse({
    id: input.id,
    assessmentId: input.assessmentId,
    classId: source.classId,
    courseId: source.courseId,
    userId: source.userId,
    classAttempt: source.classAttempt,
    assessmentAttempt: input.assessmentAttempt,
    ...(input.materialVersion === 2 ? { materialVersion: 2 as const } : {}),
    ...(speakingPolicy ? { speakingPolicy } : {}),
    ownership: source.ownership,
    formativeRevision: source.formativeRevision,
    teachingReceipt: source.teachingReceipt,
    requirements: source.requirements,
    thresholds: source.thresholds,
    selection,
    cliBinding: input.cliBinding ?? null,
    grant: delegationGrantBinding(spec),
    status: 'QUEUED',
  });
  const admitted = admitAssessmentFence(current, proposed);
  const outbox = sottoJobOutbox(database);
  if (current) {
    const record = await outbox.read(admitted.id);
    const payload = record && assessmentWorkSchema.safeParse(record.job.payload);
    const assessment = await database.classAssessment.findUnique({
      where: { id: admitted.assessmentId },
      include: { sections: true },
    });
    if (
      !record ||
      record.complete ||
      record.job.handler !== 'interactions' ||
      record.job.version !== 6 ||
      !payload ||
      !payload.success ||
      !isDeepStrictEqual(payload.data.fence, { ...admitted, status: 'QUEUED' }) ||
      !isDeepStrictEqual(record.job.scopes, admitted.ownership.scopes) ||
      !assessment ||
      assessment.classId !== admitted.classId ||
      assessment.courseId !== admitted.courseId ||
      assessment.userId !== admitted.userId ||
      assessment.classAttempt !== admitted.classAttempt ||
      assessment.assessmentAttempt !== admitted.assessmentAttempt ||
      assessment.materialVersion !== (admitted.materialVersion ?? 1) ||
      assessment.generationOperationId !== admitted.id ||
      assessment.status !== 'GENERATING' ||
      assessment.sealedAt !== null ||
      assessment.formativeRevision !== admitted.formativeRevision ||
      assessment.teachingKind !== admitted.teachingReceipt.kind ||
      assessment.teachingReceiptId !== admitted.teachingReceipt.receiptId ||
      !isDeepStrictEqual(assessment.requirements, admitted.requirements) ||
      assessment.sections.length !== skills.length ||
      assessment.sections.some(
        (section) =>
          !skills.includes(section.skill) ||
          section.passThreshold !== admitted.thresholds[section.skill]
      )
    )
      throw new AssessmentFenceConflict();
    await learningPreparationGrant(database, admitted, 'assessment').validate(admitted.grant);
    return record;
  }
  if (await outbox.read(input.id)) throw new AssessmentFenceConflict();
  await database.classAssessment.create({
    data: {
      id: proposed.assessmentId,
      classId: proposed.classId,
      courseId: proposed.courseId,
      userId: proposed.userId,
      classAttempt: proposed.classAttempt,
      assessmentAttempt: proposed.assessmentAttempt,
      materialVersion: proposed.materialVersion ?? 1,
      requirements: proposed.requirements,
      formativeRevision: proposed.formativeRevision,
      teachingKind: proposed.teachingReceipt.kind,
      teachingReceiptId: proposed.teachingReceipt.receiptId,
      generationOperationId: proposed.id,
      sections: {
        create: skills.map((skill) => ({ skill, passThreshold: proposed.thresholds[skill]! })),
      },
    },
  });
  const record = await outbox.enqueue(
    prepareJob({
      id: proposed.id,
      namespace: SIDEDOOR_STATE_ID,
      handler: 'interactions',
      version: 6,
      payload: { kind: 'CLASS_ASSESSMENT', fence: proposed },
      scopes: proposed.ownership.scopes,
      delivery: { attempts: 1, priority: 0, availableAt: 0 },
    })
  );
  const grant = learningPreparationGrant(database, proposed, 'assessment');
  await grant.create(spec);
  await grant.validate(proposed.grant);
  await recordAssessmentFence(backend, proposed);
  return record;
}
