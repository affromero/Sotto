import { describe, it, expect, vi } from 'vitest';

// generatePlacement reaches out to the resolved AI provider; mock the seams so
// the test stays hermetic and asserts only our option-shaping behavior.
vi.mock('@/lib/learning-ai', () => ({
  resolveLearningAi: vi.fn().mockResolvedValue({ provider: 'test', model: 'test-model', apiKey: undefined }),
}));
vi.mock('@/lib/providers/ai', () => ({
  createAIProvider: vi.fn(() => ({
    generateResponse: vi.fn().mockResolvedValue({
      content: JSON.stringify([
        { cefr: 'A1', skill: 'grammar', prompt: 'q1', options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: '' },
        { cefr: 'B1', skill: 'reading', prompt: 'q2', options: ['w', 'x', 'y', 'z'], correctIndex: 2, explanation: '' },
      ]),
      model: 'test-model',
      inputTokens: 0,
      outputTokens: 0,
    }),
  })),
}));
vi.mock('@/lib/prompt-loader', () => ({ loadAndRender: vi.fn(() => '') }));
vi.mock('@/lib/usage-logger', () => ({ logUsage: vi.fn() }));
vi.mock('@/lib/course-notes', () => ({ formatNotesForPrompt: vi.fn(() => '') }));

import { scorePlacement, idkLabel, generatePlacement, type PlacementQuestion } from '@/lib/placement-test';

function q(id: string, cefr: string, skill: string): PlacementQuestion {
  return {
    id,
    cefr: cefr as PlacementQuestion['cefr'],
    skill: skill as PlacementQuestion['skill'],
    prompt: id,
    options: ['a', 'b', 'c', 'd', "I don't know"],
    correctIndex: 0,
    explanation: '',
  };
}

// Two questions per band A1..B2 (>=70% ⇒ both correct to pass a band).
const questions: PlacementQuestion[] = [
  q('a1-1', 'A1', 'grammar'),
  q('a1-2', 'A1', 'vocab'),
  q('a2-1', 'A2', 'grammar'),
  q('a2-2', 'A2', 'vocab'),
  q('b1-1', 'B1', 'grammar'),
  q('b1-2', 'B1', 'reading'),
  q('b2-1', 'B2', 'grammar'),
  q('b2-2', 'B2', 'reading'),
];
const allCorrect = questions.map((x) => ({ id: x.id, selectedIndex: 0 }));

const IDK_INDEX = 4;

describe('scorePlacement staircase', () => {
  it('assigns the highest fully-passed band', () => {
    expect(scorePlacement(questions, allCorrect).level).toBe('B2');
  });

  it('stops one band below the first failed band', () => {
    const answers = questions.map((x) => ({ id: x.id, selectedIndex: x.cefr === 'B1' ? 3 : 0 }));
    expect(scorePlacement(questions, answers).level).toBe('A2');
  });

  it('floors at A1 when A1 is failed', () => {
    const answers = questions.map((x) => ({ id: x.id, selectedIndex: x.cefr === 'A1' ? 3 : 0 }));
    expect(scorePlacement(questions, answers).level).toBe('A1');
  });

  it('reports per-skill scores and a response per question', () => {
    const out = scorePlacement(questions, allCorrect);
    expect(out.scoreBySkill.grammar).toBe(1);
    expect(out.responses).toHaveLength(questions.length);
    expect(out.responses.every((r) => r.correct)).toBe(true);
  });

  it('scores the "I don\'t know" option as not mastered', () => {
    // Choosing index 4 (the appended IDK option) is never the correct index, so
    // every band fails and the learner floors at A1.
    const idkEverywhere = questions.map((x) => ({ id: x.id, selectedIndex: IDK_INDEX }));
    const out = scorePlacement(questions, idkEverywhere);
    expect(out.level).toBe('A1');
    expect(out.responses.every((r) => !r.correct)).toBe(true);
  });
});

describe('idkLabel', () => {
  it('returns the native-language phrase for supported languages', () => {
    expect(idkLabel('en')).toBe("I don't know");
    expect(idkLabel('es')).toBe('No lo sé');
    expect(idkLabel('de')).toBe('Ich weiß nicht');
  });

  it('normalizes case/whitespace', () => {
    expect(idkLabel(' ES ')).toBe('No lo sé');
  });

  it('falls back to English for unknown codes', () => {
    expect(idkLabel('xx')).toBe("I don't know");
  });
});

describe('generatePlacement option shaping', () => {
  it('appends the native-language "I don\'t know" as the last option', async () => {
    const { questions: out } = await generatePlacement('user-1', 'es', 'en');
    expect(out.length).toBeGreaterThan(0);
    for (const question of out) {
      expect(question.options).toHaveLength(5);
      expect(question.options[4]).toBe('No lo sé');
      // correctIndex always points at a content option, never the IDK option.
      expect(question.correctIndex).toBeLessThan(4);
    }
  });
});
