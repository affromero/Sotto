import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';

import { errorResponse } from '@/lib/api-response';
const registerTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['ios', 'android']),
});

export async function POST(request: NextRequest) {
  const auth = await authenticateRequest(request);
  if (!auth) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const parsed = registerTokenSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.flatten(), 400);
  }

  const { token, platform } = parsed.data;

  await prisma.expoPushToken.upsert({
    where: { token },
    create: {
      userId: auth.userId,
      token,
      platform,
    },
    update: {
      userId: auth.userId,
      platform,
    },
  });

  return NextResponse.json({ success: true });
}
