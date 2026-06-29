import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { isUserAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { createStorageProvider } from '@/lib/providers/storage';

export const runtime = 'nodejs';

const checkStorageSchema = z.object({
  provider: z.enum(['local', 'r2', 's3']),
  s3Bucket: z.string().trim().max(128).nullable().optional(),
  s3Region: z.string().trim().max(64).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);
  const isOwner = await isUserAdmin(authed.userId);
  if (!isOwner) return errorResponse('Forbidden', 403);

  const parsed = checkStorageSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);

  const key = `__sotto-check/${randomUUID()}.txt`;
  try {
    const storage = createStorageProvider(parsed.data.provider, {
      s3Bucket: parsed.data.s3Bucket,
      s3Region: parsed.data.s3Region,
    });
    await storage.uploadFile(key, Buffer.from('ok'), 'text/plain');
    await storage.deleteFile(key);
    return NextResponse.json({
      ok: true,
      provider: parsed.data.provider,
      detail: `${parsed.data.provider} storage can write and delete files.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        provider: parsed.data.provider,
        detail: error instanceof Error ? error.message : 'Storage check failed.',
      },
      { status: 422 }
    );
  }
}
