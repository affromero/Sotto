import {
  DEMO_LANGUAGE_IDS,
  prisma,
  seedGermanCurriculum,
  upsertClassEpisode,
  upsertQuestions,
  upsertSection,
  upsertSpeakingPrompts,
} from './shared';

export async function seedLanguageLearningDemo(userId: string) {
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
