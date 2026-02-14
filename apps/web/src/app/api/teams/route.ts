import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createTeamSchema } from '@/lib/validations';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { teamId: true },
  });

  if (!user?.teamId) {
    return NextResponse.json({ team: null });
  }

  const team = await prisma.team.findUnique({
    where: { id: user.teamId },
    include: {
      owner: { select: { id: true, name: true, email: true, image: true } },
      members: { select: { id: true, name: true, email: true, image: true, createdAt: true } },
      invites: {
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      },
      _count: { select: { members: true } },
    },
  });

  return NextResponse.json({ team });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check not already in a team
  const existingUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { teamId: true },
  });

  if (existingUser?.teamId) {
    return NextResponse.json({ error: 'Already in a team' }, { status: 400 });
  }

  const body = await request.json();
  const parsed = createTeamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const team = await prisma.team.create({
    data: {
      name: parsed.data.name,
      ownerId: session.user.id,
      members: { connect: { id: session.user.id } },
    },
  });

  return NextResponse.json(team, { status: 201 });
}
