import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma } from '@/lib/prisma';
import { uploadFile, deleteFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function POST(request: NextRequest) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) {
      return errorResponse('Unauthorized', 401);
    }
    const userId = authed.userId;

    const formData = await request.formData();
    const file = formData.get('avatar') as File | null;

    if (!file) {
      return errorResponse('No file provided', 400);
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return errorResponse('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.', 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return errorResponse('File too large. Maximum size is 2MB.', 400);
    }

    // Delete old avatar from R2 if one exists
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { image: true },
    });
    if (currentUser?.image) {
      deleteFile(currentUser.image).catch((err) => {
        logger.warn('Failed to delete old avatar from R2', {
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const extension = file.type.split('/')[1];
    const timestamp = Date.now();
    const key = `avatars/${userId}/${timestamp}.${extension}`;

    const url = await uploadFile(key, buffer, file.type);

    await prisma.user.update({
      where: { id: userId },
      data: { image: url },
    });

    return NextResponse.json({ url });
  } catch (error: unknown) {
    logger.error('Failed to upload avatar', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to upload avatar', 500);
  }
}
