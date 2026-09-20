import { NextRequest, NextResponse } from 'next/server';
import { isAccessError } from 'thesidedoor-core/access';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { isUserAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { checkSottoStorage } from '@/lib/sidedoor/storage/core/storage-probe';
import { prismaUnfiltered } from '@/lib/prisma';

export const runtime = 'nodejs';

const checkStorageSchema = z
  .object({
    provider: z.enum(['local', 'r2', 's3']),
    localStorageRoot: z.string().trim().max(1024).nullable().optional(),
    endpoint: z.string().trim().url().max(2048).nullable().optional(),
    bucket: z.string().trim().max(128).nullable().optional(),
    region: z.string().trim().max(64).nullable().optional(),
    publicUrl: z.string().trim().url().max(2048).nullable().optional(),
    accessKeyId: z.string().trim().max(512).nullable().optional(),
    secretAccessKey: z.string().trim().max(2048).nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.provider === 'local') return;
    for (const field of ['endpoint', 'bucket', 'region', 'accessKeyId', 'secretAccessKey'] as const)
      if (!value[field])
        context.addIssue({ code: 'custom', path: [field], message: `${field} is required` });
  });

export async function POST(request: NextRequest) {
  const authed = await authenticateRequest(request);
  if (!authed) return errorResponse('Unauthorized', 401);
  const isOwner = await isUserAdmin(authed);
  if (!isOwner) return errorResponse('Forbidden', 403);

  const parsed = checkStorageSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);

  try {
    await checkSottoStorage({
      database: prismaUnfiltered,
      request,
      admission: authed,
      selection: parsed.data,
    });
    return NextResponse.json({
      ok: true,
      provider: parsed.data.provider,
      detail: `${parsed.data.provider} storage can write and delete files.`,
    });
  } catch (error) {
    const primary: unknown = error instanceof AggregateError ? error.errors[0] : error;
    if (isAccessError(primary))
      return errorResponse(
        primary.message,
        primary.code === 'unauthorized' ? 401 : primary.code === 'forbidden' ? 403 : 409
      );
    if (request.signal.aborted) return errorResponse('Storage check cancelled', 499);
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
