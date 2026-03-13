import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';
import { avatarImageUploadSchema } from '@/lib/validations';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGES = 10;

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const images = await prisma.avatarImage.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ images });
  } catch (error: unknown) {
    logger.error('Failed to list avatar images', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to list avatar images', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const count = await prisma.avatarImage.count({ where: { userId: session.user.id } });
    if (count >= MAX_IMAGES) {
      return errorResponse(`Avatar image limit reached (${MAX_IMAGES})`, 409);
    }

    const formData = await request.formData();
    const file = formData.get('image') as File | null;
    const nameRaw = formData.get('name') as string | null;

    const parsed = avatarImageUploadSchema.safeParse({ name: nameRaw });
    if (!parsed.success) {
      return errorResponse('Invalid name', 400);
    }

    if (!file) {
      return errorResponse('No image file provided', 400);
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return errorResponse('Invalid file type. Only JPEG, PNG, and WebP are allowed.', 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return errorResponse('File too large. Maximum size is 5MB.', 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const extension = file.type.split('/')[1];
    const timestamp = Date.now();
    const key = `avatar-images/${session.user.id}/${timestamp}.${extension}`;

    const imageUrl = await uploadFile(key, buffer, file.type);

    const image = await prisma.avatarImage.create({
      data: {
        userId: session.user.id,
        name: parsed.data.name,
        imageUrl,
        sourceType: 'UPLOAD',
      },
    });

    return NextResponse.json({ id: image.id, imageUrl: image.imageUrl });
  } catch (error: unknown) {
    logger.error('Failed to upload avatar image', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to upload avatar image', 500);
  }
}
