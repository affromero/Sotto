import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { isHandleAvailable } from '@/lib/handles';
import { handleSchema, customTagSchema, deleteAccountSchema } from '@/lib/validations';
import { generateTagSlug } from '@/lib/slugify';
import { deleteFile, listFiles } from '@/lib/r2';
import { logger } from '@/lib/logger';
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
    preferredHostVoiceId: z.string().nullable().optional(),
    preferredExpertVoiceId: z.string().nullable().optional(),
    preferredLanguage: z.string().max(5).nullable().optional(),
    interests: z.array(z.string()).max(20).optional(),
    customTags: z.array(customTagSchema).max(10).optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: authResult.userId },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
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
      preferredHostVoiceId: user.preferredHostVoiceId,
      preferredExpertVoiceId: user.preferredExpertVoiceId,
      preferredLanguage: user.preferredLanguage,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch user';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validation = updateUserSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: validation.error.errors[0].message }, { status: 400 });
    }

    const { interests, customTags, handle, ...data } = validation.data;

    // Validate handle availability if changing it
    if (handle !== undefined) {
      const currentUser = await prisma.user.findUnique({
        where: { id: authResult.userId },
        select: { handle: true },
      });
      if (currentUser?.handle !== handle) {
        const availability = await isHandleAvailable(handle);
        if (!availability.available) {
          return NextResponse.json(
            { error: availability.reason || 'Handle is not available' },
            { status: 409 }
          );
        }
      }
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      // Update user profile fields (including handle if provided)
      const updateData = handle !== undefined ? { ...data, handle } : data;
      const user = await tx.user.update({
        where: { id: authResult.userId },
        data: updateData,
      });

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
      preferredHostVoiceId: updatedUser.preferredHostVoiceId,
      preferredExpertVoiceId: updatedUser.preferredExpertVoiceId,
      preferredLanguage: updatedUser.preferredLanguage,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update user';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validation = deleteAccountSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'You must send { "confirm": "DELETE" } to delete your account' },
        { status: 400 }
      );
    }

    const userId = session.user.id;

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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
