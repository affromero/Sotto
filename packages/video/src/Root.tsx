import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { EpisodeVideo } from './compositions/EpisodeVideo';
import { LaunchVideo, computeTotalDurationFrames } from './compositions/LaunchVideo';
import { SegmentStill } from './compositions/SegmentStill';
import type { RenderInput, LaunchVideoInput, VideoSegment } from './types';
import { DEFAULT_RENDER_CONFIG, DEFAULT_BRANDING } from './types';

const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="EpisodeVideo"
        component={EpisodeVideo as React.FC}
        durationInFrames={30 * 60}
        fps={DEFAULT_RENDER_CONFIG.fps}
        width={DEFAULT_RENDER_CONFIG.width}
        height={DEFAULT_RENDER_CONFIG.height}
        defaultProps={{
          audioUrl: '',
          segments: [],
          config: DEFAULT_RENDER_CONFIG,
          branding: DEFAULT_BRANDING,
        } satisfies RenderInput}
        calculateMetadata={({ props }) => {
          const fps = props.config?.fps ?? DEFAULT_RENDER_CONFIG.fps;
          const lastEnd = props.segments.reduce(
            (max, s) => Math.max(max, (s.startTime ?? 0) + (s.duration ?? 0)),
            0,
          );
          // Add 1 second padding to avoid cutting off the last frame
          const durationInFrames = Math.max(1, Math.ceil((lastEnd + 1) * fps));
          return { durationInFrames };
        }}
      />

      <Composition
        id="LaunchVideo"
        component={LaunchVideo as React.FC}
        durationInFrames={30 * 60}
        fps={DEFAULT_RENDER_CONFIG.fps}
        width={DEFAULT_RENDER_CONFIG.width}
        height={DEFAULT_RENDER_CONFIG.height}
        defaultProps={{
          scenes: [],
        } satisfies LaunchVideoInput}
        calculateMetadata={({ props }) => {
          const fps = props.config?.fps ?? DEFAULT_RENDER_CONFIG.fps;
          const totalFrames = computeTotalDurationFrames(props.scenes, fps);
          // Add 1 second padding
          const durationInFrames = Math.max(1, totalFrames + fps);
          return { durationInFrames };
        }}
      />
      <Composition
        id="SegmentStill"
        component={SegmentStill as React.FC}
        durationInFrames={30 * 5}
        fps={DEFAULT_RENDER_CONFIG.fps}
        width={DEFAULT_RENDER_CONFIG.width}
        height={DEFAULT_RENDER_CONFIG.height}
        defaultProps={{
          segment: {
            segmentId: '',
            order: 0,
            speaker: '',
            text: '',
            startTime: 0,
            duration: 5,
            visualType: 'TEXT_CARD',
          } satisfies VideoSegment,
          audioUrl: undefined as string | undefined,
          audioStartTime: undefined as number | undefined,
        }}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(1, Math.ceil((props.segment.duration ?? 5) * DEFAULT_RENDER_CONFIG.fps)),
        })}
      />
    </>
  );
};

registerRoot(RemotionRoot);
