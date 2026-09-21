import { NextRequest, NextResponse } from 'next/server';
import { AccessError } from 'thesidedoor-core/access';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';
import { authenticateRequest } from '@/lib/api-keys';
import { prismaUnfiltered } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { isBundledAvatarImage } from '@/lib/avatars';
import { accessOperation } from '@/lib/sidedoor/access/core/http';
import { writeProfileStorageReference } from '@/lib/sidedoor/storage/core/storage-write';

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function POST(request: NextRequest) {
  return accessOperation(request, !request.headers.has('authorization'), async () => {
    const authed = await authenticateRequest(request);
    if (!authed) {
      return errorResponse('Unauthorized', 401);
    }
    const userId = authed.userId;

    let bytes: Uint8Array;
    try {
      bytes = await readRequestBytes(request, MAX_FILE_SIZE + 64 * 1024);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError)
        return errorResponse('Upload request is too large', 413);
      throw error;
    }
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    let formData: FormData;
    try {
      formData = await new Request(request.url, {
        method: 'POST',
        headers,
        body: Uint8Array.from(bytes).buffer,
        signal: request.signal,
      }).formData();
    } catch {
      return errorResponse('Invalid multipart upload', 400);
    }
    const file = formData.get('avatar');

    if (!(file instanceof File)) {
      return errorResponse('No file provided', 400);
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return errorResponse('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.', 400);
    }

    if (file.size > MAX_FILE_SIZE) {
      return errorResponse('File too large. Maximum size is 2MB.', 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const url = await writeProfileStorageReference<{ image: string | null }>({
      database: prismaUnfiltered,
      request,
      admission: authed,
      prefix: `avatars/${userId}`,
      extension: file.type.split('/')[1]!,
      body: buffer,
      contentType: file.type,
      referenceSlot: 'avatar',
      previousReference: (previous) =>
        previous.image && !isBundledAvatarImage(previous.image) ? previous.image : null,
      inspect: (database) =>
        database.user.findUniqueOrThrow({
          where: { id: userId },
          select: { image: true },
        }),
      commit: async (database, image, previous) => {
        const changed = await database.user.updateMany({
          where: { id: userId, image: previous.image },
          data: { image },
        });
        if (changed.count !== 1)
          throw new AccessError('conflict', 'The avatar changed during this upload');
      },
    });

    return NextResponse.json({ url });
  });
}
