import React from 'react';
import { AbsoluteFill, Audio } from 'remotion';
import type { RenderInput } from '../types';
import { PodcastVisuals } from './PodcastVisuals';

export const PodcastVideo: React.FC<RenderInput> = ({
  audioUrl,
  segments,
  config,
  branding,
}) => {
  return (
    <AbsoluteFill>
      <Audio src={audioUrl} />
      <PodcastVisuals segments={segments} config={config} branding={branding} />
    </AbsoluteFill>
  );
};
