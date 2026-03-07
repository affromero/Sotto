import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, prefetch } from 'remotion';
import type { VisualsInput } from '../types';
import { resolveSegmentComponent } from './segments';
import { SottoWatermark } from './shared/SottoWatermark';
import { SpeakerLabel } from './shared/SpeakerLabel';
import { Background } from './shared/Background';

const TRANSITION_FRAMES = 8;

const SegmentWithFade: React.FC<{
  children: React.ReactNode;
  durationInFrames: number;
}> = ({ children, durationInFrames }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [0, TRANSITION_FRAMES, durationInFrames - TRANSITION_FRAMES, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill style={{ opacity }}>
      {children}
    </AbsoluteFill>
  );
};

export const PodcastVisuals: React.FC<VisualsInput> = ({
  segments,
  branding,
}) => {
  const { fps } = useVideoConfig();

  // Prefetch all image/video assets so they're ready before their segment plays
  React.useEffect(() => {
    const cleanups: (() => void)[] = [];
    for (const segment of segments) {
      if (segment.assetUrl) {
        const { free } = prefetch(segment.assetUrl, { method: 'blob-url' });
        cleanups.push(free);
      }
    }
    return () => cleanups.forEach((fn) => fn());
  }, [segments]);

  return (
    <AbsoluteFill>
      <Background backgroundColor={branding.backgroundColor}>
        {segments.map((segment) => {
          const fromFrame = Math.round(segment.startTime * fps);
          const durationFrames = Math.round(segment.duration * fps);
          const SegmentComponent = resolveSegmentComponent(segment.visualType);

          return (
            <Sequence
              key={segment.segmentId}
              from={fromFrame}
              durationInFrames={durationFrames}
            >
              <SegmentWithFade durationInFrames={durationFrames}>
                <SegmentComponent segment={segment} />
                <SpeakerLabel speaker={segment.speaker} branding={branding} />
              </SegmentWithFade>
            </Sequence>
          );
        })}

        <SottoWatermark />
      </Background>
    </AbsoluteFill>
  );
};
