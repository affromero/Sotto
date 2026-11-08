import { createHash, randomUUID } from 'node:crypto';
import { it, expect, type Mock } from 'vitest';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';
import { authorizedLearnerExecution } from '../../../../helpers/runtime/provider-execution';
import type {
  SharedTestInstance,
  SharedTestIdentity,
} from '../../../../helpers/setup/shared-instance';
import { initialA1MaterialHash } from '@/lib/classes/lesson/initial-a1-provenance';
import { admitAssessmentWork } from '@/lib/learning/classes/generation/assessment-admission';
import {
  startAssessmentWork,
  requirePendingAssessmentWork,
} from '@/lib/learning/classes/generation/assessment-work';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import { learningPreparationRequestFingerprint } from '@/lib/learning/preparation/preparation-provider';
import { MODERATION_API_URL, moderationRequestBody } from '@/lib/moderation';
import {
  admitAssessmentProviderCall,
  prepareAssessmentProviderCall,
  settleAssessmentProviderCall,
} from '@/lib/learning/classes/provider/assessment-provider-journal';
import {
  readAssessmentCliCall,
  settleAssessmentCliCall,
} from '@/lib/learning/classes/provider/assessment-cli-journal';
import { invokeAssessmentProviderStage } from '@/lib/learning/classes/provider/assessment-provider-stage';
import { authorAssessmentSection } from '@/lib/learning/classes/generation/assessment-authoring';
import {
  generateAssessmentSection,
  prepareAssessmentAuthorProof,
  verifyAssessmentAuthorProof,
} from '@/lib/learning/classes/generation/assessment-generation';

export function registerAssessmentCliJournalCase(
  getContext: () => {
    instance: SharedTestInstance;
    identity: SharedTestIdentity;
    classId: string;
    cliBoundary: { execute: Mock };
  }
) {
  it('journals a Codex response and its nested moderation under the captured account', async () => {
    const { instance, identity, classId, cliBoundary } = getContext();
    const cls = await instance.database.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const materialHash = await sottoTransaction(instance.database, (tx) =>
      initialA1MaterialHash(tx, classId, identity.ownerId)
    );
    const receiptId = randomUUID();
    await instance.database.courseClass.update({
      where: { id: classId },
      data: {
        prerequisiteGate: {
          version: 1,
          receiptId,
          classId,
          courseId: cls.courseId,
          userId: identity.ownerId,
          attempt: cls.attempt,
          materialHash,
          acknowledgment: { userId: identity.ownerId, receiptId, materialHash },
        },
      },
    });
    const execution = authorizedLearnerExecution(identity.ownerId);
    const selection = {
      provider: 'codex',
      model: 'codex:fixture:high',
      credentialFingerprint: null,
      moderationCredentialFingerprint: '5'.repeat(64),
    };
    const binding = {
      kind: 'LOCAL_ACCOUNT' as const,
      fingerprint: '9'.repeat(64),
      revision: 'revision',
    };
    const record = await sottoTransaction(instance.database, (tx) =>
      admitAssessmentWork(tx, {
        id: randomUUID(),
        revision: randomUUID(),
        assessmentId: randomUUID(),
        classId,
        classAttempt: 1,
        assessmentAttempt: 1,
        expiresAt: Date.now() + 60_000,
        selection,
        cliBinding: binding,
        execution,
      })
    );
    const operation = { id: record.job.id, fingerprint: record.fingerprint };
    await sottoTransaction(instance.database, (tx) =>
      startAssessmentWork(tx, operation, execution)
    );
    const context = {
      identity: operation,
      execution,
      stage: 'REVIEW' as const,
      ordinal: 0,
      role: 'CLI' as const,
      inputDigest: '8'.repeat(64),
      moderationInput: 'Lesson input',
    };
    const attempt = {
      id: randomUUID(),
      fingerprint: learningProviderInputHash({
        inputDigest: context.inputDigest,
        selection,
        binding,
      }),
    };
    await sottoTransaction(instance.database, (tx) => prepareAssessmentProviderCall(tx, context));
    await sottoTransaction(instance.database, (tx) =>
      admitAssessmentProviderCall(tx, context, attempt)
    );
    const response = {
      content: '{"skill":"GRAMMAR"}',
      model: selection.model,
      inputTokens: 1,
      outputTokens: 2,
    };
    const body = Buffer.from(
      JSON.stringify({ results: [{ categories: {}, category_scores: {} }] })
    );
    const httpReceipt = {
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json']] as [string, string][],
      bodyBase64: body.toString('base64'),
      bodySha256: createHash('sha256').update(body).digest('hex'),
    };
    const moderationAttempts = [];
    for (const [index, text] of [context.moderationInput, response.content].entries()) {
      const moderation = { ...context, ordinal: index + 1, role: 'MODERATION' as const };
      const fingerprint = await learningPreparationRequestFingerprint(
        new Request(MODERATION_API_URL, { method: 'POST', body: moderationRequestBody(text) }),
        {
          selection,
          operationId: operation.id,
          stage: context.stage,
          inputDigest: context.inputDigest,
        },
        new AbortController().signal
      );
      const moderationAttempt = { id: randomUUID(), fingerprint };
      moderationAttempts.push(moderationAttempt);
      await sottoTransaction(instance.database, (tx) =>
        prepareAssessmentProviderCall(tx, moderation)
      );
      await sottoTransaction(instance.database, (tx) =>
        admitAssessmentProviderCall(tx, moderation, moderationAttempt)
      );
      await sottoTransaction(instance.database, (tx) =>
        settleAssessmentProviderCall(tx, moderation, moderationAttempt, 'succeeded', httpReceipt)
      );
    }
    const cliReceipt = { inputDigest: context.inputDigest, attempt, binding, response };
    await sottoTransaction(instance.database, (tx) =>
      settleAssessmentCliCall(tx, context, attempt, 'succeeded', cliReceipt)
    );
    expect(
      await sottoTransaction(instance.database, (tx) => readAssessmentCliCall(tx, context))
    ).toEqual(response);
    const { verifyHistoricalAssessmentReviewReceipt, verifyHistoricalAssessmentModeration } =
      await import('@/lib/learning/classes/review/assessment-review-history');
    const reviewFence = (
      await sottoTransaction(instance.database, (tx) =>
        requirePendingAssessmentWork(tx, operation, execution, 'RUNNING')
      )
    ).current;
    const savedCliCall = await instance.database.classAssessmentProviderCall.findFirstOrThrow({
      where: { attemptId: attempt.id },
    });
    const savedReviewReceipt = {
      inputDigest: context.inputDigest,
      resultAttemptId: attempt.id,
      resultFingerprint: attempt.fingerprint,
      responseSha256: savedCliCall.responseSha256,
    };
    expect(
      await sottoTransaction(instance.database, (tx) =>
        verifyHistoricalAssessmentReviewReceipt(tx, reviewFence, savedReviewReceipt)
      )
    ).toEqual({ kind: 'CLI', content: response.content });
    await expect(
      sottoTransaction(instance.database, (tx) =>
        verifyHistoricalAssessmentModeration(
          tx,
          reviewFence,
          context.inputDigest,
          context.moderationInput,
          response.content
        )
      )
    ).resolves.toBeUndefined();
    let cliDispatches = 0;
    cliBoundary.execute.mockImplementation(
      async (
        input: Parameters<
          typeof import('@/lib/learning/preparation/provider-invocation').executeLearningCliOnce
        >[0]
      ) => {
        const call = {
          id: randomUUID(),
          fingerprint: learningProviderInputHash({
            inputDigest: input.inputDigest,
            selection: input.selection,
            binding: input.binding,
          }),
        };
        await sottoTransaction(instance.database, async (tx) => {
          await input.operation.validateBinding(tx, input.binding);
          await input.operation.admit(tx, call);
        });
        await input.beforeDispatch?.();
        cliDispatches += 1;
        const generated = {
          content: JSON.stringify({
            skill: 'WRITING',
            items: Array.from({ length: 3 }, (_, index) => ({
              task: `Write ${index}`,
              rubric: 'Criteria',
              guidance: 'Guide',
            })),
          }),
          model: selection.model,
          inputTokens: 1,
          outputTokens: 2,
        };
        await input.validateResponse?.(generated);
        await sottoTransaction(instance.database, (tx) =>
          input.operation.settle(tx, call, 'succeeded', {
            inputDigest: input.inputDigest,
            attempt: call,
            binding: input.binding,
            response: generated,
          })
        );
        return generated;
      }
    );
    const generateInput = {
      identity: operation,
      execution,
      skill: 'WRITING' as const,
      unresolved: () => {
        throw new Error('Unexpected unresolved call');
      },
    };
    const stagedWriting = await generateAssessmentSection(generateInput);
    expect(await generateAssessmentSection(generateInput)).toEqual(stagedWriting);
    expect(cliDispatches).toBe(1);
    const writingProof = await prepareAssessmentAuthorProof(generateInput);
    expect(
      await sottoTransaction(instance.database, (tx) =>
        verifyAssessmentAuthorProof(tx, writingProof)
      )
    ).toEqual({ skill: 'WRITING', sectionId: stagedWriting.sectionId });
    expect(cliDispatches).toBe(1);
    const pendingWriting = await sottoTransaction(instance.database, (tx) =>
      requirePendingAssessmentWork(tx, operation, execution, 'RUNNING')
    );
    let writingRequest:
      { system: string; payload: string; schema: Record<string, unknown> } | undefined;
    await authorAssessmentSection(
      {
        source: pendingWriting.source.source,
        prerequisite: pendingWriting.source.prerequisite,
        requirements: pendingWriting.source.requirements,
        skill: 'WRITING',
      },
      async (request) => {
        writingRequest = request;
        return JSON.stringify({
          skill: 'WRITING',
          items: Array.from({ length: 3 }, (_, index) => ({
            task: `Write ${index}`,
            rubric: 'Criteria',
            guidance: 'Guide',
          })),
        });
      }
    );
    if (!writingRequest) throw new Error('Writing request missing');
    const { current, source: capturedSource } = pendingWriting;
    const sourceDigest = learningProviderInputHash({
      version: 1,
      stage: 'AUTHOR_WRITING',
      classId: current.classId,
      assessmentId: current.assessmentId,
      classAttempt: current.classAttempt,
      assessmentAttempt: current.assessmentAttempt,
      formativeRevision: current.formativeRevision,
      teachingReceipt: current.teachingReceipt,
      requirements: capturedSource.requirements,
      source: capturedSource.source,
      prerequisite: capturedSource.prerequisite,
      selection: current.selection,
      cliBinding: current.cliBinding,
    });
    cliBoundary.execute.mockImplementation(async () => {
      throw new Error('Replay spawned Codex');
    });
    const replay = await invokeAssessmentProviderStage({
      identity: operation,
      execution,
      current,
      stage: 'AUTHOR_WRITING',
      sourceDigest,
      request: { ...writingRequest, schemaName: 'class_assessment_section' },
      replayOnly: true,
      unresolved: generateInput.unresolved,
    });
    await sottoTransaction(instance.database, (tx) => replay.verify(tx));
    expect(JSON.parse(replay.content)).toMatchObject({ skill: 'WRITING' });
    expect(cliDispatches).toBe(1);
    expect(
      await instance.database.writingPrompt.count({
        where: { assessmentSectionId: stagedWriting.sectionId },
      })
    ).toBe(3);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        readAssessmentCliCall(tx, { ...context, moderationInput: 'Different input' })
      )
    ).rejects.toThrow(/already active/);
    const moderationRow = await instance.database.classAssessmentProviderCall.findFirstOrThrow({
      where: { attemptId: moderationAttempts[0]!.id },
    });
    await instance.database.classAssessmentProviderCall.update({
      where: { id: moderationRow.id },
      data: {
        responseMetadata: { status: 400, statusText: 'Changed', headers: [] },
      },
    });
    await expect(
      sottoTransaction(instance.database, (tx) => readAssessmentCliCall(tx, context))
    ).rejects.toThrow(/already active/);
    const flagged = Buffer.from(
      JSON.stringify({
        results: [{ categories: { violence: true }, category_scores: { violence: 0.9 } }],
      })
    );
    await instance.database.classAssessmentProviderCall.update({
      where: { id: moderationRow.id },
      data: {
        responseMetadata: {
          status: 200,
          statusText: 'OK',
          headers: [['content-type', 'application/json']],
        },
        responseBytes: flagged,
        responseSha256: createHash('sha256').update(flagged).digest('hex'),
      },
    });
    await expect(
      sottoTransaction(instance.database, (tx) => readAssessmentCliCall(tx, context))
    ).rejects.toThrow(/already active/);
    await expect(
      sottoTransaction(instance.database, (tx) =>
        admitAssessmentProviderCall(tx, context, { ...attempt, id: randomUUID() })
      )
    ).rejects.toThrow(/already active/);
  });
}
