import React from 'react';
import { AbsoluteFill, Audio } from 'remotion';
import type { RenderInput } from '../types';
import { PodcastVisuals } from './PodcastVisuals';
import { AvatarPip } from './shared/AvatarPip';

export const PodcastVideo: React.FC<RenderInput> = ({
  audioUrl,
  segments,
  config,
  branding,
  transitions,
  avatarOverlays,
}) => {
  return (
    <AbsoluteFill>
      <Audio src={audioUrl} />
      <PodcastVisuals segments={segments} config={config} branding={branding} transitions={transitions} />
      {avatarOverlays?.map((overlay) => (
        <AvatarPip key={overlay.speaker} overlay={overlay} />
      ))}
    </AbsoluteFill>
  );
};
