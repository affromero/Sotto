import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizedLearnerExecution } from '../../../helpers/runtime/provider-execution';

const runtime = vi.hoisted(() => ({
  replies: [] as Array<{ content: string; model: string } | Error>,
  requests: [] as Array<{
    system: string;
    messages: Array<{ role: string; content: string }>;
    options: Record<string, unknown>;
  }>,
  spoken: [] as string[],
  events: [] as string[],
  afterReview: undefined as (() => void) | undefined,
}));

vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async (userId: string, execution: { signal?: AbortSignal }) => ({
    provider: 'configured-provider',
    model: 'configured-model',
    userId,
    execution,
  }),
  capturedLearningAiOptions: async (ai: {
    model: string;
    execution: { signal?: AbortSignal };
  }) => ({
    model: ai.model,
    apiKeyOverride: 'configured-credential',
    abortSignal: ai.execution.signal,
  }),
}));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: (provider: string) => {
    expect(provider).toBe('configured-provider');
    return {
      generateResponse: async (
        system: string,
        messages: Array<{ role: string; content: string }>,
        options: Record<string, unknown>
      ) => {
        runtime.requests.push({ system, messages, options });
        const review = Boolean(options.jsonSchema);
        runtime.events.push(review ? 'review' : 'generation');
        const reply = runtime.replies.shift();
        if (!reply) throw new Error('Unexpected additional provider request');
        if (!('content' in reply)) throw reply;
        if (review) runtime.afterReview?.();
        return reply;
      },
    };
  },
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: async () => ({ preferredTtsModel: 'configured-tts-model' }) } },
  prismaUnfiltered: {},
}));
vi.mock('@/lib/providers/tts', () => ({
  canResolveTts: async () => true,
  getConfiguredTtsProviderId: () => 'cartesia',
  resolveTtsProvider: async () => ({
    provider: {
      getVoiceId: () => 'configured-voice',
      generateSpeech: async ({ text }: { text: string }) => {
        runtime.events.push('tts');
        runtime.spoken.push(text);
        return Uint8Array.of(1, 2, 3);
      },
    },
  }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/sidedoor/storage/core/storage-write', () => ({
  writeStorageReference: async () => {
    throw new Error('Content generation must not publish storage');
  },
}));
vi.mock('@/lib/sidedoor/storage/core/speaking-storage', () => ({
  captureSpeakingPromptStorage: async () => {
    throw new Error('Content generation must not persist learner material');
  },
}));

import { composeSpeakingPrompts } from '@/lib/class-speaking-generator';
import {
  ReviewerProtocolError,
  TeachingQualityRejectionError,
} from '@/lib/classes/quality/teaching-quality';
import { captureTeachingFailure } from '@/lib/classes/quality/teaching-failure';

const phrases = [
  { targetPhrase: 'Ich habe den Bus verpasst.', translation: 'I took the bus.' },
  { targetPhrase: 'Wir sind nach Hause gegangen.', translation: 'We went home.' },
  {
    targetPhrase: 'Sie ist am Bahnhof stehen geblieben.',
    translation: 'She stopped at the station.',
  },
  { targetPhrase: 'Er hat seine Schwester angerufen.', translation: 'He called his sister.' },
];
const corrected = phrases.map((phrase) => ({ ...phrase }));
corrected[0] = { targetPhrase: 'Ich habe den Bus verpasst.', translation: 'I missed the bus.' };
const params = {
  userId: 'learner',
  execution: authorizedLearnerExecution('learner'),
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  objective: 'Describe completed journeys in the Perfekt.',
  targetVocab: [{ lemma: 'verpassen', gloss: 'to miss' }],
  refId: 'unpublished-content',
  ttsProvider: 'cartesia' as const,
  referenceAudioRequired: true,
};
function verdict(reject = false) {
  return {
    items: phrases.map((phrase, index) => ({
      index,
      acceptable: !reject || index !== 0,
      issues: reject && index === 0 ? ['incorrect'] : [],
      feedback:
        reject && index === 0
          ? [`For "${phrase.targetPhrase}", the translation changes the supplied event.`]
          : [],
    })),
  };
}
function reply(value: unknown) {
  return { content: JSON.stringify(value), model: 'configured-model' };
}
function noAudio() {
  expect(runtime.spoken).toEqual([]);
  expect(runtime.events).not.toContain('tts');
}

describe('canonical speaking correction before reference audio', () => {
  beforeEach(() => {
    runtime.replies = [];
    runtime.requests = [];
    runtime.spoken = [];
    runtime.events = [];
    runtime.afterReview = undefined;
  });

  it('renders the reviewed complete set without a correction request', async () => {
    runtime.replies.push(reply(corrected), reply(verdict()));
    const result = await composeSpeakingPrompts(params);
    expect(result.map((item) => item.targetPhrase)).toEqual(
      corrected.map((item) => item.targetPhrase)
    );
    expect(result.every((item) => item.referenceTtsAudio?.byteLength === 3)).toBe(true);
    expect(runtime.events).toEqual(['generation', 'review', 'tts', 'tts', 'tts', 'tts']);
  });

  it('renders only the corrected set after the same canonical reviewer approves every phrase', async () => {
    runtime.replies.push(reply(phrases), reply(verdict(true)), reply(corrected), reply(verdict()));
    const result = await composeSpeakingPrompts(params);
    expect(result.map((item) => item.targetPhrase)).toEqual(
      corrected.map((item) => item.targetPhrase)
    );
    expect(result.map((item) => item.translation)).toEqual(
      corrected.map((item) => item.translation)
    );
    expect(runtime.spoken).toEqual(corrected.map((item) => item.targetPhrase));
    expect(runtime.events).toEqual([
      'generation',
      'review',
      'generation',
      'review',
      'tts',
      'tts',
      'tts',
      'tts',
    ]);
    const correction = runtime.requests[2];
    expect(correction.system).toContain(params.objective);
    expect(correction.system).toContain('verpassen');
    expect(correction.messages[0].content).toContain(JSON.stringify(phrases));
    expect(correction.messages[0].content).toContain(JSON.stringify(verdict(true)));
    expect(correction.messages[0].content).toContain('untrusted data');
    expect(
      runtime.requests.every(
        (request) =>
          request.options.model === 'configured-model' &&
          request.options.apiKeyOverride === 'configured-credential'
      )
    ).toBe(true);
    expect(
      JSON.parse(runtime.requests[3].messages[0].content).items.map(
        (item: { content: unknown }) => item.content
      )
    ).toEqual(corrected);
  });

  it('retains both actual rejected sets and verdicts without rendering any audio', async () => {
    runtime.replies.push(
      reply(phrases),
      reply(verdict(true)),
      reply(corrected),
      reply(verdict(true))
    );
    const error = await composeSpeakingPrompts(params).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    const rejection = error as TeachingQualityRejectionError;
    expect(
      rejection.teachingFailure?.reviews.map((review) => JSON.parse(review.candidate!))
    ).toEqual([phrases, corrected]);
    expect(rejection.teachingFailure?.reviews.map((review) => review.verdict)).toEqual([
      verdict(true),
      verdict(true),
    ]);
    expect(JSON.stringify(error)).not.toContain(phrases[0].targetPhrase);
    expect(runtime.events).toEqual(['generation', 'review', 'generation', 'review']);
    noAudio();
  });

  it.each([
    '{',
    JSON.stringify(phrases.slice(0, 3)),
    JSON.stringify([...phrases, phrases[0]]),
    JSON.stringify(
      phrases.map((phrase, index) => (index === 0 ? { ...phrase, ipa: false } : phrase))
    ),
    JSON.stringify(
      phrases.map((phrase, index) => (index === 0 ? { ...phrase, translation: ' ' } : phrase))
    ),
  ])('rejects malformed or incomplete generation before review or audio', async (content) => {
    runtime.replies.push({ content, model: 'configured-model' });
    await expect(composeSpeakingPrompts(params)).rejects.toThrow('usable phrases');
    expect(runtime.events).toEqual(['generation']);
    noAudio();
  });

  it.each([
    '{',
    JSON.stringify({ items: [] }),
    JSON.stringify({ items: verdict().items.map((item) => ({ ...item, index: 0 })) }),
    JSON.stringify({
      items: verdict().items.map((item) => ({ ...item, feedback: ['Conflicting approval'] })),
    }),
  ])('propagates malformed or inconsistent review without another generation', async (content) => {
    runtime.replies.push(reply(phrases), { content, model: 'configured-model' });
    await expect(composeSpeakingPrompts(params)).rejects.toBeInstanceOf(ReviewerProtocolError);
    expect(runtime.events).toEqual(['generation', 'review']);
    noAudio();
  });

  it.each([new Error('Provider unavailable'), new DOMException('Cancelled', 'AbortError')])(
    'preserves an external failure during correction without disguising it as a teaching verdict',
    async (failure) => {
      runtime.replies.push(reply(phrases), reply(verdict(true)), failure);
      await expect(composeSpeakingPrompts(params)).rejects.toBe(failure);
      expect(runtime.events).toEqual(['generation', 'review', 'generation']);
      noAudio();
    }
  );

  it('stops when cancellation arrives with the rejected review', async () => {
    const controller = new AbortController();
    const reason = new Error('Learner cancelled');
    runtime.afterReview = () => controller.abort(reason);
    runtime.replies.push(reply(phrases), reply(verdict(true)));
    await expect(
      composeSpeakingPrompts({
        ...params,
        execution: { ...params.execution, signal: controller.signal },
      })
    ).rejects.toBe(reason);
    expect(runtime.events).toEqual(['generation', 'review']);
    noAudio();
  });

  it('keeps an oversized rejected first candidate omitted and never uses it for regeneration', async () => {
    const oversized = phrases.map((phrase, index) =>
      index === 0 ? { ...phrase, targetPhrase: 'x'.repeat(40000) } : phrase
    );
    runtime.replies.push(reply(oversized), reply(verdict(true)));
    const error = await composeSpeakingPrompts(params).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(TeachingQualityRejectionError);
    expect((error as TeachingQualityRejectionError).teachingFailure?.reviews[0]).toMatchObject({
      candidate: null,
      omitted: 'size_limit',
      verdict: verdict(true),
    });
    expect(runtime.events).toEqual(['generation', 'review']);
    noAudio();
  });

  it('retains the first verdict and explicitly omitted oversized final evidence without another correction', async () => {
    const oversized = corrected.map((phrase, index) =>
      index === 0 ? { ...phrase, targetPhrase: 'x'.repeat(40000) } : phrase
    );
    runtime.replies.push(
      reply(phrases),
      reply(verdict(true)),
      reply(oversized),
      reply(verdict(true))
    );
    const error = await composeSpeakingPrompts(params).catch((failure: unknown) => failure);
    const failure = (error as TeachingQualityRejectionError).teachingFailure;
    expect(failure?.reviews).toHaveLength(2);
    expect(JSON.parse(failure!.reviews[0].candidate!)).toEqual(phrases);
    expect(failure!.reviews[1]).toEqual({
      candidate: null,
      omitted: 'size_limit',
      verdict: verdict(true),
    });
    expect(runtime.events).toEqual(['generation', 'review', 'generation', 'review']);
    noAudio();
  });

  it('does not treat an unrelated provider error object as trusted speaking review evidence', async () => {
    const failure = new TeachingQualityRejectionError(
      ['incorrect'],
      [],
      captureTeachingFailure(
        'writing',
        phrases,
        verdict(true) as Parameters<typeof captureTeachingFailure>[2]
      )
    );
    runtime.replies.push(reply(phrases), failure);
    await expect(composeSpeakingPrompts(params)).rejects.toBe(failure);
    expect(runtime.events).toEqual(['generation', 'review']);
    noAudio();
  });
});
