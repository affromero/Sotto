import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { errorResponse } from '@/lib/api-response';
import { addJob, JobType, demoVoiceoverQueue } from '@/lib/queue';

interface Params {
  params: Promise<{ projectId: string; sceneId: string }>;
}

/** POST — Queue voiceover for one scene */
export async function POST(_request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId, sceneId } = await params;

  const job = await addJob(
    demoVoiceoverQueue,
    JobType.GENERATE_DEMO_VOICEOVER,
    { projectId, sceneId },
    { jobId: `demo-voiceover-${sceneId}-${Date.now()}` },
  );

  return NextResponse.json({ status: 'queued', jobId: job.id });
}
