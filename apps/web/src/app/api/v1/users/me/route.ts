import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { customTagSchema, deleteAccountSchema } from '@/lib/validations';
import { generateTagSlug } from '@/lib/slugify';
import { deleteFile, listFiles } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { getProviderForModel, isValidModelId } from '@/lib/providers/ai-registry';
import { getAutoModelConfig } from '@/lib/auto-model-config';
import { getConfiguredTtsProviderId } from '@/lib/providers/tts';
import { getProviderMeta } from '@/lib/providers/tts-registry';
import { getSttProviderMeta, isValidSttProviderId } from '@/lib/providers/stt-registry';
import { getServerInfra } from '@/lib/server-config';
import { supportsLanguage } from '@/lib/tts-language-support';
import { supportsSttLanguage } from '@/lib/providers/stt-registry';
import { errorResponse } from '@/lib/api-response';
import { THEME_PREFS_COOKIE, serializeThemePrefs, themePrefsFromUser } from '@/lib/theme-prefs';
import { z } from 'zod';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const updateUserSchema = z
  .object({
    name: z
      .string()
      .transform((val) => val.trim())
      .pipe(z.string().min(1).max(100))
      .optional(),
    image: z
      .string()
      .refine(
        (v) => /^https?:\/\//.test(v) || /^\/avatars\/[a-z]+\.png$/.test(v),
        'Image must be a URL or a preset avatar'
      )
      .optional(),
    voicePreferences: z
      .array(
        z.object({
          speaker: z.string().min(1).max(50),
          voiceId: z.string().min(1),
        })
      )
      .optional(),
    preferredLanguage: z.string().max(5).nullable().optional(),
    preferredAiModel: z.string().nullable().optional(),
    preferredTtsModel: z.string().nullable().optional(),
    preferredSttModel: z.string().nullable().optional(),
    emailNotifications: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    showAgentUsageStatus: z.boolean().optional(),
    interests: z.array(z.string()).max(20).optional(),
    customTags: z.array(customTagSchema).max(10).optional(),
    // Per-profile appearance (persisted by the ThemeProvider for the active profile)
    themeMode: z.enum(['system', 'light', 'dark']).optional(),
    themePalette: z.enum(['aula', 'paper']).optional(),
    themeAccent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
    reducedMotion: z.boolean().optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult) {
      return errorResponse('Unauthorized', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: authResult.userId },
      include: {
        voicePreferences: { select: { speaker: true, voiceId: true, sortOrder: true } },
      },
    });

    if (!user) {
      return errorResponse('User not found', 404);
    }

    const episodeCount = await prisma.episode.count({
      where: { userId: authResult.userId },
    });

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      episodeCount,
      createdAt: user.createdAt.toISOString(),
      voicePreferences: user.voicePreferences,
      preferredLanguage: user.preferredLanguage,
      preferredAiModel: user.preferredAiModel,
      preferredTtsModel: user.preferredTtsModel,
      preferredSttModel: user.preferredSttModel,
      showAgentUsageStatus: user.showAgentUsageStatus,
    });
  } catch (error: unknown) {
    logger.error('Failed to fetch user', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to fetch user', 500);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult) {
      return errorResponse('Unauthorized', 401);
    }

    const body = await request.json();
    const validation = updateUserSchema.safeParse(body);

    if (!validation.success) {
      return errorResponse(validation.error.issues[0].message, 400);
    }

    const {
      interests,
      customTags,
      voicePreferences,
      preferredAiModel,
      preferredTtsModel,
      preferredSttModel,
      ...data
    } = validation.data;

    // Validate preferredAiModel against registry or dynamic CLI model id support.
    if (preferredAiModel) {
      if (!isValidModelId(preferredAiModel)) {
        return errorResponse(
          `Unknown AI model: "${preferredAiModel}". Check /api/ai-models for available models.`,
          400
        );
      }
    }

    // Derive preferredAiProvider from preferredAiModel
    if (preferredAiModel !== undefined) {
      (data as Record<string, unknown>).preferredAiModel = preferredAiModel;
      (data as Record<string, unknown>).preferredAiProvider = preferredAiModel
        ? (getProviderForModel(preferredAiModel) ?? null)
        : null;
    }

    if (preferredTtsModel !== undefined || preferredSttModel !== undefined) {
      const [autoConfig, infra, currentUser] = await Promise.all([
        getAutoModelConfig(),
        getServerInfra(),
        prisma.user.findUnique({
          where: { id: authResult.userId },
          select: { preferredLanguage: true },
        }),
      ]);
      const language = validation.data.preferredLanguage ?? currentUser?.preferredLanguage ?? null;

      if (preferredTtsModel) {
        const provider = getConfiguredTtsProviderId() ?? autoConfig.model.ttsProvider;
        const meta = getProviderMeta(provider);
        if (!meta.models.some((model) => model.id === preferredTtsModel)) {
          return errorResponse(
            `TTS model "${preferredTtsModel}" is not available on provider "${provider}".`,
            400
          );
        }
        if (language && !supportsLanguage(provider, preferredTtsModel, language)) {
          return errorResponse(
            `TTS model "${preferredTtsModel}" does not support language "${language}".`,
            400
          );
        }
      }

      if (preferredSttModel) {
        const configuredSttProvider = infra.sttProvider ?? '';
        const provider = isValidSttProviderId(configuredSttProvider)
          ? configuredSttProvider
          : autoConfig.model.sttProvider;
        const meta = getSttProviderMeta(provider);
        if (!meta.models.some((model) => model.id === preferredSttModel)) {
          return errorResponse(
            `STT model "${preferredSttModel}" is not available on provider "${provider}".`,
            400
          );
        }
        if (language && !supportsSttLanguage(provider, preferredSttModel, language)) {
          return errorResponse(
            `STT model "${preferredSttModel}" does not support language "${language}".`,
            400
          );
        }
      }

      (data as Record<string, unknown>).preferredTtsModel = preferredTtsModel ?? null;
      (data as Record<string, unknown>).preferredSttModel = preferredSttModel ?? null;
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: authResult.userId },
        data,
        include: {
          voicePreferences: { select: { speaker: true, voiceId: true, sortOrder: true } },
        },
      });

      // Update voice preferences if provided
      if (voicePreferences !== undefined) {
        await tx.userVoicePreference.deleteMany({ where: { userId: authResult.userId } });
        if (voicePreferences.length > 0) {
          await tx.userVoicePreference.createMany({
            data: voicePreferences.map((vp, i) => ({
              userId: authResult.userId,
              speaker: vp.speaker,
              voiceId: vp.voiceId,
              sortOrder: i,
            })),
          });
        }
      }

      // Update interests if provided
      if (interests !== undefined) {
        // Upsert custom tags and collect their IDs
        const customTagIds: string[] = [];
        if (customTags && customTags.length > 0) {
          const parentSlugs = [...new Set(customTags.map((ct) => ct.parentSlug))];
          const parents = await tx.tag.findMany({
            where: { slug: { in: parentSlugs }, parentId: null },
            select: { id: true, slug: true },
          });
          const parentMap = new Map(parents.map((p) => [p.slug, p.id]));

          for (const ct of customTags) {
            const parentId = parentMap.get(ct.parentSlug);
            if (!parentId) {
              throw new Error(`Unknown parent category: ${ct.parentSlug}`);
            }
            const slug = generateTagSlug(ct.name);
            if (!slug) {
              throw new Error(`Invalid custom interest name: ${ct.name}`);
            }
            const tag = await tx.tag.upsert({
              where: { slug },
              create: { name: ct.name, slug, parentId },
              update: {},
            });
            customTagIds.push(tag.id);
          }
        }

        const allTagIds = [...new Set([...interests, ...customTagIds])];

        // Enforce combined limit of 20
        if (allTagIds.length > 20) {
          throw new Error('Maximum 20 interests allowed (predefined + custom combined)');
        }

        // Verify all predefined tag IDs exist and are sub-tags (have a parentId)
        if (interests.length > 0) {
          const existingTags = await tx.tag.findMany({
            where: { id: { in: interests } },
            select: { id: true, parentId: true },
          });
          if (existingTags.length !== interests.length) {
            throw new Error('One or more tag IDs are invalid');
          }
          const topLevelTags = existingTags.filter((t) => !t.parentId);
          if (topLevelTags.length > 0) {
            throw new Error('Only sub-interest tags can be selected, not top-level categories');
          }
        }

        // Delete existing manual interests
        await tx.userInterest.deleteMany({
          where: { userId: authResult.userId, source: { in: ['onboarding', 'manual'] } },
        });

        // Create new interests
        if (allTagIds.length > 0) {
          await tx.userInterest.createMany({
            data: allTagIds.map((tagId) => ({
              userId: authResult.userId,
              tagId,
              source: 'manual',
              weight: 1.0,
            })),
          });
        }
      }

      return user;
    });

    const response = NextResponse.json({
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      image: updatedUser.image,
      createdAt: updatedUser.createdAt.toISOString(),
      voicePreferences: updatedUser.voicePreferences,
      preferredLanguage: updatedUser.preferredLanguage,
      preferredAiModel: updatedUser.preferredAiModel,
      preferredTtsModel: updatedUser.preferredTtsModel,
      preferredSttModel: updatedUser.preferredSttModel,
      showAgentUsageStatus: updatedUser.showAgentUsageStatus,
    });

    // Keep the active profile's appearance cookie in sync so the next load applies
    // it flash-free (the cookie is the only client-readable source the init script
    // sees; it never holds secrets).
    response.cookies.set(THEME_PREFS_COOKIE, serializeThemePrefs(themePrefsFromUser(updatedUser)), {
      sameSite: 'lax',
      path: '/',
      maxAge: ONE_YEAR_SECONDS,
      secure: process.env.NODE_ENV === 'production',
    });
    return response;
  } catch (error: unknown) {
    logger.error('Failed to update user', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to update user', 500);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult) {
      return errorResponse('Unauthorized', 401);
    }

    const body = await request.json();
    const validation = deleteAccountSchema.safeParse(body);
    if (!validation.success) {
      return errorResponse('You must send { "confirm": "DELETE" } to delete your account', 400);
    }

    const userId = authResult.userId;

    // Collect episode IDs and storage keys before deleting
    const episodes = await prisma.episode.findMany({
      where: { userId },
      select: { id: true, audioUrl: true, pdfUrl: true },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });

    // Delete orphaned models (no User FK, won't cascade)
    await Promise.all([prisma.feedback.deleteMany({ where: { userId } })]);

    // Delete user — cascades handle all FK-linked records
    await prisma.user.delete({ where: { id: userId } });

    // R2 storage cleanup — best-effort, doesn't fail the request
    try {
      const deletePromises: Promise<void>[] = [];

      // Delete all files under each episode prefix (segments, audio, PDFs, versions)
      // force: true — account deletion is the one legitimate bulk-delete scenario
      for (const p of episodes) {
        const keys = await listFiles(`episodes/${p.id}/`);
        for (const key of keys) {
          deletePromises.push(deleteFile(key, { force: true }));
        }
      }

      // Delete user avatar
      if (user?.image) {
        deletePromises.push(deleteFile(user.image));
      }

      if (deletePromises.length > 0) {
        await Promise.allSettled(deletePromises);
        logger.info('Account deletion R2 cleanup completed', {
          userId,
          filesAttempted: String(deletePromises.length),
        });
      }
    } catch (storageError) {
      logger.error('Account deletion R2 cleanup failed', {
        userId,
        error: storageError instanceof Error ? storageError.message : 'Unknown error',
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    logger.error('Failed to delete account', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to delete account', 500);
  }
}
