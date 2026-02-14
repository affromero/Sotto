import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { userSearchSchema } from '@/lib/validations';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const handle = request.nextUrl.searchParams.get('handle') ?? '';
  const parsed = userSearchSchema.safeParse({ handle });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 });
  }

  const users = await prisma.user.findMany({
    where: {
      handle: { contains: parsed.data.handle, mode: 'insensitive' },
      id: { not: session.user.id },
    },
    select: {
      id: true,
      handle: true,
      name: true,
      image: true,
    },
    take: 10,
    orderBy: { handle: 'asc' },
  });

  return NextResponse.json(users);
}
