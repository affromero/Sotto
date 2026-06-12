import { ImageResponse } from 'next/og';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const alt = 'Sotto Lesson';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const mins = Math.floor(seconds / 60);
  return `${mins} min`;
}

export default async function OgImage({ params }: { params: Promise<{ episodeId: string }> }) {
  const { episodeId } = await params;
  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: {
      title: true,
      topic: true,
      duration: true,
      user: { select: { name: true } },
    },
  });

  if (!episode) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#F5F4F0',
          fontFamily: 'sans-serif',
        }}
      >
        <span style={{ fontSize: 48, color: '#1E2128' }}>Lesson Not Found</span>
      </div>,
      { ...size }
    );
  }

  const duration = formatDuration(episode.duration);
  const creatorName = episode.user.name || 'Anonymous';

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#F5F4F0',
        fontFamily: 'sans-serif',
        padding: 60,
        position: 'relative',
      }}
    >
      {/* Accent bar at top */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 8,
          backgroundColor: '#3F4FB0',
        }}
      />

      {/* Sotto wordmark */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: 40,
        }}
      >
        <span
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: '#3F4FB0',
            letterSpacing: '-0.02em',
          }}
        >
          Sotto
        </span>
      </div>

      {/* Title */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <h1
          style={{
            fontSize: 56,
            fontWeight: 700,
            color: '#1E2128',
            lineHeight: 1.2,
            margin: 0,
            maxWidth: '90%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {episode.title}
        </h1>
      </div>

      {/* Bottom info */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 24,
        }}
      >
        <span style={{ fontSize: 24, color: '#6B7280' }}>by {creatorName}</span>
        {duration && (
          <>
            <span style={{ fontSize: 24, color: '#D1D5DB' }}>|</span>
            <span style={{ fontSize: 24, color: '#6B7280' }}>{duration}</span>
          </>
        )}
      </div>
    </div>,
    { ...size }
  );
}
