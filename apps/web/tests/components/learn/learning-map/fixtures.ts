import {
  evaluateLevelReadiness,
  learningLevelReadinessSchema,
  objectiveProgress,
  type CefrLevel,
  type LearningCatalog,
  type LearningMapResponse,
  type LearningObjective,
  type ObjectiveEvidenceState,
} from '@sotto/shared';

const now = new Date('2026-10-20T12:00:00.000Z');
export const grammarExamples: Record<
  CefrLevel,
  { title: string; example: string; assessment: string }
> = {
  A1: {
    title: 'Put the finite verb second in statements',
    example: 'Heute lerne ich Deutsch.',
    assessment: 'Build a main clause with the finite verb in second position.',
  },
  A2: {
    title: 'Choose als or wenn for past events',
    example: 'Als ich ankam, regnete es.',
    assessment: 'Use als for a particular past occasion and wenn for repeated past occasions.',
  },
  B1: {
    title: 'Sequence past events using nachdem',
    example: 'Nachdem ich gegessen hatte, ging ich spazieren.',
    assessment:
      'Use nachdem to show the earlier past event and choose tenses that make the sequence clear.',
  },
  B2: {
    title: 'Use relative clauses with prepositions',
    example: 'Das ist die Kollegin, mit der ich arbeite.',
    assessment: 'Choose the relative pronoun case required by the preposition.',
  },
  C1: {
    title: 'Mark indirect speech with Konjunktiv I',
    example: 'Die Sprecherin erklärte, das Ergebnis sei vorläufig.',
    assessment: 'Report a third-party claim while preserving reporting perspective.',
  },
  C2: {
    title: 'Control the scope of complex negation',
    example: 'Nicht alle Anträge wurden abgelehnt.',
    assessment:
      'Express precise partial or total negation and explain how placement changes meaning.',
  },
};
export function makeMap(
  options: {
    viewedLevel?: CefrLevel;
    currentLevel?: CefrLevel;
    confident?: boolean;
    blockers?: string[];
    completed?: boolean;
  } = {}
): LearningMapResponse {
  const level = options.viewedLevel ?? 'A2';
  const grammar: LearningObjective = {
    id: `de.g.${level.toLowerCase()}`,
    parentId: 'de.grammar.connecting',
    branch: 'GRAMMAR',
    kind: 'OBJECTIVE',
    title: grammarExamples[level].title,
    description: grammarExamples[level].assessment,
    assessment: grammarExamples[level].assessment,
    examples: [grammarExamples[level].example],
    level,
    order: 2,
    required: true,
    criterionVersion: 1,
    policyVersion: 1,
    skills: ['GRAMMAR', 'WRITING'],
    skillCriteria: {
      GRAMMAR: `Distinguish and apply: ${grammarExamples[level].assessment}`,
      WRITING: `Compose an original answer: ${grammarExamples[level].assessment}`,
    },
    grammarKeys: [],
    vocabulary: [],
  };
  const situation: LearningObjective = {
    ...grammar,
    id: `de.s.${level.toLowerCase()}`,
    parentId: 'de.situations',
    branch: 'SITUATIONS',
    title: 'Arrange a meeting',
    assessment: 'Propose a time and place, respond to an alternative, and confirm an arrangement.',
    examples: ['Passt dir Donnerstag um drei Uhr?'],
    order: 4,
    skills: ['READING', 'LISTENING', 'SPEAKING', 'WRITING'],
    skillCriteria: {
      READING: 'Interpret a proposal of a meeting time and place in an unseen exchange.',
      LISTENING: 'Understand an unheard spoken arrangement and its confirmation.',
      SPEAKING: 'Independently propose and negotiate a meeting without a supplied answer.',
      WRITING: 'Compose an original meeting proposal and respond to an alternative.',
    },
  };
  const states: ObjectiveEvidenceState[] = options.confident
    ? [grammar, situation].flatMap((objective) =>
        objective.skills.map((skill) => ({
          objectiveId: objective.id,
          criterionVersion: 1,
          policyVersion: 1,
          level,
          skill,
          mastery: 0.95,
          assessedTasks: 5,
          assessedSessions: 2,
          lastQuality: 1,
          lastReviewed: '2026-10-01T12:00:00.000Z',
          dueAt: '2026-10-02T12:00:00.000Z',
        }))
      )
    : [];
  const catalog: LearningCatalog = {
    schemaVersion: 1,
    version: 1,
    targetLang: 'de',
    title: 'German',
    alignment: 'SOTTO_CEFR',
    references: [{ title: 'Curriculum reference', url: 'https://www.coe.int/' }],
    nodes: [
      {
        id: 'de.grammar',
        parentId: null,
        branch: 'GRAMMAR',
        kind: 'GROUP',
        title: 'Grammar',
        description: '',
        order: 0,
      },
      {
        id: 'de.grammar.connecting',
        parentId: 'de.grammar',
        branch: 'GRAMMAR',
        kind: 'GROUP',
        title: 'Connecting sentences',
        description: '',
        order: 1,
      },
      grammar,
      {
        id: 'de.situations',
        parentId: null,
        branch: 'SITUATIONS',
        kind: 'GROUP',
        title: 'Situations',
        description: '',
        order: 3,
      },
      situation,
    ],
  };
  return {
    courseId: 'course-1',
    targetLang: 'de',
    currentLevel: options.currentLevel ?? 'A2',
    viewedLevel: level,
    catalogVersion: 1,
    catalogHash: 'a'.repeat(64),
    requirementId: 'binding-1',
    readiness: learningLevelReadinessSchema.parse(
      evaluateLevelReadiness(catalog, level, states, [], now)
    ),
    coverage: null,
    blockers: options.blockers ?? [],
    completedAt: options.completed ? '2026-10-19T12:00:00.000Z' : null,
    references: catalog.references,
    nodes: catalog.nodes.map((node) => {
      const progress = node.kind === 'OBJECTIVE' ? objectiveProgress(node, states, [], now) : null;
      return {
        node,
        progress,
        summary: {
          total: 1,
          confident: options.confident ? 1 : 0,
          notAssessed: options.confident ? 0 : 1,
          reviewDue: options.confident ? 1 : 0,
        },
      };
    }),
  };
}
