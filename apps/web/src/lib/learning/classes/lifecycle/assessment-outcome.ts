import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { learningSkills } from '@sotto/shared';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { capturePrerequisiteOwnership } from '@/lib/classes/help/lifecycle/prerequisite-ownership';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { sottoJobOutbox, sottoJobSnapshot } from '@/lib/sidedoor/jobs/core/job-delivery';
import { hasSettledSottoExecution } from '@/lib/sidedoor/jobs/core/job-settlement-proof';
import {
  runSottoExecutionTransaction,
  type SottoJobExecutionCapability,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { verifyAssessmentAudioJobsDrained } from '../audio/assessment-audio-drain';
import {
  prepareAssessmentAuthorProof,
  verifyAssessmentAuthorProof,
} from '../generation/assessment-generation';
import {
  prepareAssessmentReviewProof,
  verifyAssessmentReviewProof,
} from '../review/assessment-review-generation';
import {
  assessmentFenceBackend,
  assessmentFenceStore,
  assessmentWorkSchema,
  AssessmentFenceConflict,
} from './assessment-fence';
import { requirePendingAssessmentWork } from '../generation/assessment-work';
import { createAssessmentArchive, readAssessmentArchive } from '../history/assessment-archive';
import { captureAssessmentCandidate } from '../material/assessment-snapshot';
import {
  assessmentHistoryManifestSchema,
  encodeAssessmentHistory,
} from '../history/assessment-history-codec';
import { readAssessmentHistory } from '../history/assessment-history';
import {
  verifyHistoricalAssessmentReviewInput,
  verifyHistoricalAssessmentReviewReceipt,
  replayHistoricalAssessmentReview,
  verifyHistoricalAssessmentModeration,
} from '../review/assessment-review-history';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const assessmentOutcomeSchema = z
  .object({
    status: z.literal('READY'),
    operationId: z.uuid(),
    fingerprint: digest,
    assessmentId: z.string().min(1),
    classId: z.string().min(1),
    userId: z.string().min(1),
    classAttempt: z.number().int().positive(),
    assessmentAttempt: z.number().int().positive(),
    formativeRevision: digest,
    teachingKind: z.enum(['BASE', 'ADDENDUM']),
    teachingReceiptId: z.string().min(1),
    materialDigest: digest,
    reviewOperationId: z.string().min(1),
    reviewReceiptDigest: digest,
    history: assessmentHistoryManifestSchema.optional(),
  })
  .strict();
type Identity = { id: string; fingerprint: string };
type AuthorProof = Awaited<ReturnType<typeof prepareAssessmentAuthorProof>>;
type ReviewProof = Awaited<ReturnType<typeof prepareAssessmentReviewProof>>;

/** Seal the exact reviewed material under the active parent execution. */
export function sealAssessmentOutcome(input: {
  database: PrismaClient;
  identity: Identity;
  execution: SottoProviderExecution;
  capability: SottoJobExecutionCapability;
  authors: readonly AuthorProof[];
  review: ReviewProof;
}) {
  const identity = { ...input.identity };
  const execution = { ...input.execution };
  const authors = [...input.authors];
  const review = input.review;
  return runSottoExecutionTransaction(
    input.capability,
    { parentId: identity.id, fingerprint: identity.fingerprint },
    input.database,
    async (database) => {
      const { record, current, source } = await requirePendingAssessmentWork(
        database,
        identity,
        execution,
        'RUNNING'
      );
      if (
        (await verifyAssessmentAudioJobsDrained(database, identity, execution)).status === 'WAITING'
      )
        return { status: 'WAITING' as const };
      const skills = learningSkills.filter(
        (skill) => current.requirements.skills[skill].state === 'REQUIRED'
      );
      if (
        authors.length !== skills.length ||
        new Set(authors.map((proof) => proof.skill)).size !== skills.length
      )
        throw new AssessmentFenceConflict();
      const sections = await database.classAssessmentSection.findMany({
        where: { assessmentId: current.assessmentId },
        select: { id: true, skill: true },
      });
      for (const skill of skills) {
        const proof = authors.find((item) => item.skill === skill);
        const section = sections.find((item) => item.skill === skill);
        if (!proof || !section || proof.sectionId !== section.id)
          throw new AssessmentFenceConflict();
        const verified = await verifyAssessmentAuthorProof(database, proof);
        if (verified.skill !== skill || verified.sectionId !== section.id)
          throw new AssessmentFenceConflict();
      }
      const verified = await verifyAssessmentReviewProof(database, review);
      const assessment = await database.classAssessment.findUniqueOrThrow({
        where: { id: current.assessmentId },
      });
      if (
        assessment.status !== 'GENERATING' ||
        assessment.sealedAt !== null ||
        assessment.reviewedMaterialDigest !== verified.materialDigest ||
        !assessment.reviewOperationId ||
        assessment.reviewReceipt === null
      )
        throw new AssessmentFenceConflict();
      const candidate = await captureAssessmentCandidate(database, execution, {
        classId: current.classId,
        assessmentId: current.assessmentId,
        classAttempt: current.classAttempt,
        assessmentAttempt: current.assessmentAttempt,
        ...(current.materialVersion === 2 ? { materialVersion: 2 as const } : {}),
        generationOperationId: current.id,
        ownership: current.ownership,
      });
      if (
        candidate.status !== 'CAPTURED' ||
        candidate.digest !== verified.materialDigest ||
        !isDeepStrictEqual(candidate.material.requirements, current.requirements) ||
        Object.entries(current.thresholds).some(
          ([skill, value]) =>
            candidate.passThresholds[skill as keyof typeof candidate.passThresholds] !== value
        )
      )
        throw new AssessmentFenceConflict();
      const history = encodeAssessmentHistory({
        scoringPolicy: 1,
        material: candidate.material,
        formativeIds: candidate.formativeIds,
        formativeTasks: candidate.formativeTasks,
        passThresholds: candidate.passThresholds,
        priorAssessments: candidate.priorAssessments,
        reviewSource: { lesson: source.source, prerequisite: source.prerequisite },
      });
      const outcome = assessmentOutcomeSchema.parse({
        status: 'READY',
        operationId: identity.id,
        fingerprint: identity.fingerprint,
        assessmentId: assessment.id,
        classId: current.classId,
        userId: current.userId,
        classAttempt: current.classAttempt,
        assessmentAttempt: current.assessmentAttempt,
        formativeRevision: current.formativeRevision,
        teachingKind: current.teachingReceipt.kind,
        teachingReceiptId: current.teachingReceipt.receiptId,
        materialDigest: verified.materialDigest,
        reviewOperationId: assessment.reviewOperationId,
        reviewReceiptDigest: learningProviderInputHash(assessment.reviewReceipt),
        history: history.manifest,
      });
      const parent = {
        id: record.job.id,
        fingerprint: createHash('sha256').update(JSON.stringify(record.job.payload)).digest('hex'),
      };
      const grant = learningPreparationGrant(database, current, 'assessment');
      await grant.settle(current.grant, parent, 'succeeded');
      await grant.complete(current.grant);
      const changed = await database.classAssessment.updateMany({
        where: {
          id: assessment.id,
          status: 'GENERATING',
          sealedAt: null,
          reviewedMaterialDigest: verified.materialDigest,
        },
        data: { status: 'READY', sealedAt: new Date() },
      });
      if (changed.count !== 1) throw new AssessmentFenceConflict();
      const snapshot = sottoJobSnapshot(database);
      await snapshot.createForJob(identity);
      await snapshot.append(identity.id, identity.fingerprint, 0, [outcome]);
      for (const [index, chunk] of history.chunks.entries())
        await snapshot.append(identity.id, identity.fingerprint, index + 1, [chunk]);
      await snapshot.seal(identity.id, identity.fingerprint);
      await createAssessmentArchive(database, {
        fingerprint: identity.fingerprint,
        fence: { ...current, status: 'COMPLETED' },
        historyDigest: history.manifest.digest,
      });
      await assessmentFenceStore(assessmentFenceBackend(database, current.classId)).transact(
        (state) => {
          if (!isDeepStrictEqual(state.current, current)) throw new AssessmentFenceConflict();
          state.current = { ...current, status: 'COMPLETED' };
        }
      );
      return { status: 'READY' as const };
    },
    {
      timeoutMs: 30_000,
      prepare: async (database) => {
        await requirePendingAssessmentWork(database, identity, execution, 'RUNNING');
      },
    }
  );
}

/** Finish delivery only after the saved outcome and parent execution have drained. */
export async function recoverAssessmentOutcome(
  database: Prisma.TransactionClient,
  input: Identity
) {
  return Boolean(await verifyAssessmentOutcome(database, input, 'recovery'));
}

/** Verify generation proof for a committed assessment without granting worker authority. */
export async function verifyHistoricalAssessmentGeneration(
  database: Prisma.TransactionClient,
  input: Identity
) {
  return Boolean(await verifyAssessmentOutcome(database, input, 'historical'));
}

/** Return historical inputs only after verifying the completed generation operation. */
export async function readVerifiedHistoricalAssessmentGeneration(
  database: Prisma.TransactionClient,
  input: Identity
) {
  const verified = await verifyAssessmentOutcome(database, input, 'historical');
  if (!verified || !verified.history) throw new AssessmentFenceConflict();
  return verified.history;
}

/** Require intact retained material before committing learner assessment work. */
export async function verifyAssessmentOutcomeForSubmission(
  database: Prisma.TransactionClient,
  input: Identity
) {
  return Boolean(await verifyAssessmentOutcome(database, input, 'submission'));
}

async function verifyAssessmentOutcome(
  database: Prisma.TransactionClient,
  input: Identity,
  mode: 'recovery' | 'historical' | 'submission'
) {
  const identity = { ...input };
  const isolation = await database.$queryRaw<{ isolation: string }[]>`
    SELECT current_setting('transaction_isolation') AS isolation`;
  if (isolation[0]?.isolation !== 'serializable')
    throw new Error('Assessment recovery requires a Serializable transaction');
  const record = await sottoJobOutbox(database).read(identity.id);
  if (
    !record ||
    record.fingerprint !== identity.fingerprint ||
    record.job.handler !== 'interactions' ||
    record.job.version !== 6
  )
    throw new AssessmentFenceConflict();
  const { fence } = assessmentWorkSchema.parse(record.job.payload);
  if (
    fence.id !== identity.id ||
    fence.status !== 'QUEUED' ||
    !isDeepStrictEqual(record.job.scopes, fence.ownership.scopes)
  )
    throw new AssessmentFenceConflict();
  await database.$queryRaw`SELECT id FROM "CourseClass" WHERE id = ${fence.classId} FOR UPDATE`;
  await database.$queryRaw`SELECT id FROM "ClassAssessment" WHERE id = ${fence.assessmentId} FOR UPDATE`;
  if (mode !== 'historical') {
    const current = (
      await assessmentFenceStore(assessmentFenceBackend(database, fence.classId)).read()
    ).current;
    if (!current || !isDeepStrictEqual({ ...current, status: 'QUEUED' }, fence))
      throw new AssessmentFenceConflict();
    if (current.status !== 'COMPLETED') return false;
  } else if (!record.complete) throw new AssessmentFenceConflict();
  const archive = await readAssessmentArchive(database, identity.id);
  if (
    archive.fingerprint !== identity.fingerprint ||
    !isDeepStrictEqual(archive.fence, { ...fence, status: 'COMPLETED' })
  )
    throw new AssessmentFenceConflict();
  const ownership = await capturePrerequisiteOwnership(
    database,
    fence.classId,
    fence.courseId,
    fence.userId
  );
  if (!isDeepStrictEqual(ownership, fence.ownership)) throw new AssessmentFenceConflict();
  const grant = await learningPreparationGrant(database, fence, 'assessment').read(fence.grant);
  const parentFingerprint = createHash('sha256')
    .update(JSON.stringify(record.job.payload))
    .digest('hex');
  if (
    grant.status !== 'completed' ||
    grant.attempts.some((attempt) => ['admitted', 'unknown'].includes(attempt.outcome)) ||
    !grant.attempts.some(
      (attempt) =>
        attempt.id === identity.id &&
        attempt.fingerprint === parentFingerprint &&
        attempt.outcome === 'succeeded'
    )
  )
    throw new AssessmentFenceConflict();
  const page = await sottoJobSnapshot(database).read(identity.id, identity.fingerprint, 0);
  if (page.items.length !== 1) throw new AssessmentFenceConflict();
  const outcome = assessmentOutcomeSchema.parse(page.items[0]);
  if (
    outcome.history
      ? page.pages !== outcome.history.chunks + 1 ||
        page.next !== 1 ||
        archive.historyDigest !== outcome.history.digest
      : page.pages !== 1 || page.next !== null || archive.historyDigest !== undefined
  )
    throw new AssessmentFenceConflict();
  if (mode === 'submission' && !outcome.history) throw new AssessmentFenceConflict();
  const history =
    mode !== 'recovery' && outcome.history
      ? await readAssessmentHistory(database, {
          ...identity,
          manifest: outcome.history,
          fence,
          materialDigest: outcome.materialDigest,
        })
      : null;
  const assessment = await database.classAssessment.findUnique({
    where: { id: fence.assessmentId },
  });
  if (
    !assessment ||
    !assessment.sealedAt ||
    (mode === 'historical'
      ? assessment.status !== 'COMMITTED'
      : mode === 'submission'
        ? assessment.status !== 'READY'
        : !['READY', 'COMMITTED'].includes(assessment.status)) ||
    outcome.operationId !== identity.id ||
    outcome.fingerprint !== identity.fingerprint ||
    outcome.classId !== fence.classId ||
    outcome.userId !== fence.userId ||
    assessment.id !== outcome.assessmentId ||
    assessment.classId !== fence.classId ||
    assessment.courseId !== fence.courseId ||
    assessment.userId !== fence.userId ||
    !isDeepStrictEqual(assessment.requirements, fence.requirements) ||
    assessment.classAttempt !== outcome.classAttempt ||
    assessment.classAttempt !== fence.classAttempt ||
    assessment.assessmentAttempt !== outcome.assessmentAttempt ||
    assessment.assessmentAttempt !== fence.assessmentAttempt ||
    assessment.materialVersion !== (fence.materialVersion ?? 1) ||
    assessment.formativeRevision !== outcome.formativeRevision ||
    outcome.formativeRevision !== fence.formativeRevision ||
    assessment.teachingKind !== outcome.teachingKind ||
    outcome.teachingKind !== fence.teachingReceipt.kind ||
    assessment.teachingReceiptId !== outcome.teachingReceiptId ||
    outcome.teachingReceiptId !== fence.teachingReceipt.receiptId ||
    assessment.generationOperationId !== identity.id ||
    assessment.reviewedMaterialDigest !== outcome.materialDigest ||
    assessment.reviewOperationId !== outcome.reviewOperationId ||
    assessment.reviewReceipt === null ||
    learningProviderInputHash(assessment.reviewReceipt) !== outcome.reviewReceiptDigest
  )
    throw new AssessmentFenceConflict();
  if (history?.reviewSource) {
    const verdict = await verifyHistoricalAssessmentReviewReceipt(
      database,
      fence,
      assessment.reviewReceipt
    );
    await verifyHistoricalAssessmentReviewInput(
      fence,
      history,
      assessment.reviewReceipt,
      async (request, digest) => {
        const content =
          verdict.kind === 'CLI'
            ? verdict.content
            : await replayHistoricalAssessmentReview(fence, verdict, request, digest);
        await verifyHistoricalAssessmentModeration(
          database,
          fence,
          digest,
          request.payload,
          content
        );
        return content;
      }
    );
  }
  if (!(await hasSettledSottoExecution(database, identity))) throw new AssessmentFenceConflict();
  if (mode !== 'historical' && !record.complete)
    await sottoJobOutbox(database).complete(identity.id, identity.fingerprint);
  return { history };
}
