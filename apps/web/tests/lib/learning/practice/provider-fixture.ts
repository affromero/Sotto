import { withReadingSupportFixture } from '../../classes/quality/teaching/reading-support-fixture';

export function practiceVocabularyFixture(input: string) {
  if (input !== 'Generate 1 vocabulary questions.')
    throw new Error('Unexpected generation request: ' + input.slice(0, 100));
  return {
    passage: '',
    questions: [
      {
        taskContext: 'Ergänze die Begrüßung.',
        question: 'Mia sagt _____ zu Ana.',
        targetIndex: 0,
        distractors: ['Tschüss', 'Gute Nacht', 'Auf Wiedersehen'],
        correctIndex: 0,
        explanation: 'Hallo begrüßt Ana zu Beginn des Gesprächs.',
        passageRef: '',
      },
    ],
  };
}

/** OpenAI-compatible response envelope for the isolated practice HTTP provider. */
export function practiceProviderFixture(content: unknown, input: string, options: unknown) {
  const response = withReadingSupportFixture([{ content: input }], options, {
    content: JSON.stringify(content),
  });
  return {
    id: 'full-fixture',
    object: 'chat.completion',
    created: 1,
    model: 'full-fixture',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: response.content },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
  };
}
