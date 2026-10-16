import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyTeachingCriticFixture,
  novelFindingCorroborationFixture,
  shapeTeachingProviderFixture,
} from '../../classes/quality/intro-provider-fixture';

const boundary = vi.hoisted(() => ({
  generate: vi.fn(),
  review: vi.fn(),
  grade: vi.fn(),
  persist: vi.fn(),
}));
vi.mock('@/lib/prisma', () => {
  const database = {
    $queryRaw: async () => [],
    courseClass: {
      findUnique: async () => ({ status: 'GENERATING', attempt: 1, course: { userId: 'u1' } }),
    },
    classSection: { create: async () => ({ id: 'writing-1' }) },
    writingPrompt: { createMany: boundary.persist },
  };
  return {
    prisma: database,
    prismaUnfiltered: {
      ...database,
      $transaction: async (write: (db: typeof database) => Promise<unknown>) => write(database),
    },
  };
});
vi.mock('@/lib/learning-ai', () => ({
  resolveCapturedLearningAi: async (_userId: string, execution: unknown) => ({
    provider: 'anthropic',
    model: 'test-model',
    execution,
  }),
  capturedLearningAiOptions: async () => ({ model: 'test-model' }),
}));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: () => ({
    generateResponse: async (
      system: string,
      messages: Array<{ content: string }>,
      options: unknown
    ) => {
      const corroboration = novelFindingCorroborationFixture(messages, options);
      if (corroboration) return corroboration;
      const name = (options as { jsonSchema?: { name: string } }).jsonSchema?.name;
      if (name === 'class_teaching_critic') return emptyTeachingCriticFixture(messages);
      if (name === 'class_teaching_adjudicator')
        return shapeTeachingProviderFixture(
          system,
          messages,
          options,
          await boundary.review(system, messages, options)
        );
      if (messages[0]?.content === 'Grade the response.')
        return boundary.grade(system, messages, options);
      return boundary.generate(system, messages, options);
    },
  }),
}));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { composeWritingPrompts, generateClassWriting } from '@/lib/class-writing-generator';
import { gradeWriting } from '@/lib/writing-grader';
import { authorizedLearnerExecution } from '../../../helpers/runtime/provider-execution';

const params = {
  userId: 'u1',
  execution: authorizedLearnerExecution('u1'),
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  objective: 'Report a journey in the Perfekt.',
  targetVocab: [{ lemma: 'Fahrkarte', gloss: 'ticket' }],
};
const translations = [
  ['I bought a ticket.', 'Ich habe eine Fahrkarte gekauft.'],
  ['Mia travelled home.', 'Mia ist nach Hause gefahren.'],
  ['We did not miss the train.', 'Wir haben den Zug nicht verpasst.'],
].map(([sourceText, modelAnswer]) => ({
  taskType: 'translation',
  task: 'Übersetze ins Deutsche. Verwende das Perfekt.',
  sourceText,
  modelAnswer,
  guidance: null,
  ideas: null,
  starterText: null,
  correctionReason: null,
}));
const response = (prompts = translations) => ({
  content: JSON.stringify({ prompts }),
  model: 'test-model',
});

beforeEach(() => {
  vi.clearAllMocks();
  boundary.generate.mockReset().mockResolvedValue(response());
  boundary.review.mockReset().mockImplementation(async (_system, messages) => ({
    content: JSON.stringify({
      items: JSON.parse(messages[0].content).items.map((item: { index: number }) => ({
        index: item.index,
        acceptable: true,
        issues: [],
        feedback: [],
      })),
    }),
    model: 'test-model',
  }));
});

describe('class translation practice', () => {
  it('publishes native source sentences without exposing the private translation or openings', async () => {
    await generateClassWriting({ ...params, classId: 'class-1' });
    const stored = boundary.persist.mock.calls[0][0].data;
    for (const [index, item] of translations.entries()) {
      expect(stored[index].task).toContain(item.sourceText);
      expect(stored[index].ideas).toEqual([]);
      expect(JSON.stringify(stored[index])).not.toContain(item.modelAnswer);
      expect(stored[index]).not.toHaveProperty('modelAnswer');
    }
    const reviewer = boundary.review.mock.calls[0][0];
    expect(reviewer).toContain('sourceText is deliberately in the learner');
    expect(reviewer).toContain('Accept natural paraphrases');
  });

  it('repairs a wrong task type while retaining the native-input policy', async () => {
    boundary.generate.mockResolvedValueOnce(
      response(translations.map((item) => ({ ...item, taskType: 'guided_reply' })))
    );
    const prompts = await composeWritingPrompts({ ...params, taskMode: 'translation' });
    expect(prompts.map((item) => item.task)).toEqual(
      translations.map((item) => `${item.task}\n\n${item.sourceText}`)
    );
    const replacement = boundary.generate.mock.calls[1][1][0].content;
    expect(replacement).toContain('sourceText must remain in en');
    expect(replacement).toContain('modelAnswer must be in de');
  });

  it('preserves accepted translations when a rejected meaning is repaired', async () => {
    boundary.generate.mockResolvedValueOnce(
      response([
        { ...translations[0], modelAnswer: 'Ich habe keine Fahrkarte gekauft.' },
        ...translations.slice(1),
      ])
    );
    boundary.generate.mockResolvedValueOnce(
      response([
        translations[0],
        {
          ...translations[1],
          sourceText: 'Mia stayed home.',
          modelAnswer: 'Mia ist zu Hause geblieben.',
        },
        {
          ...translations[2],
          sourceText: 'We missed the train.',
          modelAnswer: 'Wir haben den Zug verpasst.',
        },
      ])
    );
    boundary.review.mockResolvedValueOnce({
      content: JSON.stringify({
        items: [
          {
            index: 0,
            acceptable: false,
            issues: ['incorrect'],
            feedback: ['The answer negates a positive source sentence.'],
          },
          { index: 1, acceptable: true, issues: [], feedback: [] },
          { index: 2, acceptable: true, issues: [], feedback: [] },
        ],
      }),
      model: 'test-model',
    });
    const prompts = await composeWritingPrompts({ ...params, taskMode: 'translation' });
    expect(prompts[1].task).toContain(translations[1].sourceText);
    expect(prompts[2].task).toContain(translations[2].sourceText);
    const reviewed = JSON.parse(boundary.review.mock.calls[1][1][0].content).items;
    for (const [index, item] of translations.entries())
      expect(reviewed[index].content).toMatchObject({
        sourceText: item.sourceText,
        modelAnswer: item.modelAnswer,
      });
    expect(boundary.generate.mock.calls[1][1][0].content).toContain('sourceText must remain in en');
  });

  it('refuses unsupported tasks after the shared replacement without publishing', async () => {
    boundary.generate.mockResolvedValue(
      response(translations.map((item) => ({ ...item, taskType: 'guided_reply' })))
    );
    await expect(generateClassWriting({ ...params, classId: 'class-1' })).rejects.toThrow();
    expect(boundary.persist).not.toHaveBeenCalled();
  });

  it('grades the supplied meaning and permits paraphrases rather than rewarding unrelated fluent text', async () => {
    boundary.grade.mockResolvedValue({
      content: JSON.stringify({
        overallScore: 0.3,
        corrections: [],
        feedback: 'The journey is missing.',
      }),
      model: 'test-model',
    });
    const task = 'Übersetze ins Deutsche: I travelled home, but I did not buy a ticket.';
    const text = 'Ich habe Kaffee getrunken.';
    const grade = await gradeWriting({ ...params, task, text });
    expect(grade).toMatchObject({ overallScore: 0.3, feedback: 'The journey is missing.' });
    const instructions = boundary.grade.mock.calls[0][0];
    expect(instructions).toContain(task);
    expect(instructions).toContain(text);
    expect(instructions).toContain('negation, modality');
    expect(instructions).toContain('Accept natural paraphrases');
    expect(instructions).toContain('Do not reward an unrelated simpler sentence');
  });
});
