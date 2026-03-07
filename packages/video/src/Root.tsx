import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { PodcastVideo } from './compositions/PodcastVideo';
import type { RenderInput } from './types';
import { DEFAULT_RENDER_CONFIG, DEFAULT_BRANDING } from './types';

const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="PodcastVideo"
      component={PodcastVideo}
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
  );
};

registerRoot(RemotionRoot);
