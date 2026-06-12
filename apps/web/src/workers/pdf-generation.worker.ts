import { Job } from 'bullmq';
import { GeneratePdfPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { generateEpisodeTranscript } from '@/lib/pdf-generator';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';

export async function processPdfGeneration(job: Job<GeneratePdfPayload>): Promise<void> {
  const { episodeId } = job.data;

  logger.info('Generating transcript', { episodeId });
  await job.updateProgress(10);

  // Load episode with segments and references
  const episode = await prisma.episode.findUniqueOrThrow({
    where: { id: episodeId },
    include: {
      user: { select: { name: true } },
      segments: { orderBy: { order: 'asc' }, select: { speaker: true, text: true, startTime: true } },
      references: { orderBy: { number: 'asc' } },
    },
  });

  await job.updateProgress(30);

  // Generate markdown transcript
  const markdown = generateEpisodeTranscript({
    title: episode.title,
    topic: episode.topic,
    creatorName: episode.user.name || 'Anonymous',
    createdAt: episode.createdAt,
    segments: episode.segments,
    references: episode.references.map((ref) => ({
      id: ref.id,
      number: ref.number,
      title: ref.title,
      authors: ref.authors,
      year: ref.year,
      url: ref.url,
      type: ref.type,
      publisher: ref.publisher,
      doi: ref.doi,
      verificationStatus: ref.verificationStatus,
      verificationDetails: ref.verificationDetails as Record<string, unknown> | null,
      contentDomain: ref.contentDomain ?? null,
    })),
  });

  await job.updateProgress(70);

  // Upload to R2
  const key = `episodes/${episodeId}/transcript.md`;
  const buffer = Buffer.from(markdown, 'utf-8');
  const pdfUrl = await uploadFile(key, buffer, 'text/markdown');

  await job.updateProgress(90);

  // Update episode record
  await prisma.episode.update({
    where: { id: episodeId },
    data: { pdfUrl },
  });

  await job.updateProgress(100);
  logger.info('Transcript generation complete', { episodeId, pdfUrl });
}
