import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
