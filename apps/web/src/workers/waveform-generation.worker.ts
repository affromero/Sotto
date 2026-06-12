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
  const { episodeId } = job.data;

  logger.info('Generating waveform data', { episodeId });
  await job.updateProgress(10);

  const episode = await prisma.episode.findUniqueOrThrow({
    where: { id: episodeId },
    select: { audioUrl: true },
  });

  if (!episode.audioUrl) {
    throw new Error(`Episode ${episodeId} has no audioUrl`);
  }

  const tmpDir = await mkdtemp(join(tmpdir(), 'waveform-'));

  try {
    const audioPath = join(tmpDir, 'audio.mp3');
    await downloadToFile(episode.audioUrl, audioPath);
    await job.updateProgress(30);

    // Extract waveform peaks
    const peaks = await extractWaveformPeaks(audioPath);
    const peaksJson = Buffer.from(JSON.stringify(peaks), 'utf-8');
    const waveformUrl = await uploadFile(
      `episodes/${episodeId}/waveform.json`,
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
        `episodes/${episodeId}/spectrogram.png`,
        spectrogramBuffer,
        'image/png',
      );
    } catch (err) {
      // Spectrogram is optional — showspectrumpic may not be available
      logger.warn('Spectrogram generation failed, skipping', {
        episodeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await job.updateProgress(80);

    // Update episode record
    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        waveformUrl,
        ...(spectrogramUrl ? { spectrogramUrl } : {}),
      },
    });

    await job.updateProgress(100);
    logger.info('Waveform generation complete', { episodeId, waveformUrl, spectrogramUrl });
  } finally {
    await rm(tmpDir, { recursive: true }).catch(() => {});
  }
}
