import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { addJob, JobType, demoTransitionQueue } from '@/lib/queue';

interface Params {
  params: Promise<{ projectId: string; sceneId: string }>;
}

/** POST — Queue transition generation for one scene */
export async function POST(_request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId, sceneId } = await params;

  await addJob(
    demoTransitionQueue,
    JobType.GENERATE_DEMO_TRANSITION,
    { projectId, sceneId },
    { jobId: `demo-transition-${sceneId}-${Date.now()}` },
  );

  return NextResponse.json({ status: 'queued' });
}
