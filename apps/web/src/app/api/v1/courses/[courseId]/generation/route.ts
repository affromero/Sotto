import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import {
  readClassPreparation,
  cancelClassPreparation,
  preparationProgress,
  readPreparationActivity,
} from '@/lib/classes/preparation';
import { currentClassSections } from '@/lib/learning/classes/current-sections';
import { readSkillRequirements } from '@/lib/learning/skill-requirements';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { PreparationConflictError } from '@/lib/classes/preparation-state';

type RouteParams = { params: Promise<{ courseId: string }> };

export const runtime = 'nodejs';

const EXPECTED_SKILLS = ['GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING'] as const;
const TOTAL_STEPS = EXPECTED_SKILLS.length + 1;
const DEFAULT_TOTAL_SECONDS = 240;

interface SectionProgress {
  skill: string;
  status: string;
  episode?: {
    status: string;
    audioUrl: string | null;
  } | null;
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

function isListeningAudioStillRendering(episode: SectionProgress['episode']): boolean {
  return Boolean(
    episode && !episode.audioUrl && !['READY', 'FAILED', 'SCRIPT_READY'].includes(episode.status)
  );
}

function describeProgress(
  status: string,
  sections: SectionProgress[],
  requiredSkills: readonly string[] = EXPECTED_SKILLS
) {
  const sectionBySkill = new Map(sections.map((section) => [section.skill, section]));
  const ready = (skill: string) =>
    ['READY', 'PASSED'].includes(sectionBySkill.get(skill)?.status ?? '');
  const readyCount = requiredSkills.filter(ready).length;
  const listening = sectionBySkill.get('LISTENING');
  const listeningAudioReady =
    listening?.episode === undefined || listening.episode === null || !!listening.episode.audioUrl;

  if (status !== 'GENERATING' && listeningAudioReady) {
    return {
      stage: 'Class ready',
      detail: 'Opening the generated class.',
      progress: 1,
      currentStep: TOTAL_STEPS,
    };
  }

  if (status !== 'GENERATING' && !listeningAudioReady) {
    if (!isListeningAudioStillRendering(listening?.episode)) {
      return {
        stage: 'Class needs attention',
        detail: 'Listening audio is missing. Open this class to regenerate it if needed.',
        progress: 1,
        currentStep: TOTAL_STEPS,
      };
    }

    return {
      stage: 'Rendering listening audio',
      detail:
        listening?.episode?.status === 'STITCHING'
          ? 'Stitching the listening scene into one playable file.'
          : 'Generating the listening scene audio.',
      progress: listening?.episode?.status === 'STITCHING' ? 0.94 : 0.9,
      currentStep: 3,
    };
  }

  const grammar = sectionBySkill.get('GRAMMAR');
  if (!grammar) {
    return {
      stage: 'Preparing class',
      detail: 'Writing and reviewing the class introduction before building the exercises.',
      progress: 0,
      currentStep: 1,
    };
  }
  if (!ready('GRAMMAR')) {
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
  if (!ready('READING')) {
    return {
      stage: 'Generating reading questions',
      detail: 'Writing comprehension questions and answer choices.',
      progress: 0.34,
      currentStep: 2,
    };
  }

  if (requiredSkills.includes('LISTENING') && !ready('LISTENING')) {
    return {
      stage: 'Composing listening practice',
      detail: 'Creating adaptive audio material and comprehension checks.',
      progress: 0.52,
      currentStep: 3,
    };
  }

  if (requiredSkills.includes('SPEAKING') && !ready('SPEAKING')) {
    return {
      stage: 'Preparing speaking prompts',
      detail: 'Creating speaking prompts and their reference audio.',
      progress: 0.72,
      currentStep: 4,
    };
  }

  if (!ready('WRITING')) {
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
    progress: readyCount >= requiredSkills.length ? 0.96 : 0.9,
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
          attempt: true,
          skillRequirements: true,
          createdAt: true,
          updatedAt: true,
          lesson: { select: { title: true } },
          sections: {
            orderBy: [{ createdAt: 'asc' }],
            select: {
              skill: true,
              attempt: true,
              status: true,
              updatedAt: true,
              episode: { select: { status: true, audioUrl: true, updatedAt: true } },
            },
          },
        },
      },
    },
  });

  if (!course) return errorResponse('Course not found', 404);

  const operation = await readClassPreparation(courseId, authed.userId);
  const cls = course.classes[0];
  // Durable preparation creates attempt 1; whole-class regeneration owns later attempts.
  const terminalOperationSuperseded =
    operation &&
    cls &&
    ['FAILED', 'CANCELLED', 'COMPLETED'].includes(operation.status) &&
    (cls.id === operation.classId
      ? cls.attempt > (operation.intent?.attempt ?? 1)
      : cls.createdAt.getTime() > operation.updatedAt);
  if (
    !terminalOperationSuperseded &&
    operation?.status === 'COMPLETED' &&
    (operation.result === 'done' || operation.result === 'requirements')
  ) {
    return NextResponse.json({
      ...preparationProgress(operation),
      result: operation.result,
      progress: 1,
    });
  }
  if (!terminalOperationSuperseded && operation && operation.status !== 'COMPLETED') {
    const preparation = preparationProgress(operation);
    if (operation.status !== 'RUNNING') return NextResponse.json(preparation);
    const activity = await readPreparationActivity(
      courseId,
      sottoRequestExecution(request, authed)
    );
    if (!activity || activity.operationId !== operation.id)
      return errorResponse('Preparation changed. Refresh its status.', 409);
    const matchesClass =
      cls && cls.id === operation.classId && cls.attempt === (operation.intent?.attempt ?? 1);
    const sections = matchesClass
      ? currentClassSections(
          cls.sections.filter((section) =>
            operation.intent?.kind === 'REPAIR' && !operation.intent.skills.includes(section.skill)
              ? true
              : section.attempt === cls.attempt
          )
        )
      : [];
    const requiredSkills = EXPECTED_SKILLS.filter(
      (skill) =>
        !operation.requirements || operation.requirements.skills[skill].state === 'REQUIRED'
    );
    const described = matchesClass
      ? describeProgress('GENERATING', sections, requiredSkills)
      : null;
    return NextResponse.json({
      ...preparation,
      ...(described ?? {}),
      lessonTitle: matchesClass ? cls.lesson.title : null,
      sections: sections.map((section) => ({
        skill: section.skill,
        status: section.status,
        episode: section.episode,
      })),
      updatedAt: new Date(
        Math.max(
          Date.parse(activity.updatedAt),
          ...(matchesClass ? [cls.updatedAt.getTime()] : []),
          ...sections.flatMap((section) => [
            section.updatedAt.getTime(),
            ...(section.episode ? [section.episode.updatedAt.getTime()] : []),
          ])
        )
      ).toISOString(),
      providerRequestsCompleted: activity.providerRequestsCompleted,
      providerRequestInFlight: activity.providerRequestInFlight,
    });
  }
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

  const activeSections = currentClassSections(
    cls.sections.filter((section) => cls.status !== 'GENERATING' || section.attempt === cls.attempt)
  );
  const sections = activeSections.map((section) => ({
    skill: section.skill,
    status: section.status,
    episode: section.episode,
  }));
  const requirements = readSkillRequirements(cls.skillRequirements);
  const described = describeProgress(
    cls.status,
    sections,
    EXPECTED_SKILLS.filter(
      (skill) => !requirements || requirements.skills[skill].state === 'REQUIRED'
    )
  );
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - cls.createdAt.getTime()) / 1000));
  const progress = clamp(described.progress, 0, 1);

  return NextResponse.json({
    ...(!terminalOperationSuperseded &&
    operation?.status === 'COMPLETED' &&
    operation.classId === cls.id
      ? preparationProgress(operation)
      : {}),
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
    updatedAt: new Date(
      Math.max(
        cls.updatedAt.getTime(),
        ...activeSections.flatMap((section) => [
          section.updatedAt.getTime(),
          ...(section.episode ? [section.episode.updatedAt.getTime()] : []),
        ])
      )
    ).toISOString(),
  });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);

  const { courseId } = await params;
  try {
    const operation = await cancelClassPreparation(
      courseId,
      sottoRequestExecution(request, authed)
    );
    if (operation?.status === 'UNRESOLVED') {
      return errorResponse('Preparation needs recovery before cancellation can finish.', 409);
    }
    if (operation) {
      return NextResponse.json({
        cancelled: operation.status === 'CANCELLED',
        cancelling: operation.status === 'CANCELLING',
        operationId: operation.id,
        classId: operation.classId,
      });
    }
  } catch (error) {
    if (error instanceof PreparationConflictError) return errorResponse(error.message, 409);
    return errorResponse('Could not cancel preparation.', 500);
  }
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId: authed.userId },
    select: {
      id: true,
      classes: {
        where: { status: 'GENERATING' },
        orderBy: [{ createdAt: 'desc' }],
        take: 1,
        select: { id: true },
      },
    },
  });

  if (!course) return errorResponse('Course not found', 404);

  const cls = course.classes[0];
  if (!cls) {
    return NextResponse.json({ cancelled: false });
  }

  await prisma.$transaction([
    prisma.course.updateMany({
      where: { id: courseId, userId: authed.userId, activeClassId: cls.id },
      data: { activeClassId: null },
    }),
    prisma.courseClass.deleteMany({ where: { id: cls.id, courseId } }),
  ]);

  return NextResponse.json({ cancelled: true, classId: cls.id });
}
