import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { prismaUnfiltered } from '@/lib/prisma';
import { invalidateServerInfra } from '@/lib/server-config';
import { getSiteConfig } from '@/lib/site-config';
import { resolveSottoRequest } from '@/lib/sidedoor/access/core/request-identity';
import { migrateSottoStorage } from '@/lib/sidedoor/storage/migration/storage-migration';
import { sottoTransaction } from '@/lib/sidedoor/access/state/transaction';

export const runtime = 'nodejs';
export const maxDuration = 300;

const optionalLocation = z.string().trim().max(2048).nullable().optional();
const schema = z
  .object({
    targetProvider: z.enum(['local', 'r2', 's3']),
    localStorageRoot: optionalLocation,
    objectStorageEndpoint: optionalLocation,
    objectStorageBucket: optionalLocation,
    objectStorageRegion: optionalLocation,
    objectStoragePublicUrl: optionalLocation,
    accessKeyId: z.string().trim().max(1024).optional(),
    secretAccessKey: z.string().trim().max(4096).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);
  const admission = await sottoTransaction(prismaUnfiltered, (database) =>
    resolveSottoRequest(database, request)
  );
  if (!admission || admission.kind !== 'content' || !admission.isOwner)
    return errorResponse('Forbidden', 403);
  try {
    const current = await getSiteConfig();
    const target = {
      ...current,
      storageProvider: parsed.data.targetProvider,
      localStorageRoot:
        parsed.data.targetProvider === 'local'
          ? (parsed.data.localStorageRoot ?? '.sotto/storage')
          : null,
      objectStorageEndpoint:
        parsed.data.targetProvider === 'local' ? null : (parsed.data.objectStorageEndpoint ?? null),
      objectStorageBucket:
        parsed.data.targetProvider === 'local' ? null : (parsed.data.objectStorageBucket ?? null),
      objectStorageRegion:
        parsed.data.targetProvider === 'local' ? null : (parsed.data.objectStorageRegion ?? null),
      objectStoragePublicUrl:
        parsed.data.targetProvider === 'local'
          ? null
          : (parsed.data.objectStoragePublicUrl ?? null),
    };
    const hasCredential = parsed.data.accessKeyId || parsed.data.secretAccessKey;
    const result = await migrateSottoStorage({
      database: prismaUnfiltered,
      request,
      admission,
      current,
      target,
      ...(hasCredential
        ? {
            credential: {
              accessKeyId: parsed.data.accessKeyId ?? '',
              secretAccessKey: parsed.data.secretAccessKey ?? '',
            },
          }
        : {}),
      dryRun: parsed.data.dryRun,
    });
    if (result.switched) invalidateServerInfra();
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Storage migration failed', 500);
  }
}
