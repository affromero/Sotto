import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import type { VideoSegment } from '../../types';

/** Provider display metadata — colors chosen for contrast on dark glass. */
const PROVIDER_META: Record<string, { name: string; color: string }> = {
  elevenlabs: { name: 'ElevenLabs', color: '#818CF8' },
  openai: { name: 'OpenAI', color: '#10A37F' },
  cartesia: { name: 'Cartesia', color: '#A78BFA' },
  hume: { name: 'Hume AI', color: '#FBBF24' },
  fal: { name: 'Fal', color: '#F87171' },
  replicate: { name: 'Replicate', color: '#60A5FA' },
  minimax: { name: 'MiniMax', color: '#F472B6' },
};

const FALLBACK_META = { name: 'Unknown', color: '#9CA3AF' };

interface ProviderWindow {
  provider: string;
  model: string | undefined;
  startFrame: number;
  endFrame: number;
  color: string;
  displayName: string;
}

function buildProviderWindows(segments: VideoSegment[], fps: number): ProviderWindow[] {
  const windows: ProviderWindow[] = [];

  for (const seg of segments) {
    if (!seg.ttsProvider) continue;

    const startFrame = Math.round(seg.startTime * fps);
    const endFrame = Math.round((seg.startTime + seg.duration) * fps);
    const meta = PROVIDER_META[seg.ttsProvider] ?? FALLBACK_META;
    const last = windows[windows.length - 1];

    // Merge consecutive segments with same provider
    if (last && last.provider === seg.ttsProvider) {
      last.endFrame = endFrame;
    } else {
      windows.push({
        provider: seg.ttsProvider,
        model: seg.ttsModel,
        startFrame,
        endFrame,
        color: meta.color,
        displayName: meta.name,
      });
    }
  }

  return windows;
}

const TRANSITION_HALF = 15; // frames on each side of a boundary

interface ProviderBadgeProps {
  segments: VideoSegment[];
}

export const ProviderBadge: React.FC<ProviderBadgeProps> = ({ segments }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const windows = React.useMemo(() => buildProviderWindows(segments, fps), [segments, fps]);

  // Nothing to show if no segments have provider overrides
  if (windows.length === 0) return null;

  // Find current + next window
  const currentIdx = windows.findIndex((w) => frame >= w.startFrame && frame < w.endFrame);
  const current = currentIdx >= 0 ? windows[currentIdx] : windows[windows.length - 1];
  const next = currentIdx >= 0 && currentIdx < windows.length - 1 ? windows[currentIdx + 1] : null;

  if (!current) return null;

  // --- Entrance animation (spring-based) ---
  const entranceProgress = spring({
    frame: frame - windows[0].startFrame,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.8 },
  });

  const slideY = interpolate(entranceProgress, [0, 1], [16, 0]);
  const entranceOpacity = interpolate(entranceProgress, [0, 1], [0, 1]);

  // --- Accent bar grow (slightly delayed spring) ---
  const barProgress = spring({
    frame: frame - windows[0].startFrame - 4,
    fps,
    config: { damping: 12, stiffness: 100, mass: 0.6 },
  });

  const barWidth = interpolate(barProgress, [0, 1], [0, 3]);

  // --- Provider transition ---
  let transitionProgress = 0;
  let outgoingWindow: ProviderWindow | null = null;

  if (next && frame >= current.endFrame - TRANSITION_HALF) {
    // We're in the transition zone at the end of the current window
    transitionProgress = interpolate(
      frame,
      [current.endFrame - TRANSITION_HALF, current.endFrame + TRANSITION_HALF],
      [0, 1],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );
    outgoingWindow = current;
  }

  const prevWindow = currentIdx > 0 ? windows[currentIdx - 1] : null;
  if (prevWindow && frame < current.startFrame + TRANSITION_HALF) {
    // We're in the transition zone at the start of the current window
    transitionProgress = interpolate(
      frame,
      [current.startFrame - TRANSITION_HALF, current.startFrame + TRANSITION_HALF],
      [0, 1],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );
    outgoingWindow = prevWindow;
  }

  const isTransitioning = transitionProgress > 0 && transitionProgress < 1;

  // Determine display values
  const activeWindow = transitionProgress > 0.5 && next ? next : current;
  const displayName = activeWindow.displayName;
  const displayModel = activeWindow.model;
  const activeColor = activeWindow.color;

  // Scale pulse during transition
  const scalePulse = isTransitioning
    ? interpolate(
        transitionProgress,
        [0, 0.5, 1],
        [1, 1.035, 1],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
      )
    : 1;

  // Shimmer position during transition
  const shimmerX = isTransitioning
    ? interpolate(transitionProgress, [0, 1], [-100, 200])
    : -100;

  // Text crossfade
  const incomingTextOpacity = isTransitioning
    ? interpolate(transitionProgress, [0.3, 0.7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 1;
  const outgoingTextOpacity = isTransitioning
    ? interpolate(transitionProgress, [0.3, 0.7], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : 0;

  // Glow intensity — stronger during transition, subtle otherwise
  const glowIntensity = isTransitioning
    ? interpolate(transitionProgress, [0, 0.5, 1], [0.15, 0.4, 0.15])
    : 0.12;

  // Exit fade near video end
  const exitOpacity = interpolate(
    frame,
    [durationInFrames - fps * 0.5, durationInFrames],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const finalOpacity = entranceOpacity * exitOpacity;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 64,
        left: 24,
        display: 'flex',
        alignItems: 'stretch',
        opacity: finalOpacity,
        transform: `translateY(${slideY}px) scale(${scalePulse})`,
        transformOrigin: 'bottom left',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: `0 4px 24px rgba(0, 0, 0, 0.35), 0 0 20px ${activeColor}${Math.round(glowIntensity * 255).toString(16).padStart(2, '0')}`,
        border: '1px solid rgba(255, 255, 255, 0.06)',
      }}
    >
      {/* Accent bar */}
      <div
        style={{
          width: barWidth,
          minHeight: '100%',
          backgroundColor: activeColor,
          transition: 'background-color 0.3s ease',
          boxShadow: `0 0 8px ${activeColor}60`,
          flexShrink: 0,
        }}
      />

      {/* Card body */}
      <div
        style={{
          position: 'relative',
          backgroundColor: 'rgba(12, 12, 16, 0.82)',
          padding: '10px 18px 10px 14px',
          minWidth: 120,
        }}
      >
        {/* Shimmer overlay */}
        {isTransitioning && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(105deg, transparent 30%, rgba(255, 255, 255, 0.08) 45%, rgba(255, 255, 255, 0.14) 50%, rgba(255, 255, 255, 0.08) 55%, transparent 70%)`,
              transform: `translateX(${shimmerX}%)`,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Text layer */}
        <div style={{ position: 'relative' }}>
          {/* Outgoing text (during transition) */}
          {isTransitioning && outgoingWindow && (
            <div style={{ position: 'absolute', inset: 0, opacity: outgoingTextOpacity }}>
              <div
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#FFFFFF',
                  letterSpacing: 0.3,
                  lineHeight: 1.2,
                }}
              >
                {outgoingWindow.displayName}
              </div>
              {outgoingWindow.model && (
                <div
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 11,
                    fontWeight: 400,
                    color: 'rgba(255, 255, 255, 0.45)',
                    letterSpacing: 0.2,
                    marginTop: 2,
                    lineHeight: 1.2,
                  }}
                >
                  {outgoingWindow.model}
                </div>
              )}
            </div>
          )}

          {/* Current / incoming text */}
          <div style={{ opacity: incomingTextOpacity }}>
            <div
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: 15,
                fontWeight: 600,
                color: '#FFFFFF',
                letterSpacing: 0.3,
                lineHeight: 1.2,
              }}
            >
              {displayName}
            </div>
            {displayModel && (
              <div
                style={{
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 11,
                  fontWeight: 400,
                  color: 'rgba(255, 255, 255, 0.45)',
                  letterSpacing: 0.2,
                  marginTop: 2,
                  lineHeight: 1.2,
                }}
              >
                {displayModel}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
