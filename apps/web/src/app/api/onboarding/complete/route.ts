import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';
/**
 * POST /api/onboarding/complete
 * Mark onboarding as complete (used by taste quiz flow).
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { hasCompletedOnboarding: true },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    logger.error('Failed to complete onboarding', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to complete onboarding', 500);
  }
}
