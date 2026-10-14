// A class with two sections, each with two questions. Submission is null (not yet submitted).
export const SAMPLE_CLASS_UNSUBMITTED = {
  id: 'class-1',
  courseId: 'course-1',
  status: 'IN_PROGRESS',
  order: 1,
  passThreshold: 0.6,
  sourceUrl: null,
  sourceTitle: null,
  adaptiveSeed: {
    intro: {
      purpose: 'Practice greetings.',
      about: 'Use greetings before the questions.',
      focus: ['Greet someone'],
      examples: [{ target: 'Hola', meaning: 'Hello', note: 'Greeting' }],
      tips: ['Listen for formal and informal forms.'],
    },
  },
  course: { nativeLang: 'en', targetLang: 'es' },
  lesson: {
    title: 'Greetings',
    level: 'A1',
    objective: 'Learn greetings',
    grammarPoints: ['ser-present'],
    targetVocab: [{ lemma: 'hola', gloss: 'hello' }],
  },
  submission: null,
  sections: [
    {
      id: 'sec-grammar',
      skill: 'GRAMMAR',
      status: 'READY',
      attempt: 1,
      score: null,
      passed: null,
      episode: null,
      questions: [
        {
          id: 'q1',
          order: 1,
          question: 'Q1?',
          options: ['a', 'b', 'c', 'd'],
          passageRef: null,
          passageText: null,
          correctIndex: 0,
          explanation: 'Exp1',
        },
        {
          id: 'q2',
          order: 2,
          question: 'Q2?',
          options: ['a', 'b', 'c', 'd'],
          passageRef: null,
          passageText: null,
          correctIndex: 1,
          explanation: 'Exp2',
        },
      ],
      prompts: [],
      writingPrompts: [],
    },
  ],
};

// A class whose SPEAKING section carries prompts (no MC questions).
export const SAMPLE_CLASS_SPEAKING = {
  ...SAMPLE_CLASS_UNSUBMITTED,
  sections: [
    {
      id: 'sec-speaking',
      skill: 'SPEAKING',
      status: 'READY',
      attempt: 1,
      score: null,
      passed: null,
      episode: null,
      questions: [],
      prompts: [
        {
          id: 'p1',
          order: 1,
          targetPhrase: 'Hola',
          translation: 'Hello',
          ipa: 'ˈola',
          referenceTtsUrl: 'https://r2/ref.mp3',
          recordings: [
            {
              id: 'rec-1',
              status: 'SCORED',
              transcript: 'Hola',
              overallScore: 0.91,
              rubricScores: { accuracy: 0.93, fluency: 0.89, completeness: 0.92 },
              phonemeScores: [{ op: 'match', expected: 'hola', actual: 'hola' }],
              feedback: 'Clear pronunciation.',
            },
          ],
        },
      ],
      writingPrompts: [],
    },
  ],
};

// A class whose LISTENING section reuses a episode (audio + comprehension MC).
export const SAMPLE_CLASS_LISTENING = {
  ...SAMPLE_CLASS_UNSUBMITTED,
  sections: [
    {
      id: 'sec-listening',
      skill: 'LISTENING',
      status: 'READY',
      attempt: 1,
      score: null,
      passed: null,
      episode: {
        id: 'pod-1',
        audioUrl: 'https://r2/listen.mp3',
        status: 'READY',
        title: 'Listening',
        references: [],
      },
      questions: [
        {
          id: 'l1',
          order: 1,
          question: 'What did they discuss?',
          options: ['a', 'b', 'c', 'd'],
          passageRef: null,
          passageText: null,
          correctIndex: 0,
          explanation: 'E',
        },
      ],
      prompts: [],
      writingPrompts: [],
    },
  ],
};

// Same class after submission — submission is non-null.
export const SAMPLE_CLASS_SUBMITTED = {
  ...SAMPLE_CLASS_UNSUBMITTED,
  status: 'PASSED',
  submission: { passed: true, overallScore: 1, submittedAt: new Date('2026-01-01T00:00:00Z') },
};
