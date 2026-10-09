import { beforeEach, describe, expect, it, vi } from 'vitest';
import { params } from './fixture';
import { shapeTeachingProviderFixture } from '../intro-provider-fixture';

const boundary = vi.hoisted(() => ({ generate: vi.fn(), resolve: vi.fn() }));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: async (
      system: string,
      messages: Array<{ content: string }>,
      options: unknown
    ) =>
      shapeTeachingProviderFixture(
        system,
        messages,
        options,
        await boundary.generate(system, messages, options)
      ),
  }),
}));
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: boundary.resolve,
  capturedLearningAiOptions: async (ai: { model: string; signal: AbortSignal }) => ({
    model: ai.model,
    signal: ai.signal,
  }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
import { createAIProvider } from '@/lib/providers/ai';
import {
  TeachingQualityRejectionError,
  reviewTeachingContent,
} from '@/lib/classes/quality/teaching-quality';

beforeEach(() => {
  boundary.generate.mockReset();
  boundary.resolve.mockResolvedValue({
    provider: 'fixture',
    model: 'captured-model',
    signal: new AbortController().signal,
    execution: params.execution,
  });
});

describe('listening teaching candidate', () => {
  it.each([
    {
      defect: 'none',
      passageText:
        'HOST: [chuckles] Beim Verb gehen benutzen wir hier sein.\nEXPERT: Die passende Form für das Wort ich ist bin. Ich bin zum Bahnhof gegangen.',
      correctIndex: 0,
      feedback: [],
    },
    {
      defect: 'incorrect spoken agreement',
      passageText: 'HOST: [laughs] Ich hat Tee gekocht.\nEXPERT: Ich bin zum Bahnhof gegangen.',
      correctIndex: 0,
      feedback: ['passageText: The spoken clause uses hat with ich.'],
    },
    {
      defect: 'English spoken teaching',
      passageText:
        'HOST: [chuckles] Now use the perfect tense.\nEXPERT: Ich bin zum Bahnhof gegangen.',
      correctIndex: 0,
      feedback: ['passageText: The spoken instruction is English at A2.'],
    },
    {
      defect: 'arbitrary bracketed English',
      passageText: 'HOST: [Use the perfect tense]\nEXPERT: Ich bin zum Bahnhof gegangen.',
      correctIndex: 0,
      feedback: ['passageText: The bracketed instruction is not a known audio control.'],
    },
    {
      defect: 'unsupported key',
      passageText: 'HOST: [laughs] Ich habe Tee gekocht.\nEXPERT: Ich bin zum Bahnhof gegangen.',
      correctIndex: 1,
      feedback: ['correctIndex: The second speaker says Bahnhof, not Kino.'],
    },
    {
      defect: 'incorrect speaker attribution',
      passageText: 'HOST: [laughs] Ich bin zum Bahnhof gegangen.\nEXPERT: Ich habe Tee gekocht.',
      correctIndex: 0,
      feedback: ['explanation: The first speaker, not the second, went to the station.'],
    },
  ])(
    'preserves the exact listening candidate and reviewer decision for $defect',
    async (fixture) => {
      const content = {
        question: 'Wohin ist der zweite Sprecher gegangen?',
        options: ['Zum Bahnhof', 'Zum Kino', 'Nach Hause', 'Zum Park'],
        correctIndex: fixture.correctIndex,
        explanation: 'Der zweite Sprecher sagt: Ich bin zum Bahnhof gegangen.',
        passageText: fixture.passageText,
      };
      const acceptable = fixture.feedback.length === 0;
      const rejectedIndex = fixture.feedback[0]?.startsWith('passageText:') ? 0 : 1;
      const verdict = {
        items: [0, 1].map((index) => ({
          index,
          acceptable: acceptable || index !== rejectedIndex,
          issues: acceptable || index !== rejectedIndex ? [] : ['incorrect'],
          feedback: acceptable || index !== rejectedIndex ? [] : fixture.feedback,
        })),
      };
      boundary.generate.mockReset();
      boundary.generate.mockResolvedValue({ content: JSON.stringify(verdict) });
      const review = reviewTeachingContent({
        ...params,
        ai: await boundary.resolve(),
        provider: createAIProvider('fixture'),
        kind: 'listening',
        items: [content],
      });
      if (acceptable) await expect(review).resolves.toBeUndefined();
      else {
        const error = await review.catch((failure: unknown) => failure);
        expect(error).toBeInstanceOf(TeachingQualityRejectionError);
        if (!(error instanceof TeachingQualityRejectionError)) throw error;
        expect(error.teachingFailure?.reviews[0].verdict).toEqual({
          items: verdict.items.map((item) => ({
            ...item,
            feedback: item.feedback.map(
              (text) => `${text.slice(0, 120)} Correction: Use accurate supported teaching.`
            ),
          })),
        });
        expect(JSON.parse(error.teachingFailure!.reviews[0].candidate!)[0].items).toEqual([
          content,
        ]);
      }
      const [system, messages, options] = boundary.generate.mock.calls[0]!;
      expect(system).toContain(
        'HOST and EXPERT at turn prefixes are nonspoken speaker identifiers'
      );
      expect(system).toContain('[laughs], [chuckles]');
      expect(system).toContain('never to arbitrary bracketed English');
      expect(system).toContain(
        'all spoken transcript content and the full questions, options and explanations'
      );
      expect(system).toContain('Immediate immersion for A2');
      expect(system).toContain('Preserve speaker attribution');
      expect(system).toContain('For listening passageText only');
      expect(system).toContain(
        'The surrounding spoken explanation must still be grammatical and idiomatic'
      );
      expect(system).toContain(
        'does not change the citation requirements for written intro content'
      );
      expect(system).toContain(
        'Reject an unquoted citation form used as though it were grammatically integrated'
      );
      expect(JSON.parse(messages[0].content)).toMatchObject({
        items: [
          {
            index: 0,
            content: { passageText: fixture.passageText },
            sourceParts: expect.any(Array),
          },
          {
            index: 1,
            content: expect.not.objectContaining({ passageText: expect.anything() }),
            sourceParts: expect.any(Array),
          },
        ],
      });
      expect(options).toMatchObject({
        model: 'captured-model',
        maxTokens: 4096,
        temperature: 0,
        jsonSchema: { name: 'class_teaching_critic' },
      });
    }
  );
});
