import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { userSearchSchema } from '@/lib/validations';

import { errorResponse } from '@/lib/api-response';
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return errorResponse('Unauthorized', 401);
  }

  const handle = request.nextUrl.searchParams.get('handle') ?? '';
  const parsed = userSearchSchema.safeParse({ handle });
  if (!parsed.success) {
    return errorResponse(parsed.error.errors[0].message, 400);
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
