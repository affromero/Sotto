import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { uploadFile } from '@/lib/r2';
import { addJob, audioImportQueue, JobType } from '@/lib/queue';
import { importPodcastSchema } from '@/lib/validations';
import { logger } from '@/lib/logger';

const MAX_AUDIO_SIZE = 100 * 1024 * 1024;

const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/ogg',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mp4',
  'audio/webm',
];

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await request.formData();

    const title = formData.get('title') as string | null;
    const topic = formData.get('topic') as string | null;
    const isHumanContentStr = formData.get('isHumanContent') as string | null;
    const audioFile = formData.get('audio') as File | null;
    const transcriptFile = formData.get('transcript') as File | null;

    if (!title || !topic) {
      return NextResponse.json({ error: 'Missing required fields: title, topic' }, { status: 400 });
    }

    if (!audioFile) {
      return NextResponse.json({ error: 'Missing required field: audio' }, { status: 400 });
    }

    const validation = importPodcastSchema.safeParse({
      title,
      topic,
      isHumanContent: isHumanContentStr === 'true',
    });

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.format() },
        { status: 400 }
      );
    }

    if (audioFile.size > MAX_AUDIO_SIZE) {
      return NextResponse.json(
        { error: `Audio file too large: max ${MAX_AUDIO_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    if (!ALLOWED_AUDIO_TYPES.includes(audioFile.type)) {
      return NextResponse.json(
        {
          error: `Unsupported audio type: ${audioFile.type}`,
          allowed: ALLOWED_AUDIO_TYPES,
        },
        { status: 400 }
      );
    }

    const { title: validatedTitle, topic: validatedTopic, isHumanContent } = validation.data;

    const podcast = await prisma.podcast.create({
      data: {
        userId: session.user.id,
        title: validatedTitle,
        topic: validatedTopic,
        status: 'IMPORTING',
        source: 'IMPORT',
        isHumanContent,
        visibility: 'PRIVATE',
      },
    });

    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const ext = audioFile.name.split('.').pop() || 'mp3';
    const audioKey = `imports/${podcast.id}/original.${ext}`;

    await uploadFile(audioKey, audioBuffer, audioFile.type);

    await prisma.podcast.update({
      where: { id: podcast.id },
      data: { importedAudioKey: audioKey },
    });

    let transcriptText: string | undefined;
    if (transcriptFile) {
      transcriptText = await transcriptFile.text();
      logger.info('Transcript provided', {
        podcastId: podcast.id,
        length: String(transcriptText.length),
      });
    }

    await addJob(audioImportQueue, JobType.IMPORT_AUDIO, {
      podcastId: podcast.id,
      userId: session.user.id,
      audioKey,
      transcriptText,
      isHumanContent,
    });

    logger.info('Audio import queued', {
      podcastId: podcast.id,
      userId: session.user.id,
      audioSize: String(audioFile.size),
      hasTranscript: !!transcriptText,
    });

    return NextResponse.json({
      id: podcast.id,
      status: 'IMPORTING',
    });
  } catch (err) {
    logger.error('Import podcast failed', {
      error: err instanceof Error ? err.message : String(err),
    });

    return NextResponse.json({ error: 'Failed to import podcast' }, { status: 500 });
  }
}
