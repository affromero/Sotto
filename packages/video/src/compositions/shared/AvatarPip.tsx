import React from 'react';
import { OffthreadVideo, useVideoConfig } from 'remotion';
import type { AvatarOverlayInput } from '../../types';

export const AvatarPip: React.FC<{ overlay: AvatarOverlayInput }> = ({ overlay }) => {
  const { width: videoWidth, height: videoHeight } = useVideoConfig();

  const left = overlay.posX * videoWidth;
  const top = overlay.posY * videoHeight;
  const w = overlay.width * videoWidth;
  const h = overlay.height * videoHeight;

  const hasMask = overlay.maskShape && overlay.maskShape !== 'none';
  const borderRadius = overlay.maskShape === 'circle' ? '50%'
    : overlay.maskShape === 'rounded' ? 16 : 8;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: w,
        height: h,
        borderRadius,
        overflow: 'hidden',
        ...(hasMask && {
          border: '2px solid rgba(255,255,255,0.3)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }),
      }}
    >
      <OffthreadVideo
        src={overlay.videoUrl}
        style={{ width: '100%', height: '100%', objectFit: hasMask ? 'cover' : 'contain' }}
        transparent={!hasMask}
        muted
      />
    </div>
  );
};
