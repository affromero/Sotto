import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

interface AvatarEntranceProps {
  children: React.ReactNode;
  /** Frame offset at which the entrance begins (default: 0) */
  enterAt?: number;
}

/**
 * Wraps avatar PiP content with a spring entrance animation:
 * - Scale 0 → 1 (spring: damping 12, stiffness 100)
 * - Blur 8px → 0
 * - Optional glow ring pulse on entrance
 */
export const AvatarEntrance: React.FC<AvatarEntranceProps> = ({ children, enterAt = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const localFrame = Math.max(0, frame - enterAt);

  const scaleProgress = spring({
    frame: localFrame,
    fps,
    config: { damping: 12, stiffness: 100, mass: 0.8 },
  });

  const scale = interpolate(scaleProgress, [0, 1], [0, 1]);
  const blur = interpolate(scaleProgress, [0, 1], [8, 0]);

  // Glow ring: pulses once during entrance then fades
  const glowOpacity = interpolate(
    scaleProgress,
    [0, 0.5, 1],
    [0, 0.6, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        transform: `scale(${scale})`,
        filter: `blur(${blur}px)`,
        transformOrigin: 'center center',
      }}
    >
      {children}
      {/* Glow ring overlay */}
      <div
        style={{
          position: 'absolute',
          inset: -4,
          borderRadius: 'inherit',
          border: '2px solid rgba(217, 119, 6, 0.8)',
          boxShadow: '0 0 16px rgba(217, 119, 6, 0.5)',
          opacity: glowOpacity,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
};
