import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { isUserAdmin } from '@/lib/auth-guards';
import { onboardingSaveSchema } from '@/lib/validations';
import { getOrCreateCurriculum } from '@/lib/curriculum-generator';
import { setCourseNote } from '@/lib/course-notes';
import { setSiteConfig } from '@/lib/site-config';
import { invalidateServerInfra } from '@/lib/server-config';
import { isSelfHosted } from '@/lib/self-hosted';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import {
  getAutoModelConfig,
  setAutoModelConfig,
  type ModelConfig,
} from '@/lib/auto-model-config';
import { isValidAiProviderId, getProviderForModel } from '@/lib/providers/ai-registry';
import { isValidProviderId, getProviderMeta } from '@/lib/providers/tts-registry';
import { isValidSttProviderId, getSttProviderMeta } from '@/lib/providers/stt-registry';

type PreferredInput = NonNullable<
  ReturnType<typeof onboardingSaveSchema.parse>['preferred']
>;

/**
 * Build the AutoModelConfig default-model update from the wizard's preferred
 * selections, including ONLY registry-valid provider+model pairs. This excludes
 * keyless/local AI (e.g. "local:qwen3") and any mismatched pair, so generation
 * reads exactly what the learner chose and setAutoModelConfig never rejects it.
 */
function buildModelUpdate(preferred: PreferredInput): Partial<ModelConfig> {
  const update: Partial<ModelConfig> = {};
  const { aiProvider, aiModel, ttsProvider, ttsModel, sttProvider, sttModel } = preferred;

  if (
    aiProvider &&
    aiModel &&
    isValidAiProviderId(aiProvider) &&
    getProviderForModel(aiModel) === aiProvider
  ) {
    update.aiProvider = aiProvider;
    update.aiModel = aiModel;
  }
  if (
    ttsProvider &&
    ttsModel &&
    isValidProviderId(ttsProvider) &&
    getProviderMeta(ttsProvider).models.some((m) => m.id === ttsModel)
  ) {
    update.ttsProvider = ttsProvider;
    update.ttsModel = ttsModel;
  }
  if (
    sttProvider &&
    sttModel &&
    isValidSttProviderId(sttProvider) &&
    getSttProviderMeta(sttProvider).models.some((m) => m.id === sttModel)
  ) {
    update.sttProvider = sttProvider;
    update.sttModel = sttModel;
  }
  return update;
}

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

    const authed = await authenticateRequest(request);
    if (!authed) {
      return errorResponse('Unauthorized', 401);
    }
    const userId = authed.userId;

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
    const isOwner = await isUserAdmin(authed.userId);
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

    // Owner: mirror the chosen provider+model into AutoModelConfig — the store the
    // admin providers page edits and generation reads — so the wizard's model
    // choice actually drives generation (and stays editable later in admin). Best
    // effort: never fail onboarding over it (the keys/course are already saved).
    if (isOwner && preferred) {
      const modelUpdate = buildModelUpdate(preferred);
      if (Object.keys(modelUpdate).length > 0) {
        try {
          await getAutoModelConfig(); // ensure the singleton exists with full seeds first
          await setAutoModelConfig({ model: modelUpdate }, userId);
        } catch (error) {
          logger.warn('Could not persist wizard model selection to AutoModelConfig', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
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
