import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type RouteParams = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { token } = await params;

  const invite = await prisma.teamInvite.findUnique({
    where: { token },
    include: {
      team: {
        select: { id: true, name: true, _count: { select: { members: true } } },
      },
    },
  });

  if (!invite) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  }

  if (invite.status !== 'PENDING') {
    return NextResponse.json({ error: `Invite is ${invite.status.toLowerCase()}` }, { status: 400 });
  }

  if (new Date() > invite.expiresAt) {
    await prisma.teamInvite.update({
      where: { id: invite.id },
      data: { status: 'EXPIRED' },
    });
    return NextResponse.json({ error: 'Invite has expired' }, { status: 400 });
  }

  return NextResponse.json({
    teamName: invite.team.name,
    email: invite.email,
    expiresAt: invite.expiresAt.toISOString(),
  });
}

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const invite = await prisma.teamInvite.findUnique({
    where: { token },
    include: {
      team: { select: { id: true, seats: true, _count: { select: { members: true } } } },
    },
  });

  if (!invite) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  }

  if (invite.status !== 'PENDING') {
    return NextResponse.json({ error: `Invite is ${invite.status.toLowerCase()}` }, { status: 400 });
  }

  if (new Date() > invite.expiresAt) {
    await prisma.teamInvite.update({
      where: { id: invite.id },
      data: { status: 'EXPIRED' },
    });
    return NextResponse.json({ error: 'Invite has expired' }, { status: 400 });
  }

  // Verify email matches
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, teamId: true },
  });

  if (!user || user.email !== invite.email) {
    return NextResponse.json({ error: 'Email does not match invite' }, { status: 403 });
  }

  if (user.teamId) {
    return NextResponse.json({ error: 'Already in a team' }, { status: 400 });
  }

  if (invite.team._count.members >= invite.team.seats) {
    return NextResponse.json({ error: 'Team is at capacity' }, { status: 400 });
  }

  // Accept invite
  await Promise.all([
    prisma.teamInvite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED' },
    }),
    prisma.user.update({
      where: { id: session.user.id },
      data: { teamId: invite.teamId },
    }),
  ]);

  return NextResponse.json({ success: true, teamId: invite.teamId });
}
