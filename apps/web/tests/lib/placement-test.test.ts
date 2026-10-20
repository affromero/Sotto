// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  parsePlacementQuestionBatch,
  preparePlacementQuestionBatch,
  scorePlacement,
  toPublic,
  idkLabel,
} from '@/lib/placement-test';

const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
const raw = () => ({
  questions: levels.flatMap((cefr) =>
    Array.from({ length: 2 }, (_, index) => ({
      cefr,
      skill: index ? 'reading' : 'grammar',
      prompt: `A distinct ${cefr} question ${index}: 😀`,
      options: ['alpha', 'beta', 'gamma', 'delta'],
      correctIndex: 0,
      explanation: 'A precise explanation.',
    }))
  ),
});
const questions = () => parsePlacementQuestionBatch(JSON.stringify(raw()), 'es', 2);
describe('complete immutable diagnostic questions', () => {
  it('retains every band and strips answer keys from the public projection', () => {
    const parsed = questions();
    expect(parsed).toHaveLength(12);
    expect(parsed.map((question) => question.cefr)).toEqual(
      levels.flatMap((level) => [level, level])
    );
    expect(parsed.every((question) => question.options[4] === 'No lo sé')).toBe(true);
    expect(toPublic(parsed[0]!)).not.toHaveProperty('correctIndex');
    expect(toPublic(parsed[0]!)).not.toHaveProperty('explanation');
  });
  it('rejects a missing band, missing question and malformed answer instead of publishing a partial quiz', () => {
    const missing = raw();
    missing.questions.pop();
    expect(() => parsePlacementQuestionBatch(JSON.stringify(missing), 'en', 2)).toThrow(
      'every requested'
    );
    const malformed = raw();
    malformed.questions[0]!.correctIndex = 4;
    expect(() => parsePlacementQuestionBatch(JSON.stringify(malformed), 'en', 2)).toThrow();
    const wrongBand = raw();
    wrongBand.questions[0]!.cefr = 'C2';
    expect(() => parsePlacementQuestionBatch(JSON.stringify(wrongBand), 'en', 2)).toThrow(
      'every requested'
    );
  });
  it('rejects duplicate content choices, a misleading native uncertainty choice and malformed Unicode', () => {
    const duplicated = raw();
    duplicated.questions[0]!.options[1] = 'alpha';
    expect(() => parsePlacementQuestionBatch(JSON.stringify(duplicated), 'en', 2)).toThrow(
      'distinct'
    );
    const uncertainty = raw();
    uncertainty.questions[0]!.options[0] = idkLabel('es');
    expect(() => parsePlacementQuestionBatch(JSON.stringify(uncertainty), 'es', 2)).toThrow();
    const malformed = raw();
    malformed.questions[0]!.prompt = 'broken\uD800';
    expect(() => parsePlacementQuestionBatch(JSON.stringify(malformed), 'en', 2)).toThrow();
  });
  it('rejects malformed JSON, invented skill defaults and oversized output', () => {
    expect(() => parsePlacementQuestionBatch('{', 'en', 2)).toThrow();
    const output = raw();
    Reflect.set(output.questions[0]!, 'skill', 'invented');
    expect(() => parsePlacementQuestionBatch(JSON.stringify(output), 'en', 2)).toThrow();
    expect(() => parsePlacementQuestionBatch('x'.repeat(524289), 'en', 2)).toThrow('budget');
  });
  it('uses the canonical bounded prompt without accepting an invalid per-band budget', () => {
    const input = preparePlacementQuestionBatch('en', 'de', 'Owned learner context', 2);
    expect(input.system).toContain('Owned learner context');
    expect(input.system).toContain('not learner mastery');
    expect(input.messages[0]!.content).toContain('12 placement questions');
    expect(input.jsonSchema.name).toBe('placement_questions');
    expect(() => preparePlacementQuestionBatch('en', 'de', '', 0)).toThrow('Invalid');
  });
});
describe('diagnostic score without earned mastery', () => {
  it('walks the complete band staircase and stops at the first failed band', () => {
    const items = questions(),
      all = items.map((question) => ({ id: question.id, selectedIndex: 0 }));
    expect(scorePlacement(items, all).level).toBe('C2');
    expect(
      scorePlacement(
        items,
        items.map((question) => ({
          id: question.id,
          selectedIndex: question.cefr === 'B1' ? 3 : 0,
        }))
      ).level
    ).toBe('A2');
  });
  it('scores uncertainty and missing answers as incorrect and exposes no objective mastery state', () => {
    const items = questions(),
      score = scorePlacement(
        items,
        items.map((question) => ({ id: question.id, selectedIndex: 4 }))
      );
    expect(score.level).toBe('A1');
    expect(score.responses.every((answer) => !answer.correct)).toBe(true);
    expect(scorePlacement(items, []).responses.every((answer) => !answer.correct)).toBe(true);
    expect(score).not.toHaveProperty('masteredObjectiveIds');
  });
});
