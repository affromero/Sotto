interface PodcastJsonLdProps {
  id: string;
  title: string;
  topic: string;
  createdAt: string;
  duration: number | null;
  audioUrl: string | null;
  creator: {
    name: string | null;
    handle: string | null;
  };
}

function toIsoDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  let iso = 'PT';
  if (h > 0) iso += `${h}H`;
  if (m > 0) iso += `${m}M`;
  if (s > 0 || iso === 'PT') iso += `${s}S`;
  return iso;
}

export function PodcastJsonLd({
  id,
  title,
  topic,
  createdAt,
  duration,
  audioUrl,
  creator,
}: PodcastJsonLdProps) {
  const podcastUrl = `https://sotto.fm/podcast/${id}`;
  const creatorName = creator.name || 'Anonymous';
  const creatorUrl = creator.handle
    ? `https://sotto.fm/@${creator.handle}`
    : undefined;

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    name: title,
    description: topic,
    url: podcastUrl,
    datePublished: createdAt,
    ...(duration != null && { duration: toIsoDuration(duration) }),
    ...(audioUrl && {
      associatedMedia: {
        '@type': 'MediaObject',
        contentUrl: audioUrl,
        encodingFormat: 'audio/mpeg',
      },
    }),
    ...(creatorUrl && {
      partOfSeries: {
        '@type': 'PodcastSeries',
        name: `${creatorName}'s Sotto Podcasts`,
        url: creatorUrl,
      },
    }),
    creator: {
      '@type': 'Person',
      name: creatorName,
      ...(creatorUrl && { url: creatorUrl }),
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
