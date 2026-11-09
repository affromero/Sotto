import type { ClassData, ClassSection } from '@/components/learn/classTypes';

function section(skill: string, overrides: Partial<ClassSection> = {}): ClassSection {
  return {
    id: `section-${skill.toLowerCase()}`,
    skill,
    status: 'READY',
    attempt: 1,
    score: null,
    passed: null,
    episode: null,
    questions: [],
    prompts: [],
    writingPrompts: [],
    ...overrides,
  };
}

export function incompleteClass(): ClassData {
  return {
    id: 'class-15',
    attempt: 1,
    taskMaterialRevision: 'a'.repeat(64),
    courseId: 'course-1',
    status: 'AVAILABLE',
    order: 15,
    passThreshold: 0.7,
    sourceUrl: null,
    sourceTitle: null,
    lesson: {
      title: 'A tricky class',
      level: 'B1',
      objective: 'Practice the target structure.',
    },
    intro: {
      purpose: 'Practice the target structure.',
      about: 'A compact class.',
      focus: ['Use the target phrase.'],
      examples: [],
      tips: [],
    },
    vocabulary: [],
    submitted: false,
    submission: null,
    sections: [
      section('GRAMMAR', {
        questions: [
          {
            id: 'q-grammar',
            order: 1,
            question: 'Pick one.',
            options: ['A', 'B'],
          },
        ],
      }),
      section('READING', {
        questions: [
          {
            id: 'q-reading',
            order: 1,
            question: 'What happened?',
            options: ['A', 'B'],
            passageText: 'A readable passage.',
          },
        ],
      }),
      section('LISTENING', {
        episode: {
          id: 'episode-1',
          audioUrl: null,
          status: 'READY',
          title: 'Listening scene',
          references: [],
        },
        questions: [
          {
            id: 'q-listening',
            order: 1,
            question: 'What did you hear?',
            options: ['A', 'B'],
          },
        ],
      }),
      section('SPEAKING', {
        prompts: [
          {
            id: 'prompt-1',
            order: 1,
            targetPhrase: 'Hola',
            translation: 'Hello',
          },
        ],
      }),
      section('WRITING', {
        writingPrompts: [
          {
            id: 'writing-1',
            order: 1,
            task: 'Write one sentence.',
            response: null,
          },
        ],
      }),
    ],
  };
}

export function recoverableClass(id: string): ClassData {
  const cls = incompleteClass();
  cls.id = id;
  cls.attempt = 1;
  cls.progressRevision = 10;
  cls.learnerAnswers = { 'q-grammar': 0, 'q-listening': 0 };
  for (const item of cls.sections) {
    item.questions = item.questions.map((question) => ({
      ...question,
      correctIndex: 0,
      explanation: 'Read the time expression.',
    }));
    if (item.episode) item.episode.audioUrl = '/demo-listening.mp3';
    if (item.skill === 'READING')
      item.questions = Array.from({ length: 5 }, (_, index) => ({
        id: `reading-${index}`,
        order: index + 1,
        question: `What happened on day ${index + 1}?`,
        options: ['A', 'B'],
        correctIndex: 0,
        explanation: 'The passage describes a visit.',
        passageText: 'On Sunday, a student visited a museum.',
      }));
    for (const prompt of item.prompts)
      prompt.latestRecording = {
        id: 'saved-speaking',
        status: 'SCORED',
        overallScore: 1,
      };
    for (const prompt of item.writingPrompts)
      prompt.response = {
        text: 'I visited a museum.',
        overallScore: 1,
        corrections: [],
        feedback: 'Clear sentence.',
      };
  }
  return cls;
}
