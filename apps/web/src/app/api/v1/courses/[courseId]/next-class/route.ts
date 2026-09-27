import { setTimeout as delay } from 'node:timers/promises';
import { NextRequest, NextResponse } from 'next/server';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { sourcedClassSchema } from '@/lib/validations';
import { readClassPreparation, requestClassPreparation } from '@/lib/classes/preparation';
import { PreparationConflictError } from '@/lib/classes/preparation-state';

type RouteParams = { params: Promise<{ courseId: string }> };
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Heavy generation belongs to the worker. Synchronous clients may wait for its durable result. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { courseId } = await params;
    const course = await prisma.course.findFirst({
      where: { id: courseId, userId: authed.userId },
      select: { id: true },
    });
    if (!course) return errorResponse('Course not found', 404);
    const parsed = sourcedClassSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);
    const admitted = await requestClassPreparation(
      courseId,
      sottoRequestExecution(request, authed),
      parsed.data
    );
    const accepted = () =>
      NextResponse.json(
        {
          started: true,
          operationId: admitted.id,
          status: admitted.status,
        },
        { status: 202 }
      );
    if (
      request.nextUrl.searchParams.get('background') === '1' ||
      request.headers.get('prefer')?.toLowerCase().includes('respond-async')
    )
      return accepted();
    const deadline = Date.now() + 270_000;
    while (Date.now() < deadline) {
      const current = await readClassPreparation(courseId, authed.userId);
      if (!current || current.id !== admitted.id) return errorResponse('Preparation changed.', 409);
      if (current.status === 'COMPLETED') {
        if (current.result === 'done') return NextResponse.json({ done: true });
        if (current.result === 'gated')
          return errorResponse('Finish the current class before starting a new one.', 409, {
            activeClassId: current.classId,
          });
        return NextResponse.json({ classId: current.classId }, { status: 201 });
      }
      if (current.status === 'CANCELLED' || current.status === 'CANCELLING')
        return errorResponse('Class preparation was cancelled.', 409, { cancelled: true });
      if (current.status === 'FAILED' && current.failure === 'source_unreadable')
        return errorResponse('The class source could not be read. Try another source.', 422);
      if (current.status === 'FAILED')
        return errorResponse('Class preparation failed. Start a new attempt.', 502);
      if (current.status === 'UNRESOLVED')
        return errorResponse('Class preparation needs execution recovery.', 409);
      await delay(500, undefined, { signal: request.signal });
    }
    return accepted();
  } catch (error) {
    if (error instanceof PreparationConflictError) return errorResponse(error.message, 409);
    return errorResponse('Could not admit or read class preparation.', 500);
  }
}
