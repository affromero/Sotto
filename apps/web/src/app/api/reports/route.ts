import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createReportSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/redis';

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit: 10 reports per hour
  const rateLimit = await checkRateLimit(`report:${session.user.id}`, 10, 3600);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many reports. Please try again later.' },
      { status: 429 }
    );
  }

  const body = await request.json();
  const parsed = createReportSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { targetType, targetId, reason, description } = parsed.data;

  // Cannot report yourself
  if (targetType === 'user' && targetId === session.user.id) {
    return NextResponse.json({ error: 'Cannot report yourself' }, { status: 400 });
  }

  // Verify target exists
  if (targetType === 'podcast') {
    const podcast = await prisma.podcast.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!podcast) return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  } else if (targetType === 'comment') {
    const comment = await prisma.comment.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  } else if (targetType === 'user') {
    const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const HIGH_PRIORITY_REASONS = ['FALSE_HUMAN_BADGE', 'MUSIC_UPLOAD', 'VOICE_THEFT'];

  try {
    const report = await prisma.report.create({
      data: {
        reporterId: session.user.id,
        targetType,
        targetId,
        reason,
        description: description ?? null,
        ...(HIGH_PRIORITY_REASONS.includes(reason) && { status: 'REVIEWING' }),
      },
    });

    return NextResponse.json({ id: report.id, status: report.status }, { status: 201 });
  } catch (err) {
    // Unique constraint violation — user already reported this target
    if ((err as { code?: string }).code === 'P2002') {
      return NextResponse.json(
        { error: 'You have already reported this content.' },
        { status: 409 }
      );
    }
    throw err;
  }
}
