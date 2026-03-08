import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

interface AttributionOverlayProps {
  photographer: string;
  source: string;
}

export const AttributionOverlay: React.FC<AttributionOverlayProps> = ({
  photographer,
  source,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, fps * 0.5], [0, 0.7], {
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        left: 20,
        padding: '4px 12px',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        borderRadius: 12,
        opacity,
      }}
    >
      <span
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize: 11,
          color: '#FFFFFF',
          fontWeight: 400,
          letterSpacing: 0.3,
        }}
      >
        {photographer} / {source}
      </span>
    </div>
  );
};
