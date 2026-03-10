import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';

type TransitionType = 'dissolve' | 'wipe' | 'zoom';

interface SceneTransitionProps {
  /** Transition type */
  type: TransitionType;
  /** Content of the outgoing scene */
  outgoing: React.ReactNode;
  /** Content of the incoming scene */
  incoming: React.ReactNode;
}

/**
 * Scene transition effects:
 * - dissolve: opacity crossfade
 * - wipe: CSS clip-path horizontal wipe
 * - zoom: scale out → in with blur
 */
export const SceneTransition: React.FC<SceneTransitionProps> = ({ type, outgoing, incoming }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  switch (type) {
    case 'dissolve':
      return <DissolveTransition progress={progress} outgoing={outgoing} incoming={incoming} />;
    case 'wipe':
      return <WipeTransition progress={progress} outgoing={outgoing} incoming={incoming} />;
    case 'zoom':
      return <ZoomTransition progress={progress} outgoing={outgoing} incoming={incoming} />;
  }
};

interface TransitionInternalProps {
  progress: number;
  outgoing: React.ReactNode;
  incoming: React.ReactNode;
}

const DissolveTransition: React.FC<TransitionInternalProps> = ({ progress, outgoing, incoming }) => {
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: 1 - progress }}>{outgoing}</AbsoluteFill>
      <AbsoluteFill style={{ opacity: progress }}>{incoming}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const WipeTransition: React.FC<TransitionInternalProps> = ({ progress, outgoing, incoming }) => {
  // Horizontal wipe from left to right
  const clipPercent = progress * 100;
  return (
    <AbsoluteFill>
      <AbsoluteFill>{incoming}</AbsoluteFill>
      <AbsoluteFill
        style={{
          clipPath: `inset(0 0 0 ${clipPercent}%)`,
        }}
      >
        {outgoing}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const ZoomTransition: React.FC<TransitionInternalProps> = ({ progress, outgoing, incoming }) => {
  // Outgoing: scale up + blur out; Incoming: scale down to normal + blur in
  const outScale = interpolate(progress, [0, 1], [1, 1.3]);
  const outBlur = interpolate(progress, [0, 1], [0, 6]);
  const outOpacity = interpolate(progress, [0, 0.6], [1, 0], {
    extrapolateRight: 'clamp',
  });

  const inScale = interpolate(progress, [0, 1], [0.8, 1]);
  const inBlur = interpolate(progress, [0, 1], [6, 0]);
  const inOpacity = interpolate(progress, [0.4, 1], [0, 1], {
    extrapolateLeft: 'clamp',
  });

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          transform: `scale(${outScale})`,
          filter: `blur(${outBlur}px)`,
          opacity: outOpacity,
        }}
      >
        {outgoing}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          transform: `scale(${inScale})`,
          filter: `blur(${inBlur}px)`,
          opacity: inOpacity,
        }}
      >
        {incoming}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
