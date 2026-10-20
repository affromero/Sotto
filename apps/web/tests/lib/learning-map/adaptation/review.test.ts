// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  objectiveReviewContext,
  objectiveReviewCounts,
  objectiveReviewSkills,
  objectiveReviewTargets,
} from '@/lib/learning-map/adaptation/review';
import { reviewFixture, onlyReviewSkill } from './fixtures';
import { practiceOverviewResponseSchema } from '@sotto/shared';

const now = new Date('2026-10-20T00:00:00Z');
const scope = { level: 'A1' as const, targetLang: 'es', kind: 'FULL' as const };
describe('qualified objective review recommendations', () => {
  it('accepts older overview responses and validates optional qualified channel counts', () => {
    const base = { due: { vocab: 2, grammar: 1 }, totalVocab: 3, recent: [] };
    expect(practiceOverviewResponseSchema.safeParse(base).success).toBe(true);
    expect(
      practiceOverviewResponseSchema.parse({
        ...base,
        due: { ...base.due, objectives: 1, bySkill: { WRITING: 1 } },
      }).due.bySkill
    ).toEqual({ WRITING: 1 });
    expect(
      practiceOverviewResponseSchema.safeParse({ ...base, due: { ...base.due, objectives: -1 } })
        .success
    ).toBe(false);
    expect(
      practiceOverviewResponseSchema.safeParse({
        ...base,
        due: { ...base.due, bySkill: { UNDECLARED: 1 } },
      }).success
    ).toBe(false);
  });
  it('uses assessed weak channels before their next due date and excludes unassessed or exempt channels', () => {
    const { entry } = reviewFixture();
    const grammar = onlyReviewSkill(entry, 'GRAMMAR');
    expect(objectiveReviewSkills(grammar, now)).toEqual(['GRAMMAR']);
    expect(objectiveReviewTargets([grammar], { ...scope, kind: 'WRITING' }, now)).toEqual([]);
    const exempt = {
      ...grammar,
      progress: {
        ...grammar.progress,
        skills: grammar.progress.skills.map((skill) => ({ ...skill, exempt: true })),
      },
    };
    expect(objectiveReviewTargets([exempt], scope, now)).toEqual([]);
  });
  it('keeps the selected band and language and counts a multi-skill objective once', () => {
    const { entry } = reviewFixture();
    const higher = reviewFixture('GRAMMAR', 'A2').entry;
    expect(
      objectiveReviewTargets([higher, entry, entry], scope, now).map((item) => item.objective.id)
    ).toEqual([entry.objective.id]);
    expect(objectiveReviewTargets([entry], { ...scope, targetLang: 'de' }, now)).toEqual([]);
    expect(objectiveReviewCounts([entry, entry], scope, now)).toEqual({
      objectives: 1,
      bySkill: { GRAMMAR: 1, WRITING: 1 },
    });
  });
  it('preserves exact criteria and revisions without manufacturing assessment authority', () => {
    const { entry } = reviewFixture();
    const context = objectiveReviewContext([entry], { ...scope, kind: 'WRITING' }, now);
    expect(context.text).toContain(entry.objective.title);
    expect(context.text).toContain(entry.objective.id);
    expect(context.text).toContain(entry.catalogHash);
    expect(context.text).toContain(entry.objective.skillCriteria.WRITING);
    expect(context.text).not.toContain(`GRAMMAR: ${entry.objective.skillCriteria.GRAMMAR}`);
    expect(context.text).toContain(
      'does not establish mastery or expand the frozen assessment scope'
    );
  });
  it('retains a whole criterion or omits it when the bounded context cannot contain it', () => {
    const { entry } = reviewFixture();
    const oversized = {
      ...entry,
      objective: {
        ...entry.objective,
        skillCriteria: {
          ...entry.objective.skillCriteria,
          GRAMMAR: 'Entire criterion '.repeat(1000),
        },
      },
    };
    expect(objectiveReviewContext([oversized], scope, now)).toEqual({ entries: [], text: '' });
  });
});
