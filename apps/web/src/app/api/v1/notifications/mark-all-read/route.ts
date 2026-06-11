import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return errorResponse('Unauthorized', 401);
  }

  const result = await prisma.notification.updateMany({
    where: {
      userId: authed.userId,
      read: false,
    },
    data: { read: true },
  });

  return NextResponse.json({ success: true, count: result.count });
}
