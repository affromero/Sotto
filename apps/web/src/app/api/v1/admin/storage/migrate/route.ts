import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { migrateStorage } from '@/lib/storage/migration';

export const runtime = 'nodejs';
export const maxDuration = 300;

const storageMigrationSchema = z.object({
  targetProvider: z.enum(['local', 'r2', 's3']),
  s3Bucket: z.string().trim().max(128).nullable().optional(),
  s3Region: z.string().trim().max(64).nullable().optional(),
  dryRun: z.boolean().optional(),
  switchAfter: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const parsed = storageMigrationSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);

  try {
    const result = await migrateStorage({
      ...parsed.data,
      adminId,
      switchAfter: parsed.data.switchAfter ?? true,
    });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Storage migration failed', 500);
  }
}
