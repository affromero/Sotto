import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { isHandleAvailable } from '@/lib/handles';
import { handleSchema, customTagSchema, deleteAccountSchema } from '@/lib/validations';
import { generateTagSlug } from '@/lib/slugify';
import { deleteFile, listFiles } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { getProviderForModel } from '@/lib/providers/ai-registry';
import { errorResponse } from '@/lib/api-response';
import { z } from 'zod';

const updateUserSchema = z
  .object({
    name: z
      .string()
      .transform((val) => val.trim())
      .pipe(z.string().min(1).max(100))
      .optional(),
    bio: z.string().max(500).optional(),
    image: z.string().url().optional(),
    handle: handleSchema.optional(),
    voicePreferences: z.array(z.object({
      speaker: z.string().min(1).max(50),
      voiceId: z.string().min(1),
    })).optional(),
    preferredLanguage: z.string().max(5).nullable().optional(),
    preferredAiModel: z.string().nullable().optional(),
    emailNotifications: z.boolean().optional(),
    pushNotifications: z.boolean().optional(),
    interests: z.array(z.string()).max(20).optional(),
    customTags: z.array(customTagSchema).max(10).optional(),
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

    const [podcastCount, followerCount, followingCount] = await Promise.all([
      prisma.podcast.count({ where: { userId: authResult.userId } }),
      prisma.follow.count({ where: { followingId: authResult.userId } }),
      prisma.follow.count({ where: { followerId: authResult.userId } }),
    ]);

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      handle: user.handle,
      image: user.image,
      bio: user.bio,
      podcastCount,
      followerCount,
      followingCount,
      createdAt: user.createdAt.toISOString(),
      twitterHandle: user.twitterHandle,
      twitterEnabled: user.twitterEnabled,
      voicePreferences: user.voicePreferences,
      preferredLanguage: user.preferredLanguage,
      preferredAiModel: user.preferredAiModel,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch user';
    return errorResponse(message, 500);
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
      return errorResponse(validation.error.errors[0].message, 400);
    }

    const { interests, customTags, handle, voicePreferences, preferredAiModel, ...data } = validation.data;

    // Derive preferredAiProvider from preferredAiModel
    if (preferredAiModel !== undefined) {
      (data as Record<string, unknown>).preferredAiModel = preferredAiModel;
      (data as Record<string, unknown>).preferredAiProvider = preferredAiModel
        ? (getProviderForModel(preferredAiModel) ?? null)
        : null;
    }

    // Validate handle availability if changing it
    if (handle !== undefined) {
      const currentUser = await prisma.user.findUnique({
        where: { id: authResult.userId },
        select: { handle: true },
      });
      if (currentUser?.handle !== handle) {
        const availability = await isHandleAvailable(handle);
        if (!availability.available) {
          return errorResponse(availability.reason || 'Handle is not available', 409);
        }
      }
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      // Update user profile fields (including handle if provided)
      const updateData = handle !== undefined ? { ...data, handle } : data;
      const user = await tx.user.update({
        where: { id: authResult.userId },
        data: updateData,
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

    return NextResponse.json({
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      handle: updatedUser.handle,
      image: updatedUser.image,
      bio: updatedUser.bio,
      createdAt: updatedUser.createdAt.toISOString(),
      twitterHandle: updatedUser.twitterHandle,
      twitterEnabled: updatedUser.twitterEnabled,
      voicePreferences: updatedUser.voicePreferences,
      preferredLanguage: updatedUser.preferredLanguage,
      preferredAiModel: updatedUser.preferredAiModel,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update user';
    return errorResponse(message, 500);
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

    // Collect podcast IDs and storage keys before deleting
    const podcasts = await prisma.podcast.findMany({
      where: { userId },
      select: { id: true, audioUrl: true, pdfUrl: true, importedAudioKey: true },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });

    // Delete orphaned models (no User FK, won't cascade)
    await Promise.all([
      prisma.behavioralEvent.deleteMany({ where: { userId } }),
      prisma.userSession.deleteMany({ where: { userId } }),
      prisma.playbackSession.deleteMany({ where: { userId } }),
      prisma.recommendationLog.deleteMany({ where: { userId } }),
      prisma.userFeature.deleteMany({ where: { userId } }),
      prisma.contentFlag.deleteMany({ where: { userId } }),
      prisma.feedback.deleteMany({ where: { userId } }),
      prisma.listeningQueue.deleteMany({ where: { userId } }),
    ]);

    // Delete user — cascades handle all FK-linked records
    await prisma.user.delete({ where: { id: userId } });

    // R2 storage cleanup — best-effort, doesn't fail the request
    try {
      const deletePromises: Promise<void>[] = [];

      // Delete all files under each podcast prefix (segments, audio, PDFs, versions)
      for (const p of podcasts) {
        const keys = await listFiles(`podcasts/${p.id}/`);
        for (const key of keys) {
          deletePromises.push(deleteFile(key));
        }
        if (p.importedAudioKey) {
          deletePromises.push(deleteFile(p.importedAudioKey));
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
    const message = error instanceof Error ? error.message : 'Failed to delete account';
    return errorResponse(message, 500);
  }
}
