import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';
import { validateDisplayName } from '@/lib/name-validation';
import { moderateDisplayName } from '@/lib/name-moderation';

const nameSchema = z.object({
  name: z
    .string()
    .transform((val) => val.trim())
    .pipe(z.string().min(1, 'Name is required').max(100)),
});

/**
 * POST /api/onboarding/name
 * Set the user's display name during onboarding.
 */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const body = await request.json();
    const validation = nameSchema.safeParse(body);
    if (!validation.success) {
      return errorResponse(validation.error.errors[0].message, 400);
    }

    const { name } = validation.data;

    // Gibberish / format check
    const formatCheck = validateDisplayName(name);
    if (!formatCheck.valid) {
      return errorResponse(formatCheck.reason!, 400);
    }

    // LLM-based obscenity check
    const moderationCheck = await moderateDisplayName(name);
    if (!moderationCheck.valid) {
      return errorResponse(moderationCheck.reason!, 400);
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { name },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    logger.error('Failed to set onboarding name', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to set name', 500);
  }
}
