// @vitest-environment private-redis
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';
import {
  createSharedTestInstance,
  type SharedTestInstance,
} from '../../helpers/setup/shared-instance';

const boundary = vi.hoisted(() => ({ database: null as PrismaClient | null }));
vi.mock('@/lib/prisma', async () => {
  const { prismaTestBoundary } = await import('../../helpers/setup/shared-instance');
  const database = prismaTestBoundary(boundary);
  return { prisma: database, prismaUnfiltered: database };
});

import { GET as practicePoll } from '@/app/api/v1/practice/[sessionId]/speaking/[promptId]/route';
import { GET as examPoll } from '@/app/api/v1/exams/[examId]/speaking/[promptId]/route';
import { GET as classPoll } from '@/app/api/v1/classes/[classId]/speaking/[promptId]/route';

const suite = process.env.SIDEDOOR_TEST_DATABASE_URL ? describe : describe.skip;
suite('speaking poll ownership', () => {
  let instance: SharedTestInstance;
  beforeAll(async () => {
    instance = await createSharedTestInstance('speaking_poll_scope');
    boundary.database = instance.database;
  });
  afterAll(async () => {
    boundary.database = null;
    await instance.close();
  });

  it('keeps each recording within its owned activity through concurrent changes', async () => {
    const identity = await instance.reset();
    const db = instance.database;
    const curriculum = await db.curriculum.upsert({
      where: { nativeLang_targetLang: { nativeLang: 'en', targetLang: 'es' } },
      create: { nativeLang: 'en', targetLang: 'es', title: 'Spanish' },
      update: {},
    });
    const course = await db.course.create({
      data: {
        userId: identity.ownerId,
        curriculumId: curriculum.id,
        nativeLang: 'en',
        targetLang: 'es',
      },
    });
    const lesson = await db.lesson.create({
      data: {
        curriculumId: curriculum.id,
        slug: 'speaking-poll-scope',
        level: 'A1',
        order: 1,
        title: 'Greetings',
        objective: 'Greet a person',
        grammarPoints: [],
        targetVocab: [],
        vocabThemes: [],
      },
    });
    const classes = await Promise.all(
      [1, 2].map((order) =>
        db.courseClass.create({
          data: { courseId: course.id, lessonId: lesson.id, order, status: 'AVAILABLE' },
        })
      )
    );
    const classSections = await Promise.all(
      classes.map((cls) =>
        db.classSection.create({
          data: {
            classId: cls.id,
            skill: 'SPEAKING',
            status: 'READY',
            seed: 'fixture',
            spec: {},
          },
        })
      )
    );
    const classPrompt = await db.speakingPrompt.create({
      data: {
        sectionId: classSections[0].id,
        order: 1,
        targetPhrase: 'Hola',
        translation: 'Hello',
      },
    });
    const classRecording = await db.speakingRecording.create({
      data: {
        promptId: classPrompt.id,
        userId: identity.ownerId,
        sectionId: classSections[0].id,
        audioUrl: 'local:class',
        status: 'SCORED',
        transcript: 'Hola',
      },
    });
    const sessions = await Promise.all(
      ['first', 'second'].map((seed) =>
        db.practiceSession.create({
          data: { courseId: course.id, kind: 'SPEAKING', items: [], seed },
        })
      )
    );
    const practicePrompt = await db.speakingPrompt.create({
      data: {
        practiceSessionId: sessions[0].id,
        order: 1,
        targetPhrase: 'Hola',
        translation: 'Hello',
      },
    });
    const practiceRecording = await db.speakingRecording.create({
      data: {
        promptId: practicePrompt.id,
        userId: identity.ownerId,
        practiceSessionId: sessions[0].id,
        audioUrl: 'local:practice',
        status: 'SCORED',
        transcript: 'Hola',
      },
    });
    const exams = await Promise.all(
      ['first', 'second'].map((blueprintId) =>
        db.mockExam.create({
          data: {
            courseId: course.id,
            userId: identity.ownerId,
            institution: 'CEFR_GENERIC',
            level: 'A1',
            blueprintId,
          },
        })
      )
    );
    const section = await db.examSection.create({
      data: {
        examId: exams[0].id,
        skill: 'SPEAKING',
        part: 'one',
        order: 1,
        format: 'speaking',
      },
    });
    const examPrompt = await db.speakingPrompt.create({
      data: {
        examSectionId: section.id,
        order: 1,
        targetPhrase: 'Hola',
        translation: 'Hello',
      },
    });
    const examRecording = await db.speakingRecording.create({
      data: {
        promptId: examPrompt.id,
        userId: identity.ownerId,
        examSectionId: section.id,
        audioUrl: 'local:exam',
        status: 'SCORED',
        transcript: 'Hola',
      },
    });
    const request = (id: string) =>
      new NextRequest(`http://localhost/api/speaking?recordingId=${id}`, {
        headers: { cookie: `sotto_session=${identity.ownerToken}` },
      });
    expect(
      (
        await classPoll(request(classRecording.id), {
          params: Promise.resolve({
            classId: classes[0].id,
            promptId: classPrompt.id,
          }),
        })
      ).status
    ).toBe(200);
    expect(
      (
        await classPoll(request(classRecording.id), {
          params: Promise.resolve({
            classId: classes[1].id,
            promptId: classPrompt.id,
          }),
        })
      ).status
    ).toBe(404);
    expect(
      (
        await practicePoll(request(practiceRecording.id), {
          params: Promise.resolve({
            sessionId: sessions[0].id,
            promptId: practicePrompt.id,
          }),
        })
      ).status
    ).toBe(200);
    expect(
      (
        await practicePoll(request(practiceRecording.id), {
          params: Promise.resolve({
            sessionId: sessions[1].id,
            promptId: practicePrompt.id,
          }),
        })
      ).status
    ).toBe(404);
    expect(
      (
        await examPoll(request(examRecording.id), {
          params: Promise.resolve({
            examId: exams[0].id,
            promptId: examPrompt.id,
          }),
        })
      ).status
    ).toBe(200);
    expect(
      (
        await examPoll(request(examRecording.id), {
          params: Promise.resolve({
            examId: exams[1].id,
            promptId: examPrompt.id,
          }),
        })
      ).status
    ).toBe(404);
    const otherLearner = await identity.household('Other learner');
    const foreignRequest = (id: string) =>
      new NextRequest(`http://localhost/api/speaking?recordingId=${id}`, {
        headers: { cookie: `sotto_session=${otherLearner.token}` },
      });
    expect(
      (
        await classPoll(foreignRequest(classRecording.id), {
          params: Promise.resolve({
            classId: classes[0].id,
            promptId: classPrompt.id,
          }),
        })
      ).status
    ).toBe(404);
    expect(
      (
        await practicePoll(foreignRequest(practiceRecording.id), {
          params: Promise.resolve({
            sessionId: sessions[0].id,
            promptId: practicePrompt.id,
          }),
        })
      ).status
    ).toBe(404);
    expect(
      (
        await examPoll(foreignRequest(examRecording.id), {
          params: Promise.resolve({
            examId: exams[0].id,
            promptId: examPrompt.id,
          }),
        })
      ).status
    ).toBe(404);

    await db.speakingRecording.update({
      where: { id: classRecording.id },
      data: { sectionId: classSections[1].id },
    });
    expect(
      (
        await classPoll(request(classRecording.id), {
          params: Promise.resolve({
            classId: classes[0].id,
            promptId: classPrompt.id,
          }),
        })
      ).status
    ).toBe(404);
    await db.speakingRecording.update({
      where: { id: classRecording.id },
      data: { sectionId: classSections[0].id },
    });
    const changedClass = db.$extends({
      query: {
        speakingPrompt: {
          async findFirst({ args, query }) {
            const result = await query(args);
            await db.classSection.update({
              where: { id: classSections[0].id },
              data: { classId: classes[1].id },
            });
            return result;
          },
        },
      },
    });
    boundary.database = changedClass as unknown as PrismaClient;
    try {
      expect(
        (
          await classPoll(request(classRecording.id), {
            params: Promise.resolve({
              classId: classes[0].id,
              promptId: classPrompt.id,
            }),
          })
        ).status
      ).toBe(404);
      expect(
        (await db.classSection.findUniqueOrThrow({ where: { id: classSections[0].id } })).classId
      ).toBe(classes[1].id);
    } finally {
      boundary.database = db;
    }
    await db.classSection.update({
      where: { id: classSections[0].id },
      data: { classId: classes[0].id },
    });
    const changedPrompt = db.$extends({
      query: {
        speakingPrompt: {
          async findFirst({ args, query }) {
            const result = await query(args);
            await db.speakingPrompt.update({
              where: { id: classPrompt.id },
              data: { sectionId: classSections[1].id },
            });
            return result;
          },
        },
      },
    });
    boundary.database = changedPrompt as unknown as PrismaClient;
    try {
      expect(
        (
          await classPoll(request(classRecording.id), {
            params: Promise.resolve({
              classId: classes[0].id,
              promptId: classPrompt.id,
            }),
          })
        ).status
      ).toBe(404);
      expect(
        (await db.speakingPrompt.findUniqueOrThrow({ where: { id: classPrompt.id } })).sectionId
      ).toBe(classSections[1].id);
    } finally {
      boundary.database = db;
    }

    const otherSection = await db.examSection.create({
      data: {
        examId: exams[1].id,
        skill: 'SPEAKING',
        part: 'two',
        order: 1,
        format: 'speaking',
      },
    });
    await db.speakingRecording.update({
      where: { id: examRecording.id },
      data: { examSectionId: otherSection.id },
    });
    expect(
      (
        await examPoll(request(examRecording.id), {
          params: Promise.resolve({
            examId: exams[0].id,
            promptId: examPrompt.id,
          }),
        })
      ).status
    ).toBe(404);
    await db.speakingRecording.update({
      where: { id: examRecording.id },
      data: { examSectionId: section.id },
    });

    const intercepted = db.$extends({
      query: {
        speakingPrompt: {
          async findFirst({ args, query }) {
            const result = await query(args);
            await db.examSection.update({
              where: { id: section.id },
              data: { examId: exams[1].id },
            });
            return result;
          },
        },
      },
    });
    boundary.database = intercepted as unknown as PrismaClient;
    try {
      expect(
        (
          await examPoll(request(examRecording.id), {
            params: Promise.resolve({
              examId: exams[0].id,
              promptId: examPrompt.id,
            }),
          })
        ).status
      ).toBe(404);
      expect((await db.examSection.findUniqueOrThrow({ where: { id: section.id } })).examId).toBe(
        exams[1].id
      );
    } finally {
      boundary.database = db;
    }
  });
});
