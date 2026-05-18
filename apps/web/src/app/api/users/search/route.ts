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

  const handle = (request.nextUrl.searchParams.get('handle') ?? '').trim().replace(/^@/, '');
  const parsed = userSearchSchema.safeParse({ handle });
  if (!parsed.success) {
    return errorResponse(parsed.error.errors[0].message, 400);
  }

  const user = await prisma.user.findUnique({
    where: { handle: parsed.data.handle },
    select: {
      id: true,
      handle: true,
    },
  });

  if (!user || user.id === session.user.id) {
    return NextResponse.json([]);
  }

  return NextResponse.json([user]);
}
