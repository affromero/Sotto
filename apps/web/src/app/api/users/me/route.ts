import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isHandleAvailable } from '@/lib/handles';
import { handleSchema } from '@/lib/validations';
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
    interests: z.array(z.string()).max(20).optional(),
  })
  .strict();

export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      handle: user.handle,
      image: user.image,
      bio: user.bio,
      createdAt: user.createdAt.toISOString(),
      twitterHandle: user.twitterHandle,
      twitterEnabled: user.twitterEnabled,
      preferredHostVoiceId: user.preferredHostVoiceId,
      preferredExpertVoiceId: user.preferredExpertVoiceId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch user';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validation = updateUserSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: validation.error.errors[0].message }, { status: 400 });
    }

    const { interests, handle, ...data } = validation.data;

    // Validate handle availability if changing it
    if (handle !== undefined) {
      const currentUser = await prisma.user.findUnique({
        where: { id: session.user.id },
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
        where: { id: session.user.id },
        data: updateData,
      });

      // Update interests if provided
      if (interests !== undefined) {
        // Verify all tag IDs exist
        if (interests.length > 0) {
          const existingTags = await tx.tag.findMany({
            where: { id: { in: interests } },
            select: { id: true },
          });
          if (existingTags.length !== interests.length) {
            throw new Error('One or more tag IDs are invalid');
          }
        }

        // Delete existing manual interests
        await tx.userInterest.deleteMany({
          where: { userId: session.user.id, source: { in: ['onboarding', 'manual'] } },
        });

        // Create new interests
        if (interests.length > 0) {
          await tx.userInterest.createMany({
            data: interests.map((tagId) => ({
              userId: session.user.id,
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
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update user';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
