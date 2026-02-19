import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import busboy from 'busboy';
import { authenticateRequest } from '@/lib/api-keys';
import { prisma, prismaUnfiltered } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { addJob, audioImportQueue, JobType } from '@/lib/queue';
import { importPodcastSchema } from '@/lib/validations';
import { getAiKey, getByokKey } from '@/lib/byok';
import { checkGenerationGate, tryIncrementFreeGeneration } from '@/lib/generation-gate';
import { getFreeTierConfig } from '@/lib/free-tier-config';
import { selectFreeTierProviders } from '@/lib/free-tier-provider-selector';
import { checkRateLimit } from '@/lib/redis';
import { logger } from '@/lib/logger';
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

  if (provider === 'groq') {
    const byokKey = await getAiKey(userId, 'groq');
    return byokKey?.apiKey ?? process.env.GROQ_API_KEY ?? undefined;
  }

  // elevenlabs
  const byokKey = await getByokKey(userId, 'elevenlabs');
  return byokKey ?? process.env.ELEVENLABS_API_KEY ?? undefined;
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest(request);

  if (!authResult) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = authResult.userId;

  // Rate limit: 20/hour, 100/day
  const hourly = await checkRateLimit(`generate:hour:${userId}`, 20, 3600);
  if (!hourly.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: max 20 generations per hour.' },
      { status: 429 }
    );
  }
  const daily = await checkRateLimit(`generate:day:${userId}`, 100, 86400);
  if (!daily.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded: max 100 generations per day.' },
      { status: 429 }
    );
  }

  // Generation gate: BYOK or free tier
  const gate = await checkGenerationGate(userId);
  if (!gate.allowed) {
    const msg =
      gate.reason === 'free_tier_exhausted'
        ? 'Free generations used. Add your own API keys to continue.'
        : 'No voice provider available. Add a TTS key in Settings for unlimited generation.';
    return NextResponse.json({ error: msg, code: gate.reason }, { status: 403 });
  }

  try {
    const { fields, files } = await parseMultipart(request);

    const title = fields.title || undefined;
    const topic = fields.topic || undefined;
    const isHumanContentStr = fields.isHumanContent || null;
    const sourcePlatform = fields.sourcePlatform || null;
    const sttProviderField = fields.sttProvider || undefined;
    const audioFile = files.audio || null;
    const transcriptFile = files.transcript || null;

    if (!audioFile) {
      return NextResponse.json({ error: 'Missing required field: audio' }, { status: 400 });
    }

    const validation = importPodcastSchema.safeParse({
      title: title || undefined,
      topic: topic || undefined,
      isHumanContent: isHumanContentStr === 'true',
      sourcePlatform: sourcePlatform || undefined,
      sttProvider: sttProviderField || undefined,
    });

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.format() },
        { status: 400 }
      );
    }

    if (audioFile.buffer.length > MAX_AUDIO_SIZE) {
      return NextResponse.json(
        { error: `Audio file too large: max ${MAX_AUDIO_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    const fileExt = audioFile.filename.split('.').pop()?.toLowerCase();
    if (
      !ALLOWED_AUDIO_TYPES.includes(audioFile.mimeType) &&
      (!fileExt || !ALLOWED_AUDIO_EXTENSIONS.includes(fileExt))
    ) {
      return NextResponse.json(
        {
          error: `Unsupported audio type: ${audioFile.mimeType}`,
          allowed: ALLOWED_AUDIO_TYPES,
        },
        { status: 400 }
      );
    }

    const {
      isHumanContent,
      sourcePlatform: validatedSourcePlatform,
      sttProvider: validatedSttProvider,
    } = validation.data;

    const validatedTitle = validation.data.title || 'Untitled Import';
    const validatedTopic = validation.data.topic || '';
    const generateMetadata = !validation.data.title;

    const podcast = await prisma.podcast.create({
      data: {
        userId,
        title: validatedTitle,
        topic: validatedTopic,
        status: 'IMPORTING',
        source: 'IMPORT',
        isHumanContent,
        sourcePlatform: validatedSourcePlatform ?? null,
        visibility: gate.isByokUser ? 'PRIVATE' : 'PUBLIC',
      },
    });

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
      return NextResponse.json(
        {
          error: `No API key available for speech-to-text provider "${provider}". Add a ${provider === 'openai' ? 'OpenAI' : provider === 'groq' ? 'Groq' : 'ElevenLabs'} key in Settings → API Keys, or provide a transcript file.`,
        },
        { status: 400 }
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
      sttApiKey,
    });

    // Increment free tier counter for non-BYOK users
    if (!gate.isByokUser) {
      const config = await getFreeTierConfig();
      const selected = await selectFreeTierProviders(userId);
      const ok = await tryIncrementFreeGeneration(userId, config.generationLimit, {
        ai: { provider: selected.aiProvider, quota: selected.aiQuota },
        tts: { provider: selected.ttsProvider, quota: selected.ttsQuota },
      });
      if (!ok) {
        await prismaUnfiltered.podcast.delete({ where: { id: podcast.id } });
        return NextResponse.json(
          { error: 'Free generations used.', code: 'free_tier_exhausted' },
          { status: 403 }
        );
      }
    }

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

    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to import podcast: ${message}` }, { status: 500 });
  }
}
