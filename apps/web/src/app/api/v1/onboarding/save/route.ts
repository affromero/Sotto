import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-guards';
import { onboardingSaveSchema } from '@/lib/validations';
import { getOrCreateCurriculum } from '@/lib/curriculum-generator';
import { setCourseNote } from '@/lib/course-notes';
import { setSiteConfig } from '@/lib/site-config';
import { invalidateServerInfra } from '@/lib/server-config';
import { isSelfHosted } from '@/lib/self-hosted';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';

/**
 * POST /api/onboarding/save
 * Persist the welcome wizard's choices in one call: the learner's course
 * (language pair + placement level), context note, provider preferences, and —
 * for the owner only — server infrastructure. Marks onboarding complete.
 *
 * BYOK keys are intentionally NOT handled here; the wizard sends them through the
 * validated /api/settings/ai-keys and /api/settings/byok routes.
 *
 * On the managed showcase (`SELF_HOSTED=false`) this is a non-persisting demo: it
 * returns `{ demo: true }` and writes nothing.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isSelfHosted()) {
      return NextResponse.json({ demo: true });
    }

    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }
    const userId = session.user.id;

    const parsed = onboardingSaveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0].message, 400);
    }
    const { course, note, preferred, infra } = parsed.data;

    if (course.native === course.target) {
      return errorResponse('Native and target languages must differ.', 400);
    }

    // Server infrastructure is owner-only. Reject (don't silently drop) a
    // non-owner attempting to set it.
    const isOwner = (await requireAdmin()) !== null;
    if (infra && !isOwner) {
      return errorResponse('Only the instance owner can set server infrastructure.', 403);
    }

    // Course at the placement level (only on first creation — never clobber progress).
    const curriculum = await getOrCreateCurriculum(userId, course.native, course.target);
    const created = await prisma.course.upsert({
      where: {
        userId_nativeLang_targetLang: {
          userId,
          nativeLang: course.native,
          targetLang: course.target,
        },
      },
      create: {
        userId,
        nativeLang: course.native,
        targetLang: course.target,
        curriculumId: curriculum.id,
        ...(course.level && { currentLevel: course.level, startLevel: course.level }),
      },
      update: {},
      select: { id: true },
    });

    if (note && note.trim()) {
      await setCourseNote(created.id, note);
    }

    if (preferred) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          ...(preferred.language !== undefined && { preferredLanguage: preferred.language }),
          ...(preferred.aiProvider !== undefined && { preferredAiProvider: preferred.aiProvider }),
          ...(preferred.aiModel !== undefined && { preferredAiModel: preferred.aiModel }),
          ...(preferred.ttsProvider !== undefined && {
            preferredTtsProvider: preferred.ttsProvider,
          }),
          ...(preferred.ttsModel !== undefined && { preferredTtsModel: preferred.ttsModel }),
        },
      });
    }

    if (infra && isOwner) {
      await setSiteConfig(infra, userId);
      invalidateServerInfra();
    }

    await prisma.user.update({
      where: { id: userId },
      data: { hasCompletedOnboarding: true },
    });

    return NextResponse.json({ demo: false, courseId: created.id });
  } catch (error: unknown) {
    logger.error('Failed to save onboarding', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to save onboarding', 500);
  }
}
