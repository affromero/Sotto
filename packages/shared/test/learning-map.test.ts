import { describe, expect, it } from 'vitest';
import {
  learningCatalogSchema,
  learningObjectiveSchema,
  type LearningCatalog,
  type LearningObjective,
} from '../src/learning-map/catalog';
import {
  evaluateLevelReadiness,
  objectiveProgress,
  type ObjectiveEvidenceState,
} from '../src/learning-map/progress';
import {
  learningSelectionSnapshotSchema,
  resolveLearningSelection,
} from '../src/learning-map/selection';

function catalog(): LearningCatalog {
  const nodes: LearningCatalog['nodes'] = [
    {
      id: 'de.grammar',
      parentId: null,
      kind: 'GROUP',
      branch: 'GRAMMAR',
      title: 'Grammar',
      description: '',
      order: 0,
    },
    {
      id: 'de.situations',
      parentId: null,
      kind: 'GROUP',
      branch: 'SITUATIONS',
      title: 'Situations',
      description: '',
      order: 1,
    },
  ];
  for (const level of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const)
    for (const branch of ['GRAMMAR', 'SITUATIONS'] as const)
      nodes.push({
        id: `de.${branch.toLowerCase()}.${level.toLowerCase()}`,
        parentId: `de.${branch.toLowerCase()}`,
        kind: 'OBJECTIVE',
        branch,
        title: `Use a ${level} construction`,
        description: '',
        order: nodes.length,
        level,
        required: true,
        criterionVersion: 1,
        policyVersion: 1,
        skills: branch === 'GRAMMAR' ? ['GRAMMAR'] : ['WRITING', 'SPEAKING'],
        skillCriteria:
          branch === 'GRAMMAR'
            ? { GRAMMAR: 'Choose or construct the selected German structure accurately.' }
            : {
                WRITING: 'Independently write a German response that meets the situation goal.',
                SPEAKING:
                  'Independently respond in German without reading a supplied target phrase.',
              },
        assessment: 'Demonstrate the selected construction in a suitable task.',
        examples: ['Ein Beispiel.'],
        grammarKeys: [],
        vocabulary: [],
      });
  return learningCatalogSchema.parse({
    schemaVersion: 1,
    targetLang: 'de',
    version: 1,
    title: 'German',
    alignment: 'SOTTO_CEFR',
    references: [{ title: 'Reference', url: 'https://www.coe.int/' }],
    nodes,
  });
}
function evidence(
  objectiveId: string,
  skill: ObjectiveEvidenceState['skill']
): ObjectiveEvidenceState {
  return {
    objectiveId,
    criterionVersion: 1,
    policyVersion: 1,
    level: 'A2',
    skill,
    mastery: 0.95,
    assessedTasks: 5,
    assessedSessions: 2,
    lastQuality: 1,
    lastReviewed: '2026-10-01T12:00:00.000Z',
    dueAt: '2026-10-02T12:00:00.000Z',
  };
}
const now = new Date('2026-10-20T12:00:00.000Z');

describe('learning maps', () => {
  it('requires exactly one nonempty rubric for each declared objective skill', () => {
    const objective = catalog().nodes.find(
      (node): node is LearningObjective => node.kind === 'OBJECTIVE' && node.branch === 'GRAMMAR'
    )!;
    expect(learningObjectiveSchema.safeParse(objective).success).toBe(true);
    for (const skillCriteria of [
      {},
      { GRAMMAR: '   ' },
      { GRAMMAR: 'x'.repeat(2001) },
      { ...objective.skillCriteria, SPEAKING: 'Speak about the topic.' },
      { ...objective.skillCriteria, TRANSLATION: 'Translate the phrase.' },
    ])
      expect(learningObjectiveSchema.safeParse({ ...objective, skillCriteria }).success).toBe(
        false
      );
  });

  it('preserves channel rubrics in a selection snapshot independently of later catalog edits', () => {
    const source = catalog();
    const objective = source.nodes.find(
      (node): node is LearningObjective =>
        node.kind === 'OBJECTIVE' && node.id === 'de.situations.a2'
    )!;
    const snapshot = learningSelectionSnapshotSchema.parse({
      schemaVersion: 1,
      catalogVersion: source.version,
      catalogHash: 'a'.repeat(64),
      targetLang: source.targetLang,
      level: 'A2',
      nodeIds: [objective.id],
      objectives: [
        {
          id: objective.id,
          criterionVersion: objective.criterionVersion,
          policyVersion: objective.policyVersion,
          title: objective.title,
          branch: objective.branch,
          level: objective.level,
          assessment: objective.assessment,
          examples: objective.examples,
          skills: objective.skills,
          skillCriteria: objective.skillCriteria,
          grammarKeys: objective.grammarKeys,
          vocabulary: objective.vocabulary,
        },
      ],
      materialFocusId: null,
    });
    expect(snapshot.objectives[0]!.skillCriteria).toEqual(objective.skillCriteria);
    objective.skillCriteria.WRITING = 'A revised writing criterion.';
    expect(snapshot.objectives[0]!.skillCriteria.WRITING).toBe(
      'Independently write a German response that meets the situation goal.'
    );
    for (const skillCriteria of [
      { SPEAKING: 'Respond independently to the prompt.' },
      { ...snapshot.objectives[0]!.skillCriteria, WRITING: '' },
      { ...snapshot.objectives[0]!.skillCriteria, LISTENING: 'Understand the recording.' },
    ]) {
      const invalid = structuredClone(snapshot);
      invalid.objectives[0]!.skillCriteria = skillCriteria;
      expect(learningSelectionSnapshotSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('rejects missing parents, cycles, duplicate identities, and missing level coverage', () => {
    const original = catalog();
    const duplicate = structuredClone(original);
    duplicate.nodes.push(duplicate.nodes[0]!);
    expect(learningCatalogSchema.safeParse(duplicate).success).toBe(false);
    const orphan = structuredClone(original);
    orphan.nodes[2]!.parentId = 'missing';
    expect(learningCatalogSchema.safeParse(orphan).success).toBe(false);
    const cyclic = structuredClone(original);
    cyclic.nodes[0]!.parentId = cyclic.nodes[0]!.id;
    expect(learningCatalogSchema.safeParse(cyclic).success).toBe(false);
    const incomplete = structuredClone(original);
    incomplete.nodes = incomplete.nodes.filter(
      (node) => node.kind !== 'OBJECTIVE' || node.level !== 'C2'
    );
    expect(learningCatalogSchema.safeParse(incomplete).success).toBe(false);
  });

  it('keeps an unassessed A2 learner blocked even when an unrelated skill is strong', () => {
    const readiness = evaluateLevelReadiness(
      catalog(),
      'A2',
      [evidence('de.grammar.a1', 'GRAMMAR')],
      [],
      now
    );
    expect(readiness.ready).toBe(false);
    expect(readiness.missingObjectiveIds).toEqual(['de.grammar.a2', 'de.situations.a2']);
    expect(readiness.unassessedCount).toBe(2);
  });

  it('requires every core criterion and discloses exempt oral skills', () => {
    const states = [evidence('de.grammar.a2', 'GRAMMAR'), evidence('de.situations.a2', 'WRITING')];
    expect(evaluateLevelReadiness(catalog(), 'A2', states, [], now).ready).toBe(false);
    const readiness = evaluateLevelReadiness(catalog(), 'A2', states, ['SPEAKING'], now);
    expect(readiness.ready).toBe(true);
    expect(readiness.nextLevel).toBe('B1');
    expect(readiness.exemptSkills).toEqual(['SPEAKING']);
  });

  it('keeps due review separate from confidence and requires distinct session evidence', () => {
    const objective = catalog().nodes.find(
      (node): node is LearningObjective => node.kind === 'OBJECTIVE' && node.id === 'de.grammar.a2'
    )!;
    expect(
      objectiveProgress(objective, [evidence(objective.id, 'GRAMMAR')], [], now)
    ).toMatchObject({ status: 'CONFIDENT', reviewDue: true });
    expect(
      objectiveProgress(
        objective,
        [{ ...evidence(objective.id, 'GRAMMAR'), assessedSessions: 1 }],
        [],
        now
      ).status
    ).toBe('PRACTISING');
  });

  it('does not reuse confidence from incompatible criteria or policies', () => {
    const objective = catalog().nodes.find(
      (node): node is LearningObjective => node.kind === 'OBJECTIVE'
    )!;
    const state = { ...evidence(objective.id, 'GRAMMAR'), level: objective.level };
    expect(objectiveProgress({ ...objective, criterionVersion: 2 }, [state], [], now).status).toBe(
      'NOT_ASSESSED'
    );
    expect(objectiveProgress(objective, [{ ...state, policyVersion: 2 }], [], now).status).toBe(
      'NOT_ASSESSED'
    );
  });

  it.each(['GRAMMAR', 'READING', 'WRITING'] as const)(
    'rejects an exemption of mandatory %s evidence',
    (skill) => {
      expect(() => evaluateLevelReadiness(catalog(), 'A2', [], [skill], now)).toThrow();
    }
  );

  it('resolves grammar and situation selections independently at the chosen refresh level', () => {
    const source = catalog();
    const grammar = resolveLearningSelection(source, {
      catalogVersion: 1,
      nodeIds: ['de.grammar'],
      level: 'A1',
    });
    expect(grammar.map((objective) => objective.id)).toEqual(['de.grammar.a1']);
    const situation = resolveLearningSelection(source, {
      catalogVersion: 1,
      nodeIds: ['de.situations'],
      level: 'A2',
    });
    expect(situation.map((objective) => objective.id)).toEqual(['de.situations.a2']);
    expect(() =>
      resolveLearningSelection(source, { catalogVersion: 2, nodeIds: ['de.grammar'], level: 'A2' })
    ).toThrow(/catalog changed/);
    expect(() =>
      resolveLearningSelection(source, { catalogVersion: 1, nodeIds: ['ja.grammar'], level: 'A2' })
    ).toThrow(/does not belong/);
  });

  it('preserves explicitly chosen objectives when a large group also needs practice', () => {
    const source = catalog();
    const base = source.nodes.find(
      (node): node is LearningObjective => node.kind === 'OBJECTIVE' && node.id === 'de.grammar.a2'
    )!;
    for (let index = 0; index < 6; index++)
      source.nodes.push({ ...base, id: `de.grammar.extra-${index}`, order: index + 20 });
    const resolved = resolveLearningSelection(
      source,
      {
        catalogVersion: 1,
        nodeIds: ['de.grammar', 'de.situations.a2'],
        level: 'A2',
      },
      source.nodes.map((node) => node.id)
    );
    expect(resolved.some((node) => node.id === 'de.situations.a2')).toBe(true);
    expect(resolved).toHaveLength(4);
    const mixedGroups = resolveLearningSelection(source, {
      catalogVersion: 1,
      nodeIds: ['de.grammar', 'de.situations'],
      level: 'A2',
    });
    expect(new Set(mixedGroups.map((node) => node.branch))).toEqual(
      new Set(['GRAMMAR', 'SITUATIONS'])
    );
    expect(() =>
      resolveLearningSelection(source, {
        catalogVersion: 1,
        level: 'A2',
        nodeIds: Array.from({ length: 5 }, (_, index) => `de.grammar.extra-${index}`),
      })
    ).toThrow(/four specific/);
  });
});
