/**
 * Export (question, context, answer, resolution) tuples for Q&A model fine-tuning.
 *
 * Extracts interactions where the user asked a question during playback,
 * along with the script context at that timestamp, for fine-tuning the Q&A model.
 *
 * Output: JSONL file with schema:
 *   { question, answer, timestamp, podcastTopic, scriptContext, segmentSpeaker, resolution, incorporated }
 *
 * Usage: npx ts-node scripts/ml/export-interaction-pairs.ts > data/interaction-pairs.jsonl
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CONTEXT_WINDOW_SEGMENTS = 3; // Segments around the timestamp

async function main() {
  const interactions = await prisma.interaction.findMany({
    where: {
      answer: { not: null },
      status: { in: ['ANSWERED', 'RESOLVED', 'INCORPORATED'] },
    },
    include: {
      podcast: {
        select: {
          id: true,
          title: true,
          topic: true,
          segments: {
            select: { order: true, speaker: true, text: true, startTime: true, duration: true },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  for (const interaction of interactions) {
    if (!interaction.answer) continue;

    const segments = interaction.podcast.segments;
    const timestamp = interaction.timestamp;

    // Find the segment playing at this timestamp
    let currentSegmentIdx = 0;
    for (let i = 0; i < segments.length; i++) {
      const start = segments[i].startTime || 0;
      const end = start + (segments[i].duration || 0);
      if (timestamp >= start && timestamp <= end) {
        currentSegmentIdx = i;
        break;
      }
      if (start > timestamp) {
        currentSegmentIdx = Math.max(0, i - 1);
        break;
      }
    }

    // Get surrounding context
    const contextStart = Math.max(0, currentSegmentIdx - CONTEXT_WINDOW_SEGMENTS);
    const contextEnd = Math.min(segments.length, currentSegmentIdx + CONTEXT_WINDOW_SEGMENTS + 1);
    const contextSegments = segments.slice(contextStart, contextEnd);

    const scriptContext = contextSegments.map((s) => `[${s.speaker}]: ${s.text}`).join('\n');

    const currentSegment = segments[currentSegmentIdx];

    const record = {
      question: interaction.question,
      answer: interaction.answer,
      timestamp: interaction.timestamp,
      podcastId: interaction.podcastId,
      podcastTitle: interaction.podcast.title,
      podcastTopic: interaction.podcast.topic,
      scriptContext,
      currentSegmentSpeaker: currentSegment?.speaker || 'HOST',
      currentSegmentText: currentSegment?.text || '',
      resolution: interaction.status,
      resolved: interaction.resolved,
      incorporated: interaction.incorporated,
    };

    process.stdout.write(JSON.stringify(record) + '\n');
  }

  console.error(`Exported ${interactions.length} interaction pairs`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
