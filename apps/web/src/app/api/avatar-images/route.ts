import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';
import { avatarImageUploadSchema } from '@/lib/validations';
import { getPlanFeatureConfig } from '@/lib/plan-feature-config';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGES = 10;

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const [user, config, images, sharedRecords] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { referralVerified: true, role: true },
      }),
      getPlanFeatureConfig(),
      prisma.avatarImage.findMany({
        where: { userId: session.user.id },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.avatarImageShare.findMany({
        where: { requesterId: session.user.id, status: 'APPROVED' },
        include: {
          avatarImage: true,
          imageOwner: { select: { id: true, name: true, handle: true, image: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const isAdmin = user.role === 'ADMIN';
    const isVerified = user.referralVerified;

    const shared = sharedRecords.map((s) => ({
      shareId: s.id,
      image: s.avatarImage,
      owner: s.imageOwner,
    }));

    const capabilities = {
      canUpload: isAdmin || (isVerified && config.avatarUploadsEnabled),
      canGenerate: isAdmin && config.avatarGenerationEnabled,
      isVerified,
      uploadsEnabled: config.avatarUploadsEnabled,
    };

    return NextResponse.json({ images, shared, capabilities });
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

    const [user, config] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: session.user.id },
        select: { referralVerified: true, role: true },
      }),
      getPlanFeatureConfig(),
    ]);

    const isAdmin = user.role === 'ADMIN';

    // Feature flag gate
    if (!isAdmin && !config.avatarUploadsEnabled) {
      return errorResponse('Avatar uploads are currently disabled', 503);
    }

    // Verification gate
    if (!isAdmin && !user.referralVerified) {
      return errorResponse('You must be verified to upload avatar images', 403);
    }

    const count = await prisma.avatarImage.count({ where: { userId: session.user.id } });
    if (count >= MAX_IMAGES) {
      return errorResponse(`Avatar image limit reached (${MAX_IMAGES})`, 409);
    }

    const formData = await request.formData();
    const file = formData.get('image') as File | null;
    const nameRaw = formData.get('name') as string | null;
    const consentRaw = formData.get('consentAcknowledged') as string | null;

    const parsed = avatarImageUploadSchema.safeParse({ name: nameRaw, consentAcknowledged: consentRaw });
    if (!parsed.success) {
      return errorResponse('Invalid request. Consent acknowledgment is required.', 400);
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
        consentAcknowledgedAt: new Date(),
      },
    });

    return NextResponse.json({ id: image.id, imageUrl: image.imageUrl });
  } catch (error: unknown) {
    logger.error('Failed to upload avatar image', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to upload avatar image', 500);
  }
}
