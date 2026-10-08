import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { sottoRequestExecution } from '@/lib/sidedoor/credentials/runtime/provider-execution';
import {
  readPreparationActivity,
  recoverClassPreparation,
  requestClassPreparation,
} from '@/lib/classes/preparation';
import { PreparationConflictError } from '@/lib/classes/preparation-state';
import {
  ProviderCreditsExhaustedError,
  speechCreditsMessage,
} from '@/lib/providers/shared/speech-availability';

export const runtime = 'nodejs';

const scheduledPreparation = z
  .object({
    availableAt: z.iso.datetime({ offset: true }),
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      }, 'Choose a valid time zone.'),
    maxProviderRequests: z.number().int().min(1).max(256),
    deferAudio: z.literal(true),
  })
  .strict();

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const actor = await authenticateRequest(request);
  if (!actor) return errorResponse('Unauthorized', 401);
  const { courseId } = await params;
  const page = z
    .object({
      after: z.coerce.number().int().min(0).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    })
    .safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!page.success) return errorResponse(page.error.flatten(), 400);
  try {
    const activity = await readPreparationActivity(
      courseId,
      sottoRequestExecution(request, actor),
      page.data
    );
    if (!activity) return errorResponse('Preparation not found', 404);
    return NextResponse.json(activity);
  } catch (error) {
    if (error instanceof PreparationConflictError) return errorResponse(error.message, 409);
    return errorResponse('Could not read preparation activity.', 500);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const actor = await authenticateRequest(request);
  if (!actor) return errorResponse('Unauthorized', 401);
  const parsed = z
    .object({ acknowledgeUnknownOutcome: z.literal(true) })
    .strict()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);
  const { courseId } = await params;
  try {
    const operation = await recoverClassPreparation(
      courseId,
      sottoRequestExecution(request, actor),
      parsed.data
    );
    return NextResponse.json({ operationId: operation.id, status: operation.status });
  } catch (error) {
    if (error instanceof PreparationConflictError) return errorResponse(error.message, 409);
    return errorResponse('Could not recover preparation.', 500);
  }
}

/** Scheduling is explicit and bounded. Audio requires a subsequent learner action. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> }
) {
  const actor = await authenticateRequest(request);
  if (!actor) return errorResponse('Unauthorized', 401);
  const { courseId } = await params;
  const course = await prisma.course.findFirst({
    where: { id: courseId, userId: actor.userId },
    select: { id: true },
  });
  if (!course) return errorResponse('Course not found', 404);
  const parsed = scheduledPreparation.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.flatten(), 400);
  try {
    const operation = await requestClassPreparation(
      courseId,
      sottoRequestExecution(request, actor),
      {
        ...parsed.data,
        availableAt: Date.parse(parsed.data.availableAt),
      }
    );
    return NextResponse.json(
      {
        operationId: operation.id,
        status: operation.status,
        availableAt: new Date(operation.availableAt).toISOString(),
        timeZone: operation.timeZone,
        maxProviderRequests: operation.maxProviderRequests,
        deferAudio: operation.deferAudio,
      },
      { status: 202 }
    );
  } catch (error) {
    if (error instanceof PreparationConflictError) return errorResponse(error.message, 409);
    if (error instanceof ProviderCreditsExhaustedError)
      return errorResponse(speechCreditsMessage(error), 402, { code: error.code });
    return errorResponse('Could not schedule class preparation.', 500);
  }
}
