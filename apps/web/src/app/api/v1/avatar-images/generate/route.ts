import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';
import { avatarImageGenerateSchema } from '@/lib/validations';
import { resolveImageProvider } from '@/lib/providers/image';

const MAX_IMAGES = 10;

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    // Admin-only gate
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      select: { role: true },
    });

    if (user.role !== 'ADMIN') {
      return errorResponse('Avatar generation is admin-only', 403);
    }

    const body = await request.json();
    const parsed = avatarImageGenerateSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse('Invalid request', 400);
    }

    const count = await prisma.avatarImage.count({ where: { userId: session.user.id } });
    if (count >= MAX_IMAGES) {
      return errorResponse(`Avatar image limit reached (${MAX_IMAGES})`, 409);
    }

    const { provider } = await resolveImageProvider({ userId: session.user.id });
    const buffer = await provider.generateImage({
      prompt: parsed.data.prompt,
      width: 512,
      height: 512,
    });

    const timestamp = Date.now();
    const key = `avatar-images/${session.user.id}/${timestamp}.png`;
    const imageUrl = await uploadFile(key, buffer, 'image/png');

    const image = await prisma.avatarImage.create({
      data: {
        userId: session.user.id,
        name: parsed.data.name,
        imageUrl,
        sourceType: 'GENERATED',
        prompt: parsed.data.prompt,
      },
    });

    return NextResponse.json({ id: image.id, imageUrl: image.imageUrl });
  } catch (error: unknown) {
    logger.error('Failed to generate avatar image', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to generate avatar image', 500);
  }
}
