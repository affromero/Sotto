import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { onboardingInterestsSchema } from '@/lib/validations';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validation = onboardingInterestsSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: validation.error.errors[0].message }, { status: 400 });
    }

    const { tagIds } = validation.data;
    const userId = session.user.id;

    // Verify all tag IDs exist
    if (tagIds.length > 0) {
      const existingTags = await prisma.tag.findMany({
        where: { id: { in: tagIds } },
        select: { id: true },
      });

      if (existingTags.length !== tagIds.length) {
        return NextResponse.json({ error: 'One or more tag IDs are invalid' }, { status: 400 });
      }
    }

    // Upsert interests and mark onboarding complete in a transaction
    await prisma.$transaction(async (tx) => {
      // Delete existing onboarding interests
      await tx.userInterest.deleteMany({
        where: { userId, source: 'onboarding' },
      });

      // Create new interests
      if (tagIds.length > 0) {
        await tx.userInterest.createMany({
          data: tagIds.map((tagId) => ({
            userId,
            tagId,
            source: 'onboarding',
            weight: 1.0,
          })),
        });
      }

      // Mark onboarding as complete
      await tx.user.update({
        where: { id: userId },
        data: { hasCompletedOnboarding: true },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to save interests';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
