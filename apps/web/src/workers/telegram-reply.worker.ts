import { Job } from 'bullmq';
import { ReplyTelegramPayload } from '@/lib/queue';
import { prismaUnfiltered as prisma } from '@/lib/prisma';
import { sendMessage } from '@/lib/telegram';
import { podcastUrl as buildPodcastPath } from '@/lib/urls';
import { logger } from '@/lib/logger';

const SOTTO_APP_URL = process.env.NEXTAUTH_URL || 'https://sotto.fm';

export async function processTelegramReply(job: Job<ReplyTelegramPayload>): Promise<void> {
  const { podcastId, telegramMessageId, chatId } = job.data;
  await job.updateProgress(10);

  const podcast = await prisma.podcast.findUniqueOrThrow({
    where: { id: podcastId },
    select: { title: true, duration: true, status: true, slug: true, user: { select: { handle: true } } },
  });

  if (podcast.status === 'FAILED') {
    try {
      await sendMessage(chatId,
        `Sorry, we couldn't generate your podcast. Try again or visit ${SOTTO_APP_URL} to create one manually.`
      );
      if (telegramMessageId) {
        await prisma.telegramMessage.update({
          where: { id: telegramMessageId },
          data: { status: 'FAILED' },
        });
      }
    } catch (err) {
      logger.error('Failed to send Telegram failure message', {
        telegramMessageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (podcast.status !== 'READY') {
    // Podcast is mid-generation (retry in progress) — skip, reply will be queued when done
    logger.info('Skipping Telegram reply — podcast not in terminal state', {
      podcastId, status: podcast.status,
    });
    return;
  }

  await job.updateProgress(30);

  const durationMin = podcast.duration ? Math.round(podcast.duration / 60) : 0;
  const durationStr = durationMin > 0 ? ` (${durationMin} min)` : '';
  const podcastUrl = `${SOTTO_APP_URL}${buildPodcastPath({ id: podcastId, slug: podcast.slug }, podcast.user.handle)}`;

  await sendMessage(chatId,
    `Your podcast is ready! "${podcast.title}"${durationStr}`,
    {
      reply_markup: {
        inline_keyboard: [[{ text: 'Listen Now', url: podcastUrl }]],
      },
    }
  );

  await job.updateProgress(80);

  if (telegramMessageId) {
    await prisma.telegramMessage.update({
      where: { id: telegramMessageId },
      data: { status: 'REPLIED' },
    });
  }

  await job.updateProgress(100);
  logger.info('Telegram reply sent', { podcastId, chatId });
}
