import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { isR2MonitoringConfigured } from '@/lib/cloudflare-r2-usage';
import { addJob, r2UsageQueue, JobType } from '@/lib/queue';

export async function POST() {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  if (!isR2MonitoringConfigured()) {
    return errorResponse('R2 monitoring not configured', 400);
  }

  await addJob(r2UsageQueue, JobType.COLLECT_R2_USAGE, {});

  return NextResponse.json({ queued: true });
}
