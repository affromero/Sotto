import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateRequest } from '@/lib/api-keys';
import { errorResponse } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { prisma, prismaUnfiltered } from '@/lib/prisma';
import { detectAudioFormat, isRecognizedAudio } from '@/lib/audio-format';
import { speakingGradingQueue } from '@/lib/queue';
import {
  ClassSpeakingBindingConflict,
  createSpeakingRecording,
} from '@/lib/sidedoor/storage/publication/speaking-recording-upload';
import { deliverSottoJob } from '@/lib/sidedoor/jobs/core/job-delivery';
import { InitialA1PracticeBlocked } from '@/lib/classes/lesson/initial-a1-provenance';
import { isAccessError } from 'thesidedoor-core/access';
import { accessErrorStatus } from 'thesidedoor-core/access/http';
import { readRequestBytes, RequestBodyTooLargeError } from 'thesidedoor-core/runtime/request';

const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

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
    if (!authed) return errorResponse('Unauthorized', 401, { code: 'CLASS_RECORDING_REJECTED' });

    const { classId, promptId } = await params;
    const userId = authed.userId;

    // Verify the class belongs to this user
    const cls = await prisma.courseClass.findFirst({
      where: { id: classId, course: { userId } },
      select: { id: true },
    });
    if (!cls) return errorResponse('Class not found', 404, { code: 'CLASS_RECORDING_REJECTED' });

    // Load the prompt and verify it belongs to this class
    const prompt = await prisma.speakingPrompt.findFirst({
      where: { id: promptId, section: { classId } },
      select: { id: true, sectionId: true },
    });
    if (!prompt)
      return errorResponse('Prompt not found', 404, { code: 'CLASS_RECORDING_REJECTED' });

    // Read multipart audio
    const bytes = await readRequestBytes(request, MAX_AUDIO_BYTES + 64 * 1024);
    const headers = new Headers(request.headers);
    headers.delete('content-length');
    let formData: FormData;
    try {
      formData = await new Request(request.url, {
        method: 'POST',
        headers,
        body: Uint8Array.from(bytes).buffer,
        signal: request.signal,
      }).formData();
    } catch {
      return errorResponse('Invalid multipart upload', 400, { code: 'CLASS_RECORDING_REJECTED' });
    }
    const attempts = formData.getAll('expectedAttempt');
    const revisions = formData.getAll('taskMaterialRevision');
    if (
      attempts.length !== 1 ||
      revisions.length !== 1 ||
      typeof attempts[0] !== 'string' ||
      typeof revisions[0] !== 'string' ||
      !/^[1-9][0-9]*$/.test(attempts[0]) ||
      !Number.isSafeInteger(Number(attempts[0])) ||
      !/^[a-f0-9]{64}$/.test(revisions[0])
    )
      return errorResponse('A valid class attempt and material revision are required.', 400, {
        code: 'CLASS_RECORDING_REJECTED',
      });
    const audioFile = formData.get('audio');
    if (!audioFile || typeof audioFile === 'string') {
      return errorResponse('Missing audio file', 400, { code: 'CLASS_RECORDING_REJECTED' });
    }
    if (audioFile.size > MAX_AUDIO_BYTES)
      return errorResponse('Audio upload is too large', 413, { code: 'CLASS_RECORDING_REJECTED' });

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0 || !isRecognizedAudio(buffer)) {
      return errorResponse('Unrecognized or empty audio upload', 400, {
        code: 'CLASS_RECORDING_REJECTED',
      });
    }
    const { ext, mime } = detectAudioFormat(buffer);

    if (!prompt.sectionId)
      return errorResponse('Prompt has no class section', 409, {
        code: 'CLASS_RECORDING_REJECTED',
      });
    const recording = await createSpeakingRecording({
      request,
      admission: authed,
      promptId,
      parent: { sectionId: prompt.sectionId },
      classBinding: {
        classId,
        expectedAttempt: Number(attempts[0]),
        taskMaterialRevision: revisions[0],
      },
      audio: buffer,
      extension: ext,
      contentType: mime,
    });

    // Enqueue grading job
    await deliverSottoJob({
      database: prismaUnfiltered,
      queue: speakingGradingQueue,
      operationId: recording.operationId,
      fingerprint: recording.fingerprint,
      version: 2,
    });

    logger.info('Speaking recording uploaded', { recordingId: recording.id, promptId, userId });

    return NextResponse.json({ recordingId: recording.id, status: 'PENDING' }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError)
      return errorResponse('Audio upload is too large', 413, { code: 'CLASS_RECORDING_REJECTED' });
    if (error instanceof ClassSpeakingBindingConflict)
      return errorResponse(error.message, 409, { code: 'CLASS_MATERIAL_CHANGED' });
    if (error instanceof InitialA1PracticeBlocked)
      return errorResponse(error.message, 409, { code: 'PREREQUISITE_ACK_REQUIRED' });
    if (isAccessError(error)) return errorResponse(error.code, accessErrorStatus(error));
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

    const prompt = await prisma.speakingPrompt.findFirst({
      where: { id: promptId, section: { classId } },
      select: { sectionId: true },
    });
    if (!prompt?.sectionId) return errorResponse('Recording not found', 404);
    const recording = await prisma.speakingRecording.findFirst({
      where: {
        id: parsed.data.recordingId,
        promptId,
        userId,
        sectionId: prompt.sectionId,
        prompt: {
          sectionId: prompt.sectionId,
          section: { classId, withdrawn: false, class: { course: { userId } } },
        },
      },
      select: {
        id: true,
        status: true,
        gradingAcknowledgedAt: true,
        overallScore: true,
        transcript: true,
        rubricScores: true,
        feedback: true,
        phonemeScores: true,
      },
    });
    if (!recording) return errorResponse('Recording not found', 404);

    return NextResponse.json({
      recordingId: recording.id,
      status: recording.status,
      recoveryAcknowledged: recording.gradingAcknowledgedAt != null,
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
