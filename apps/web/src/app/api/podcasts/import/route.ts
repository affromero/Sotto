import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import busboy from 'busboy';
import { Prisma } from '@prisma/client';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma, prismaUnfiltered } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { addJob, audioImportQueue, JobType } from '@/lib/queue';
import { importPodcastSchema } from '@/lib/validations';
import { getAiKey, getByokKey } from '@/lib/byok';
import { checkGenerationGate } from '@/lib/generation-gate';

import { checkRateLimit } from '@/lib/redis';
import { generatePodcastSlug } from '@/lib/slugify';
import { logger } from '@/lib/logger';
import { errorResponse } from '@/lib/api-response';
import type { SttProviderId } from '@sotto/shared';

const MAX_AUDIO_SIZE = 100 * 1024 * 1024;

const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp4',
  'audio/aac',
  'audio/webm',
];

const ALLOWED_AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'mp4', 'aac', 'webm', 'opus'];

interface ParsedFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

function parseMultipart(
  request: NextRequest
): Promise<{ fields: Record<string, string>; files: Record<string, ParsedFile> }> {
  const contentType = request.headers.get('content-type');
  if (!contentType?.includes('multipart/form-data')) {
    return Promise.reject(new Error('Expected multipart/form-data'));
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return Promise.reject(new Error('No request body'));
  }

  const nodeStream = new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) {
        this.push(null);
      } else {
        this.push(Buffer.from(value));
      }
    },
  });

  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const files: Record<string, ParsedFile> = {};

    const bb = busboy({
      headers: { 'content-type': contentType },
      limits: { fileSize: MAX_AUDIO_SIZE },
    });

    bb.on('field', (name, value) => {
      fields[name] = value;
    });

    bb.on('file', (fieldname, stream, info) => {
      const chunks: Buffer[] = [];
      let truncated = false;

      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        truncated = true;
      });
      stream.on('end', () => {
        if (truncated) {
          return; // handled in 'finish'
        }
        files[fieldname] = {
          buffer: Buffer.concat(chunks),
          filename: info.filename,
          mimeType: info.mimeType,
        };
      });
    });

    bb.on('finish', () => resolve({ fields, files }));
    bb.on('error', reject);

    nodeStream.pipe(bb);
  });
}

/**
 * Resolve the BYOK API key for the selected STT provider.
 * Falls back to platform keys when no BYOK key is available.
 */
async function resolveSttApiKey(
  userId: string,
  sttProvider: SttProviderId | undefined
): Promise<string | undefined> {
  const provider = sttProvider ?? 'openai';

  if (provider === 'openai') {
    const byokKey = await getAiKey(userId, 'openai');
    return byokKey?.apiKey ?? process.env.OPENAI_API_KEY ?? undefined;
  }

  if (provider === 'together') {
    const byokKey = await getAiKey(userId, 'together');
    return byokKey?.apiKey ?? process.env.TOGETHER_API_KEY ?? undefined;
  }

  if (provider === 'deepgram') {
    const byokKey = await getAiKey(userId, 'deepgram');
    return byokKey?.apiKey ?? process.env.DEEPGRAM_API_KEY ?? undefined;
  }

  if (provider === 'assemblyai') {
    const byokKey = await getAiKey(userId, 'assemblyai');
    return byokKey?.apiKey ?? process.env.ASSEMBLYAI_API_KEY ?? undefined;
  }

  // elevenlabs
  const byokKey = await getByokKey(userId, 'elevenlabs');
  return byokKey ?? process.env.ELEVENLABS_API_KEY ?? undefined;
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return errorResponse('Unauthorized', 401);
  }

  const userId = authResult.userId;

  // Rate limit: 20/hour, 100/day
  const hourly = await checkRateLimit(`generate:hour:${userId}`, 20, 3600);
  if (!hourly.allowed) {
    return errorResponse('Rate limit exceeded: max 20 generations per hour.', 429);
  }
  const daily = await checkRateLimit(`generate:day:${userId}`, 100, 86400);
  if (!daily.allowed) {
    return errorResponse('Rate limit exceeded: max 100 generations per day.', 429);
  }

  // Generation gate: BYOK or free tier
  const gate = await checkGenerationGate(userId);
  if (!gate.allowed) {
    const msg = gate.reason === 'generation_in_progress'
      ? 'A podcast is already generating. Wait for it to finish before starting another.'
      : 'No voice provider available. Add a TTS key in Settings for unlimited generation.';
    return errorResponse(msg, 403, { code: gate.reason });
  }

  try {
    const { fields, files } = await parseMultipart(request);

    const title = fields.title || undefined;
    const topic = fields.topic || undefined;
    const isHumanContentStr = fields.isHumanContent || null;
    const sourcePlatform = fields.sourcePlatform || null;
    const sttProviderField = fields.sttProvider || undefined;
    const sttModelField = fields.sttModel || undefined;
    const audioFile = files.audio || null;
    const transcriptFile = files.transcript || null;
    const draftId = fields.draftId || undefined;

    if (!audioFile) {
      return errorResponse('Missing required field: audio', 400);
    }

    const validation = importPodcastSchema.safeParse({
      title: title || undefined,
      topic: topic || undefined,
      isHumanContent: isHumanContentStr === 'true',
      sourcePlatform: sourcePlatform ?? undefined,
      sttProvider: sttProviderField || undefined,
      sttModel: sttModelField || undefined,
    });

    if (!validation.success) {
      return errorResponse('Validation failed', 400, { details: validation.error.format() });
    }

    if (audioFile.buffer.length > MAX_AUDIO_SIZE) {
      return errorResponse(`Audio file too large: max ${MAX_AUDIO_SIZE / 1024 / 1024}MB`, 400);
    }

    const fileExt = audioFile.filename.split('.').pop()?.toLowerCase();
    if (
      !ALLOWED_AUDIO_TYPES.includes(audioFile.mimeType) &&
      (!fileExt || !ALLOWED_AUDIO_EXTENSIONS.includes(fileExt))
    ) {
      return errorResponse(`Unsupported audio type: ${audioFile.mimeType}`, 400, { allowed: ALLOWED_AUDIO_TYPES, });
    }

    const {
      isHumanContent,
      sourcePlatform: validatedSourcePlatform,
      sttProvider: validatedSttProvider,
      sttModel: validatedSttModel,
    } = validation.data;

    const validatedTitle = validation.data.title || 'Untitled Import';
    const validatedTopic = validation.data.topic || '';
    const generateMetadata = !validation.data.title;

    // Validate draft ownership if resuming from a draft
    if (draftId) {
      const draft = await prisma.podcast.findUnique({
        where: { id: draftId },
        select: { userId: true, status: true },
      });
      if (!draft || draft.userId !== userId || draft.status !== 'DRAFT') {
        return errorResponse('Invalid draft', 400);
      }
    }

    const importData = {
      title: validatedTitle,
      topic: validatedTopic,
      status: 'IMPORTING' as const,
      source: 'IMPORT' as const,
      isHumanContent,
      sourcePlatform: validatedSourcePlatform,
      sttProvider: validatedSttProvider,
      sttModel: validatedSttModel,
      visibility: gate.isProUser ? ('PRIVATE' as const) : ('PUBLIC' as const),
    };

    const podcast = draftId
      ? await prisma.podcast.update({
          where: { id: draftId },
          data: { ...importData, draftData: Prisma.DbNull },
        })
      : await prisma.podcast.create({
          data: { ...importData, userId },
        });

    // Generate slug if missing (covers both create and draft-to-import update)
    if (!podcast.slug) {
      const slug = await generatePodcastSlug(importData.title, userId, prisma);
      await prisma.podcast.update({ where: { id: podcast.id }, data: { slug } });
    }

    const ext = fileExt || 'mp3';
    const audioKey = `imports/${podcast.id}/original.${ext}`;

    await uploadFile(audioKey, audioFile.buffer, audioFile.mimeType);

    await prisma.podcast.update({
      where: { id: podcast.id },
      data: { importedAudioKey: audioKey },
    });

    let transcriptText: string | undefined;
    if (transcriptFile) {
      transcriptText = transcriptFile.buffer.toString('utf-8');
      logger.info('Transcript provided', {
        podcastId: podcast.id,
        length: String(transcriptText.length),
      });
    }

    const sttApiKey = await resolveSttApiKey(userId, validatedSttProvider);

    if (!sttApiKey && !transcriptText) {
      await prismaUnfiltered.podcast.delete({ where: { id: podcast.id } });
      const provider = validatedSttProvider ?? 'openai';
      const providerName = { openai: 'OpenAI', elevenlabs: 'ElevenLabs', together: 'Together AI', deepgram: 'Deepgram', assemblyai: 'AssemblyAI' }[provider] ?? provider;
      return errorResponse(
        `No API key available for speech-to-text provider "${provider}". Add a ${providerName} key in Settings → API Keys, or provide a transcript file.`,
        400
      );
    }

    await addJob(audioImportQueue, JobType.IMPORT_AUDIO, {
      podcastId: podcast.id,
      userId,
      audioKey,
      transcriptText,
      isHumanContent,
      generateMetadata,
      sttProvider: validatedSttProvider,
      sttModel: validatedSttModel,
      sttApiKey,
    });

    // Quota consumed on success by audio-import worker

    logger.info('Audio import queued', {
      podcastId: podcast.id,
      userId,
      audioSize: String(audioFile.buffer.length),
      hasTranscript: !!transcriptText,
      sttProvider: validatedSttProvider ?? 'openai',
      generateMetadata: String(generateMetadata),
    });

    return NextResponse.json({
      id: podcast.id,
      status: 'IMPORTING',
    });
  } catch (err) {
    logger.error('Import podcast failed', {
      error: err instanceof Error ? err.message : String(err),
    });

    return errorResponse('Failed to import podcast', 500);
  }
}
