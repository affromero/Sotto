import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';
import { avatarImagePath, isAnimalSlug } from '@/lib/avatars';
import { validateDisplayName } from '@/lib/name-validation';
import { moderateDisplayName } from '@/lib/name-moderation';

const nameSchema = z.object({
  name: z
    .string()
    .transform((val) => val.trim())
    .pipe(z.string().min(1, 'Name is required').max(100)),
  avatarSlug: z.string().refine(isAnimalSlug, 'Unknown avatar').optional(),
});

/**
 * POST /api/onboarding/name
 * Set the user's display name during onboarding.
 */
export async function POST(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) {
      return errorResponse('Unauthorized', 401);
    }
    const userId = authed.userId;

    const body = await request.json();
    const validation = nameSchema.safeParse(body);
    if (!validation.success) {
      return errorResponse(validation.error.issues[0].message, 400);
    }

    const { name, avatarSlug } = validation.data;

    // Gibberish / format check
    const formatCheck = validateDisplayName(name);
    if (!formatCheck.valid) {
      return errorResponse(formatCheck.reason!, 400);
    }

    // Local obscenity / impersonation check
    const moderationCheck = await moderateDisplayName(name);
    if (!moderationCheck.valid) {
      return errorResponse(moderationCheck.reason!, 400);
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        ...(avatarSlug !== undefined && { image: avatarImagePath(avatarSlug) }),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    logger.error('Failed to set onboarding name', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to set name', 500);
  }
}
