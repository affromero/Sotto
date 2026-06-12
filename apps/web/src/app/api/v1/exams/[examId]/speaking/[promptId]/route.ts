import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { addJob, speakingGradingQueue, JobType } from '@/lib/queue';

type RouteParams = { params: Promise<{ examId: string; promptId: string }> };

const pollSchema = z.object({ recordingId: z.string().min(1) });

/**
 * POST /api/exams/[examId]/speaking/[promptId] — upload a recorded attempt for an
 * exam speaking prompt. Reuses SpeakingRecording (keyed by examSectionId) + the
 * async speaking-grading worker. Returns { recordingId, status: 'PENDING' }.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { examId, promptId } = await params;
    const userId = authed.userId;

    const exam = await prisma.mockExam.findFirst({ where: { id: examId, userId }, select: { id: true } });
    if (!exam) return errorResponse('Exam not found', 404);

    const prompt = await prisma.speakingPrompt.findFirst({
      where: { id: promptId, examSection: { examId } },
      select: { id: true, examSectionId: true },
    });
    if (!prompt) return errorResponse('Prompt not found', 404);

    const formData = await request.formData();
    const audioFile = formData.get('audio');
    if (!audioFile || typeof audioFile === 'string') return errorResponse('Missing audio file', 400);

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const contentType = audioFile instanceof File ? audioFile.type || 'audio/webm' : 'audio/webm';
    const key = `speaking/${userId}/${promptId}/${crypto.randomUUID()}.webm`;
    const audioUrl = await uploadFile(key, buffer, contentType);

    const recording = await prisma.speakingRecording.create({
      data: { examSectionId: prompt.examSectionId, promptId, userId, audioUrl, status: 'PENDING' },
      select: { id: true, status: true },
    });

    await addJob(speakingGradingQueue, JobType.SPEAKING_GRADING, { recordingId: recording.id });
    logger.info('Exam speaking recording uploaded', { recordingId: recording.id, promptId, userId });
    return NextResponse.json({ recordingId: recording.id, status: 'PENDING' }, { status: 201 });
  } catch (error: unknown) {
    logger.error('Failed to upload exam speaking recording', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to upload speaking recording', 500);
  }
}

/** GET /api/exams/[examId]/speaking/[promptId]?recordingId=... — poll grading. */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authed = await authenticateRequest(request);
    if (!authed) return errorResponse('Unauthorized', 401);
    const { examId, promptId } = await params;
    const userId = authed.userId;

    const parsed = pollSchema.safeParse({ recordingId: request.nextUrl.searchParams.get('recordingId') });
    if (!parsed.success) return errorResponse(parsed.error.issues[0].message, 400);

    const exam = await prisma.mockExam.findFirst({ where: { id: examId, userId }, select: { id: true } });
    if (!exam) return errorResponse('Exam not found', 404);

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

    return NextResponse.json({
      status: recording.status,
      overallScore: recording.overallScore,
      transcript: recording.transcript,
      rubricScores: recording.rubricScores,
      feedback: recording.feedback,
      phonemeScores: recording.phonemeScores,
    });
  } catch (error: unknown) {
    logger.error('Failed to poll exam speaking recording', {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse('Failed to poll speaking recording', 500);
  }
}
