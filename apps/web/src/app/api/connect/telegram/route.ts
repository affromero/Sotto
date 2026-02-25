import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getRedisClient } from '@/lib/redis';
import { sendMessage } from '@/lib/telegram';
import { telegramConnectSchema } from '@/lib/validations';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return errorResponse('Unauthorized', 401);
  }

  const code = request.nextUrl.searchParams.get('code');
  if (!code) {
    return errorResponse('Missing code parameter', 400);
  }

  const redis = getRedisClient();
  const raw = await redis.get(`telegram:link:${code}`);

  if (!raw) {
    return errorResponse('Link code expired or invalid', 404);
  }

  const linkData = JSON.parse(raw) as { telegramUserId: string; chatId: string; firstName: string };

  return NextResponse.json({
    telegramUserId: linkData.telegramUserId,
    firstName: linkData.firstName,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return errorResponse('Unauthorized', 401);
  }

  const body = await request.json();
  const parsed = telegramConnectSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request body', 400);
  }

  const { code } = parsed.data;
  const redis = getRedisClient();
  const raw = await redis.get(`telegram:link:${code}`);

  if (!raw) {
    return errorResponse('Link code expired or invalid', 404);
  }

  const linkData = JSON.parse(raw) as { telegramUserId: string; chatId: string; firstName: string };
  const userId = session.user.id;

  // Check if this Telegram account is already linked to another Sotto user
  const existingAccount = await prisma.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: 'telegram',
        providerAccountId: linkData.telegramUserId,
      },
    },
  });

  if (existingAccount) {
    if (existingAccount.userId === userId) {
      // Already linked to this user — just confirm
      await redis.del(`telegram:link:${code}`);
      return NextResponse.json({ success: true, alreadyLinked: true });
    }
    return errorResponse('This Telegram account is already linked to a different Sotto account', 409);
  }

  // Create Account record + enable Telegram on user
  await prisma.$transaction([
    prisma.account.create({
      data: {
        userId,
        type: 'oauth',
        provider: 'telegram',
        providerAccountId: linkData.telegramUserId,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { telegramEnabled: true, telegramChatId: linkData.chatId },
    }),
  ]);

  // Delete the Redis link code
  await redis.del(`telegram:link:${code}`);

  // Send confirmation to Telegram chat
  try {
    await sendMessage(
      linkData.chatId,
      'Account connected! Send me any topic or URL to save it as a podcast idea.'
    );
  } catch (err) {
    logger.error('Failed to send Telegram confirmation', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('Telegram account linked', {
    userId,
    telegramUserId: linkData.telegramUserId,
  });

  return NextResponse.json({ success: true });
}
