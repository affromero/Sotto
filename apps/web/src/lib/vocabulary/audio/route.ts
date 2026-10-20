import { NextRequest, NextResponse } from 'next/server';
import { vocabularyWorkRequestSchema } from '@sotto/shared';
import { authenticateRequest } from '../../api-keys';
import { errorResponse } from '../../api-response';
import { sottoRequestExecution } from '../../sidedoor/credentials/runtime/provider-execution';
import { requestVocabularyAudio, type VocabularyAudioSubject } from './index';
import { readVocabularyAudio } from './read';
import { vocabularyErrorResponse } from '../http';

export async function vocabularyAudioRoute(request: NextRequest, subject: VocabularyAudioSubject) {
  const actor = await authenticateRequest(request);
  if (!actor) return errorResponse('Unauthorized', 401);
  const execution = sottoRequestExecution(request, actor);
  try {
    if (request.method === 'POST') {
      const input = vocabularyWorkRequestSchema.parse(await request.json().catch(() => null));
      return NextResponse.json(await requestVocabularyAudio(subject, execution, input.retry));
    }
    const { bytes, mime } = await readVocabularyAudio(subject, execution);
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(bytes.length),
        'Content-Disposition': 'inline; filename="pronunciation"',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return vocabularyErrorResponse(error);
  }
}
