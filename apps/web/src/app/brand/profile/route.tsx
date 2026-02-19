import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const variant = searchParams.get('v');

  const colors: Record<string, { bg: string; fg: string; glow: string }> = {
    amber: { bg: '#D97706', fg: '#FFFFFF', glow: 'rgba(255,255,255,0.15)' },
    white: { bg: '#FFFFFF', fg: '#D97706', glow: 'rgba(217,119,6,0.08)' },
  };
  const { bg, fg, glow } =
    colors[variant ?? ''] ?? { bg: '#FEFCF8', fg: '#1A1A1A', glow: 'rgba(217,119,6,0.06)' };

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        fontFamily: 'sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`,
        }}
      />

      <span
        style={{
          fontSize: 420,
          fontWeight: 700,
          color: fg,
          letterSpacing: '-0.03em',
          lineHeight: 1,
        }}
      >
        S
      </span>
    </div>,
    { width: 512, height: 512 }
  );
}
