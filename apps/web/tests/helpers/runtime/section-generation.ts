export const GENERATED_PASSAGE =
  'En el laboratorio, la científica Marta encontró una nota antigua y decidió investigar.';

export const SAMPLE_QUESTIONS = [
  {
    question: '¿Qué descubrió el científico?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 0,
    explanation: 'x',
    passageRef: 'L1',
  },
  {
    question: '¿Cuándo ocurrió?',
    options: ['a', 'b', 'c', 'd'],
    correctIndex: 1,
    explanation: 'y',
  },
];
SAMPLE_QUESTIONS.push(
  ...[2, 3, 4].map((index) => ({
    ...SAMPLE_QUESTIONS[0],
    question: `Question ${index}`,
    correctIndex: 0,
  }))
);

export const SAMPLE_SECTION_RESPONSE = JSON.stringify({
  passage: GENERATED_PASSAGE,
  questions: SAMPLE_QUESTIONS,
});

export const VOCABULARY_MADE_QUESTION = {
  question: 'Ich habe gestern meine Hausaufgaben _____.',
  options: ['gemacht', 'gegessen', 'getrunken', 'gehört'],
  correctIndex: 0,
  explanation: 'Hausaufgaben macht man.',
  passageRef: '',
};
export const VOCABULARY_SEEN_QUESTION = {
  ...VOCABULARY_MADE_QUESTION,
  question: 'Mia hat den Film mit den Augen _____.',
  options: ['gesehen', 'gegessen', 'getrunken', 'geschrieben'],
  explanation: 'Mit den Augen sieht man einen Film.',
};
export const VOCABULARY_YESTERDAY_QUESTION = {
  ...VOCABULARY_MADE_QUESTION,
  question: 'Heute ist Dienstag. Montag war _____.',
  options: ['gestern', 'morgen', 'heute', 'übermorgen'],
  explanation: 'Montag war der Tag vor heute.',
};

export const vocabularySectionFixture = (
  questions: Array<typeof VOCABULARY_MADE_QUESTION & { targetIndex?: number }>
) => ({ content: JSON.stringify({ passage: '', questions }), model: 'm' });

export const GRAMMAR_TASK_CONTEXT =
  'Complete the sentence using the indicated grammatical construction.';
export const VOCABULARY_TASK_CONTEXT = 'Choose the word that fits the stated situation.';

/** Shapes synthetic public fixtures only at the model response boundary. */
export function sectionProviderFixture<T extends { content: string }>(
  system: string,
  options: unknown,
  response: T
): T {
  const schema = (
    options as {
      jsonSchema?: {
        name: string;
        schema: { properties: { questions: { items: { required: string[] } } } };
      };
    }
  ).jsonSchema;
  if (schema?.name !== 'class_section_questions') return response;
  const required = schema.schema.properties.questions.items.required;
  if (!required.includes('taskContext')) return response;
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.content);
  } catch {
    return response;
  }
  const vocabulary = required.includes('targetIndex');
  const targets = [...system.matchAll(/\[([0-4])\] ([^\n;]+?) \(/g)].map((match) => ({
    index: Number(match[1]),
    lemma: match[2],
  }));
  const envelope = parsed as { questions?: unknown[] };
  const questions = Array.isArray(parsed) ? parsed : envelope.questions;
  if (!Array.isArray(questions)) return response;
  const shaped = questions.map((value) => {
    const question = value as {
      options?: string[];
      correctIndex?: number;
      taskContext?: string;
      targetIndex?: number;
    };
    const context =
      question.taskContext ?? (vocabulary ? VOCABULARY_TASK_CONTEXT : GRAMMAR_TASK_CONTEXT);
    if (!vocabulary || !Array.isArray(question.options))
      return { ...question, taskContext: context };
    const { options: choices, ...fields } = question;
    const key = question.correctIndex;
    return {
      ...fields,
      taskContext: context,
      targetIndex:
        question.targetIndex ??
        targets.find((target) => target.lemma === choices[key ?? -1]?.trim())?.index ??
        -1,
      distractors:
        key !== undefined && Number.isInteger(key) && key >= 0 && key < choices.length
          ? [...choices.slice(0, key), ...choices.slice(key + 1)]
          : choices,
    };
  });
  return {
    ...response,
    content: JSON.stringify(Array.isArray(parsed) ? shaped : { ...envelope, questions: shaped }),
  };
}

export function compiledGrammarFixture<T extends { question: string }>(question: T): T {
  return { ...question, question: `${GRAMMAR_TASK_CONTEXT}\n${question.question.trim()}` };
}
