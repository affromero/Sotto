import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma, prismaUnfiltered } from '@/lib/prisma';
import { detectAudioFormat, isRecognizedAudio } from '@/lib/audio-format';
import { speakingGradingQueue } from '@/lib/queue';
import { createSpeakingRecording } from '@/lib/sidedoor/storage/publication/speaking-recording-upload';
import { deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';

type RouteParams = { params: Promise<{ sessionId: string; promptId: string }> };

const pollSchema = z.object({ recordingId: z.string().min(1) });

async function ownedSession(sessionId: string, userId: string): Promise<boolean> {
  const session = await prisma.practiceSession.findFirst({
    where: { id: sessionId, course: { userId } },
    select: { id: true },
  });
  return Boolean(session);
}

/**
 * POST /api/practice/[sessionId]/speaking/[promptId]
 * Upload a recorded attempt for a practice speaking prompt; enqueue grading.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { sessionId, promptId } = await params;
    const userId = authed.userId;

    if (!(await ownedSession(sessionId, userId)))
      return errorResponse('Practice session not found', 404);

    const prompt = await prisma.speakingPrompt.findFirst({
      where: { id: promptId, practiceSessionId: sessionId },
      select: { id: true },
    });
    if (!prompt) return errorResponse('Prompt not found', 404);

    const formData = await request.formData();
    const audioFile = formData.get('audio');
    if (!audioFile || typeof audioFile === 'string')
      return errorResponse('Missing audio file', 400);

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    if (buffer.length === 0 || !isRecognizedAudio(buffer)) {
      return errorResponse('Unrecognized or empty audio upload', 400);
    }
    const { ext, mime } = detectAudioFormat(buffer);
    const recording = await createSpeakingRecording({
      request,
      admission: authed,
      promptId,
      parent: { practiceSessionId: sessionId },
      audio: buffer,
      extension: ext,
      contentType: mime,
    });

    await deliverSottoJob({
      database: prismaUnfiltered,
      queue: speakingGradingQueue,
      operationId: recording.operationId,
      fingerprint: recording.fingerprint,
      version: 1,
    });
    logger.info('Practice speaking recording uploaded', {
      recordingId: recording.id,
      promptId,
      userId,
    });
    return NextResponse.json({ recordingId: recording.id, status: 'PENDING' }, { status: 201 });
  } catch (error: unknown) {
    logger.error('Failed to upload practice speaking recording', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to upload practice speaking recording', 500);
  }
}

/** GET /api/practice/[sessionId]/speaking/[promptId]?recordingId=... — poll grading. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { sessionId, promptId } = await params;
    const userId = authed.userId;

    const parsed = pollSchema.safeParse({
      recordingId: request.nextUrl.searchParams.get('recordingId'),
    });
    if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);

    if (!(await ownedSession(sessionId, userId)))
      return errorResponse('Practice session not found', 404);

    const recording = await prisma.speakingRecording.findFirst({
      where: { id: parsed.data.recordingId, promptId, userId },
      select: {
        status: true,
        overallScore: true,
        transcript: true,
        rubricScores: true,
        feedback: true,
        phonemeScores: true,
      },
    });
    if (!recording) return errorResponse('Recording not found', 404);
    return NextResponse.json(recording);
  } catch (error: unknown) {
    logger.error('Failed to poll practice speaking recording', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to poll practice speaking recording', 500);
  }
}
