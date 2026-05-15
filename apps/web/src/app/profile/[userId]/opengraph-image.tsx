import { ImageResponse } from 'next/og';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const alt = 'Sotto Profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OgImage({ params }: { params: { userId: string } }) {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: {
      name: true,
      handle: true,
      bio: true,
      _count: {
        select: {
          podcasts: { where: { status: 'READY', visibility: 'PUBLIC', deletedAt: null } },
        },
      },
    },
  });

  if (!user) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#FEFCF8',
          fontFamily: 'sans-serif',
        }}
      >
        <span style={{ fontSize: 48, color: '#1A1A1A' }}>User Not Found</span>
      </div>,
      { ...size }
    );
  }

  const displayName = user.name || `@${user.handle}` || 'Anonymous';

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#FEFCF8',
        fontFamily: 'sans-serif',
        padding: 60,
        position: 'relative',
      }}
    >
      {/* Navy accent bar at top */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 8,
          backgroundColor: '#1E3A5F',
        }}
      />

      {/* Sotto wordmark */}
      <div style={{ display: 'flex', marginBottom: 40 }}>
        <span
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: '#D97706',
            letterSpacing: '-0.02em',
          }}
        >
          Sotto
        </span>
      </div>

      {/* User info */}
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
            color: '#1A1A1A',
            lineHeight: 1.2,
            margin: 0,
            marginBottom: 12,
          }}
        >
          {displayName}
        </h1>
        {user.bio && (
          <p
            style={{
              fontSize: 24,
              color: '#6B7280',
              lineHeight: 1.4,
              margin: 0,
              maxWidth: '80%',
            }}
          >
            {user.bio.length > 120 ? `${user.bio.slice(0, 120)}...` : user.bio}
          </p>
        )}
      </div>

      {/* Stats */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 32,
        }}
      >
        <span style={{ fontSize: 24, color: '#6B7280' }}>
          {user._count.podcasts} podcast{user._count.podcasts !== 1 ? 's' : ''}
        </span>
      </div>
    </div>,
    { ...size }
  );
}
