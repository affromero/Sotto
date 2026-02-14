import { Job } from 'bullmq';
import { ImportAudioPayload, notificationQueue, addJob, JobType } from '@/lib/queue';
import { prisma } from '@/lib/prisma';
import { downloadFile, uploadPodcastAudio } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { createSttProvider } from '@/lib/providers/stt';
import { parseTranscript, diarizeSpeakers } from '@/lib/transcript-parser';
import { getAudioDuration } from '@/lib/audio-stitcher';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { writeFile, mkdir, rm } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Audio import worker: transcribe + diarize + create podcast segments
 * Handles the full pipeline for user-uploaded audio podcasts
 */
export async function processAudioImport(job: Job<ImportAudioPayload>): Promise<void> {
  const { podcastId, userId, audioKey, transcriptText } = job.data;

  logger.info('Starting audio import', { podcastId, userId, hasTranscript: !!transcriptText });

  const tmpDir = path.join(os.tmpdir(), `sotto-import-${crypto.randomUUID()}`);

  try {
    await mkdir(tmpDir, { recursive: true });

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'IMPORTING' },
    });
    await job.updateProgress(5);

    const ext = path.extname(audioKey) || '.mp3';
    const originalPath = path.join(tmpDir, `original${ext}`);
    const normalizedPath = path.join(tmpDir, 'normalized.mp3');

    logger.info('Downloading audio from R2', { audioKey });
    const audioBuffer = await downloadFile(audioKey);
    await writeFile(originalPath, audioBuffer);
    await job.updateProgress(10);

    logger.info('Validating and normalizing audio with FFmpeg');
    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      originalPath,
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-filter:a',
      'loudnorm=I=-16:TP=-1.5:LRA=11',
      normalizedPath,
    ]);
    await job.updateProgress(20);

    const duration = await getAudioDuration(normalizedPath);
    const fileSize = (await import('fs/promises')).stat(normalizedPath).then((s) => s.size);

    logger.info('Audio normalized', { duration: String(Math.round(duration)) });

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'TRANSCRIBING' },
    });
    await job.updateProgress(30);

    let segments;

    if (transcriptText) {
      logger.info('Parsing provided transcript');
      segments = await parseTranscript(transcriptText);
      await job.updateProgress(70);

      if (!segments.some((s) => s.speaker === 'EXPERT')) {
        logger.info('Running speaker diarization on parsed transcript');
        const whisperSegments = segments.map((s) => ({
          start: s.startTime ?? 0,
          end: s.endTime ?? 0,
          text: s.text,
        }));
        segments = await diarizeSpeakers(whisperSegments);
      }
    } else {
      logger.info('Transcribing audio with Whisper');
      const sttProvider = createSttProvider();
      const normalizedBuffer = await import('fs/promises').then((fs) =>
        fs.readFile(normalizedPath)
      );
      const transcription = await sttProvider.transcribe(normalizedBuffer);
      await job.updateProgress(70);

      logger.info('Running speaker diarization');
      segments = await diarizeSpeakers(transcription.segments);
    }

    await job.updateProgress(80);

    logger.info('Creating Script and Segment records', { segmentCount: String(segments.length) });

    const turns = segments.map((seg) => ({
      speaker: seg.speaker,
      text: seg.text,
    }));

    await prisma.script.create({
      data: {
        podcastId,
        version: 1,
        turns,
        markdown: segments.map((s) => `**${s.speaker}:** ${s.text}`).join('\n\n'),
      },
    });

    const finalAudioBuffer = await import('fs/promises').then((fs) => fs.readFile(normalizedPath));
    const audioUrl = await uploadPodcastAudio(podcastId, finalAudioBuffer);
    await job.updateProgress(85);

    const dbSegments = await Promise.all(
      segments.map((seg) =>
        prisma.segment.create({
          data: {
            podcastId,
            speaker: seg.speaker,
            text: seg.text,
            order: seg.order,
            audioUrl,
            duration: seg.endTime && seg.startTime ? seg.endTime - seg.startTime : 0,
            startTime: seg.startTime ?? 0,
          },
        })
      )
    );

    const podcastVersion = await prisma.podcastVersion.create({
      data: {
        podcastId,
        version: 1,
        changeType: 'initial',
        audioUrl,
        duration: Math.round(duration),
      },
    });

    await Promise.all(
      dbSegments.map((seg, i) =>
        prisma.podcastVersionSegment.create({
          data: {
            versionId: podcastVersion.id,
            segmentId: seg.id,
            order: i,
            startTime: segments[i].startTime ?? 0,
          },
        })
      )
    );

    await job.updateProgress(90);

    await prisma.podcast.update({
      where: { id: podcastId },
      data: {
        status: 'READY',
        audioUrl,
        duration,
        fileSize: await fileSize,
        currentVersion: podcastVersion.version,
      },
    });

    const cumulativeTime = segments.reduce<number[]>((acc, seg, i) => {
      const prevTime =
        i === 0
          ? 0
          : acc[i - 1] + (segments[i - 1].endTime ?? 0) - (segments[i - 1].startTime ?? 0);
      return [...acc, seg.startTime ?? prevTime];
    }, []);

    await Promise.all(
      dbSegments.map((seg, i) =>
        prisma.segment.update({
          where: { id: seg.id },
          data: { startTime: cumulativeTime[i] ?? 0 },
        })
      )
    );

    await job.updateProgress(95);

    await addJob(notificationQueue, JobType.SEND_NOTIFICATION, {
      userId,
      type: 'PODCAST_READY',
      title: 'Import Complete',
      message: 'Your imported podcast is ready!',
      data: { podcastId },
    });

    await job.updateProgress(100);

    logger.info('Audio import complete', {
      podcastId,
      duration: String(Math.round(duration)),
      segments: String(segments.length),
    });
  } catch (err) {
    logger.error('Audio import failed', {
      podcastId,
      error: err instanceof Error ? err.message : String(err),
    });

    await prisma.podcast.update({
      where: { id: podcastId },
      data: { status: 'FAILED' },
    });

    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
