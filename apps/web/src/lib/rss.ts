import { createHash, randomBytes } from 'crypto';
import { prisma } from './prisma';
import { resolveAudioUrl } from './r2';
import { getAppBaseUrl } from './urls';

const PRIVATE_FEED_TOKEN_BYTES = 32;

function getAppUrl(): string {
  return getAppBaseUrl();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatRfc822Date(date: Date): string {
  return date.toUTCString();
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function hashPrivateFeedToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createPrivateFeedToken(
  userId: string,
  name = 'Private Sotto Feed'
): Promise<{ id: string; token: string; feedUrl: string }> {
  const token = randomBytes(PRIVATE_FEED_TOKEN_BYTES).toString('base64url');
  const row = await prisma.privateFeedToken.create({
    data: {
      userId,
      name,
      tokenHash: hashPrivateFeedToken(token),
    },
    select: { id: true },
  });

  return {
    id: row.id,
    token,
    feedUrl: `${getAppUrl()}/api/rss/private/${token}`,
  };
}

export async function generatePrivateRssFeed(token: string): Promise<string | null> {
  if (!token) return null;

  const feedToken = await prisma.privateFeedToken.findUnique({
    where: { tokenHash: hashPrivateFeedToken(token) },
    select: {
      id: true,
      userId: true,
      name: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          bio: true,
          image: true,
        },
      },
    },
  });

  if (!feedToken || feedToken.revokedAt) return null;

  await prisma.privateFeedToken.update({
    where: { id: feedToken.id },
    data: { lastUsedAt: new Date() },
  });

  const podcasts = await prisma.podcast.findMany({
    where: {
      userId: feedToken.userId,
      status: 'READY',
      deletedAt: null,
      audioUrl: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      topic: true,
      audioUrl: true,
      duration: true,
      language: true,
      visibility: true,
      createdAt: true,
    },
  });

  const appUrl = getAppUrl();
  const ownerName = escapeXml(feedToken.user.name || 'Private listener');
  const feedTitle = escapeXml(feedToken.name || `${ownerName} on Sotto`);
  const feedDescription = escapeXml(
    feedToken.user.bio || 'Private Sotto audio briefings and podcasts.'
  );
  const feedUrl = `${appUrl}/api/rss/private/${token}`;

  const renderedItems = await Promise.all(
    podcasts.map(async (p) => {
      const itemUrl = `${appUrl}/podcast/${p.id}`;
      const duration = p.duration ? formatDuration(p.duration) : '';
      const audioUrl = p.audioUrl ? await resolveAudioUrl(p.audioUrl, p.visibility) : null;
      return `    <item>
      <title>${escapeXml(p.title)}</title>
      <description>${escapeXml(p.topic)}</description>
      <link>${itemUrl}</link>
      <guid isPermaLink="true">${itemUrl}</guid>
      <pubDate>${formatRfc822Date(p.createdAt)}</pubDate>${
        audioUrl
          ? `
      <enclosure url="${escapeXml(audioUrl)}" type="audio/mpeg" />`
          : ''
      }${
        duration
          ? `
      <itunes:duration>${duration}</itunes:duration>`
          : ''
      }
    </item>`;
    })
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${feedTitle}</title>
    <description>${feedDescription}</description>
    <link>${appUrl}/dashboard</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <language>${podcasts[0]?.language ?? 'en'}</language>
    <generator>Sotto</generator>
    <lastBuildDate>${formatRfc822Date(new Date())}</lastBuildDate>${
      feedToken.user.image
        ? `
    <itunes:image href="${escapeXml(feedToken.user.image)}" />`
        : ''
    }
    <itunes:author>${ownerName}</itunes:author>
    <itunes:category text="Technology" />
${renderedItems.join('\n')}
  </channel>
</rss>`;
}
