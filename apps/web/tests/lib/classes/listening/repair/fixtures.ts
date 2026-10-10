import {
  SAMPLE_QUESTIONS_JSON,
  mockGenerateResponse,
} from '../../../../helpers/runtime/listening-generation';

export const causalCandidateQuestions = [
  {
    question: 'What did Ana find quickly?',
    options: ['The station', 'A restaurant', 'Her hotel', 'The museum'],
    correctIndex: 0,
    explanation: 'The transcript says Ana found the station quickly.',
  },
  ...JSON.parse(SAMPLE_QUESTIONS_JSON).questions.slice(1),
];
export const unsupportedCausalQuestions = [
  {
    question: 'Why did Ana find the station quickly?',
    options: [
      'The people were friendly',
      'It was raining',
      'She knew the driver',
      'The station was closed',
    ],
    correctIndex: 0,
    explanation: 'The people were friendly, so Ana found the station quickly.',
  },
  ...causalCandidateQuestions.slice(1),
];
export const causalTranscript = [
  { speaker: 'HOST', text: 'Ana was new in town.' },
  { speaker: 'EXPERT', text: 'The people were friendly. Ana found the station quickly.' },
];
export function teachingVerdict(items: Array<{ index: number }>, rejectedIndex?: number) {
  return {
    items: items.map(({ index }) =>
      index === rejectedIndex
        ? {
            index,
            acceptable: false,
            issues: ['unsupported'],
            feedback: [
              'The transcript does not say that friendliness caused Ana to find the station.',
            ],
          }
        : { index, acceptable: true, issues: [], feedback: [] }
    ),
  };
}

export function listeningQuizJson(questions: unknown) {
  return JSON.stringify({ questions });
}
export function useQuizResponseSequence(contents: readonly string[]) {
  const original = mockGenerateResponse.getMockImplementation();
  if (!original) throw new Error('Listening provider fixture is not configured.');
  let quizIndex = 0;
  mockGenerateResponse.mockImplementation(async (...args) => {
    if (args[2].maxTokens === 4096 && quizIndex < contents.length) {
      return { content: contents[quizIndex++]!, model: 'm' };
    }
    return original(...args);
  });
}

export const malformedQuizResponses = [
  ['malformed JSON', '{'],
  ['wrong count', listeningQuizJson(JSON.parse(SAMPLE_QUESTIONS_JSON).questions.slice(0, 3))],
  ['wrong container', JSON.stringify(JSON.parse(SAMPLE_QUESTIONS_JSON).questions)],
  [
    'invalid item',
    listeningQuizJson(
      JSON.parse(SAMPLE_QUESTIONS_JSON).questions.map(
        (question: Record<string, unknown>, index: number) =>
          index === 0 ? { ...question, options: ['only one option'] } : question
      )
    ),
  ],
];
