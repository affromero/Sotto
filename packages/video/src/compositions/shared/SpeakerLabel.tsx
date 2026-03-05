import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

interface SpeakerLabelProps {
  speaker: string;
  branding: {
    primaryColor: string;
    accentColor: string;
    bodyFont: string;
  };
}

export const SpeakerLabel: React.FC<SpeakerLabelProps> = ({ speaker, branding }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, fps * 0.3], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const isHost = speaker.toLowerCase() === 'host';
  const bgColor = isHost ? branding.primaryColor : branding.accentColor;

  return (
    <div
      style={{
        position: 'absolute',
        top: 20,
        left: 24,
        padding: '6px 16px',
        backgroundColor: bgColor,
        borderRadius: 20,
        opacity,
      }}
    >
      <span
        style={{
          fontFamily: `${branding.bodyFont}, sans-serif`,
          fontSize: 14,
          color: '#FFFFFF',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}
      >
        {speaker}
      </span>
    </div>
  );
};
