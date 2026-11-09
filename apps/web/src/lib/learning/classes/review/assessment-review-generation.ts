import { isDeepStrictEqual } from 'node:util';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import type { SottoProviderExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import {
  runSottoExecutionOperation,
  verifySottoExecutionOperation,
  type SottoJobExecutionCapability,
} from '@/lib/sidedoor/jobs/core/job-execution-lifetime';
import { captureAssessmentCandidate } from '../material/assessment-snapshot';
import { reviewAssessmentDraft } from './assessment-review';
import { invokeAssessmentProviderStage } from '../provider/assessment-provider-stage';
import { requirePendingAssessmentWork } from '../generation/assessment-work';
import { AssessmentFenceConflict } from '../lifecycle/assessment-fence';
import { assessmentCallInventoryDigest } from '../provider/assessment-provider-journal';

type ReviewProof = Readonly<{ materialDigest: string }>;
const reviewProofs = new WeakMap<
  ReviewProof,
  (
    database: Parameters<typeof requirePendingAssessmentWork>[0]
  ) => Promise<{ materialDigest: string }>
>();

/** Review the exact staged assessment and retain the provider-bound private receipt. */
export async function generateAssessmentReview(input: {
  identity: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  unresolved: () => void;
}) {
  const result = await runAssessmentReview(input, false);
  return result.status === 'PREPARING_AUDIO'
    ? result
    : { status: result.status, materialDigest: result.materialDigest };
}

/** Reparse only retained review calls. This never creates work or dispatches a provider. */
export async function verifyAssessmentReview(input: {
  identity: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
}) {
  const result = await runAssessmentReview(
    {
      ...input,
      unresolved: () => {
        throw new AssessmentFenceConflict();
      },
    },
    true
  );
  if (result.status !== 'REVIEWED') throw new AssessmentFenceConflict();
  return { status: result.status, materialDigest: result.materialDigest };
}

/** Create internally after offline replay; callers must never accept a proof from external input. */
export async function prepareAssessmentReviewProof(input: {
  identity: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
}) {
  const result = await runAssessmentReview(
    {
      ...input,
      unresolved: () => {
        throw new AssessmentFenceConflict();
      },
    },
    true
  );
  if (result.status !== 'REVIEWED') throw new AssessmentFenceConflict();
  const proof = Object.freeze({ materialDigest: result.materialDigest });
  reviewProofs.set(proof, result.verify);
  return proof;
}

/** Resume a saved review offline and keep pending audio distinct from failure. */
export function prepareOrGenerateAssessmentReviewProof(input: {
  identity: { id: string; fingerprint: string };
  execution: SottoProviderExecution;
  capability: SottoJobExecutionCapability;
  unresolved: () => void;
}) {
  const expected = { parentId: input.identity.id, fingerprint: input.identity.fingerprint };
  return runSottoExecutionOperation(input.capability, expected, async (operation, signal) => {
    const execution = {
      ...input.execution,
      signal: input.execution.signal ? AbortSignal.any([input.execution.signal, signal]) : signal,
    };
    const saved = await sottoTransaction(
      prisma,
      async (database) => {
        const pending = await requirePendingAssessmentWork(
          database,
          input.identity,
          execution,
          'RUNNING'
        );
        await verifySottoExecutionOperation(database, operation, expected);
        const assessment = await database.classAssessment.findUniqueOrThrow({
          where: { id: pending.current.assessmentId },
          select: { reviewReceipt: true, reviewOperationId: true, reviewedMaterialDigest: true },
        });
        const parts = [
          assessment.reviewReceipt,
          assessment.reviewOperationId,
          assessment.reviewedMaterialDigest,
        ];
        if (parts.some((part) => part === null) && parts.some((part) => part !== null))
          throw new AssessmentFenceConflict();
        return parts[0] !== null;
      },
      { signal }
    );
    const context = { identity: input.identity, execution };
    if (!saved) {
      const result = await generateAssessmentReview({ ...context, unresolved: input.unresolved });
      if (result.status === 'PREPARING_AUDIO') {
        await sottoTransaction(
          prisma,
          async (database) => {
            await requirePendingAssessmentWork(database, input.identity, execution, 'RUNNING');
            await verifySottoExecutionOperation(database, operation, expected);
          },
          { signal }
        );
        return { status: 'PREPARING_AUDIO' as const };
      }
    }
    const proof = await prepareAssessmentReviewProof(context);
    await sottoTransaction(
      prisma,
      async (database) => {
        await requirePendingAssessmentWork(database, input.identity, execution, 'RUNNING');
        await verifySottoExecutionOperation(database, operation, expected);
        await verifyAssessmentReviewProof(database, proof);
      },
      { signal }
    );
    return { status: 'REVIEWED' as const, proof };
  });
}

/** Only proofs produced by local offline verification can be used in the final transaction. */
export async function verifyAssessmentReviewProof(
  database: Parameters<typeof requirePendingAssessmentWork>[0],
  proof: ReviewProof
) {
  const verify = reviewProofs.get(proof);
  if (!verify) throw new AssessmentFenceConflict();
  return verify(database);
}

async function runAssessmentReview(
  input: {
    identity: { id: string; fingerprint: string };
    execution: SottoProviderExecution;
    unresolved: () => void;
  },
  replayOnly: boolean
) {
  const identity = { ...input.identity };
  const execution = { ...input.execution };
  const signal = execution.signal ?? new AbortController().signal;
  const capture = async (database: Parameters<typeof requirePendingAssessmentWork>[0]) => {
    const pending = await requirePendingAssessmentWork(database, identity, execution, 'RUNNING');
    const current = pending.current;
    const candidate = await captureAssessmentCandidate(database, execution, {
      classId: current.classId,
      assessmentId: current.assessmentId,
      classAttempt: current.classAttempt,
      assessmentAttempt: current.assessmentAttempt,
      ...(current.materialVersion === 2 ? { materialVersion: 2 as const } : {}),
      generationOperationId: current.id,
      ownership: current.ownership,
    });
    return { ...pending, candidate };
  };
  const captured = await sottoTransaction(prisma, capture, { signal });
  if (captured.candidate.status === 'PREPARING_AUDIO' && replayOnly)
    throw new AssessmentFenceConflict();
  if (captured.candidate.status === 'PREPARING_AUDIO')
    return { status: 'PREPARING_AUDIO' as const };
  const candidate = captured.candidate;
  const current = captured.current;
  const sourceDigest = learningProviderInputHash({
    version: 1,
    stage: 'REVIEW',
    classId: current.classId,
    assessmentId: current.assessmentId,
    classAttempt: current.classAttempt,
    assessmentAttempt: current.assessmentAttempt,
    ...(current.speakingPolicy ? { speakingPolicy: current.speakingPolicy } : {}),
    formativeRevision: current.formativeRevision,
    teachingReceipt: current.teachingReceipt,
    requirements: captured.source.requirements,
    source: captured.source.source,
    prerequisite: captured.source.prerequisite,
    materialDigest: candidate.digest,
    ...(candidate.priorAssessments.length ? { priorAssessments: candidate.priorAssessments } : {}),
    selection: current.selection,
    cliBinding: current.cliBinding,
  });
  let invocation: Awaited<ReturnType<typeof invokeAssessmentProviderStage>> | undefined;
  const verdict = await reviewAssessmentDraft(
    captured.source,
    {
      material: candidate.material,
      digest: candidate.digest,
      priorAssessments: candidate.priorAssessments,
      ...(current.speakingPolicy ? { speakingPolicy: current.speakingPolicy } : {}),
    },
    async ({ system, payload, schema }) => {
      invocation = await invokeAssessmentProviderStage({
        identity,
        execution,
        current,
        stage: 'REVIEW',
        sourceDigest,
        unresolved: input.unresolved,
        replayOnly,
        request: { system, payload, schema, schemaName: 'class_assessment_review' },
      });
      return invocation.content;
    }
  );
  if (!invocation) throw new AssessmentFenceConflict();
  const reviewed = invocation;
  return sottoTransaction(
    prisma,
    async (database) => {
      const refreshed = await capture(database);
      if (
        refreshed.candidate.status !== 'CAPTURED' ||
        refreshed.candidate.digest !== candidate.digest ||
        !isDeepStrictEqual(refreshed.candidate.material, candidate.material) ||
        !isDeepStrictEqual(refreshed.candidate.priorAssessments, candidate.priorAssessments) ||
        !isDeepStrictEqual(refreshed.current, current) ||
        verdict.materialDigest !== candidate.digest ||
        verdict.formativeRevision !== current.formativeRevision
      )
        throw new AssessmentFenceConflict();
      await database.$queryRaw`SELECT id FROM "ClassAssessmentProviderCall" WHERE "assessmentId" = ${current.assessmentId} AND stage = 'REVIEW' ORDER BY ordinal FOR UPDATE`;
      await reviewed.verify(database);
      const calls = await database.classAssessmentProviderCall.findMany({
        where: { assessmentId: current.assessmentId, stage: 'REVIEW' },
        orderBy: { ordinal: 'asc' },
      });
      const result = calls
        .filter((call) => call.role === (current.cliBinding ? 'CLI' : 'MODEL'))
        .at(-1);
      if (
        !result ||
        result.status !== 'SUCCEEDED' ||
        !result.attemptId ||
        !result.attemptFingerprint ||
        !result.responseSha256
      )
        throw new AssessmentFenceConflict();
      const receipt = {
        version: 1,
        decision: 'ACCEPTED',
        assessmentId: current.assessmentId,
        generationOperationId: current.id,
        classAttempt: current.classAttempt,
        assessmentAttempt: current.assessmentAttempt,
        materialDigest: candidate.digest,
        formativeRevision: current.formativeRevision,
        teachingReceipt: current.teachingReceipt,
        inputDigest: reviewed.inputDigest,
        resultAttemptId: result.attemptId,
        resultFingerprint: result.attemptFingerprint,
        responseSha256: result.responseSha256,
      };
      const assessment = await database.classAssessment.findUniqueOrThrow({
        where: { id: current.assessmentId },
      });
      if (
        assessment.reviewReceipt !== null ||
        assessment.reviewOperationId !== null ||
        assessment.reviewedMaterialDigest !== null
      ) {
        if (
          !isDeepStrictEqual(assessment.reviewReceipt, receipt) ||
          assessment.reviewOperationId !== result.attemptId ||
          assessment.reviewedMaterialDigest !== candidate.digest
        )
          throw new AssessmentFenceConflict();
      } else if (replayOnly) throw new AssessmentFenceConflict();
      else
        await database.classAssessment.update({
          where: { id: current.assessmentId },
          data: {
            reviewReceipt: receipt,
            reviewOperationId: result.attemptId,
            reviewedMaterialDigest: candidate.digest,
          },
        });
      const inventoryDigest = assessmentCallInventoryDigest(calls);
      const verify = async (tx: Parameters<typeof capture>[0]) => {
        const check = await capture(tx);
        if (
          check.candidate.status !== 'CAPTURED' ||
          check.candidate.digest !== candidate.digest ||
          !isDeepStrictEqual(check.candidate.material, candidate.material) ||
          !isDeepStrictEqual(check.candidate.priorAssessments, candidate.priorAssessments) ||
          !isDeepStrictEqual(check.current, current)
        )
          throw new AssessmentFenceConflict();
        await tx.$queryRaw`SELECT id FROM "ClassAssessmentProviderCall" WHERE "assessmentId" = ${current.assessmentId} AND stage = 'REVIEW' ORDER BY ordinal FOR UPDATE`;
        await reviewed.verify(tx);
        const saved = await tx.classAssessment.findUniqueOrThrow({
          where: { id: current.assessmentId },
        });
        if (
          !isDeepStrictEqual(saved.reviewReceipt, receipt) ||
          saved.reviewOperationId !== result.attemptId ||
          saved.reviewedMaterialDigest !== candidate.digest
        )
          throw new AssessmentFenceConflict();
        const records = await tx.classAssessmentProviderCall.findMany({
          where: { assessmentId: current.assessmentId, stage: 'REVIEW' },
          orderBy: { ordinal: 'asc' },
        });
        if (assessmentCallInventoryDigest(records) !== inventoryDigest)
          throw new AssessmentFenceConflict();
        return { materialDigest: candidate.digest };
      };
      return { status: 'REVIEWED' as const, materialDigest: candidate.digest, verify };
    },
    { signal }
  );
}
