/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { loadCurriculum } from './curricula/schema';

const prisma = new PrismaClient();

const DEMO_LANGUAGE_IDS = {
  courseClassIntro: 'demo-de-a1-class-greetings',
  courseClassNumbers: 'demo-de-a1-class-numbers',
  introEpisode: 'demo-de-a1-listening-greetings',
  numbersEpisode: 'demo-de-a1-listening-market',
} as const;

type DemoSkill = 'GRAMMAR' | 'READING' | 'LISTENING' | 'SPEAKING';

interface DemoQuestion {
  order: number;
  skill: DemoSkill;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  passageRef?: string;
  passageText?: string;
  grammarKeys?: string[];
}

interface DemoPrompt {
  order: number;
  targetPhrase: string;
  translation: string;
  ipa?: string;
}

async function seedGermanCurriculum() {
  const { manifest, lessons } = loadCurriculum('de-from-en');
  const curriculum = await prisma.curriculum.upsert({
    where: {
      nativeLang_targetLang: { nativeLang: manifest.nativeLang, targetLang: manifest.targetLang },
    },
    create: {
      nativeLang: manifest.nativeLang,
      targetLang: manifest.targetLang,
      title: manifest.title,
      version: manifest.version,
      source: 'seeded',
    },
    update: {
      title: manifest.title,
      version: manifest.version,
      source: 'seeded',
    },
  });

  const lessonBySlug = new Map<string, Awaited<ReturnType<typeof prisma.lesson.upsert>>>();
  for (const lesson of lessons) {
    const data = {
      level: lesson.level,
      order: lesson.order,
      title: lesson.title,
      objective: lesson.objective,
      grammarPoints: lesson.grammarPoints,
      vocabThemes: lesson.vocabThemes,
      targetVocab: lesson.targetVocab,
      canDoSummary: lesson.canDoSummary ?? null,
      estMinutes: lesson.estMinutes,
    };
    const saved = await prisma.lesson.upsert({
      where: { curriculumId_slug: { curriculumId: curriculum.id, slug: lesson.slug } },
      create: { curriculumId: curriculum.id, slug: lesson.slug, ...data },
      update: data,
    });
    lessonBySlug.set(lesson.slug, saved);
  }

  const introLesson = lessonBySlug.get('a1-greetings-introductions');
  const numbersLesson = lessonBySlug.get('a1-numbers-dates');
  if (!introLesson || !numbersLesson) {
    throw new Error('German demo curriculum is missing required A1 lessons.');
  }

  return { curriculum, introLesson, numbersLesson };
}

async function upsertClassEpisode(params: {
  id: string;
  userId: string;
  title: string;
  topic: string;
  segments: string[];
}) {
  const duration = params.segments.length * 14;
  const episode = await prisma.episode.upsert({
    where: { id: params.id },
    create: {
      id: params.id,
      userId: params.userId,
      title: params.title,
      topic: params.topic,
      status: 'READY',
      visibility: 'PRIVATE',
      source: 'CLASS',
      audioUrl: '/demo-audio.mp3',
      duration,
      language: 'de',
    },
    update: {
      userId: params.userId,
      title: params.title,
      topic: params.topic,
      status: 'READY',
      visibility: 'PRIVATE',
      source: 'CLASS',
      audioUrl: '/demo-audio.mp3',
      duration,
      language: 'de',
    },
  });

  await prisma.segment.deleteMany({ where: { episodeId: episode.id } });
  await prisma.reference.deleteMany({ where: { episodeId: episode.id } });
  await prisma.segment.createMany({
    data: params.segments.map((text, index) => ({
      episodeId: episode.id,
      speaker: index % 2 === 0 ? 'TEACHER' : 'LEARNER',
      text,
      order: index,
      startTime: index * 14,
      duration: 14,
      version: 1,
    })),
  });

  return episode;
}

async function upsertSection(params: {
  id: string;
  classId: string;
  skill: DemoSkill;
  status: 'READY' | 'PASSED';
  score?: number;
  passed?: boolean;
  episodeId?: string | null;
  spec: Prisma.InputJsonObject;
}) {
  return prisma.classSection.upsert({
    where: { id: params.id },
    create: {
      id: params.id,
      classId: params.classId,
      skill: params.skill,
      attempt: 1,
      status: params.status,
      seed: `${params.id}-seed`,
      spec: params.spec,
      score: params.score ?? null,
      passed: params.passed ?? null,
      passThreshold: 0.7,
      episodeId: params.episodeId ?? null,
      generatedAt: new Date('2026-05-20T12:00:00.000Z'),
    },
    update: {
      classId: params.classId,
      skill: params.skill,
      attempt: 1,
      status: params.status,
      seed: `${params.id}-seed`,
      spec: params.spec,
      score: params.score ?? null,
      passed: params.passed ?? null,
      passThreshold: 0.7,
      episodeId: params.episodeId ?? null,
      generatedAt: new Date('2026-05-20T12:00:00.000Z'),
    },
  });
}

async function upsertQuestions(sectionId: string, questions: DemoQuestion[]) {
  const saved = [];
  for (const question of questions) {
    const record = await prisma.lessonQuestion.upsert({
      where: { sectionId_order: { sectionId, order: question.order } },
      create: {
        id: `${sectionId}-q${question.order}`,
        sectionId,
        order: question.order,
        skill: question.skill,
        question: question.question,
        options: question.options,
        correctIndex: question.correctIndex,
        explanation: question.explanation,
        grammarKeys: question.grammarKeys ?? [],
        passageRef: question.passageRef ?? null,
        passageText: question.passageText ?? null,
      },
      update: {
        skill: question.skill,
        question: question.question,
        options: question.options,
        correctIndex: question.correctIndex,
        explanation: question.explanation,
        grammarKeys: question.grammarKeys ?? [],
        passageRef: question.passageRef ?? null,
        passageText: question.passageText ?? null,
      },
    });
    saved.push(record);
  }
  await prisma.lessonQuestion.deleteMany({
    where: { sectionId, id: { notIn: saved.map((question) => question.id) } },
  });
  return saved;
}

async function upsertSpeakingPrompts(sectionId: string, prompts: DemoPrompt[]) {
  const saved = [];
  for (const prompt of prompts) {
    const record = await prisma.speakingPrompt.upsert({
      where: { sectionId_order: { sectionId, order: prompt.order } },
      create: {
        id: `${sectionId}-prompt${prompt.order}`,
        sectionId,
        order: prompt.order,
        targetPhrase: prompt.targetPhrase,
        translation: prompt.translation,
        ipa: prompt.ipa ?? null,
        referenceTtsUrl: '/demo-audio.mp3',
      },
      update: {
        targetPhrase: prompt.targetPhrase,
        translation: prompt.translation,
        ipa: prompt.ipa ?? null,
        referenceTtsUrl: '/demo-audio.mp3',
      },
    });
    saved.push(record);
  }
  await prisma.speakingPrompt.deleteMany({
    where: { sectionId, id: { notIn: saved.map((prompt) => prompt.id) } },
  });
  return saved;
}

async function seedLanguageLearningDemo(userId: string) {
  const { curriculum, introLesson, numbersLesson } = await seedGermanCurriculum();

  const course = await prisma.course.upsert({
    where: { userId_nativeLang_targetLang: { userId, nativeLang: 'en', targetLang: 'de' } },
    create: {
      userId,
      nativeLang: 'en',
      targetLang: 'de',
      curriculumId: curriculum.id,
      currentLevel: 'A1',
      startLevel: 'A1',
      pedagogy: 'BALANCED',
    },
    update: {
      curriculumId: curriculum.id,
      currentLevel: 'A1',
      startLevel: 'A1',
      pedagogy: 'BALANCED',
    },
  });

  await prisma.placementResult.upsert({
    where: { courseId: course.id },
    create: {
      courseId: course.id,
      level: 'A1',
      responses: [
        {
          questionId: 'demo-placement-greeting',
          skill: 'grammar',
          cefr: 'A1',
          selectedIndex: 1,
          correct: true,
        },
        {
          questionId: 'demo-placement-listening',
          skill: 'listening',
          cefr: 'A1',
          selectedIndex: 2,
          correct: true,
        },
        {
          questionId: 'demo-placement-vocab',
          skill: 'vocab',
          cefr: 'A1',
          selectedIndex: 0,
          correct: false,
        },
      ],
      scoreBySkill: { grammar: 0.72, vocab: 0.48, listening: 0.66, speaking: 0.58 },
      model: 'seed-demo',
      provider: 'seed',
    },
    update: {
      level: 'A1',
      responses: [
        {
          questionId: 'demo-placement-greeting',
          skill: 'grammar',
          cefr: 'A1',
          selectedIndex: 1,
          correct: true,
        },
        {
          questionId: 'demo-placement-listening',
          skill: 'listening',
          cefr: 'A1',
          selectedIndex: 2,
          correct: true,
        },
        {
          questionId: 'demo-placement-vocab',
          skill: 'vocab',
          cefr: 'A1',
          selectedIndex: 0,
          correct: false,
        },
      ],
      scoreBySkill: { grammar: 0.72, vocab: 0.48, listening: 0.66, speaking: 0.58 },
      model: 'seed-demo',
      provider: 'seed',
    },
  });

  const introEpisode = await upsertClassEpisode({
    id: DEMO_LANGUAGE_IDS.introEpisode,
    userId,
    title: 'A1 German Listening: First Day in Berlin',
    topic: 'A slow A1 dialogue for greetings, introductions, and polite goodbyes in German.',
    segments: [
      'Hallo, ich heiße Nico. Wie heißen Sie?',
      'Guten Tag, ich heiße Anna. Schön, Sie kennenzulernen.',
      'Bitte sprechen Sie langsam. Ich lerne Deutsch.',
      'Natürlich. Willkommen in Berlin, Nico. Auf Wiedersehen!',
    ],
  });
  const numbersEpisode = await upsertClassEpisode({
    id: DEMO_LANGUAGE_IDS.numbersEpisode,
    userId,
    title: 'A1 German Listening: Saturday at the Market',
    topic: 'A slow A1 dialogue for German numbers, prices, weekdays, and dates.',
    segments: [
      'Guten Morgen. Heute ist Samstag und der Markt ist offen.',
      'Ich kaufe zwei Äpfel und zehn Brötchen. Das kostet vier Euro.',
      'Welches Datum haben wir heute? Heute ist der erste Juni.',
      'Danke. Bis Montag und einen schönen Tag!',
    ],
  });

  const passedAt = new Date('2026-05-18T16:30:00.000Z');

  const introClass = await prisma.courseClass.upsert({
    where: { id: DEMO_LANGUAGE_IDS.courseClassIntro },
    create: {
      id: DEMO_LANGUAGE_IDS.courseClassIntro,
      courseId: course.id,
      lessonId: introLesson.id,
      order: introLesson.order,
      status: 'PASSED',
      attempt: 1,
      adaptiveSeed: {
        vocabIds: ['Hallo', 'Guten Tag', 'ich heiße'],
        grammarKeys: ['verb-sein-present'],
      },
      passThreshold: 0.7,
      submittedAt: passedAt,
      passedAt,
    },
    update: {
      courseId: course.id,
      lessonId: introLesson.id,
      order: introLesson.order,
      status: 'PASSED',
      attempt: 1,
      adaptiveSeed: {
        vocabIds: ['Hallo', 'Guten Tag', 'ich heiße'],
        grammarKeys: ['verb-sein-present'],
      },
      passThreshold: 0.7,
      submittedAt: passedAt,
      passedAt,
      failedAt: null,
    },
  });

  const numbersClass = await prisma.courseClass.upsert({
    where: { id: DEMO_LANGUAGE_IDS.courseClassNumbers },
    create: {
      id: DEMO_LANGUAGE_IDS.courseClassNumbers,
      courseId: course.id,
      lessonId: numbersLesson.id,
      order: numbersLesson.order,
      status: 'AVAILABLE',
      attempt: 1,
      adaptiveSeed: {
        vocabIds: ['eins', 'zwei', 'zehn', 'Montag'],
        grammarKeys: ['cardinal-numbers'],
      },
      passThreshold: 0.7,
      submittedAt: null,
      passedAt: null,
      failedAt: null,
    },
    update: {
      courseId: course.id,
      lessonId: numbersLesson.id,
      order: numbersLesson.order,
      status: 'AVAILABLE',
      attempt: 1,
      adaptiveSeed: {
        vocabIds: ['eins', 'zwei', 'zehn', 'Montag'],
        grammarKeys: ['cardinal-numbers'],
      },
      passThreshold: 0.7,
      submittedAt: null,
      passedAt: null,
      failedAt: null,
    },
  });
  await prisma.classSubmission.deleteMany({ where: { classId: numbersClass.id } });

  const sectionSpecs = {
    intro: {
      lessonSlug: introLesson.slug,
      level: introLesson.level,
      objective: introLesson.objective,
    },
    numbers: {
      lessonSlug: numbersLesson.slug,
      level: numbersLesson.level,
      objective: numbersLesson.objective,
    },
  };

  const introSections = {
    grammar: await upsertSection({
      id: `${introClass.id}-grammar`,
      classId: introClass.id,
      skill: 'GRAMMAR',
      status: 'PASSED',
      score: 1,
      passed: true,
      spec: sectionSpecs.intro,
    }),
    reading: await upsertSection({
      id: `${introClass.id}-reading`,
      classId: introClass.id,
      skill: 'READING',
      status: 'PASSED',
      score: 0.9,
      passed: true,
      spec: sectionSpecs.intro,
    }),
    listening: await upsertSection({
      id: `${introClass.id}-listening`,
      classId: introClass.id,
      skill: 'LISTENING',
      status: 'PASSED',
      score: 1,
      passed: true,
      episodeId: introEpisode.id,
      spec: sectionSpecs.intro,
    }),
    speaking: await upsertSection({
      id: `${introClass.id}-speaking`,
      classId: introClass.id,
      skill: 'SPEAKING',
      status: 'PASSED',
      score: 0.82,
      passed: true,
      spec: sectionSpecs.intro,
    }),
  };

  const numbersSections = {
    grammar: await upsertSection({
      id: `${numbersClass.id}-grammar`,
      classId: numbersClass.id,
      skill: 'GRAMMAR',
      status: 'READY',
      spec: sectionSpecs.numbers,
    }),
    reading: await upsertSection({
      id: `${numbersClass.id}-reading`,
      classId: numbersClass.id,
      skill: 'READING',
      status: 'READY',
      spec: sectionSpecs.numbers,
    }),
    listening: await upsertSection({
      id: `${numbersClass.id}-listening`,
      classId: numbersClass.id,
      skill: 'LISTENING',
      status: 'READY',
      episodeId: numbersEpisode.id,
      spec: sectionSpecs.numbers,
    }),
    speaking: await upsertSection({
      id: `${numbersClass.id}-speaking`,
      classId: numbersClass.id,
      skill: 'SPEAKING',
      status: 'READY',
      spec: sectionSpecs.numbers,
    }),
  };

  const passedQuestions = [
    ...(await upsertQuestions(introSections.grammar.id, [
      {
        order: 1,
        skill: 'GRAMMAR',
        question: 'Choose the correct German sentence for "My name is Nico."',
        options: ['Ich bin Nico.', 'Ich heiße Nico.', 'Du heißt Nico.', 'Sie heißen Nico.'],
        correctIndex: 1,
        explanation: '"Ich heiße ..." is the standard way to give your name.',
        grammarKeys: ['verb-heissen-present'],
      },
      {
        order: 2,
        skill: 'GRAMMAR',
        question: 'Which pronoun is formal for "you" in German?',
        options: ['ich', 'du', 'Sie', 'er'],
        correctIndex: 2,
        explanation: 'Capitalized "Sie" is the formal singular or plural "you."',
        grammarKeys: ['personal-pronouns-nominative'],
      },
    ])),
    ...(await upsertQuestions(introSections.reading.id, [
      {
        order: 1,
        skill: 'READING',
        question: 'Who is new in Berlin?',
        options: ['Anna', 'Nico', 'The teacher', 'No one'],
        correctIndex: 1,
        explanation: 'The passage says Nico introduces himself and is welcomed to Berlin.',
        passageRef: 'Short dialogue',
        passageText:
          'Nico sagt: "Guten Tag, ich heiße Nico." Anna antwortet: "Willkommen in Berlin, Nico."',
      },
      {
        order: 2,
        skill: 'READING',
        question: 'Which phrase is a formal goodbye?',
        options: ['Tschüss', 'Hallo', 'Auf Wiedersehen', 'Bitte'],
        correctIndex: 2,
        explanation: '"Auf Wiedersehen" is the formal goodbye from the greetings lesson.',
        passageRef: 'Courtesy phrases',
        passageText:
          'Im Kurs übt Nico höfliche Sätze: Guten Tag, bitte, danke und Auf Wiedersehen.',
      },
    ])),
    ...(await upsertQuestions(introSections.listening.id, [
      {
        order: 1,
        skill: 'LISTENING',
        question: 'What does Nico ask the other speaker to do?',
        options: ['Repeat the date', 'Speak slowly', 'Open the market', 'Count to ten'],
        correctIndex: 1,
        explanation: 'Nico says, "Bitte sprechen Sie langsam."',
        passageRef: 'First Day in Berlin audio',
      },
      {
        order: 2,
        skill: 'LISTENING',
        question: 'Which city is named in the listening?',
        options: ['Hamburg', 'Berlin', 'München', 'Köln'],
        correctIndex: 1,
        explanation: 'The teacher says, "Willkommen in Berlin."',
        passageRef: 'First Day in Berlin audio',
      },
    ])),
    ...(await upsertQuestions(introSections.speaking.id, [
      {
        order: 1,
        skill: 'SPEAKING',
        question: 'Which phrase should Nico say to introduce himself?',
        options: ['Ich heiße Nico.', 'Ich komme Montag.', 'Ich kaufe Brot.', 'Ich habe zwei.'],
        correctIndex: 0,
        explanation: 'This phrase directly practices the speaking target for introductions.',
      },
    ])),
  ];

  await upsertQuestions(numbersSections.grammar.id, [
    {
      order: 1,
      skill: 'GRAMMAR',
      question: 'Choose the German word for "two."',
      options: ['eins', 'zwei', 'zehn', 'zwanzig'],
      correctIndex: 1,
      explanation: '"Zwei" means "two."',
      grammarKeys: ['cardinal-numbers'],
    },
    {
      order: 2,
      skill: 'GRAMMAR',
      question: 'Which option means "twenty"?',
      options: ['zehn', 'zwanzig', 'hundert', 'erste'],
      correctIndex: 1,
      explanation: '"Zwanzig" is twenty; "zehn" is ten.',
      grammarKeys: ['cardinal-numbers'],
    },
    {
      order: 3,
      skill: 'GRAMMAR',
      question: 'Complete the phrase: "Heute ist der ___ Juni."',
      options: ['eins', 'erste', 'zwei', 'zehn'],
      correctIndex: 1,
      explanation: 'Dates use ordinal forms, so "der erste Juni" means "the first of June."',
      grammarKeys: ['ordinal-numbers-basic'],
    },
  ]);

  await upsertQuestions(numbersSections.reading.id, [
    {
      order: 1,
      skill: 'READING',
      question: 'What day is the market open?',
      options: ['Montag', 'Freitag', 'Samstag', 'Sonntag'],
      correctIndex: 2,
      explanation: 'The passage says, "Heute ist Samstag und der Markt ist offen."',
      passageRef: 'Market note',
      passageText:
        'Heute ist Samstag und der Markt ist offen. Nico kauft zwei Äpfel und zehn Brötchen.',
    },
    {
      order: 2,
      skill: 'READING',
      question: 'How many rolls does Nico buy?',
      options: ['one', 'two', 'ten', 'twenty'],
      correctIndex: 2,
      explanation: '"Zehn Brötchen" means ten rolls.',
      passageRef: 'Market note',
      passageText:
        'Heute ist Samstag und der Markt ist offen. Nico kauft zwei Äpfel und zehn Brötchen.',
    },
  ]);

  await upsertQuestions(numbersSections.listening.id, [
    {
      order: 1,
      skill: 'LISTENING',
      question: 'What does the speaker buy at the market?',
      options: [
        'Two apples and ten rolls',
        'One ticket and two coffees',
        'Ten books',
        'A calendar',
      ],
      correctIndex: 0,
      explanation: 'The audio says, "zwei Äpfel und zehn Brötchen."',
      passageRef: 'Saturday at the Market audio',
    },
    {
      order: 2,
      skill: 'LISTENING',
      question: 'What date is mentioned?',
      options: ['Der erste Juni', 'Der zweite Montag', 'Der zehnte Freitag', 'Der zwanzigste Mai'],
      correctIndex: 0,
      explanation: 'The audio asks the date and answers, "Heute ist der erste Juni."',
      passageRef: 'Saturday at the Market audio',
    },
  ]);

  await upsertQuestions(numbersSections.speaking.id, [
    {
      order: 1,
      skill: 'SPEAKING',
      question: "Which spoken phrase asks for today's date?",
      options: [
        'Welches Datum haben wir heute?',
        'Wie heißen Sie?',
        'Ich kaufe zwei Äpfel.',
        'Guten Abend.',
      ],
      correctIndex: 0,
      explanation: 'This is the target phrase for asking the date.',
    },
  ]);

  const introPrompts = await upsertSpeakingPrompts(introSections.speaking.id, [
    {
      order: 1,
      targetPhrase: 'Guten Tag, ich heiße Nico.',
      translation: 'Good day, my name is Nico.',
      ipa: 'ˈɡuːtn̩ taːk ɪç ˈhaɪ̯sə ˈniːko',
    },
  ]);
  await upsertSpeakingPrompts(numbersSections.speaking.id, [
    {
      order: 1,
      targetPhrase: 'Heute ist der erste Juni.',
      translation: 'Today is the first of June.',
      ipa: 'ˈhɔʏ̯tə ɪst deːɐ̯ ˈeːɐ̯stə ˈjuːni',
    },
    {
      order: 2,
      targetPhrase: 'Ich kaufe zwei Äpfel und zehn Brötchen.',
      translation: 'I am buying two apples and ten rolls.',
      ipa: 'ɪç ˈkaʊ̯fə tsvaɪ̯ ˈɛpfl̩ ʊnt tseːn ˈbʁøːtçən',
    },
  ]);
  await prisma.speakingRecording.deleteMany({ where: { sectionId: numbersSections.speaking.id } });

  if (introPrompts[0]) {
    await prisma.speakingRecording.upsert({
      where: { id: `${introPrompts[0].id}-recording` },
      create: {
        id: `${introPrompts[0].id}-recording`,
        sectionId: introSections.speaking.id,
        promptId: introPrompts[0].id,
        userId,
        audioUrl: '/demo-audio.mp3',
        transcript: 'Guten Tag, ich heiße Nico.',
        overallScore: 0.82,
        rubricScores: { accuracy: 0.84, fluency: 0.8, completeness: 0.82 },
        feedback: 'Clear greeting and name phrase; soften the ch sound in ich.',
        status: 'SCORED',
      },
      update: {
        sectionId: introSections.speaking.id,
        promptId: introPrompts[0].id,
        userId,
        audioUrl: '/demo-audio.mp3',
        transcript: 'Guten Tag, ich heiße Nico.',
        overallScore: 0.82,
        rubricScores: { accuracy: 0.84, fluency: 0.8, completeness: 0.82 },
        feedback: 'Clear greeting and name phrase; soften the ch sound in ich.',
        status: 'SCORED',
      },
    });
  }

  const submission = await prisma.classSubmission.upsert({
    where: { classId: introClass.id },
    create: {
      classId: introClass.id,
      userId,
      overallScore: 1,
      passed: true,
      submittedAt: passedAt,
    },
    update: {
      userId,
      overallScore: 1,
      passed: true,
      submittedAt: passedAt,
    },
  });
  await prisma.sectionAnswer.deleteMany({ where: { submissionId: submission.id } });
  await prisma.sectionAnswer.createMany({
    data: passedQuestions.map((question) => ({
      submissionId: submission.id,
      sectionId: question.sectionId,
      questionId: question.id,
      selectedIndex: question.correctIndex,
      isCorrect: true,
      answeredAt: passedAt,
    })),
  });

  const vocabItems = [
    {
      lemma: 'Hallo',
      translation: 'hello',
      partOfSpeech: 'interjection',
      pronunciation: 'HAH-loh',
      firstSeenClassId: introClass.id,
      mastery: 0.82,
      dueAt: new Date('2026-06-18T09:00:00.000Z'),
      lastReviewed: passedAt,
    },
    {
      lemma: 'Guten Tag',
      translation: 'good day / hello',
      partOfSpeech: 'phrase',
      pronunciation: 'GOO-ten tahk',
      firstSeenClassId: introClass.id,
      mastery: 0.74,
      dueAt: new Date('2026-06-12T09:00:00.000Z'),
      lastReviewed: passedAt,
    },
    {
      lemma: 'ich heiße',
      translation: 'my name is',
      partOfSpeech: 'phrase',
      pronunciation: 'ikh HIGH-suh',
      firstSeenClassId: introClass.id,
      mastery: 0.68,
      dueAt: new Date('2026-06-09T09:00:00.000Z'),
      lastReviewed: passedAt,
    },
    {
      lemma: 'zwei',
      translation: 'two',
      partOfSpeech: 'numeral',
      pronunciation: 'tsvai',
      firstSeenClassId: numbersClass.id,
      mastery: 0.32,
      dueAt: new Date('2026-06-10T09:00:00.000Z'),
      lastReviewed: null,
    },
    {
      lemma: 'zehn',
      translation: 'ten',
      partOfSpeech: 'numeral',
      pronunciation: 'tsayn',
      firstSeenClassId: numbersClass.id,
      mastery: 0.28,
      dueAt: new Date('2026-06-10T09:00:00.000Z'),
      lastReviewed: null,
    },
    {
      lemma: 'Montag',
      translation: 'Monday',
      partOfSpeech: 'noun',
      pronunciation: 'MOHN-tahk',
      firstSeenClassId: numbersClass.id,
      mastery: 0.41,
      dueAt: new Date('2026-06-11T09:00:00.000Z'),
      lastReviewed: null,
    },
  ];

  const vocabByLemma = new Map<string, Awaited<ReturnType<typeof prisma.learnerVocab.upsert>>>();
  for (const item of vocabItems) {
    const record = await prisma.learnerVocab.upsert({
      where: { courseId_lemma: { courseId: course.id, lemma: item.lemma } },
      create: {
        courseId: course.id,
        lemma: item.lemma,
        translation: item.translation,
        partOfSpeech: item.partOfSpeech,
        pronunciation: item.pronunciation,
        ease: 2.5,
        intervalDays: item.mastery > 0.6 ? 6 : 0,
        dueAt: item.dueAt,
        reps: item.mastery > 0.6 ? 2 : 0,
        lapses: 0,
        mastery: item.mastery,
        lastReviewed: item.lastReviewed,
        firstSeenClassId: item.firstSeenClassId,
        cefrLevel: 'A1',
      },
      update: {
        translation: item.translation,
        partOfSpeech: item.partOfSpeech,
        pronunciation: item.pronunciation,
        ease: 2.5,
        intervalDays: item.mastery > 0.6 ? 6 : 0,
        dueAt: item.dueAt,
        reps: item.mastery > 0.6 ? 2 : 0,
        lapses: 0,
        mastery: item.mastery,
        lastReviewed: item.lastReviewed,
        firstSeenClassId: item.firstSeenClassId,
        cefrLevel: 'A1',
      },
    });
    vocabByLemma.set(item.lemma, record);
  }

  const grammarByKey = new Map<string, Awaited<ReturnType<typeof prisma.learnerGrammar.upsert>>>();
  for (const grammar of [
    {
      topicKey: 'verb-heissen-present',
      title: 'Present tense of heißen',
      mastery: 0.7,
      dueAt: new Date('2026-06-12T09:00:00.000Z'),
    },
    {
      topicKey: 'personal-pronouns-nominative',
      title: 'Nominative personal pronouns',
      mastery: 0.64,
      dueAt: new Date('2026-06-14T09:00:00.000Z'),
    },
    {
      topicKey: 'cardinal-numbers',
      title: 'Cardinal numbers',
      mastery: 0.3,
      dueAt: new Date('2026-06-10T09:00:00.000Z'),
    },
    {
      topicKey: 'ordinal-numbers-basic',
      title: 'Basic ordinal numbers',
      mastery: 0.25,
      dueAt: new Date('2026-06-10T09:00:00.000Z'),
    },
  ]) {
    const record = await prisma.learnerGrammar.upsert({
      where: { courseId_topicKey: { courseId: course.id, topicKey: grammar.topicKey } },
      create: {
        courseId: course.id,
        topicKey: grammar.topicKey,
        title: grammar.title,
        cefrLevel: 'A1',
        ease: 2.5,
        intervalDays: grammar.mastery > 0.6 ? 4 : 0,
        dueAt: grammar.dueAt,
        reps: grammar.mastery > 0.6 ? 2 : 0,
        lapses: 0,
        mastery: grammar.mastery,
        lastReviewed: grammar.mastery > 0.6 ? passedAt : null,
      },
      update: {
        title: grammar.title,
        cefrLevel: 'A1',
        ease: 2.5,
        intervalDays: grammar.mastery > 0.6 ? 4 : 0,
        dueAt: grammar.dueAt,
        reps: grammar.mastery > 0.6 ? 2 : 0,
        lapses: 0,
        mastery: grammar.mastery,
        lastReviewed: grammar.mastery > 0.6 ? passedAt : null,
      },
    });
    grammarByKey.set(grammar.topicKey, record);
  }

  const requiredEdgeNodes = [
    vocabByLemma.get('Hallo'),
    vocabByLemma.get('Guten Tag'),
    vocabByLemma.get('ich heiße'),
    vocabByLemma.get('Montag'),
    grammarByKey.get('verb-heissen-present'),
    grammarByKey.get('cardinal-numbers'),
  ];
  if (requiredEdgeNodes.some((node) => !node)) {
    throw new Error('German demo memory graph is missing required nodes.');
  }

  await prisma.vocabEdge.upsert({
    where: { id: 'demo-de-edge-hallo-guten-tag' },
    create: {
      id: 'demo-de-edge-hallo-guten-tag',
      courseId: course.id,
      type: 'VOCAB_VOCAB',
      weight: 0.8,
      sourceVocabId: vocabByLemma.get('Hallo')!.id,
      targetVocabId: vocabByLemma.get('Guten Tag')!.id,
    },
    update: {
      courseId: course.id,
      type: 'VOCAB_VOCAB',
      weight: 0.8,
      sourceVocabId: vocabByLemma.get('Hallo')!.id,
      targetVocabId: vocabByLemma.get('Guten Tag')!.id,
      grammarId: null,
      classId: null,
      episodeId: null,
    },
  });
  await prisma.vocabEdge.upsert({
    where: { id: 'demo-de-edge-heisse-grammar' },
    create: {
      id: 'demo-de-edge-heisse-grammar',
      courseId: course.id,
      type: 'VOCAB_GRAMMAR',
      weight: 0.92,
      sourceVocabId: vocabByLemma.get('ich heiße')!.id,
      grammarId: grammarByKey.get('verb-heissen-present')!.id,
    },
    update: {
      courseId: course.id,
      type: 'VOCAB_GRAMMAR',
      weight: 0.92,
      sourceVocabId: vocabByLemma.get('ich heiße')!.id,
      targetVocabId: null,
      grammarId: grammarByKey.get('verb-heissen-present')!.id,
      classId: null,
      episodeId: null,
    },
  });
  await prisma.vocabEdge.upsert({
    where: { id: 'demo-de-edge-montag-numbers' },
    create: {
      id: 'demo-de-edge-montag-numbers',
      courseId: course.id,
      type: 'VOCAB_GRAMMAR',
      weight: 0.75,
      sourceVocabId: vocabByLemma.get('Montag')!.id,
      grammarId: grammarByKey.get('cardinal-numbers')!.id,
    },
    update: {
      courseId: course.id,
      type: 'VOCAB_GRAMMAR',
      weight: 0.75,
      sourceVocabId: vocabByLemma.get('Montag')!.id,
      targetVocabId: null,
      grammarId: grammarByKey.get('cardinal-numbers')!.id,
      classId: null,
      episodeId: null,
    },
  });

  await prisma.course.update({
    where: { id: course.id },
    data: { activeClassId: numbersClass.id },
  });

  return {
    course,
    curriculum,
    classes: [introClass, numbersClass],
    sections: [...Object.values(introSections), ...Object.values(numbersSections)],
    vocabCount: vocabItems.length,
    grammarCount: grammarByKey.size,
    edgeCount: 3,
  };
}

async function main() {
  console.log('Seeding demo data...');

  // ── 1. Demo user ───────────────────────────────────────────────
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {
      name: 'Nico Valerio',
      role: 'USER',
      image: '/avatars/capybara.png',
    },
    create: {
      email: 'demo@example.com',
      name: 'Nico Valerio',
      role: 'USER',
      image: '/avatars/capybara.png',
    },
  });
  console.log(`  Demo user: ${demoUser.id} (${demoUser.email})`);

  // ── 2. Admin user ───────────────────────────────────────────────
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: { name: 'Sotto Admin', role: 'ADMIN', image: '/avatars/jaguar.png' },
    create: {
      email: 'admin@example.com',
      name: 'Sotto Admin',
      role: 'ADMIN',
      image: '/avatars/jaguar.png',
    },
  });
  console.log(`  Admin user: ${adminUser.id} (${adminUser.email})`);

  // ── 3. Additional users (varied tiers & roles) ─────────────────
  const extraUsers = [
    { email: 'maria.chen@example.com', name: 'Maria Chen', role: 'USER' as const },
    { email: 'james.okafor@example.com', name: 'James Okafor', role: 'USER' as const },
    { email: 'sofia.petrov@example.com', name: 'Sofia Petrov', role: 'USER' as const },
    { email: 'liam.tanaka@example.com', name: 'Liam Tanaka', role: 'USER' as const },
    { email: 'priya.sharma@example.com', name: 'Priya Sharma', role: 'USER' as const },
    { email: 'noah.weber@example.com', name: 'Noah Weber', role: 'USER' as const },
    { email: 'elena.rossi@example.com', name: 'Elena Rossi', role: 'USER' as const },
    { email: 'omar.hassan@example.com', name: 'Omar Hassan', role: 'USER' as const },
    { email: 'chloe.dubois@example.com', name: 'Chloe Dubois', role: 'USER' as const },
    { email: 'kai.nakamura@example.com', name: 'Kai Nakamura', role: 'USER' as const },
  ];

  // Preset profile animals (mirror of ANIMAL_AVATARS in src/lib/avatars.ts) so
  // demo profiles use the offline, on-brand avatars rather than an external
  // service.
  const ANIMAL_SLUGS = [
    'capybara',
    'iguana',
    'sloth',
    'toucan',
    'macaw',
    'frog',
    'hummingbird',
    'jaguar',
  ];

  const createdUsers = [];
  for (const [i, u] of extraUsers.entries()) {
    const image = `/avatars/${ANIMAL_SLUGS[i % ANIMAL_SLUGS.length]}.png`;
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, image },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        image,
      },
    });
    createdUsers.push(user);
  }
  console.log(`  Created ${createdUsers.length} additional users`);

  // ── 4. Ensure tags exist (reuse from seed.ts) ──────────────────
  const tagSlugs = [
    'technology',
    'science',
    'business',
    'history',
    'philosophy',
    'health',
    'ai-ml',
    'programming',
  ];
  const tagMap: Record<string, string> = {};
  for (const slug of tagSlugs) {
    const tag = await prisma.tag.findUnique({ where: { slug } });
    if (tag) tagMap[slug] = tag.id;
  }

  // ── 6. Episodes ─────────────────────────────────────────────────
  const episodeDefs = [
    {
      title: 'The Hidden History of Cryptography',
      topic:
        'From ancient ciphers to modern encryption — how secret codes shaped wars, commerce, and the digital age.',
      visibility: 'PUBLIC' as const,
      tags: ['history', 'technology'],
      userId: demoUser.id,
    },
    {
      title: 'Understanding Quantum Computing',
      topic:
        'Qubits, superposition, and entanglement explained for curious minds. What quantum computers can (and cannot) do today.',
      visibility: 'PUBLIC' as const,
      tags: ['science', 'technology'],
      userId: demoUser.id,
    },
    {
      title: 'The Future of Remote Work',
      topic:
        'How distributed teams, async communication, and AI tools are reshaping the way we work — and what it means for cities, culture, and careers.',
      visibility: 'PUBLIC' as const,
      tags: ['business', 'technology'],
      userId: demoUser.id,
    },
    {
      title: 'AI Ethics: Where Do We Draw the Line?',
      topic:
        'Bias in models, deepfakes, autonomous weapons, surveillance — the ethical dilemmas of artificial intelligence and who gets to decide.',
      visibility: 'PUBLIC' as const,
      tags: ['ai-ml', 'philosophy'],
      userId: demoUser.id,
    },
    {
      title: 'Stoicism for Modern Life',
      topic:
        'Marcus Aurelius, Seneca, and Epictetus — how ancient Stoic philosophy offers practical wisdom for dealing with stress, uncertainty, and ambition today.',
      visibility: 'PUBLIC' as const,
      tags: ['philosophy', 'health'],
      userId: demoUser.id,
    },
    {
      title: 'How mRNA Vaccines Work',
      topic:
        'The science behind mRNA vaccine technology, from basic cell biology to the Pfizer and Moderna COVID-19 vaccines. How they were developed so quickly and what comes next.',
      visibility: 'PRIVATE' as const,
      tags: ['science', 'health'],
      userId: demoUser.id,
    },
  ];

  // Segment templates — realistic two-voice episode dialogue
  const segmentSets: { speaker: string; text: string }[][] = [
    // Cryptography
    [
      {
        speaker: 'HOST',
        text: "Welcome back to Sotto. Today we're diving into something that's been a part of human civilization for thousands of years — cryptography. The art and science of secret communication.",
      },
      {
        speaker: 'EXPERT',
        text: "That's right. And what's fascinating is that the basic challenge hasn't changed since ancient times: how do you send a message that only the intended recipient can read?",
      },
      {
        speaker: 'HOST',
        text: "Let's start at the very beginning. When did humans first start encrypting messages?",
      },
      {
        speaker: 'EXPERT',
        text: 'The earliest known use dates back to around 1900 BC in ancient Egypt. But the first well-documented cipher is the Caesar cipher, used by Julius Caesar to communicate with his generals.',
      },
      { speaker: 'HOST', text: 'The one where you shift each letter by a fixed number?' },
      {
        speaker: 'EXPERT',
        text: "Exactly. Caesar used a shift of three. So 'A' becomes 'D', 'B' becomes 'E', and so on. Simple by today's standards, but revolutionary at the time.",
      },
      {
        speaker: 'HOST',
        text: "Fast forward to World War II — that's when things really got interesting with the Enigma machine.",
      },
      {
        speaker: 'EXPERT',
        text: 'The Enigma machine was an electro-mechanical device used by Nazi Germany. It created a cipher so complex that the Germans believed it was unbreakable. Each day, operators would set the machine to a new configuration.',
      },
      { speaker: 'HOST', text: 'And then Alan Turing and the team at Bletchley Park cracked it.' },
      {
        speaker: 'EXPERT',
        text: "They did. Turing built the Bombe machine, which could test thousands of possible Enigma settings. It's estimated that breaking Enigma shortened the war by about two years and saved millions of lives.",
      },
      {
        speaker: 'HOST',
        text: 'That brings us to the modern era. How does encryption work today?',
      },
      {
        speaker: 'EXPERT',
        text: 'Modern encryption relies on mathematical problems that are easy to compute in one direction but practically impossible to reverse. RSA encryption, for example, is based on the difficulty of factoring very large prime numbers.',
      },
    ],
    // Quantum Computing
    [
      {
        speaker: 'HOST',
        text: "Today on Sotto, we're tackling one of the most mind-bending topics in modern science — quantum computing. What makes it so different from the computers we use every day?",
      },
      {
        speaker: 'EXPERT',
        text: 'Great question. Classical computers process information using bits — zeros and ones. A quantum computer uses qubits, which can exist in a superposition of both zero and one simultaneously.',
      },
      {
        speaker: 'HOST',
        text: 'That sounds almost magical. How does superposition actually work?',
      },
      {
        speaker: 'EXPERT',
        text: "Think of a coin spinning in the air. While it's spinning, it's neither heads nor tails — it has some probability of being either. A qubit in superposition is similar. It holds both possibilities until you measure it.",
      },
      {
        speaker: 'HOST',
        text: "And then there's entanglement — Einstein called it 'spooky action at a distance.'",
      },
      {
        speaker: 'EXPERT',
        text: "Entanglement is when two qubits become correlated in such a way that measuring one instantly tells you about the other, no matter how far apart they are. This isn't communication — it's correlation.",
      },
      {
        speaker: 'HOST',
        text: "So what can quantum computers actually do that classical computers can't?",
      },
      {
        speaker: 'EXPERT',
        text: "They excel at specific problems. Shor's algorithm can factor large numbers exponentially faster — which would break RSA encryption. Grover's algorithm provides quadratic speedup for searching unsorted databases.",
      },
      { speaker: 'HOST', text: "That sounds like it could break the internet's security." },
      {
        speaker: 'EXPERT',
        text: "Potentially, yes. That's why there's a whole field called post-quantum cryptography developing encryption methods that are resistant to quantum attacks. NIST has already standardized several post-quantum algorithms.",
      },
    ],
    // Remote Work
    [
      {
        speaker: 'HOST',
        text: "The way we work has fundamentally changed. Today on Sotto, we're exploring the future of remote work and what it means for all of us.",
      },
      {
        speaker: 'EXPERT',
        text: "The pandemic was really a forcing function. Companies that said remote work was impossible suddenly had their entire workforce operating from home — and discovered that productivity didn't collapse.",
      },
      { speaker: 'HOST', text: "But it's not all rosy, is it? There are real challenges." },
      {
        speaker: 'EXPERT',
        text: 'Absolutely. Loneliness, burnout, the blurring of work-life boundaries. And there are significant challenges around mentorship, spontaneous collaboration, and building company culture remotely.',
      },
      {
        speaker: 'HOST',
        text: 'How are the most successful remote companies handling these challenges?',
      },
      {
        speaker: 'EXPERT',
        text: "The best remote companies are 'async-first' — they default to written communication, recorded video updates, and documented decisions. This means meetings are intentional rather than habitual.",
      },
      { speaker: 'HOST', text: "What about AI's role in all of this?" },
      {
        speaker: 'EXPERT',
        text: 'AI is becoming a game-changer for remote work. AI meeting summaries, automated task management, code review assistants — these tools reduce the coordination cost that makes remote work harder.',
      },
      { speaker: 'HOST', text: 'Where do you see this heading in the next five to ten years?' },
      {
        speaker: 'EXPERT',
        text: "I think we'll see a spectrum. Some work will be fully remote, some hybrid, some in-person. The key shift is that location will be a choice, not a requirement, for most knowledge workers.",
      },
    ],
    // AI Ethics
    [
      {
        speaker: 'HOST',
        text: "Artificial intelligence is advancing at a breathtaking pace. But today on Sotto, we're asking the harder question — where should we draw the ethical lines?",
      },
      {
        speaker: 'EXPERT',
        text: 'This is the defining challenge of our generation. The technology itself is neutral, but the way we deploy it reflects our values — or lack thereof.',
      },
      { speaker: 'HOST', text: "Let's start with bias. How do AI systems become biased?" },
      {
        speaker: 'EXPERT',
        text: 'AI systems learn from data, and data reflects historical human decisions. If you train a hiring algorithm on decades of biased hiring data, the algorithm will perpetuate and even amplify those biases.',
      },
      {
        speaker: 'HOST',
        text: "What about deepfakes? That's something that worries a lot of people.",
      },
      {
        speaker: 'EXPERT',
        text: "Deepfakes are a real concern. We're reaching a point where you genuinely cannot tell a real video from a generated one. This undermines trust in media and creates new vectors for fraud and manipulation.",
      },
      { speaker: 'HOST', text: "And then there's the question of autonomous weapons." },
      {
        speaker: 'EXPERT',
        text: 'This is perhaps the most urgent ethical question. Should a machine be able to make life-or-death decisions without human intervention? Most ethicists say no, but the military incentives are strong.',
      },
      { speaker: 'HOST', text: 'Who gets to decide these ethical boundaries?' },
      {
        speaker: 'EXPERT',
        text: "That's the trillion-dollar question. Right now it's a patchwork — some regulation from governments, some self-regulation from companies, and a lot of academic debate. We need more inclusive, democratic processes for these decisions.",
      },
      { speaker: 'HOST', text: 'What gives you hope?' },
      {
        speaker: 'EXPERT',
        text: "The fact that we're having this conversation. Awareness is the first step. And I see a growing movement of responsible AI practitioners who are building ethical considerations into the development process from the start.",
      },
    ],
    // Stoicism
    [
      {
        speaker: 'HOST',
        text: "Today on Sotto, we're going back over two thousand years to explore a philosophy that's having a massive renaissance — Stoicism.",
      },
      {
        speaker: 'EXPERT',
        text: "It's remarkable how relevant Stoic ideas are today. The core insight is simple but powerful: we can't control what happens to us, but we can control how we respond.",
      },
      { speaker: 'HOST', text: 'Who were the major Stoic philosophers?' },
      {
        speaker: 'EXPERT',
        text: 'Three stand out. Seneca was a Roman statesman and playwright. Epictetus was a former slave who became one of the most respected teachers in Rome. And Marcus Aurelius was literally the Emperor of Rome.',
      },
      { speaker: 'HOST', text: "An emperor, a slave, and a senator — that's quite a range." },
      {
        speaker: 'EXPERT',
        text: "And that's what makes Stoicism universal. It works regardless of your circumstances. Marcus Aurelius wrote his Meditations as a private journal — never intending it for publication — while managing the Roman Empire.",
      },
      { speaker: 'HOST', text: 'How can someone apply Stoic principles to modern life?' },
      {
        speaker: 'EXPERT',
        text: "Start with the dichotomy of control. Every morning, identify what's in your control — your effort, your attitude, your responses — and what isn't — other people's opinions, the economy, the weather. Focus your energy only on the first category.",
      },
      {
        speaker: 'HOST',
        text: "What about negative visualization? That's a practice I've heard about.",
      },
      {
        speaker: 'EXPERT',
        text: "Yes — premeditatio malorum. Deliberately imagining worst-case scenarios. Not to be pessimistic, but to reduce anxiety. When you've mentally rehearsed losing something, you appreciate it more and fear less.",
      },
    ],
    // mRNA Vaccines
    [
      {
        speaker: 'HOST',
        text: "The COVID-19 pandemic brought a technology into the spotlight that most people had never heard of — mRNA vaccines. Today on Sotto, we're breaking down how they actually work.",
      },
      {
        speaker: 'EXPERT',
        text: 'mRNA vaccines represent a fundamentally different approach to vaccination. Instead of injecting a weakened or inactivated virus, you inject instructions — messenger RNA — that tell your cells to make a harmless piece of the virus.',
      },
      { speaker: 'HOST', text: 'So your body becomes the factory?' },
      {
        speaker: 'EXPERT',
        text: 'Exactly. Your cells read the mRNA instructions, produce the spike protein found on the surface of the coronavirus, and then your immune system recognizes it as foreign and mounts a response.',
      },
      { speaker: 'HOST', text: 'How were the Pfizer and Moderna vaccines developed so quickly?' },
      {
        speaker: 'EXPERT',
        text: "The technology had been in development for over a decade. Katalin Karik and Drew Weissman solved the key problem — making synthetic mRNA that doesn't trigger an inflammatory response — back in 2005. When COVID hit, the platform was ready.",
      },
      { speaker: 'HOST', text: 'Does the mRNA change your DNA?' },
      {
        speaker: 'EXPERT',
        text: "No, absolutely not. mRNA never enters the cell nucleus where DNA is stored. It stays in the cytoplasm, gets read by ribosomes to make proteins, and then it's broken down naturally within hours to days.",
      },
      { speaker: 'HOST', text: "What's next for mRNA technology?" },
      {
        speaker: 'EXPERT',
        text: "The potential is enormous. There are clinical trials for mRNA vaccines against cancer, HIV, malaria, and even autoimmune diseases. Personalized cancer vaccines that are tailored to an individual patient's tumor are showing very promising results.",
      },
      {
        speaker: 'HOST',
        text: "That's genuinely exciting. A technology born from a pandemic could end up transforming medicine.",
      },
      {
        speaker: 'EXPERT',
        text: 'It already is. And the speed of development will only increase as we build better tools for designing and manufacturing mRNA sequences.',
      },
    ],
  ];

  // Reference templates per episode
  const referenceSets: {
    title: string;
    authors: string[];
    year: number;
    url: string;
    type: 'WEB' | 'PAPER' | 'BOOK' | 'ARTICLE';
  }[][] = [
    // Cryptography
    [
      {
        title: 'The Code Book: The Science of Secrecy from Ancient Egypt to Quantum Cryptography',
        authors: ['Simon Singh'],
        year: 1999,
        url: 'https://www.simonsingh.net/books/the-code-book/',
        type: 'BOOK',
      },
      {
        title: 'A History of Cryptography and Cryptanalysis',
        authors: ['John F. Dooley'],
        year: 2018,
        url: 'https://link.springer.com/book/10.1007/978-3-319-90443-6',
        type: 'BOOK',
      },
      {
        title: 'The Enigma Machine and Its Role in WWII',
        authors: ['Bletchley Park Trust'],
        year: 2023,
        url: 'https://bletchleypark.org.uk/our-story/enigma',
        type: 'WEB',
      },
      {
        title: 'A Method for Obtaining Digital Signatures and Public-Key Cryptosystems',
        authors: ['Ron Rivest', 'Adi Shamir', 'Leonard Adleman'],
        year: 1978,
        url: 'https://people.csail.mit.edu/rivest/Rsapaper.pdf',
        type: 'PAPER',
      },
    ],
    // Quantum Computing
    [
      {
        title: 'Quantum Computing: An Applied Approach',
        authors: ['Jack D. Hidary'],
        year: 2021,
        url: 'https://link.springer.com/book/10.1007/978-3-030-83274-2',
        type: 'BOOK',
      },
      {
        title: "Shor's Algorithm for Factoring Large Integers",
        authors: ['Peter W. Shor'],
        year: 1994,
        url: 'https://arxiv.org/abs/quant-ph/9508027',
        type: 'PAPER',
      },
      {
        title: 'Post-Quantum Cryptography Standardization',
        authors: ['NIST'],
        year: 2024,
        url: 'https://csrc.nist.gov/projects/post-quantum-cryptography',
        type: 'WEB',
      },
      {
        title: 'A fast quantum mechanical algorithm for database search',
        authors: ['Lov K. Grover'],
        year: 1996,
        url: 'https://arxiv.org/abs/quant-ph/9605043',
        type: 'PAPER',
      },
      {
        title: 'Quantum Supremacy Using a Programmable Superconducting Processor',
        authors: ['Frank Arute', 'Kunal Arya', 'et al.'],
        year: 2019,
        url: 'https://www.nature.com/articles/s41586-019-1666-5',
        type: 'PAPER',
      },
    ],
    // Remote Work
    [
      {
        title: 'Remote: Office Not Required',
        authors: ['Jason Fried', 'David Heinemeier Hansson'],
        year: 2013,
        url: 'https://basecamp.com/books/remote',
        type: 'BOOK',
      },
      {
        title: 'The Future of Remote Work',
        authors: ['McKinsey Global Institute'],
        year: 2023,
        url: 'https://www.mckinsey.com/featured-insights/future-of-work',
        type: 'ARTICLE',
      },
      {
        title: 'Does Working from Home Work? Evidence from a Chinese Experiment',
        authors: ['Nicholas Bloom', 'James Liang', 'John Roberts', 'Zhichun Jenny Ying'],
        year: 2015,
        url: 'https://academic.oup.com/qje/article/130/1/165/2337855',
        type: 'PAPER',
      },
    ],
    // AI Ethics
    [
      {
        title: 'On the Dangers of Stochastic Parrots',
        authors: [
          'Emily M. Bender',
          'Timnit Gebru',
          'Angelina McMillan-Major',
          'Shmargaret Shmitchell',
        ],
        year: 2021,
        url: 'https://dl.acm.org/doi/10.1145/3442188.3445922',
        type: 'PAPER',
      },
      {
        title: 'Weapons of Math Destruction',
        authors: ["Cathy O'Neil"],
        year: 2016,
        url: 'https://weaponsofmathdestructionbook.com/',
        type: 'BOOK',
      },
      {
        title: 'The Ethics of Artificial Intelligence',
        authors: ['Nick Bostrom', 'Eliezer Yudkowsky'],
        year: 2014,
        url: 'https://intelligence.org/files/EthicsofAI.pdf',
        type: 'PAPER',
      },
      {
        title: 'EU Artificial Intelligence Act',
        authors: ['European Parliament'],
        year: 2024,
        url: 'https://artificialintelligenceact.eu/',
        type: 'WEB',
      },
    ],
    // Stoicism
    [
      {
        title: 'Meditations',
        authors: ['Marcus Aurelius'],
        year: 180,
        url: 'https://www.gutenberg.org/ebooks/2680',
        type: 'BOOK',
      },
      {
        title: 'Letters from a Stoic',
        authors: ['Seneca'],
        year: 65,
        url: 'https://www.gutenberg.org/ebooks/27523',
        type: 'BOOK',
      },
      {
        title: 'The Discourses of Epictetus',
        authors: ['Epictetus', 'Arrian'],
        year: 108,
        url: 'https://www.gutenberg.org/ebooks/10661',
        type: 'BOOK',
      },
      {
        title: 'How to Be a Stoic: Using Ancient Philosophy to Live a Modern Life',
        authors: ['Massimo Pigliucci'],
        year: 2017,
        url: 'https://massimopigliucci.com/books/',
        type: 'BOOK',
      },
      {
        title: 'A Guide to the Good Life: The Ancient Art of Stoic Joy',
        authors: ['William B. Irvine'],
        year: 2008,
        url: 'https://global.oup.com/academic/product/a-guide-to-the-good-life-9780195374612',
        type: 'BOOK',
      },
    ],
    // mRNA Vaccines
    [
      {
        title: 'Nucleoside-modified mRNA induces potent adaptive immune responses',
        authors: ['Katalin Kariko', 'Drew Weissman'],
        year: 2005,
        url: 'https://doi.org/10.1016/j.immuni.2005.06.005',
        type: 'PAPER',
      },
      {
        title: 'Safety and Efficacy of the BNT162b2 mRNA Covid-19 Vaccine',
        authors: ['Fernando P. Polack', 'et al.'],
        year: 2020,
        url: 'https://www.nejm.org/doi/full/10.1056/NEJMoa2034577',
        type: 'PAPER',
      },
      {
        title: 'mRNA vaccines — a new era in vaccinology',
        authors: ['Norbert Pardi', 'Michael J. Hogan', 'Frederick W. Porter', 'Drew Weissman'],
        year: 2018,
        url: 'https://www.nature.com/articles/nrd.2017.243',
        type: 'PAPER',
      },
      {
        title: 'Understanding mRNA COVID-19 Vaccines',
        authors: ['CDC'],
        year: 2024,
        url: 'https://www.cdc.gov/vaccines/covid-19/mrna.html',
        type: 'WEB',
      },
    ],
  ];

  const episodes = [];
  for (let i = 0; i < episodeDefs.length; i++) {
    const def = episodeDefs[i];
    const segments = segmentSets[i];
    const refs = referenceSets[i];

    // Upsert episode by checking if one with same title + userId exists
    let episode = await prisma.episode.findFirst({
      where: { title: def.title, userId: def.userId },
    });

    if (episode) {
      episode = await prisma.episode.update({
        where: { id: episode.id },
        data: {
          topic: def.topic,
          status: 'READY',
          visibility: def.visibility,
          duration: segments.length * 25, // ~25 seconds per segment
        },
      });
    } else {
      episode = await prisma.episode.create({
        data: {
          userId: def.userId,
          title: def.title,
          topic: def.topic,
          status: 'READY',
          visibility: def.visibility,
          duration: segments.length * 25,
        },
      });
    }
    episodes.push(episode);

    // Delete existing segments + references (idempotent re-creation)
    await prisma.segment.deleteMany({ where: { episodeId: episode.id } });
    await prisma.reference.deleteMany({ where: { episodeId: episode.id } });

    // Create segments
    await prisma.segment.createMany({
      data: segments.map((seg, idx) => ({
        episodeId: episode!.id,
        speaker: seg.speaker,
        text: seg.text,
        order: idx,
        startTime: idx * 25,
        duration: 25,
        version: 1,
      })),
    });

    // Create references
    await prisma.reference.createMany({
      data: refs.map((ref, idx) => ({
        episodeId: episode!.id,
        number: idx + 1,
        title: ref.title,
        authors: ref.authors,
        year: ref.year,
        url: ref.url,
        type: ref.type,
        verificationStatus: 'VERIFIED',
      })),
    });

    // Create tags
    for (const slug of def.tags) {
      const tagId = tagMap[slug];
      if (!tagId) continue;
      await prisma.episodeTag.create({ data: { episodeId: episode.id, tagId } }).catch(() => {}); // ignore if already exists
    }
  }
  console.log(`  Created ${episodes.length} episodes with segments and references`);

  // ── 7. Interaction on the quantum computing episode ─────────────
  const quantumEpisode = episodes[1];
  if (quantumEpisode) {
    const existing = await prisma.interaction.findFirst({
      where: { episodeId: quantumEpisode.id, userId: demoUser.id },
    });
    if (!existing) {
      await prisma.interaction.create({
        data: {
          episodeId: quantumEpisode.id,
          userId: demoUser.id,
          status: 'RESOLVED',
          question:
            'Wait, if quantum computers can break RSA encryption, does that mean all our current internet security is at risk?',
          timestamp: 125.0,
          answer:
            "Great question! Yes, a sufficiently powerful quantum computer running Shor's algorithm could theoretically break RSA and other public-key cryptography systems. However, we're not there yet — current quantum computers have around 1,000 qubits, while breaking RSA-2048 would require millions of error-corrected qubits. In the meantime, NIST has already standardized post-quantum cryptographic algorithms like CRYSTALS-Kyber and CRYSTALS-Dilithium that are resistant to quantum attacks. The transition to quantum-safe encryption is already underway.",
          resolved: true,
          incorporated: false,
        },
      });
      console.log('  Created interaction on quantum computing episode');
    }
  }

  // ── 8. Set audioUrl on Cryptography episode ──────────────────
  const cryptoEpisode = episodes[0];
  if (cryptoEpisode) {
    await prisma.episode.update({
      where: { id: cryptoEpisode.id },
      data: { audioUrl: '/demo-audio.mp3' },
    });
    console.log('  Set audioUrl on Cryptography episode');
  }

  // ── 9. SCRIPT_READY episode — "The Psychology of Decision Making" ──
  const scriptReadyTurns = [
    {
      speaker: 'HOST',
      text: "Welcome to Sotto. Today we're exploring something that affects every single decision you make — the psychology behind why we choose what we choose.",
    },
    {
      speaker: 'EXPERT',
      text: "And spoiler alert — most of those choices aren't nearly as rational as we think they are. Our brains use mental shortcuts called heuristics that often lead us astray.",
    },
    { speaker: 'HOST', text: "Let's start with one of the most famous: the anchoring effect." },
    {
      speaker: 'EXPERT',
      text: "Anchoring is when the first piece of information you encounter disproportionately influences your judgment. In experiments, even random numbers can anchor people's estimates of completely unrelated quantities.",
    },
    {
      speaker: 'HOST',
      text: 'That explains why retail stores show the "original price" crossed out next to the sale price.',
    },
    {
      speaker: 'EXPERT',
      text: "Exactly. The anchor makes the sale price feel like a bargain, even if it's still overpriced. Daniel Kahneman and Amos Tversky demonstrated this beautifully in their Nobel Prize-winning research.",
    },
    {
      speaker: 'HOST',
      text: "What about loss aversion? I've heard we feel losses more intensely than gains.",
    },
    {
      speaker: 'EXPERT',
      text: 'Roughly twice as intensely, according to prospect theory. Losing $100 feels about as bad as gaining $200 feels good. This asymmetry drives everything from investment behavior to why people stay in bad relationships.',
    },
    {
      speaker: 'HOST',
      text: "And then there's the paradox of choice — the idea that more options can actually make us less happy.",
    },
    {
      speaker: 'EXPERT',
      text: "Barry Schwartz showed that when faced with too many options, people either freeze and choose nothing, or they choose but feel less satisfied — always wondering if another option would have been better. It's the tyranny of abundance.",
    },
  ];

  const scriptReadyMarkdown = scriptReadyTurns
    .map((t) => `**${t.speaker}:** ${t.text}`)
    .join('\n\n');

  let scriptReadyEpisode = await prisma.episode.findFirst({
    where: { title: 'The Psychology of Decision Making', userId: demoUser.id },
  });

  if (scriptReadyEpisode) {
    scriptReadyEpisode = await prisma.episode.update({
      where: { id: scriptReadyEpisode.id },
      data: {
        status: 'SCRIPT_READY',
        visibility: 'PUBLIC',
        topic:
          'Why we make irrational choices — anchoring, loss aversion, the paradox of choice, and the cognitive biases that shape our decisions.',
      },
    });
  } else {
    scriptReadyEpisode = await prisma.episode.create({
      data: {
        userId: demoUser.id,
        title: 'The Psychology of Decision Making',
        topic:
          'Why we make irrational choices — anchoring, loss aversion, the paradox of choice, and the cognitive biases that shape our decisions.',
        status: 'SCRIPT_READY',
        visibility: 'PUBLIC',
        duration: 0,
      },
    });
  }

  // Upsert Script record
  await prisma.script.upsert({
    where: { episodeId: scriptReadyEpisode.id },
    update: { turns: scriptReadyTurns, markdown: scriptReadyMarkdown },
    create: {
      episodeId: scriptReadyEpisode.id,
      turns: scriptReadyTurns,
      markdown: scriptReadyMarkdown,
    },
  });

  // Tag it
  if (tagMap['philosophy']) {
    await prisma.episodeTag
      .create({
        data: { episodeId: scriptReadyEpisode.id, tagId: tagMap['philosophy'] },
      })
      .catch(() => {});
  }
  if (tagMap['science']) {
    await prisma.episodeTag
      .create({
        data: { episodeId: scriptReadyEpisode.id, tagId: tagMap['science'] },
      })
      .catch(() => {});
  }

  console.log(`  Created SCRIPT_READY episode: ${scriptReadyEpisode.id}`);

  // ── 10. Language-learning course showcase ──────────────────────
  const languageDemo = await seedLanguageLearningDemo(demoUser.id);
  console.log(
    `  Seeded language demo: ${languageDemo.curriculum.title}, ${languageDemo.classes.length} classes, ${languageDemo.vocabCount} vocab nodes, ${languageDemo.edgeCount} graph edges`
  );

  console.log('\nDemo data seeded successfully!');
  console.log(`  Demo user:  ${demoUser.email} (${demoUser.id})`);
  console.log(`  Admin user: ${adminUser.email} (${adminUser.id})`);
  console.log(`  Episodes:   ${episodes.length + 3} (including SCRIPT_READY and class audio)`);
  console.log(
    `  Course:     ${languageDemo.course.nativeLang}->${languageDemo.course.targetLang} ${languageDemo.course.currentLevel}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
