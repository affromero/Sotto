import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import type { RenderInput } from '../types';
import { resolveSegmentComponent } from './segments';
import { SottoWatermark } from './shared/SottoWatermark';
import { SpeakerLabel } from './shared/SpeakerLabel';
import { Background } from './shared/Background';

export const PodcastVideo: React.FC<RenderInput> = ({
  audioUrl,
  segments,
  branding,
}) => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Background backgroundColor={branding.backgroundColor}>
        {/* Main audio track */}
        <Audio src={audioUrl} />

        {/* Segment visuals */}
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
              <AbsoluteFill>
                <SegmentComponent segment={segment} />
                <SpeakerLabel speaker={segment.speaker} branding={branding} />
              </AbsoluteFill>
            </Sequence>
          );
        })}

        {/* Watermark overlay — always visible */}
        <SottoWatermark />
      </Background>
    </AbsoluteFill>
  );
};
