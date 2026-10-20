import { describe, expect, it } from 'vitest';
import { getLanguageCatalog } from '@/lib/learning-map/catalogs';
import { mapLessonToCatalog } from '@/lib/learning-map/lessons';

const german = getLanguageCatalog('de');
describe('curriculum teaching scope', () => {
  it('links exact known constructions while preserving unresolved broad labels', () => {
    const result = mapLessonToCatalog(german, {
      level: 'A2',
      grammarPoints: ['temporal-als-wenn', 'temporal-connectors'],
    });
    expect(result.objectives.map((item) => item.objectiveId)).toEqual(['de.g.als-wenn-past']);
    expect(result.unresolvedGrammarKeys).toEqual(['temporal-connectors']);
    expect(result.unresolved).toBe(true);
  });
  it('does not move a higher-band construction into a lower lesson', () => {
    expect(
      mapLessonToCatalog(german, { level: 'A1', grammarPoints: ['temporal-als-wenn'] }).objectives
    ).toEqual([]);
  });
  it('leaves broad historical tense and mood labels unresolved', () => {
    const result = mapLessonToCatalog(german, {
      level: 'B1',
      grammarPoints: ['plusquamperfekt', 'konjunktiv-ii', 'passive-voice'],
    });
    expect(result.objectives).toEqual([]);
    expect(result.unresolvedGrammarKeys).toEqual([
      'plusquamperfekt',
      'konjunktiv-ii',
      'passive-voice',
    ]);
  });
  it('preserves independent situation and grammar links', () => {
    const result = mapLessonToCatalog(german, {
      level: 'A2',
      grammarPoints: ['temporal-als-wenn'],
      learningObjectiveIds: ['de.s.plans'],
    });
    expect(result.objectives.map((item) => item.objectiveId)).toEqual([
      'de.s.plans',
      'de.g.als-wenn-past',
    ]);
    expect(result.unresolved).toBe(false);
  });
  it('rejects a foreign language or band in explicit authored links', () => {
    for (const id of ['ja.g.wa-ga', 'de.s.introductions'])
      expect(() =>
        mapLessonToCatalog(german, { level: 'A2', grammarPoints: [], learningObjectiveIds: [id] })
      ).toThrow('target language and difficulty');
  });
  it('keeps an ambiguous legacy label unresolved instead of crediting several objectives', () => {
    const ambiguous = structuredClone(german);
    for (const node of ambiguous.nodes)
      if (node.kind === 'OBJECTIVE' && node.level === 'A2' && node.branch === 'GRAMMAR')
        node.grammarKeys.push('ambiguous');
    const result = mapLessonToCatalog(ambiguous, { level: 'A2', grammarPoints: ['ambiguous'] });
    expect(result.objectives).toEqual([]);
    expect(result.unresolvedGrammarKeys).toEqual(['ambiguous']);
  });
});
