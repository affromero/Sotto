import { ImageResponse } from 'next/og';
import { BRAND } from '@sotto/shared';
import { getAppBaseUrl } from '@/lib/urls';

export const runtime = 'nodejs';
export const alt = BRAND.title;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  const appHost = new URL(getAppBaseUrl()).host;
  const bars = Array.from({ length: 48 }, (_, i) => {
    const center = 24;
    const dist = Math.abs(i - center) / center;
    const height = 8 + (1 - dist) * 52 + Math.sin(i * 0.7) * 12;
    return height;
  });

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
        overflow: 'hidden',
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

      {/* Subtle glow in background */}
      <div
        style={{
          position: 'absolute',
          top: -100,
          right: -100,
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(63,79,176,0.08) 0%, transparent 70%)',
        }}
      />

      {/* Sotto wordmark */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
        <span
          style={{
            fontSize: 36,
            fontWeight: 700,
            color: '#3F4FB0',
            letterSpacing: '-0.02em',
          }}
        >
          Sotto
        </span>
      </div>

      {/* Badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: '#3F4FB0',
          }}
        />
        <span style={{ fontSize: 20, color: '#6B7280', letterSpacing: '0.05em' }}>
          {BRAND.tagline}
        </span>
      </div>

      {/* Main headline */}
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
            fontSize: 72,
            fontWeight: 700,
            color: '#1E2128',
            lineHeight: 1.1,
            margin: 0,
            marginBottom: 24,
          }}
        >
          Practice. Rehearse.{' '}
          <span style={{ color: '#3F4FB0', fontStyle: 'italic' }}>Progress.</span>
        </h1>
        <p
          style={{
            fontSize: 24,
            color: '#6B7280',
            lineHeight: 1.5,
            margin: 0,
            maxWidth: '75%',
          }}
        >
          {BRAND.subline}
        </p>
      </div>

      {/* Waveform decoration */}
      <div
        style={{
          position: 'absolute',
          bottom: 40,
          right: 60,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 3,
          opacity: 0.15,
        }}
      >
        {bars.map((h, i) => (
          <div
            key={i}
            style={{
              width: 4,
              height: h,
              borderRadius: 2,
              backgroundColor: i % 2 === 0 ? '#3F4FB0' : '#2A3550',
            }}
          />
        ))}
      </div>

      {/* Deployment host */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 20, color: '#D1D5DB' }}>{appHost}</span>
      </div>
    </div>,
    { ...size }
  );
}
