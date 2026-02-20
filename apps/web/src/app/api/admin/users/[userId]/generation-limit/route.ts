import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const updateLimitSchema = z.object({
  dailyGenerationOverride: z.number().int().min(0).nullable(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userRole = (session.user as Record<string, unknown>)?.role as string;

  if (userRole !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId } = await context.params;

  try {
    const body = await request.json();
    const { dailyGenerationOverride } = updateLimitSchema.parse(body);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { dailyGenerationOverride },
      select: {
        id: true,
        name: true,
        email: true,
        dailyGenerationOverride: true,
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json({ error: 'Failed to update generation limit' }, { status: 500 });
  }
}
