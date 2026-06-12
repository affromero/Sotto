import React from 'react';
import { AbsoluteFill, Audio } from 'remotion';
import type { RenderInput } from '../types';
import { EpisodeVisuals } from './EpisodeVisuals';
import { AvatarPip } from './shared/AvatarPip';

export const EpisodeVideo: React.FC<RenderInput> = ({
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
      <EpisodeVisuals segments={segments} config={config} branding={branding} transitions={transitions} />
      {avatarOverlays?.map((overlay) => (
        <AvatarPip key={overlay.speaker} overlay={overlay} />
      ))}
    </AbsoluteFill>
  );
};
