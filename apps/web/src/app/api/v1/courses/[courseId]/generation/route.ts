import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';

type RouteParams = { params: Promise<{ courseId: string }> };

export const runtime = 'nodejs';

const EXPECTED_SKILLS = ['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING'] as const;
const TOTAL_STEPS = EXPECTED_SKILLS.length + 1;
const DEFAULT_TOTAL_SECONDS = 240;

interface SectionProgress {
  skill: string;
  status: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function estimateRemainingSeconds(elapsedSeconds: number | null, progress: number): number | null {
  if (elapsedSeconds === null) return null;
  if (progress >= 1) return 0;
  if (elapsedSeconds < 5 || progress <= 0.05) {
    return Math.max(0, DEFAULT_TOTAL_SECONDS - elapsedSeconds);
  }

  const estimatedTotal = clamp(Math.round(elapsedSeconds / progress), 45, 420);
  return Math.max(0, estimatedTotal - elapsedSeconds);
}

function describeProgress(status: string, sections: SectionProgress[]) {
  const sectionBySkill = new Map(sections.map((section) => [section.skill, section]));
  const readyCount = EXPECTED_SKILLS.filter(
    (skill) => sectionBySkill.get(skill)?.status === 'READY'
  ).length;

  if (status !== 'GENERATING') {
    return {
      stage: 'Class ready',
      detail: 'Opening the generated class.',
      progress: 1,
      currentStep: TOTAL_STEPS,
    };
  }

  const grammar = sectionBySkill.get('GRAMMAR');
  if (!grammar) {
    return {
      stage: 'Preparing class',
      detail: 'Creating the class shell and loading the lesson plan.',
      progress: 0.05,
      currentStep: 1,
    };
  }
  if (grammar.status !== 'READY') {
    return {
      stage: 'Generating grammar questions',
      detail: 'Building the first multiple-choice section.',
      progress: 0.14,
      currentStep: 1,
    };
  }

  const reading = sectionBySkill.get('READING');
  if (!reading) {
    return {
      stage: 'Preparing reading section',
      detail: 'Moving from grammar into reading comprehension.',
      progress: 0.28,
      currentStep: 2,
    };
  }
  if (reading.status !== 'READY') {
    return {
      stage: 'Generating reading questions',
      detail: 'Writing comprehension questions and answer choices.',
      progress: 0.34,
      currentStep: 2,
    };
  }

  if (!sectionBySkill.has('LISTENING')) {
    return {
      stage: 'Composing listening practice',
      detail: 'Creating adaptive audio material and comprehension checks.',
      progress: 0.52,
      currentStep: 3,
    };
  }

  if (!sectionBySkill.has('SPEAKING')) {
    return {
      stage: 'Preparing speaking prompts',
      detail: 'Creating short Apple Pencil and voice practice prompts.',
      progress: 0.72,
      currentStep: 4,
    };
  }

  if (!sectionBySkill.has('WRITING')) {
    return {
      stage: 'Preparing writing prompts',
      detail: 'Creating the final written-response practice.',
      progress: 0.86,
      currentStep: 5,
    };
  }

  return {
    stage: 'Finalizing class',
    detail: 'Saving adaptive review targets and unlocking the class.',
    progress: readyCount >= EXPECTED_SKILLS.length ? 0.96 : 0.9,
    currentStep: TOTAL_STEPS,
  };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);

  const { courseId } = await params;
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId: authed.userId },
    select: {
      id: true,
      classes: {
        where: { status: { not: 'PASSED' } },
        orderBy: [{ createdAt: 'desc' }],
        take: 1,
        select: {
          id: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          lesson: { select: { title: true } },
          sections: {
            orderBy: [{ createdAt: 'asc' }],
            select: { skill: true, status: true },
          },
        },
      },
    },
  });

  if (!course) return errorResponse('Course not found', 404);

  const cls = course.classes[0];
  if (!cls) {
    return NextResponse.json({
      status: 'IDLE',
      classId: null,
      lessonTitle: null,
      stage: 'Waiting to start',
      detail: 'Sotto has not created a class record yet.',
      progress: 0,
      currentStep: 0,
      totalSteps: TOTAL_STEPS,
      elapsedSeconds: null,
      remainingSeconds: null,
      sections: [],
    });
  }

  const sections = cls.sections.map((section) => ({
    skill: section.skill,
    status: section.status,
  }));
  const described = describeProgress(cls.status, sections);
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - cls.createdAt.getTime()) / 1000));
  const progress = clamp(described.progress, 0, 1);

  return NextResponse.json({
    status: cls.status,
    classId: cls.id,
    lessonTitle: cls.lesson.title,
    stage: described.stage,
    detail: described.detail,
    progress,
    currentStep: described.currentStep,
    totalSteps: TOTAL_STEPS,
    elapsedSeconds,
    remainingSeconds: estimateRemainingSeconds(elapsedSeconds, progress),
    sections,
    updatedAt: cls.updatedAt.toISOString(),
  });
}
