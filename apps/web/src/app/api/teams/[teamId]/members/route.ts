import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type RouteParams = { params: Promise<{ teamId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      members: {
        select: { id: true, name: true, email: true, image: true, createdAt: true },
      },
    },
  });

  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  const isMember = team.members.some((m) => m.id === session.user!.id);
  if (!isMember) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  }

  return NextResponse.json({ members: team.members });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { userId } = await request.json();
  if (!userId || typeof userId !== 'string') {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { ownerId: true },
  });

  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  // Only owner can remove members, or member can remove themselves
  if (team.ownerId !== session.user.id && userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Cannot remove the owner
  if (userId === team.ownerId) {
    return NextResponse.json({ error: 'Cannot remove the team owner' }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: userId },
    data: { teamId: null },
  });

  return new NextResponse(null, { status: 204 });
}
