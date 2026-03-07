import React from 'react';
import { OffthreadVideo, useVideoConfig } from 'remotion';
import type { AvatarOverlayInput } from '../../types';

export const AvatarPip: React.FC<{ overlay: AvatarOverlayInput }> = ({ overlay }) => {
  const { width: videoWidth, height: videoHeight } = useVideoConfig();

  const left = overlay.posX * videoWidth;
  const top = overlay.posY * videoHeight;
  const w = overlay.width * videoWidth;
  const h = overlay.height * videoHeight;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: w,
        height: h,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <OffthreadVideo
        src={overlay.videoUrl}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        transparent
        muted
      />
    </div>
  );
};
