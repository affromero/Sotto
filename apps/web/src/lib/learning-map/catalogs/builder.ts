import {
  learningCatalogSchema,
  learningLevels,
  type LearningCatalog,
  type LearningLevel,
  type LearningNode,
  type LearningObjective,
} from '@sotto/shared';

export type GrammarRow = readonly [
  level: LearningLevel,
  key: string,
  group: string,
  title: string,
  assessment: string,
  example: string,
  aliases?: readonly string[],
];
export interface LanguageRows {
  targetLang: string;
  title: string;
  references: LearningCatalog['references'];
  grammar: readonly GrammarRow[];
  situations: readonly (readonly string[])[];
}

const situations = [
  [
    [
      'introductions',
      'Social life',
      'Introduce yourself',
      'Give your name, origin, and one personal detail, and ask the other person a relevant question.',
    ],
    [
      'order-food',
      'Food and dining',
      'Order a simple meal',
      'Order a food and drink item, state a quantity, and understand a simple follow-up question.',
    ],
    [
      'directions',
      'Travel',
      'Ask for a location',
      'Ask where a place is and understand a short route with basic location words.',
    ],
    [
      'shopping',
      'Transactions',
      'Ask about price and quantity',
      'Ask the price, request a quantity, and identify the final amount in a simple purchase.',
    ],
  ],
  [
    [
      'plans',
      'Social life',
      'Arrange a meeting',
      'Propose a time and place, respond to an alternative, and confirm a workable arrangement.',
    ],
    [
      'dietary-needs',
      'Food and dining',
      'Explain a dietary restriction',
      'Describe a dietary restriction, ask about ingredients, and select a suitable alternative.',
    ],
    [
      'travel-problem',
      'Travel',
      'Resolve a routine travel problem',
      'Explain a missed connection or booking problem and ask for the next practical option.',
    ],
    [
      'past-experience',
      'Social life',
      'Describe a recent experience',
      'Describe what happened, put events in order, and answer a straightforward follow-up question.',
    ],
  ],
  [
    [
      'work-update',
      'Work',
      'Explain progress at work',
      'Summarize completed work, explain an obstacle, and agree on a practical next step.',
    ],
    [
      'health',
      'Services',
      'Describe symptoms and ask for advice',
      'Explain symptoms and their duration, answer follow-up questions, and clarify advice.',
    ],
    [
      'complaint',
      'Transactions',
      'Explain a service problem',
      'Describe a specific problem, give relevant details, and request a reasonable remedy.',
    ],
    [
      'opinion',
      'Social life',
      'Support an opinion with reasons',
      'State a view, support it with reasons and examples, and respond to a different view.',
    ],
  ],
  [
    [
      'negotiate',
      'Work',
      'Negotiate a change of plan',
      'Explain competing constraints, compare proposals, and negotiate a justified compromise.',
    ],
    [
      'debate',
      'Society',
      'Respond to a counterargument',
      'Represent an opposing argument fairly, respond with evidence, and qualify your own claim.',
    ],
    [
      'housing',
      'Services',
      'Resolve a housing dispute',
      'Explain a housing issue precisely, clarify responsibilities, and negotiate an acceptable resolution.',
    ],
    [
      'presentation',
      'Work',
      'Present and discuss a proposal',
      'Present a structured proposal, distinguish tradeoffs, and answer unprepared audience questions.',
    ],
  ],
  [
    [
      'mediation',
      'Society',
      'Mediate a disagreement',
      'Represent the participants fairly, identify shared interests, and reformulate a disputed point tactfully.',
    ],
    [
      'technical',
      'Work',
      'Explain a specialist idea to a general audience',
      'Explain a complex idea accurately, adapt terminology, and clarify a listener misunderstanding.',
    ],
    [
      'sensitive',
      'Social life',
      'Handle a sensitive conversation',
      'Express disagreement or concern tactfully while preserving the intended meaning and relationship.',
    ],
    [
      'synthesis',
      'Society',
      'Synthesize conflicting sources',
      'Compare source positions, distinguish evidence from interpretation, and explain a qualified conclusion.',
    ],
  ],
  [
    [
      'nuance',
      'Society',
      'Express a precise nuanced position',
      'Express fine distinctions, qualifications, and implications without losing coherence or precision.',
    ],
    [
      'register',
      'Work',
      'Adapt a message across registers',
      'Convey the same complex intent appropriately in informal, professional, and formal contexts.',
    ],
    [
      'ambiguity',
      'Social life',
      'Clarify ambiguity and implication',
      'Identify an ambiguous or implied meaning, clarify it tactfully, and respond to the intended point.',
    ],
    [
      'persuasion',
      'Society',
      'Develop a sustained persuasive argument',
      'Sustain a precise argument, integrate counterarguments, and adapt emphasis to audience responses.',
    ],
  ],
] as const;

const groupKeys: Readonly<Record<string, string>> = {
  Verbs: 'verbs',
  'Word order': 'word-order',
  'Nouns and cases': 'nouns-cases',
  'Nouns and agreement': 'nouns-agreement',
  'Nouns and classifiers': 'nouns-classifiers',
  Negation: 'negation',
  'Time relationships': 'time',
  Pronouns: 'pronouns',
  'Connecting sentences': 'connections',
  'Passive voice': 'passive',
  Concession: 'concession',
  'Register and discourse': 'discourse',
  Particles: 'particles',
  Predicates: 'predicates',
  Modality: 'modality',
  Comparison: 'comparison',
  'Connecting clauses': 'clauses',
  Conditionals: 'conditionals',
  'Noun modification': 'noun-modification',
  Reporting: 'reporting',
  Perspective: 'perspective',
  Register: 'register',
  'Focus and scope': 'scope',
  'Social life': 'social',
  'Food and dining': 'food',
  Travel: 'travel',
  Transactions: 'transactions',
  Work: 'work',
  Services: 'services',
  Society: 'society',
};

function groupId(language: string, branch: 'GRAMMAR' | 'SITUATIONS', title: string) {
  const key = groupKeys[title];
  if (!key) throw new Error(`Learning group needs an explicit stable key: ${title}`);
  return `${language}.${branch.toLowerCase()}.${key}`;
}

/** Sotto-authored teaching objectives; CEFR bands are curriculum choices, not exam equivalences. */
export function buildLanguageCatalog(input: LanguageRows): LearningCatalog {
  const nodes: LearningNode[] = [
    {
      id: `${input.targetLang}.grammar`,
      parentId: null,
      kind: 'GROUP',
      branch: 'GRAMMAR',
      title: 'Grammar',
      description: 'Specific structures and distinctions.',
      order: 0,
    },
    {
      id: `${input.targetLang}.situations`,
      parentId: null,
      kind: 'GROUP',
      branch: 'SITUATIONS',
      title: 'Situations',
      description: 'Practical communication tasks.',
      order: 1,
    },
  ];
  function ensureGroup(branch: 'GRAMMAR' | 'SITUATIONS', title: string) {
    const id = groupId(input.targetLang, branch, title);
    const parentId =
      branch === 'GRAMMAR' && ['Time relationships', 'Concession'].includes(title)
        ? ensureGroup('GRAMMAR', 'Connecting sentences')
        : `${input.targetLang}.${branch.toLowerCase()}`;
    if (!nodes.some((node) => node.id === id))
      nodes.push({
        id,
        parentId,
        kind: 'GROUP',
        branch,
        title,
        description: '',
        order: nodes.length,
      });
    return id;
  }
  for (const [level, key, group, title, assessment, example, aliases = []] of input.grammar) {
    const parentId = ensureGroup('GRAMMAR', group);
    nodes.push({
      id: `${input.targetLang}.g.${key}`,
      parentId,
      kind: 'OBJECTIVE',
      branch: 'GRAMMAR',
      title,
      description: assessment,
      order: nodes.length,
      level,
      required: true,
      criterionVersion: 1,
      policyVersion: 1,
      skills: ['GRAMMAR', 'WRITING'],
      skillCriteria: {
        GRAMMAR:
          `In ${input.title}, choose or construct the named structure: "${title}". ` + assessment,
        WRITING:
          `Write an original ${input.title} response demonstrating "${title}". ` +
          `${assessment} ` +
          'Use the structure independently to express the intended meaning, ' +
          'with suitable form and word order, without copying a supplied model.',
      },
      assessment,
      examples: [example],
      grammarKeys: [key, ...aliases],
      vocabulary: [],
    });
  }
  if (input.situations.length !== learningLevels.length)
    throw new Error('Every language needs situation examples for all six learning bands.');
  for (const [index, level] of learningLevels.entries()) {
    const examples = input.situations[index];
    if (!examples || examples.length !== situations[index]!.length)
      throw new Error(`Missing ${input.targetLang} ${level} situation examples.`);
    for (const [taskIndex, [key, group, title, assessment]] of situations[index]!.entries()) {
      const parentId = ensureGroup('SITUATIONS', group);
      const objective: LearningObjective = {
        id: `${input.targetLang}.s.${key}`,
        parentId,
        kind: 'OBJECTIVE',
        branch: 'SITUATIONS',
        title,
        description: assessment,
        order: nodes.length,
        level,
        required: true,
        criterionVersion: 1,
        policyVersion: 1,
        skills: ['READING', 'LISTENING', 'SPEAKING', 'WRITING'],
        skillCriteria: {
          READING:
            `Read a ${input.title} written exchange about "${title}". ` +
            "Identify the participants' intent and relevant constraints, " +
            'and choose or explain an appropriate response based on that exchange. ' +
            `Recognize how the participants meet these goal criteria: ${assessment}`,
          LISTENING:
            `Listen to the exact supplied ${input.title} spoken exchange about "${title}". ` +
            "Identify the speakers' intent and relevant constraints, " +
            'and choose or explain an appropriate response based on what was heard. ' +
            `Recognize how the speakers meet these goal criteria: ${assessment}`,
          WRITING:
            `Independently write a ${input.title} response that achieves "${title}". ` +
            "Address the situation's constraints and give the needed information " +
            `in original wording without copying a supplied model. Goal criteria: ${assessment}`,
          SPEAKING:
            `Independently respond aloud in ${input.title} to a situational prompt for "${title}". ` +
            "Achieve the communicative goal and address the listener's constraints " +
            `using original wording without reading a supplied target phrase. Goal criteria: ${assessment}`,
        },
        assessment,
        examples: [examples[taskIndex]!],
        grammarKeys: [],
        vocabulary: [],
      };
      nodes.push(objective);
    }
  }
  return learningCatalogSchema.parse({
    schemaVersion: 1,
    targetLang: input.targetLang,
    version: 1,
    title: input.title,
    alignment: 'SOTTO_CEFR',
    references: input.references,
    nodes,
  });
}
