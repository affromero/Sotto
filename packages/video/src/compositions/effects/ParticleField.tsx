import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

interface ParticleFieldProps {
  /** Number of particles (default: 30) */
  count?: number;
  /** Seed for deterministic positions (default: 42) */
  seed?: number;
  /** Base opacity (default: 0.15) */
  opacity?: number;
  /** Particle color (default: white) */
  color?: string;
  /** Max particle radius in px (default: 3) */
  maxRadius?: number;
}

/** Simple seeded PRNG for deterministic renders. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

interface Particle {
  x: number;
  y: number;
  radius: number;
  driftX: number;
  driftY: number;
  phaseOffset: number;
}

/**
 * Ambient floating particles with deterministic positions.
 * Slow drift animation, low opacity, small circles.
 */
export const ParticleField: React.FC<ParticleFieldProps> = ({
  count = 30,
  seed = 42,
  opacity = 0.15,
  color = 'white',
  maxRadius = 3,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();

  const particles = React.useMemo<Particle[]>(() => {
    const rand = seededRandom(seed);
    return Array.from({ length: count }, () => ({
      x: rand() * 100,
      y: rand() * 100,
      radius: 1 + rand() * (maxRadius - 1),
      driftX: (rand() - 0.5) * 20, // total X drift in % over duration
      driftY: (rand() - 0.5) * 15, // total Y drift in %
      phaseOffset: rand() * Math.PI * 2,
    }));
  }, [count, seed, maxRadius]);

  // Fade in at start, fade out at end
  const fieldOpacity = interpolate(
    frame,
    [0, fps, durationInFrames - fps, durationInFrames],
    [0, opacity, opacity, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const progress = frame / Math.max(1, durationInFrames);

  return (
    <AbsoluteFill style={{ opacity: fieldOpacity, pointerEvents: 'none' }}>
      {particles.map((p, i) => {
        // Smooth drift with sine wobble
        const wobble = Math.sin(progress * Math.PI * 4 + p.phaseOffset) * 2;
        const cx = p.x + p.driftX * progress + wobble;
        const cy = p.y + p.driftY * progress;

        // Per-particle twinkle
        const twinkle = 0.6 + 0.4 * Math.sin(progress * Math.PI * 6 + p.phaseOffset);

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${cx}%`,
              top: `${cy}%`,
              width: p.radius * 2,
              height: p.radius * 2,
              borderRadius: '50%',
              backgroundColor: color,
              opacity: twinkle,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
