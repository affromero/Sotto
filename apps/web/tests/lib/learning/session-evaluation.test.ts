import { describe, expect, it } from 'vitest';
import { createSkillRequirements } from '@sotto/shared';
import {
  assertLearningMaterial,
  evaluateLearningWork,
  type LearningSectionWork,
} from '@/lib/learning/session-evaluation';

const requirements = createSkillRequirements({
  scope: 'FULL',
  nativeLang: 'en',
  targetLang: 'de',
  level: 'A2',
  ttsProvider: null,
  sttProvider: null,
});
const sections: LearningSectionWork[] = [
  {
    skill: 'GRAMMAR',
    itemIds: ['g1', 'g2', 'g3', 'g4', 'g5'],
    gradedItemIds: ['g1', 'g2', 'g3', 'g4', 'g5'],
    score: 1,
    passThreshold: 0.7,
  },
  {
    skill: 'READING',
    itemIds: ['r1', 'r2', 'r3', 'r4', 'r5'],
    gradedItemIds: ['r1', 'r2', 'r3', 'r4', 'r5'],
    passageText: 'Anna fährt morgen nach Berlin.',
    score: 1,
    passThreshold: 0.7,
  },
  {
    skill: 'WRITING',
    itemIds: ['w1', 'w2', 'w3'],
    gradedItemIds: ['w1', 'w2', 'w3'],
    score: 1,
    passThreshold: 0.7,
  },
];

describe('complete learning evidence', () => {
  it('permits complete text learning only with captured provider exemptions', () => {
    const result = evaluateLearningWork(requirements, sections);
    expect(result.complete).toBe(true);
    expect(result.mastered).toBe(true);
    expect(result.sections.find((section) => section.skill === 'LISTENING')).toMatchObject({
      required: false,
      score: null,
      passed: null,
    });
  });

  it('keeps ungraded writing incomplete despite perfect other scores', () => {
    const result = evaluateLearningWork(
      requirements,
      sections.map((section) =>
        section.skill === 'WRITING' ? { ...section, gradedItemIds: ['w1'], score: 1 } : section
      )
    );
    expect(result.complete).toBe(false);
    expect(result.mastered).toBe(false);
  });

  it('separates completed low-score practice from class mastery', () => {
    const result = evaluateLearningWork(
      requirements,
      sections.map((section) =>
        section.skill === 'WRITING' ? { ...section, score: 0.2 } : section
      )
    );
    expect(result.complete).toBe(true);
    expect(result.mastered).toBe(false);
  });

  it('does not let duplicate evidence replace a missing response', () => {
    const result = evaluateLearningWork(
      requirements,
      sections.map((section) =>
        section.skill === 'WRITING' ? { ...section, gradedItemIds: ['w1', 'w1', 'w2'] } : section
      )
    );
    expect(result.complete).toBe(false);
  });

  it('rejects a missing required skill instead of scoring the smaller session', () => {
    expect(() =>
      assertLearningMaterial(
        requirements,
        sections.filter((section) => section.skill !== 'WRITING')
      )
    ).toThrow(/writing/);
  });

  it('rejects absent reading passages even when questions exist', () => {
    expect(() =>
      assertLearningMaterial(
        requirements,
        sections.map((section) => ({ ...section, passageText: null }))
      )
    ).toThrow(/passage/);
  });

  it('blocks completion until required listening audio is ready', () => {
    const audioRequirements = createSkillRequirements({
      ...requirements,
      scope: 'LISTENING',
      ttsProvider: 'local',
    });
    const listening: LearningSectionWork = {
      skill: 'LISTENING',
      itemIds: ['l1', 'l2', 'l3', 'l4'],
      gradedItemIds: ['l1', 'l2', 'l3', 'l4'],
      audio: { status: 'GENERATING_AUDIO', audioUrl: null },
      score: 1,
      passThreshold: 0.7,
    };
    expect(() => assertLearningMaterial(audioRequirements, [listening])).not.toThrow();
    expect(() => evaluateLearningWork(audioRequirements, [listening])).toThrow(/preparing/);
  });

  it.each([NaN, Infinity, -0.1, 1.1])(
    'rejects unsupported score %s as completion evidence',
    (score) => {
      expect(
        evaluateLearningWork(
          requirements,
          sections.map((section) => (section.skill === 'WRITING' ? { ...section, score } : section))
        ).complete
      ).toBe(false);
    }
  );
});
