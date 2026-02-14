import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { teamInviteSchema } from '@/lib/validations';

type RouteParams = { params: Promise<{ teamId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { ownerId: true },
  });

  if (!team || team.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const invites = await prisma.teamInvite.findMany({
    where: { teamId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ invites });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { _count: { select: { members: true } } },
  });

  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  if (team.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Only the team owner can invite members' }, { status: 403 });
  }

  if (team._count.members >= team.seats) {
    return NextResponse.json({ error: 'Team is at capacity' }, { status: 400 });
  }

  const body = await request.json();
  const parsed = teamInviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Check if already a member
  const existingMember = await prisma.user.findFirst({
    where: { email: parsed.data.email, teamId },
  });
  if (existingMember) {
    return NextResponse.json({ error: 'User is already a team member' }, { status: 400 });
  }

  // Check for existing pending invite
  const existingInvite = await prisma.teamInvite.findFirst({
    where: { teamId, email: parsed.data.email, status: 'PENDING' },
  });
  if (existingInvite) {
    return NextResponse.json({ error: 'Invite already pending for this email' }, { status: 400 });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invite = await prisma.teamInvite.create({
    data: {
      teamId,
      email: parsed.data.email,
      token,
      invitedBy: session.user.id,
      expiresAt,
    },
  });

  return NextResponse.json(invite, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { teamId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { ownerId: true },
  });

  if (!team || team.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { inviteId } = await request.json();
  if (!inviteId) {
    return NextResponse.json({ error: 'inviteId is required' }, { status: 400 });
  }

  await prisma.teamInvite.update({
    where: { id: inviteId },
    data: { status: 'REVOKED' },
  });

  return new NextResponse(null, { status: 204 });
}
