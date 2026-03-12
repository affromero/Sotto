import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { deleteFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return errorResponse('Unauthorized', 401);
    }

    const { id } = await params;

    const image = await prisma.avatarImage.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!image) {
      return errorResponse('Avatar image not found', 404);
    }

    await deleteFile(image.imageUrl, { force: true });

    await prisma.avatarImage.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    logger.error('Failed to delete avatar image', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse('Failed to delete avatar image', 500);
  }
}
