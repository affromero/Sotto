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
      durationInFrames={30 * 60} // placeholder — overridden at render time
      fps={DEFAULT_RENDER_CONFIG.fps}
      width={DEFAULT_RENDER_CONFIG.width}
      height={DEFAULT_RENDER_CONFIG.height}
      defaultProps={{
        audioUrl: '',
        segments: [],
        config: DEFAULT_RENDER_CONFIG,
        branding: DEFAULT_BRANDING,
      } satisfies RenderInput}
    />
  );
};

registerRoot(RemotionRoot);
