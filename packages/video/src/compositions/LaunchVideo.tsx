import React from 'react';
import { AbsoluteFill, Audio, useVideoConfig, useCurrentFrame, interpolate, OffthreadVideo } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
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
  return scene.recordingDurationSec ?? 10;
}

/** Transition clip duration (seconds) when a pre-rendered video is provided. */
const TRANSITION_CLIP_DURATION_SEC = 1.5;

/** Crossfade duration (frames) when no transition video is provided. */
const CROSSFADE_FRAMES = 15;

/**
 * Compute total duration in frames for the TransitionSeries layout.
 * Used by calculateMetadata in Root.tsx.
 *
 * - Scenes with transitionUrl: adds a separate transition clip sequence (no overlap)
 * - Scenes without transitionUrl (not last): crossfade overlaps by CROSSFADE_FRAMES
 */
export function computeTotalDurationFrames(scenes: LaunchSceneInput[], fps: number): number {
  let totalFrames = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    totalFrames += Math.ceil(sceneDurationSec(scene) * fps);

    if (i < scenes.length - 1) {
      if (scene.transitionUrl) {
        // Pre-rendered transition clip adds frames (no overlap)
        totalFrames += Math.ceil(TRANSITION_CLIP_DURATION_SEC * fps);
      } else {
        // Crossfade overlaps scenes, reducing total duration
        totalFrames -= CROSSFADE_FRAMES;
      }
    }
  }

  return Math.max(1, totalFrames);
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

      {/* Scenes with transitions */}
      <TransitionSeries>
        {scenes.map((scene, i) => {
          const durationFrames = Math.ceil(sceneDurationSec(scene) * fps);
          const isLast = i === scenes.length - 1;

          return (
            <React.Fragment key={`scene-${i}`}>
              <TransitionSeries.Sequence durationInFrames={durationFrames}>
                <LaunchScene scene={scene} sceneIndex={i} fps={fps} />
              </TransitionSeries.Sequence>

              {!isLast && scene.transitionUrl && (
                <TransitionSeries.Sequence durationInFrames={Math.ceil(TRANSITION_CLIP_DURATION_SEC * fps)}>
                  <TransitionClip src={scene.transitionUrl} />
                </TransitionSeries.Sequence>
              )}

              {!isLast && !scene.transitionUrl && (
                <TransitionSeries.Transition
                  presentation={fade()}
                  timing={linearTiming({ durationInFrames: CROSSFADE_FRAMES })}
                />
              )}
            </React.Fragment>
          );
        })}
      </TransitionSeries>

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
