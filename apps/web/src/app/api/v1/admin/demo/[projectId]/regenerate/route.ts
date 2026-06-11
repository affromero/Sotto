import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { addJob, JobType, demoScriptQueue } from '@/lib/queue';

interface Params {
  params: Promise<{ projectId: string }>;
}

/** POST /api/admin/demo/[projectId]/regenerate — Regenerate walkthrough script */
export async function POST(_request: NextRequest, { params }: Params) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const { projectId } = await params;

  const project = await prisma.demoProject.findUnique({ where: { id: projectId } });
  if (!project) return errorResponse('Project not found', 404);

  // Reset project status — scenes will be deleted by the worker before recreating
  await prisma.demoProject.update({
    where: { id: projectId },
    data: { status: 'DRAFT', failedReason: null },
  });

  await addJob(
    demoScriptQueue,
    JobType.GENERATE_DEMO_SCRIPT,
    { projectId },
    { jobId: `demo-script-${projectId}-${Date.now()}` },
  );

  return NextResponse.json({ status: 'queued' });
}
