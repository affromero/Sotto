import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import type { Prisma } from '@/generated/prisma/client';
import { loadCurriculum } from '../curricula/schema';

export const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
  }),
});

export const DEMO_LANGUAGE_IDS = {
  courseClassIntro: 'demo-de-a1-class-greetings',
  courseClassNumbers: 'demo-de-a1-class-numbers',
  introEpisode: 'demo-de-a1-listening-greetings',
  numbersEpisode: 'demo-de-a1-listening-market',
} as const;

export type DemoSkill = 'GRAMMAR' | 'READING' | 'LISTENING' | 'SPEAKING';

export interface DemoQuestion {
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

export interface DemoPrompt {
  order: number;
  targetPhrase: string;
  translation: string;
  ipa?: string;
}

export async function seedGermanCurriculum() {
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

export async function upsertClassEpisode(params: {
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

export async function upsertSection(params: {
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

export async function upsertQuestions(sectionId: string, questions: DemoQuestion[]) {
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

export async function upsertSpeakingPrompts(sectionId: string, prompts: DemoPrompt[]) {
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
