import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateTeamSchema } from '@/lib/validations';

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
      owner: { select: { id: true, name: true, email: true, image: true } },
      members: { select: { id: true, name: true, email: true, image: true } },
      _count: { select: { members: true } },
    },
  });

  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  // Must be a member
  const isMember = team.members.some((m) => m.id === session.user!.id);
  if (!isMember) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  }

  return NextResponse.json(team);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { ownerId: true },
  });

  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  if (team.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Only the team owner can update the team' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updateTeamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.team.update({
    where: { id: teamId },
    data: parsed.data,
  });

  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { ownerId: true },
  });

  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  if (team.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Only the team owner can delete the team' }, { status: 403 });
  }

  // Remove all members from team
  await prisma.user.updateMany({
    where: { teamId },
    data: { teamId: null },
  });

  await prisma.team.delete({ where: { id: teamId } });

  return new NextResponse(null, { status: 204 });
}
