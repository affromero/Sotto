import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const updatePlanSchema = z.object({
  plan: z.enum(['FREE', 'PRO']),
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
    const { plan } = updatePlanSchema.parse(body);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { plan },
      select: {
        id: true,
        name: true,
        email: true,
        plan: true,
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

    return NextResponse.json({ error: 'Failed to update user plan' }, { status: 500 });
  }
}
