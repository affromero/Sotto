// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
import type { AssessmentFence } from '@/lib/learning/classes/lifecycle/assessment-fence';
import {
  replayHistoricalAssessmentReview,
  verifyHistoricalAssessmentModeration,
  verifyHistoricalAssessmentReviewReceipt,
} from '@/lib/learning/classes/review/assessment-review-history';
import { learningProviderInputHash } from '@/lib/learning/preparation/identity';
import { learningPreparationRequestFingerprint } from '@/lib/learning/preparation/preparation-provider';
import { createAIProvider } from '@/lib/providers/ai';
import { MODERATION_API_URL, moderationRequestBody } from '@/lib/moderation';

const boundary = vi.hoisted(() => ({ readGrant: vi.fn() }));
vi.mock('@/lib/learning/preparation/preparation-grant', () => ({
  learningPreparationGrant: () => ({ read: boundary.readGrant }),
}));

describe('historical assessment review receipt', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('binds saved moderation to the reviewed input and rejects flagged content', async () => {
    const selection = { moderationCredentialFingerprint: 'configured' };
    const fence = {
      id: 'operation',
      assessmentId: 'assessment',
      selection,
      cliBinding: null,
    } as AssessmentFence;
    const inputDigest = 'a'.repeat(64);
    const fingerprint = await learningPreparationRequestFingerprint(
      new Request(MODERATION_API_URL, { method: 'POST', body: moderationRequestBody('lesson') }),
      { selection, operationId: fence.id, stage: 'REVIEW', inputDigest },
      new AbortController().signal
    );
    const bytes = Buffer.from(
      JSON.stringify({ results: [{ categories: {}, category_scores: {} }] })
    );
    const call = {
      status: 'SUCCEEDED',
      attemptFingerprint: fingerprint,
      responseBytes: bytes,
      responseSha256: createHash('sha256').update(bytes).digest('hex'),
      responseMetadata: { status: 200, statusText: 'OK', headers: [] },
    };
    const findMany = vi.fn().mockResolvedValue([call]);
    const database = {
      classAssessmentProviderCall: { findMany },
    } as unknown as Prisma.TransactionClient;
    await expect(
      verifyHistoricalAssessmentModeration(database, fence, inputDigest, 'lesson', 'verdict')
    ).resolves.toBeUndefined();
    await expect(
      verifyHistoricalAssessmentModeration(database, fence, inputDigest, 'changed', 'verdict')
    ).rejects.toThrow();
    const flagged = Buffer.from(
      JSON.stringify({ results: [{ categories: {}, category_scores: { violence: 1 } }] })
    );
    findMany.mockResolvedValue([
      {
        ...call,
        responseBytes: flagged,
        responseSha256: createHash('sha256').update(flagged).digest('hex'),
      },
    ]);
    await expect(
      verifyHistoricalAssessmentModeration(database, fence, inputDigest, 'lesson', 'verdict')
    ).rejects.toThrow();
  });

  it('requires both CLI input and output moderation in their original order', async () => {
    const selection = { moderationCredentialFingerprint: 'configured' };
    const fence = {
      id: 'operation',
      assessmentId: 'assessment',
      selection,
      cliBinding: { fingerprint: 'binding' },
    } as AssessmentFence;
    const inputDigest = 'a'.repeat(64);
    const bytes = Buffer.from(
      JSON.stringify({ results: [{ categories: {}, category_scores: {} }] })
    );
    const calls = await Promise.all(
      ['lesson', 'verdict'].map(async (text) => ({
        status: 'SUCCEEDED',
        attemptFingerprint: await learningPreparationRequestFingerprint(
          new Request(MODERATION_API_URL, { method: 'POST', body: moderationRequestBody(text) }),
          { selection, operationId: fence.id, stage: 'REVIEW', inputDigest },
          new AbortController().signal
        ),
        responseBytes: bytes,
        responseSha256: createHash('sha256').update(bytes).digest('hex'),
        responseMetadata: { status: 200, statusText: 'OK', headers: [] },
      }))
    );
    const findMany = vi.fn().mockResolvedValue(calls);
    const database = {
      classAssessmentProviderCall: { findMany },
    } as unknown as Prisma.TransactionClient;
    await expect(
      verifyHistoricalAssessmentModeration(database, fence, inputDigest, 'lesson', 'verdict')
    ).resolves.toBeUndefined();
    await expect(
      verifyHistoricalAssessmentModeration(database, fence, inputDigest, 'lesson', 'changed')
    ).rejects.toThrow();
    findMany.mockResolvedValue([...calls].reverse());
    await expect(
      verifyHistoricalAssessmentModeration(database, fence, inputDigest, 'lesson', 'verdict')
    ).rejects.toThrow();
    findMany.mockResolvedValue([calls[0]]);
    await expect(
      verifyHistoricalAssessmentModeration(database, fence, inputDigest, 'lesson', 'verdict')
    ).rejects.toThrow();
  });

  it('replays Anthropic output moderation without treating a logged output flag as a rejection', async () => {
    const selection = { provider: 'anthropic', moderationCredentialFingerprint: 'configured' };
    const fence = {
      id: 'operation',
      assessmentId: 'assessment',
      selection,
      cliBinding: null,
    } as AssessmentFence;
    const inputDigest = 'a'.repeat(64);
    const calls = await Promise.all(
      ['lesson', 'verdict'].map(async (text, index) => {
        const bytes = Buffer.from(
          JSON.stringify({ results: [{ categories: {}, category_scores: { violence: index } }] })
        );
        return {
          status: 'SUCCEEDED',
          attemptFingerprint: await learningPreparationRequestFingerprint(
            new Request(MODERATION_API_URL, { method: 'POST', body: moderationRequestBody(text) }),
            { selection, operationId: fence.id, stage: 'REVIEW', inputDigest },
            new AbortController().signal
          ),
          responseBytes: bytes,
          responseSha256: createHash('sha256').update(bytes).digest('hex'),
          responseMetadata: { status: 200, statusText: 'OK', headers: [] },
        };
      })
    );
    const findMany = vi.fn().mockResolvedValue(calls);
    const database = {
      classAssessmentProviderCall: { findMany },
    } as unknown as Prisma.TransactionClient;
    await expect(
      verifyHistoricalAssessmentModeration(database, fence, inputDigest, 'lesson', 'verdict')
    ).resolves.toBeUndefined();
    await expect(
      verifyHistoricalAssessmentModeration(database, fence, inputDigest, 'lesson', 'different')
    ).rejects.toThrow();
    findMany.mockResolvedValue([calls[0]]);
    await expect(
      verifyHistoricalAssessmentModeration(database, fence, inputDigest, 'lesson', 'verdict')
    ).rejects.toThrow();
  });

  it.each(['openai', 'local', 'anthropic'] as const)(
    'replays a saved %s response without network access',
    async (provider) => {
      const selection = {
        provider,
        model: provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'fixture-model',
        endpoint: 'http://localhost:9999/v1',
      };
      const fence = { id: 'operation', selection } as AssessmentFence;
      const inputDigest = 'a'.repeat(64);
      const request = { system: 'Review this.', payload: 'A lesson.', schema: { type: 'object' } };
      const body = JSON.stringify(
        provider === 'anthropic'
          ? {
              id: 'message',
              type: 'message',
              role: 'assistant',
              model: selection.model,
              content: [{ type: 'text', text: '{"taught":true}' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 },
            }
          : {
              choices: [
                {
                  message: { role: 'assistant', content: '{"taught":true}' },
                  finish_reason: 'stop',
                },
              ],
            }
      );
      let captured: Request | undefined;
      await createAIProvider(provider).generateResponse(
        request.system,
        [{ role: 'user', content: request.payload }],
        {
          model: selection.model,
          endpoint: selection.endpoint,
          apiKeyOverride: 'fixture',
          skipModeration: true,
          maxTokens: 4000,
          temperature: 0.3,
          jsonSchema: { name: 'class_assessment_review', schema: request.schema },
          fetch: async (resource, init) => {
            captured = new Request(resource, init);
            return new Response(body, {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          },
        }
      );
      if (!captured) throw new Error('Provider request not captured');
      const fingerprint = await learningPreparationRequestFingerprint(
        captured,
        {
          selection,
          operationId: fence.id,
          stage: 'REVIEW',
          inputDigest,
        },
        new AbortController().signal
      );
      const bytes = Buffer.from(body);
      const result = {
        kind: 'HTTP' as const,
        fingerprint,
        response: {
          status: 200,
          statusText: '',
          headers: [['content-type', 'application/json']] as [string, string][],
          bodyBase64: bytes.toString('base64'),
          bodySha256: createHash('sha256').update(bytes).digest('hex'),
        },
      };
      vi.stubGlobal('fetch', () => {
        throw new Error('Unexpected network request');
      });
      await expect(
        replayHistoricalAssessmentReview(fence, result, request, inputDigest)
      ).resolves.toBe('{"taught":true}');
      await expect(
        replayHistoricalAssessmentReview(
          fence,
          result,
          { ...request, payload: 'Changed lesson.' },
          inputDigest
        )
      ).rejects.toThrow();
    }
  );

  it('binds a saved CLI result to its model and captured configuration', async () => {
    const inputDigest = 'b'.repeat(64);
    const selection = { model: 'example' };
    const binding = { fingerprint: 'configured' };
    const fingerprint = learningProviderInputHash({ inputDigest, selection, binding });
    const bytes = Buffer.from(JSON.stringify({ model: 'example', content: 'review' }));
    const responseSha256 = createHash('sha256').update(bytes).digest('hex');
    const call = {
      ordinal: 0,
      role: 'CLI',
      status: 'SUCCEEDED',
      inputDigest,
      attemptId: 'attempt',
      attemptFingerprint: fingerprint,
      responseSha256,
      responseBytes: bytes,
      responseMetadata: { kind: 'CLI', binding },
    };
    const findMany = vi.fn().mockResolvedValue([call]);
    const database = {
      $queryRaw: vi.fn(),
      classAssessmentProviderCall: { findMany },
    } as unknown as Prisma.TransactionClient;
    const fence = {
      assessmentId: 'assessment',
      selection,
      cliBinding: binding,
      grant: {},
    } as AssessmentFence;
    const receipt = {
      inputDigest,
      resultAttemptId: 'attempt',
      resultFingerprint: fingerprint,
      responseSha256,
    };
    boundary.readGrant.mockResolvedValue({
      attempts: [{ id: 'attempt', fingerprint, outcome: 'succeeded' }],
    });
    await expect(
      verifyHistoricalAssessmentReviewReceipt(database, fence, receipt)
    ).resolves.toEqual({
      kind: 'CLI',
      content: 'review',
    });
    findMany.mockResolvedValue([
      { ...call, responseMetadata: { kind: 'CLI', binding: { fingerprint: 'changed' } } },
    ]);
    await expect(
      verifyHistoricalAssessmentReviewReceipt(database, fence, receipt)
    ).rejects.toThrow();
  });

  it('requires the exact successful provider result and its settled grant', async () => {
    const responseBytes = Buffer.from(JSON.stringify({ choices: [{ finish_reason: 'stop' }] }));
    const responseSha256 = createHash('sha256').update(responseBytes).digest('hex');
    const fingerprint = 'a'.repeat(64);
    const inputDigest = 'b'.repeat(64);
    const receipt = {
      inputDigest,
      resultAttemptId: 'attempt',
      resultFingerprint: fingerprint,
      responseSha256,
    };
    const call = {
      ordinal: 0,
      role: 'MODEL',
      status: 'SUCCEEDED',
      inputDigest,
      attemptId: 'attempt',
      attemptFingerprint: fingerprint,
      responseSha256,
      responseBytes,
      responseMetadata: { status: 200, statusText: 'OK', headers: [] },
    };
    const findMany = vi.fn().mockResolvedValue([call]);
    const database = {
      $queryRaw: vi.fn(),
      classAssessmentProviderCall: { findMany },
    } as unknown as Prisma.TransactionClient;
    const fence = { assessmentId: 'assessment', cliBinding: null, grant: {} } as AssessmentFence;
    boundary.readGrant.mockResolvedValue({
      attempts: [{ id: 'attempt', fingerprint, outcome: 'succeeded' }],
    });
    await expect(
      verifyHistoricalAssessmentReviewReceipt(database, fence, receipt)
    ).resolves.toMatchObject({ kind: 'HTTP', fingerprint });
    findMany.mockResolvedValue([call, { ...call, ordinal: 1, status: 'DISPATCHING' }]);
    await expect(
      verifyHistoricalAssessmentReviewReceipt(database, fence, receipt)
    ).rejects.toThrow();
    findMany.mockResolvedValue([{ ...call, responseBytes: Buffer.from('changed') }]);
    await expect(
      verifyHistoricalAssessmentReviewReceipt(database, fence, receipt)
    ).rejects.toThrow();
    const truncated = Buffer.from(JSON.stringify({ choices: [{ finish_reason: 'length' }] }));
    const truncatedHash = createHash('sha256').update(truncated).digest('hex');
    findMany.mockResolvedValue([
      { ...call, responseBytes: truncated, responseSha256: truncatedHash },
    ]);
    await expect(
      verifyHistoricalAssessmentReviewReceipt(database, fence, {
        ...receipt,
        responseSha256: truncatedHash,
      })
    ).rejects.toThrow();
    findMany.mockResolvedValue([call]);
    boundary.readGrant.mockResolvedValue({
      attempts: [{ id: 'attempt', fingerprint, outcome: 'failed' }],
    });
    await expect(
      verifyHistoricalAssessmentReviewReceipt(database, fence, receipt)
    ).rejects.toThrow();
  });
});
