import { prisma } from './prisma';

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

export async function generateCreatorRssFeed(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      handle: true,
      bio: true,
      image: true,
    },
  });

  if (!user) return null;

  const podcasts = await prisma.podcast.findMany({
    where: {
      userId,
      status: 'READY',
      visibility: 'PUBLIC',
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
      createdAt: true,
    },
  });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://sotto.fm';
  const creatorName = escapeXml(user.name || 'Anonymous');
  const creatorBio = escapeXml(user.bio || `Podcasts by ${creatorName} on Sotto`);
  const feedUrl = `${appUrl}/api/users/${user.id}/rss`;
  const profileUrl = user.handle ? `${appUrl}/@${user.handle}` : `${appUrl}/profile/${user.id}`;

  const items = podcasts
    .map((p) => {
      const itemUrl = `${appUrl}/podcast/${p.id}`;
      const duration = p.duration ? formatDuration(p.duration) : '';
      return `    <item>
      <title>${escapeXml(p.title)}</title>
      <description>${escapeXml(p.topic)}</description>
      <link>${itemUrl}</link>
      <guid isPermaLink="true">${itemUrl}</guid>
      <pubDate>${formatRfc822Date(p.createdAt)}</pubDate>${
        p.audioUrl
          ? `
      <enclosure url="${escapeXml(p.audioUrl)}" type="audio/mpeg" />`
          : ''
      }${
        duration
          ? `
      <itunes:duration>${duration}</itunes:duration>`
          : ''
      }
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${creatorName} on Sotto</title>
    <description>${creatorBio}</description>
    <link>${profileUrl}</link>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
    <language>${podcasts[0]?.language ?? 'en'}</language>
    <generator>Sotto</generator>
    <lastBuildDate>${formatRfc822Date(new Date())}</lastBuildDate>${
      user.image
        ? `
    <itunes:image href="${escapeXml(user.image)}" />`
        : ''
    }
    <itunes:author>${creatorName}</itunes:author>
    <itunes:category text="Education" />
${items}
  </channel>
</rss>`;
}
