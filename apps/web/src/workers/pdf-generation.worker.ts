import { Job } from 'bullmq';
import { GeneratePdfPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { generatePodcastTranscript } from '@/lib/pdf-generator';
import { uploadFile } from '@/lib/r2';
import { logger } from '@/lib/logger';

export async function processPdfGeneration(job: Job<GeneratePdfPayload>): Promise<void> {
  const { podcastId } = job.data;

  logger.info('Generating transcript', { podcastId });
  await job.updateProgress(10);

  // Load podcast with segments and references
  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    include: {
      user: { select: { name: true } },
      segments: { orderBy: { order: 'asc' }, select: { speaker: true, text: true, startTime: true } },
      references: { orderBy: { number: 'asc' } },
    },
  });

  await job.updateProgress(30);

  // Generate markdown transcript
  const markdown = generatePodcastTranscript({
    title: podcast.title,
    topic: podcast.topic,
    creatorName: podcast.user.name || 'Anonymous',
    createdAt: podcast.createdAt,
    segments: podcast.segments,
    references: podcast.references.map((ref) => ({
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
    })),
  });

  await job.updateProgress(70);

  // Upload to R2
  const key = `podcasts/${podcastId}/transcript.md`;
  const buffer = Buffer.from(markdown, 'utf-8');
  const pdfUrl = await uploadFile(key, buffer, 'text/markdown');

  await job.updateProgress(90);

  // Update podcast record
  await prisma.podcast.update({
    where: { id: podcastId },
    data: { pdfUrl },
  });

  await job.updateProgress(100);
  logger.info('Transcript generation complete', { podcastId, pdfUrl });
}
