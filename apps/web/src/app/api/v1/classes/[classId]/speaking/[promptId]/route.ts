import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { detectAudioFormat, isRecognizedAudio } from '@/lib/audio-format';
import { addJob, speakingGradingQueue, JobType } from '@/lib/queue';

type RouteParams = { params: Promise<{ classId: string; promptId: string }> };

const pollSchema = z.object({
  recordingId: z.string().min(1),
});

/**
 * POST /api/classes/[classId]/speaking/[promptId]
 * Upload a recorded audio attempt for a speaking prompt.
 * Returns { recordingId, status: 'PENDING' } and enqueues grading.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);

    const { classId, promptId } = await params;
    const userId = authed.userId;

    // Verify the class belongs to this user
    const cls = await prisma.courseClass.findFirst({
      where: { id: classId, course: { userId } },
      select: { id: true },
    });
    if (!cls) return errorResponse('Class not found', 404);

    // Load the prompt and verify it belongs to this class
    const prompt = await prisma.speakingPrompt.findFirst({
      where: { id: promptId, section: { classId } },
      select: { id: true, sectionId: true },
    });
    if (!prompt) return errorResponse('Prompt not found', 404);

    // Read multipart audio
    const formData = await request.formData();
    const audioFile = formData.get('audio');
    if (!audioFile || typeof audioFile === 'string') {
      return errorResponse('Missing audio file', 400);
    }

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0 || !isRecognizedAudio(buffer)) {
      return errorResponse('Unrecognized or empty audio upload', 400);
    }
    const { ext, mime } = detectAudioFormat(buffer);

    // Upload to R2
    const key = `speaking/${userId}/${promptId}/${crypto.randomUUID()}.${ext}`;
    const audioUrl = await uploadFile(key, buffer, mime);

    // Create SpeakingRecording
    const recording = await prisma.speakingRecording.create({
      data: {
        sectionId: prompt.sectionId,
        promptId,
        userId,
        audioUrl,
        status: 'PENDING',
      },
      select: { id: true, status: true },
    });

    // Enqueue grading job
    await addJob(speakingGradingQueue, JobType.SPEAKING_GRADING, { recordingId: recording.id });

    logger.info('Speaking recording uploaded', { recordingId: recording.id, promptId, userId });

    return NextResponse.json({ recordingId: recording.id, status: 'PENDING' }, { status: 201 });
  } catch (error: unknown) {
    logger.error('Failed to upload speaking recording', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to upload speaking recording', 500);
  }
}

/**
 * GET /api/classes/[classId]/speaking/[promptId]?recordingId=...
 * Poll grading status for a specific recording.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);

    const { classId, promptId } = await params;
    const userId = authed.userId;

    // Validate query params
    const parsed = pollSchema.safeParse({
      recordingId: request.nextUrl.searchParams.get('recordingId'),
    });
    if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);

    // Verify class ownership
    const cls = await prisma.courseClass.findFirst({
      where: { id: classId, course: { userId } },
      select: { id: true },
    });
    if (!cls) return errorResponse('Class not found', 404);

    const recording = await prisma.speakingRecording.findFirst({
      where: { id: parsed.data.recordingId, promptId, userId },
      select: {
        id: true,
        status: true,
        overallScore: true,
        transcript: true,
        rubricScores: true,
        feedback: true,
        phonemeScores: true,
      },
    });
    if (!recording) return errorResponse('Recording not found', 404);

    return NextResponse.json({
      status: recording.status,
      overallScore: recording.overallScore,
      transcript: recording.transcript,
      rubricScores: recording.rubricScores,
      feedback: recording.feedback,
      phonemeScores: recording.phonemeScores,
    });
  } catch (error: unknown) {
    logger.error('Failed to poll speaking recording', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to poll speaking recording', 500);
  }
}
