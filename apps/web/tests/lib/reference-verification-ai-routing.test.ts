// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useProviderCredentialDatabase } from '../helpers/runtime/provider-credentials-postgres';
import type { PrismaClient } from '@/generated/prisma/client';
import { ProviderCleanupError } from 'thesidedoor-core/ai';
import { aiEvaluateWithDomainContext } from '@/lib/reference-verification/ai-layer';
import { groundFailedReferences } from '@/lib/reference-verification/grounding';
import { runReferenceVerification } from '@/lib/reference-verification/pipeline';
import type { ReferenceInput, VerificationCheck } from '@/lib/reference-validator';

const { generateResponse } = vi.hoisted(() => ({ generateResponse: vi.fn() }));

let database: PrismaClient;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return database;
  },
  get prismaUnfiltered() {
    return database;
  },
}));

vi.mock('@/lib/providers/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/ai')>()),
  createAIProvider: () => ({ generateResponse }),
}));

vi.mock('@/lib/reference-validator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reference-validator')>()),
  verifyUrl: async () => ({ layer: 'url', passed: true, confidence: 0.9, detail: 'URL verified' }),
  searchTitle: async () => ({
    layer: 'title',
    passed: true,
    confidence: 0.9,
    detail: 'Title found',
  }),
}));

const reference: ReferenceInput = {
  id: 'ref-1',
  number: 1,
  title: 'A real source title',
  authors: ['A. Researcher'],
  year: 2025,
  url: 'https://example.com/source',
  doi: null,
  type: 'article',
};

const claimContext = {
  sentences: ['A cited claim appears here.'],
  speakerTurns: ['HOST'],
};

const failedCheck: VerificationCheck = {
  layer: 'url',
  passed: false,
  confidence: 0,
  detail: 'URL failed',
};

const capturedAi = (signal?: AbortSignal) => ({
  provider: 'codex',
  model: 'gpt-6-luna',
  execution: { userId: 'alice', authorize: async () => ({ userId: 'alice' }), signal },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('reference verification AI routing', () => {
  const fixture = useProviderCredentialDatabase();

  beforeAll(() => {
    database = fixture.database;
  });

  it('rejects reference evaluation without a captured AI selection', async () => {
    await expect(
      aiEvaluateWithDomainContext(
        [{ ref: reference, domain: 'GENERAL', claimContext, priorChecks: [] }],
        'Source evaluation topic',
        null as never
      )
    ).rejects.toThrow();
  });

  it('returns no grounded references when captured AI selection is missing', async () => {
    await expect(
      groundFailedReferences(
        [
          {
            ref: reference,
            domain: 'GENERAL',
            claimContext,
            allChecks: [failedCheck],
          },
        ],
        'Source grounding topic',
        null as never
      )
    ).resolves.toEqual(new Map());
  });

  it('waits for the selected Codex response beyond 60 seconds and admits it once', async () => {
    vi.useFakeTimers();
    const response = deferred<{
      content: string;
      model: string;
      inputTokens: number;
      outputTokens: number;
    }>();
    const started = deferred<void>();
    generateResponse.mockImplementationOnce(() => {
      started.resolve();
      return response.promise;
    });

    const evaluation = aiEvaluateWithDomainContext(
      [{ ref: reference, domain: 'GENERAL', claimContext, priorChecks: [] }],
      'Source evaluation topic',
      capturedAi()
    );
    await started.promise;
    await vi.advanceTimersByTimeAsync(60_001);
    response.resolve({
      content: JSON.stringify({
        evaluations: [
          {
            refNumber: 1,
            sourceExists: true,
            verdict: 'SUPPORTED',
            confidence: 0.9,
            reasoning: 'The source supports the claim.',
            suggestedReplacement: null,
          },
        ],
      }),
      model: 'codex',
      inputTokens: 10,
      outputTokens: 10,
    });

    await expect(evaluation).resolves.toMatchObject(new Map([['ref-1', { passed: true }]]));
    expect(generateResponse).toHaveBeenCalledTimes(1);
    expect(generateResponse).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ model: 'gpt-6-luna', useWebSearch: true })
    );
  });

  it('propagates cancellation only after the provider call settles', async () => {
    const controller = new AbortController();
    const started = deferred<void>();
    const providerClosed = deferred<void>();
    const abortError = new Error('operation cancelled');
    generateResponse.mockImplementationOnce((_system, _messages, options) => {
      started.resolve();
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          'abort',
          async () => {
            await providerClosed.promise;
            reject(abortError);
          },
          { once: true }
        );
      });
    });

    const evaluation = aiEvaluateWithDomainContext(
      [{ ref: reference, domain: 'GENERAL', claimContext, priorChecks: [] }],
      'Source evaluation topic',
      capturedAi(controller.signal)
    );
    await started.promise;
    controller.abort(abortError);
    let settled = false;
    const observed = evaluation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    providerClosed.resolve();
    await expect(evaluation).rejects.toBe(abortError);
    await observed;
  });

  it('rejects a pre-aborted captured execution before provider admission', async () => {
    const controller = new AbortController();
    const abortError = new Error('operation cancelled before admission');
    controller.abort(abortError);

    await expect(
      aiEvaluateWithDomainContext(
        [{ ref: reference, domain: 'GENERAL', claimContext, priorChecks: [] }],
        'Source evaluation topic',
        capturedAi(controller.signal)
      )
    ).rejects.toBe(abortError);
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it.each([
    { kind: 'provider error', failure: new Error('provider request failed') },
    {
      kind: 'provider cleanup error',
      failure: new ProviderCleanupError(true, { cause: new Error('child remains') }),
    },
  ])('preserves the original $kind through the verification pipeline', async ({ failure }) => {
    generateResponse.mockRejectedValueOnce(failure);

    await expect(
      runReferenceVerification(
        [reference],
        [{ speaker: 'HOST', text: 'A cited claim appears here.' }],
        'Source evaluation topic',
        capturedAi()
      )
    ).rejects.toBe(failure);
    expect(generateResponse).toHaveBeenCalledTimes(1);
  });

  it('preserves a parent abort through the verification pipeline', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('operation cancelled', 'AbortError');
    controller.abort(abortError);

    await expect(
      runReferenceVerification(
        [reference],
        [{ speaker: 'HOST', text: 'A cited claim appears here.' }],
        'Source evaluation topic',
        capturedAi(controller.signal)
      )
    ).rejects.toBe(abortError);
    expect(generateResponse).not.toHaveBeenCalled();
  });

  it('keeps contradicted model verdicts as failed checks', async () => {
    generateResponse.mockResolvedValueOnce({
      content: JSON.stringify({
        evaluations: [
          {
            refNumber: 1,
            sourceExists: true,
            verdict: 'CONTRADICTED',
            confidence: 0.9,
            reasoning: 'The source contradicts the claim.',
            suggestedReplacement: null,
          },
        ],
      }),
      model: 'codex',
      inputTokens: 10,
      outputTokens: 10,
    });

    const result = await aiEvaluateWithDomainContext(
      [{ ref: reference, domain: 'GENERAL', claimContext, priorChecks: [] }],
      'Source evaluation topic',
      capturedAi()
    );
    expect(result.get(reference.id)).toMatchObject({ passed: false, confidence: 0 });
  });

  it('keeps invalid model output as an unparseable failed check', async () => {
    generateResponse.mockResolvedValueOnce({
      content: 'not JSON',
      model: 'codex',
      inputTokens: 10,
      outputTokens: 10,
    });

    const result = await aiEvaluateWithDomainContext(
      [{ ref: reference, domain: 'GENERAL', claimContext, priorChecks: [] }],
      'Source evaluation topic',
      capturedAi()
    );
    expect(result.get(reference.id)).toMatchObject({
      passed: false,
      confidence: 0,
      detail: expect.stringMatching(/unparseable/i),
    });
  });
});
