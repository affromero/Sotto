import { Job } from 'bullmq';
import { GenerateWaveformPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { extractWaveformPeaks, generateSpectrogram } from '@/lib/waveform-extractor';
import { uploadFile, downloadToFile } from '@/lib/r2';
import { logger } from '@/lib/logger';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';

export async function processWaveformGeneration(job: Job<GenerateWaveformPayload>): Promise<void> {
  const { podcastId } = job.data;

  logger.info('Generating waveform data', { podcastId });
  await job.updateProgress(10);

  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: { audioUrl: true },
  });

  if (!podcast.audioUrl) {
    throw new Error(`Podcast ${podcastId} has no audioUrl`);
  }

  const tmpDir = await mkdtemp(join(tmpdir(), 'waveform-'));

  try {
    const audioPath = join(tmpDir, 'audio.mp3');
    await downloadToFile(podcast.audioUrl, audioPath);
    await job.updateProgress(30);

    // Extract waveform peaks
    const peaks = await extractWaveformPeaks(audioPath);
    const peaksJson = Buffer.from(JSON.stringify(peaks), 'utf-8');
    const waveformUrl = await uploadFile(
      `podcasts/${podcastId}/waveform.json`,
      peaksJson,
      'application/json',
    );
    await job.updateProgress(60);

    // Generate spectrogram image
    let spectrogramUrl: string | undefined;
    try {
      const spectrogramPath = join(tmpDir, 'spectrogram.png');
      await generateSpectrogram(audioPath, spectrogramPath);
      const spectrogramBuffer = await readFile(spectrogramPath);
      spectrogramUrl = await uploadFile(
        `podcasts/${podcastId}/spectrogram.png`,
        spectrogramBuffer,
        'image/png',
      );
    } catch (err) {
      // Spectrogram is optional — showspectrumpic may not be available
      logger.warn('Spectrogram generation failed, skipping', {
        podcastId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await job.updateProgress(80);

    // Update podcast record
    await prisma.podcast.update({
      where: { id: podcastId },
      data: {
        waveformUrl,
        ...(spectrogramUrl ? { spectrogramUrl } : {}),
      },
    });

    await job.updateProgress(100);
    logger.info('Waveform generation complete', { podcastId, waveformUrl, spectrogramUrl });
  } finally {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  }
}
