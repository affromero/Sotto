import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig, useCurrentFrame, interpolate, OffthreadVideo } from 'remotion';
import type { LaunchVideoInput, LaunchSceneInput } from '../types';
import { DEFAULT_RENDER_CONFIG } from '../types';
import { LaunchScene } from './LaunchScene';
import { SottoWatermark } from './shared/SottoWatermark';

/**
 * Compute the effective duration for a scene in seconds.
 * Uses voiceover duration when available, falls back to recording duration.
 */
function sceneDurationSec(scene: LaunchSceneInput): number {
  if (scene.voiceoverDurationSec && scene.voiceoverDurationSec > 0) {
    return scene.voiceoverDurationSec;
  }
  return scene.recordingDurationSec ?? 10; // fallback 10s if somehow missing
}

/**
 * Estimate transition clip duration — default 1.5s if a transition URL is present.
 * The worker can extend LaunchSceneInput with exact transition durations later.
 */
const TRANSITION_DURATION_SEC = 1.5;

export interface SceneLayout {
  startFrame: number;
  durationFrames: number;
  transitionStartFrame?: number;
  transitionDurationFrames?: number;
}

export function computeSceneLayouts(scenes: LaunchSceneInput[], fps: number): SceneLayout[] {
  const layouts: SceneLayout[] = [];
  let currentFrame = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const durationFrames = Math.ceil(sceneDurationSec(scene) * fps);

    const layout: SceneLayout = {
      startFrame: currentFrame,
      durationFrames,
    };

    currentFrame += durationFrames;

    // Transition clip between scenes (not after the last)
    if (scene.transitionUrl && i < scenes.length - 1) {
      layout.transitionStartFrame = currentFrame;
      layout.transitionDurationFrames = Math.ceil(TRANSITION_DURATION_SEC * fps);
      currentFrame += layout.transitionDurationFrames;
    }

    layouts.push(layout);
  }

  return layouts;
}

/**
 * CSS filter equivalent to the FFmpeg warm amber grading:
 * curves=preset=lighter → brightness(1.03)
 * eq=contrast=1.03:saturation=1.04 → contrast(1.03) saturate(1.04)
 * unsharp omitted (subtle, no CSS equivalent)
 */
const GRADE_FILTER = 'brightness(1.03) saturate(1.04) contrast(1.03)';

export const LaunchVideo: React.FC<LaunchVideoInput> = ({
  scenes,
  backgroundMusicUrl,
  backgroundMusicVolume,
  gradeVideo,
  config,
}) => {
  const fps = config?.fps ?? DEFAULT_RENDER_CONFIG.fps;
  const { durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  const layouts = React.useMemo(() => computeSceneLayouts(scenes, fps), [scenes, fps]);

  const bgVol = backgroundMusicVolume ?? 0.1;

  // Fade out background music over last 3 seconds
  const fadeOutStartFrame = durationInFrames - fps * 3;
  const musicVolume = interpolate(
    frame,
    [fadeOutStartFrame, durationInFrames],
    [bgVol, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill
      style={{
        filter: gradeVideo !== false ? GRADE_FILTER : undefined,
      }}
    >
      {/* Background music — looped with fade-out */}
      {backgroundMusicUrl && (
        <Audio src={backgroundMusicUrl} volume={musicVolume} loop />
      )}

      {/* Scenes */}
      {scenes.map((scene, i) => {
        const layout = layouts[i];
        return (
          <React.Fragment key={`scene-${i}`}>
            <Sequence from={layout.startFrame} durationInFrames={layout.durationFrames}>
              <LaunchScene scene={scene} sceneIndex={i} fps={fps} />
            </Sequence>

            {/* Transition clip between scenes */}
            {scene.transitionUrl && layout.transitionStartFrame !== undefined && layout.transitionDurationFrames && (
              <Sequence from={layout.transitionStartFrame} durationInFrames={layout.transitionDurationFrames}>
                <TransitionClip src={scene.transitionUrl} />
              </Sequence>
            )}
          </React.Fragment>
        );
      })}

      <SottoWatermark />
    </AbsoluteFill>
  );
};

/** Simple full-frame transition video clip */
const TransitionClip: React.FC<{ src: string }> = ({ src }) => {
  return (
    <AbsoluteFill style={{ zIndex: 10 }}>
      <OffthreadVideo src={src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
};
