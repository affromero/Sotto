import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Prisma } from '@/generated/prisma/client';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import { learningPreparationGrant } from '@/lib/learning/preparation/preparation-grant';
import {
  learningHttpCompletion,
  replayLearningProviderResponse,
} from '@/lib/learning/preparation/provider-invocation';
import {
  learningPreparationRequestFingerprint,
  restoreLearningPreparationResponse,
} from '@/lib/learning/preparation/preparation-provider';
import {
  interpretModerationResponse,
  MODERATION_API_URL,
  moderationRequestBody,
} from '@/lib/moderation';
import { AssessmentFenceConflict, type AssessmentFence } from '../lifecycle/assessment-fence';
import type { readAssessmentHistory } from '../history/assessment-history';
import { assessmentMaterialDigest } from '../material/assessment-material';
import { reviewAssessmentDraft } from './assessment-review';

/** Verify that the accepted review still has its exact settled provider result. */
export async function verifyHistoricalAssessmentReviewReceipt(
  database: Prisma.TransactionClient,
  fence: AssessmentFence,
  receipt: unknown
) {
  const saved = z
    .object({
      inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
      resultAttemptId: z.string().min(1),
      resultFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      responseSha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .passthrough()
    .parse(receipt);
  await database.$queryRaw`SELECT id FROM "ClassAssessmentProviderCall" WHERE "assessmentId" = ${fence.assessmentId} AND stage = 'REVIEW' ORDER BY ordinal FOR UPDATE`;
  const calls = await database.classAssessmentProviderCall.findMany({
    where: { assessmentId: fence.assessmentId, stage: 'REVIEW' },
    orderBy: { ordinal: 'asc' },
  });
  const result = calls.filter((call) => call.role === (fence.cliBinding ? 'CLI' : 'MODEL')).at(-1);
  const grant = await learningPreparationGrant(database, fence, 'assessment').read(fence.grant);
  for (const [ordinal, call] of calls.entries()) {
    const attempt = grant.attempts.find((item) => item.id === call.attemptId);
    if (
      call.ordinal !== ordinal ||
      call.inputDigest !== saved.inputDigest ||
      !['SUCCEEDED', 'FAILED'].includes(call.status) ||
      !call.responseBytes ||
      !call.responseSha256 ||
      createHash('sha256').update(call.responseBytes).digest('hex') !== call.responseSha256 ||
      !attempt ||
      attempt.fingerprint !== call.attemptFingerprint ||
      attempt.outcome !== call.status.toLowerCase() ||
      (fence.cliBinding
        ? ordinal === 0
          ? call.role !== 'CLI'
          : call.role !== 'MODERATION'
        : !['MODEL', 'MODERATION'].includes(call.role))
    )
      throw new AssessmentFenceConflict();
  }
  const attempt = grant.attempts.find((item) => item.id === saved.resultAttemptId);
  if (
    !result ||
    result.status !== 'SUCCEEDED' ||
    result.inputDigest !== saved.inputDigest ||
    result.attemptId !== saved.resultAttemptId ||
    result.attemptFingerprint !== saved.resultFingerprint ||
    result.responseSha256 !== saved.responseSha256 ||
    !result.responseBytes ||
    createHash('sha256').update(result.responseBytes).digest('hex') !== saved.responseSha256 ||
    !attempt ||
    attempt.fingerprint !== saved.resultFingerprint ||
    attempt.outcome !== 'succeeded'
  )
    throw new AssessmentFenceConflict();
  if (fence.cliBinding) {
    const cli = z
      .object({ model: z.string().min(1), content: z.string().min(1) })
      .passthrough()
      .parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.responseBytes)));
    if (
      cli.model !== fence.selection.model ||
      !isDeepStrictEqual(result.responseMetadata, { kind: 'CLI', binding: fence.cliBinding }) ||
      saved.resultFingerprint !==
        learningProviderInputHash({
          inputDigest: saved.inputDigest,
          selection: fence.selection,
          binding: fence.cliBinding,
        })
    )
      throw new AssessmentFenceConflict();
    return { kind: 'CLI' as const, content: cli.content };
  } else {
    const metadata = z
      .object({
        status: z.number().int().min(200).max(299),
        statusText: z.string(),
        headers: z.array(z.tuple([z.string(), z.string()])),
      })
      .strict()
      .parse(result.responseMetadata);
    const response = {
      ...metadata,
      bodyBase64: Buffer.from(result.responseBytes).toString('base64'),
      bodySha256: saved.responseSha256,
    };
    restoreLearningPreparationResponse(response);
    if (learningHttpCompletion(response) !== 'COMPLETE') throw new AssessmentFenceConflict();
    return { kind: 'HTTP' as const, response, fingerprint: saved.resultFingerprint };
  }
}

/** Verify saved moderation against the exact request and, for CLI, its output. */
export async function verifyHistoricalAssessmentModeration(
  database: Prisma.TransactionClient,
  fence: AssessmentFence,
  inputDigest: string,
  payload: string,
  output: string
) {
  const calls = await database.classAssessmentProviderCall.findMany({
    where: { assessmentId: fence.assessmentId, stage: 'REVIEW', role: 'MODERATION' },
    orderBy: { ordinal: 'asc' },
  });
  const texts =
    fence.selection.moderationCredentialFingerprint === null
      ? []
      : fence.cliBinding || fence.selection.provider === 'anthropic'
        ? [payload, output]
        : [payload];
  if (calls.length !== texts.length) throw new AssessmentFenceConflict();
  for (const [index, call] of calls.entries()) {
    if (
      call.status !== 'SUCCEEDED' ||
      !call.responseBytes ||
      !call.responseSha256 ||
      !call.attemptFingerprint
    )
      throw new AssessmentFenceConflict();
    const metadata = z
      .object({
        status: z.number().int().min(200).max(299),
        statusText: z.string(),
        headers: z.array(z.tuple([z.string(), z.string()])),
      })
      .strict()
      .parse(call.responseMetadata);
    restoreLearningPreparationResponse({
      ...metadata,
      bodyBase64: Buffer.from(call.responseBytes).toString('base64'),
      bodySha256: call.responseSha256,
    });
    const request = new Request(MODERATION_API_URL, {
      method: 'POST',
      body: moderationRequestBody(texts[index]!),
    });
    const fingerprint = await learningPreparationRequestFingerprint(
      request,
      {
        selection: fence.selection,
        operationId: fence.id,
        stage: 'REVIEW',
        inputDigest,
      },
      new AbortController().signal
    );
    const flagged = interpretModerationResponse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(call.responseBytes))
    ).flagged;
    if (
      fingerprint !== call.attemptFingerprint ||
      (flagged && !(fence.selection.provider === 'anthropic' && index === 1))
    )
      throw new AssessmentFenceConflict();
  }
}

/** Bind retained review inputs to the request that was accepted when the assessment was sealed. */
export async function verifyHistoricalAssessmentReviewInput(
  fence: AssessmentFence,
  history: Awaited<ReturnType<typeof readAssessmentHistory>>,
  receipt: unknown,
  retainedVerdict?:
    | string
    | ((
        request: { system: string; payload: string; schema: Record<string, unknown> },
        inputDigest: string
      ) => Promise<string>)
) {
  const source = history.reviewSource;
  if (!source) throw new AssessmentFenceConflict();
  const saved = z
    .object({ inputDigest: z.string().regex(/^[a-f0-9]{64}$/) })
    .passthrough()
    .parse(receipt);
  const priorAssessments = history.priorAssessments ?? [];
  const sourceDigest = learningProviderInputHash({
    version: 1,
    stage: 'REVIEW',
    classId: fence.classId,
    assessmentId: fence.assessmentId,
    classAttempt: fence.classAttempt,
    assessmentAttempt: fence.assessmentAttempt,
    ...(fence.speakingPolicy ? { speakingPolicy: fence.speakingPolicy } : {}),
    formativeRevision: fence.formativeRevision,
    teachingReceipt: fence.teachingReceipt,
    requirements: fence.requirements,
    source: source.lesson,
    prerequisite: source.prerequisite,
    materialDigest: assessmentMaterialDigest(history.material),
    ...(priorAssessments.length ? { priorAssessments } : {}),
    selection: fence.selection,
    cliBinding: fence.cliBinding,
  });
  const requestVerified = new Error('Retained assessment review request verified');
  try {
    await reviewAssessmentDraft(
      {
        classId: fence.classId,
        courseId: fence.courseId,
        userId: fence.userId,
        classAttempt: fence.classAttempt,
        formativeRevision: fence.formativeRevision,
        requirements: fence.requirements,
        source: source.lesson,
        prerequisite: source.prerequisite,
      },
      {
        material: history.material,
        digest: assessmentMaterialDigest(history.material),
        priorAssessments,
        ...(fence.speakingPolicy ? { speakingPolicy: fence.speakingPolicy } : {}),
      },
      async (request) => {
        const inputDigest = learningProviderInputHash({
          version: 2,
          stage: 'REVIEW',
          sourceDigest,
          selection: fence.selection,
          cliBinding: fence.cliBinding,
          request: { ...request, schemaName: 'class_assessment_review' },
          maxTokens: 4000,
          temperature: 0.3,
        });
        if (inputDigest !== saved.inputDigest) throw new AssessmentFenceConflict();
        if (typeof retainedVerdict === 'function') return retainedVerdict(request, inputDigest);
        if (retainedVerdict !== undefined) return retainedVerdict;
        throw requestVerified;
      }
    );
  } catch (error) {
    if (error !== requestVerified) throw error;
    return;
  }
  if (retainedVerdict === undefined) throw new AssessmentFenceConflict();
}

/** Replay one saved HTTP response through the selected provider without network access. */
export async function replayHistoricalAssessmentReview(
  fence: AssessmentFence,
  result: Extract<
    Awaited<ReturnType<typeof verifyHistoricalAssessmentReviewReceipt>>,
    { kind: 'HTTP' }
  >,
  request: { system: string; payload: string; schema: Record<string, unknown> },
  inputDigest: string
) {
  const response = await replayLearningProviderResponse({
    provider: fence.selection.provider,
    endpoint: fence.selection.endpoint,
    system: request.system,
    messages: [{ role: 'user', content: request.payload }],
    options: {
      model: fence.selection.model,
      skipModeration: true,
      maxTokens: 4000,
      temperature: 0.3,
      jsonSchema: { name: 'class_assessment_review', schema: request.schema },
    },
    selection: { selection: fence.selection, operationId: fence.id, stage: 'REVIEW', inputDigest },
    attemptFingerprint: result.fingerprint,
    receipt: result.response,
    signal: new AbortController().signal,
  });
  return response.content;
}
