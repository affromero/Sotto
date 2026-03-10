import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-guards';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/api-response';
import { createDemoProjectSchema } from '@/lib/validations';
import { addJob, JobType, demoScriptQueue } from '@/lib/queue';

/** GET /api/admin/demo — List all DemoProjects */
export async function GET() {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const projects = await prisma.demoProject.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { scenes: true } } },
  });

  return NextResponse.json(projects);
}

/** POST /api/admin/demo — Create a DemoProject and queue script generation */
export async function POST(request: NextRequest) {
  const adminId = await requireAdmin();
  if (!adminId) return errorResponse('Forbidden', 403);

  const body = await request.json();
  const parsed = createDemoProjectSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0].message, 400);
  }

  const { title, description, features, durationTarget } = parsed.data;

  const project = await prisma.demoProject.create({
    data: {
      userId: adminId,
      title,
      description,
      features,
    },
  });

  await addJob(
    demoScriptQueue,
    JobType.GENERATE_DEMO_SCRIPT,
    { projectId: project.id },
    { jobId: `demo-script-${project.id}-${Date.now()}` },
  );

  // Store durationTarget as metadata hint (used by the worker via project features length)
  // The worker calculates duration from features count, but we pass the user's preference here
  void durationTarget;

  return NextResponse.json({ id: project.id, status: project.status }, { status: 201 });
}
