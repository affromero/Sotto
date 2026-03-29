import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from 'remotion';
import type {
  LaunchSceneInput,
  TimingSegment,
  TextOverlayConfig,
  ProviderBannerConfig,
  LaunchAvatarConfig,
} from '../types';
import { AvatarEntrance } from './effects/AvatarEntrance';
import { SubtitleTrack as SubtitleTrackEffect } from './effects/SubtitleTrack';

// ---------------------------------------------------------------------------
// SFX base URL — served statically from the Remotion sidecar
// ---------------------------------------------------------------------------
const SFX_BASE = typeof process !== 'undefined' && process.env.REMOTION_SERVE_URL
  ? `${process.env.REMOTION_SERVE_URL}/assets/sfx`
  : '/assets/sfx';

const CLICK_SFXS = [
  `${SFX_BASE}/click-1.mp3`,
  `${SFX_BASE}/click-2.mp3`,
  `${SFX_BASE}/click-3.mp3`,
];
const KEYSTROKE_SFXS = [
  `${SFX_BASE}/keystroke-1.mp3`,
  `${SFX_BASE}/keystroke-2.mp3`,
  `${SFX_BASE}/keystroke-3.mp3`,
];
const SCROLL_SFX_URL = `${SFX_BASE}/scroll.mp3`;
const ZOOM_SFX_URL = `${SFX_BASE}/zoom.mp3`;

/** Deterministic hash for variant selection — consistent across Remotion renders. */
function deterministicHash(a: number, b: number = 0): number {
  return ((a * 2654435761 + b * 1597334677) >>> 0) / 4294967296;
}

/** Pick a deterministic variant from an array. */
function pickVariant<T>(variants: T[], eventIndex: number, subIndex: number = 0): T {
  const idx = Math.floor(deterministicHash(eventIndex, subIndex) * variants.length);
  return variants[idx];
}

/** Deterministic volume jitter for natural SFX variation. */
function jitterVolume(base: number, range: number, eventIndex: number, subIndex: number = 0): number {
  const t = deterministicHash(eventIndex + 7919, subIndex + 104729);
  return base - range / 2 + t * range;
}

/** Deterministic playback rate jitter. */
function jitterRate(eventIndex: number, subIndex: number = 0): number {
  const t = deterministicHash(eventIndex + 15731, subIndex + 65537);
  return 0.95 + t * 0.1; // 0.95 - 1.05
}

// ---------------------------------------------------------------------------
// Main LaunchScene component
// ---------------------------------------------------------------------------

interface LaunchSceneProps {
  scene: LaunchSceneInput;
  sceneIndex: number;
  fps: number;
}

export const LaunchScene: React.FC<LaunchSceneProps> = ({ scene, sceneIndex, fps }) => {
  const { durationInFrames } = useVideoConfig();

  // Determine effective playback rate for video-voiceover sync
  const recordingDur = scene.recordingDurationSec ?? 10;
  const voiceoverDur = scene.voiceoverDurationSec;
  const hasVoiceover = !!scene.voiceoverUrl && voiceoverDur && voiceoverDur > 0;

  return (
    <AbsoluteFill>
      {/* Recording video layer */}
      <RecordingLayer
        scene={scene}
        recordingDur={recordingDur}
        voiceoverDur={voiceoverDur}
        fps={fps}
        durationInFrames={durationInFrames}
      />

      {/* Voiceover audio (recording video is muted) */}
      {hasVoiceover && <Audio src={scene.voiceoverUrl!} />}

      {/* SFX layer */}
      <SfxLayer scene={scene} fps={fps} />

      {/* Provider banner */}
      {scene.providerBanner && (
        <ProviderBanner config={scene.providerBanner} fps={fps} durationInFrames={durationInFrames} />
      )}

      {/* Text overlays */}
      {scene.overlays?.map((overlay, i) => (
        <TextOverlay key={`overlay-${sceneIndex}-${i}`} config={overlay} fps={fps} />
      ))}

      {/* Subtitles — use enhanced effect component */}
      {scene.subtitles?.enabled && scene.narration && (
        <SubtitleTrackEffect
          narration={scene.narration}
          style={scene.subtitles.style}
          position={scene.subtitles.position}
          fontSize={scene.subtitles.fontSize}
          highlightCurrentWord
        />
      )}

      {/* Avatar PiP */}
      {scene.avatarConfig?.videoUrl && (
        <LaunchAvatarPip config={scene.avatarConfig} fps={fps} durationInFrames={durationInFrames} />
      )}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Recording video layer
// ---------------------------------------------------------------------------

/**
 * Handles timing segments (speed zones) and video-voiceover sync.
 *
 * Timing segments: chained OffthreadVideo clips with different playbackRates.
 * Voiceover sync: if no timing segments, apply a single playbackRate to match
 * recording duration to voiceover duration.
 */
const RecordingLayer: React.FC<{
  scene: LaunchSceneInput;
  recordingDur: number;
  voiceoverDur: number | undefined;
  fps: number;
  durationInFrames: number;
}> = ({ scene, recordingDur, voiceoverDur, fps, durationInFrames }) => {
  const hasTimingSegments = scene.timingSegments && scene.timingSegments.length > 0;

  if (hasTimingSegments) {
    return (
      <TimingSegmentedVideo
        recordingUrl={scene.recordingUrl}
        segments={scene.timingSegments!}
        fps={fps}
        totalDurationFrames={durationInFrames}
      />
    );
  }

  // Simple case: stretch/compress recording to match voiceover
  const playbackRate = voiceoverDur && voiceoverDur > 0
    ? recordingDur / voiceoverDur
    : 1;

  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={scene.recordingUrl}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        playbackRate={playbackRate}
        muted
      />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Timing segments: chained video clips with different speeds
// ---------------------------------------------------------------------------

const TimingSegmentedVideo: React.FC<{
  recordingUrl: string;
  segments: TimingSegment[];
  fps: number;
  totalDurationFrames: number;
}> = ({ recordingUrl, segments, fps, totalDurationFrames }) => {
  // Filter out skip segments (speed=0), compute frame ranges
  const activeSegments = segments.filter((s) => s.speed > 0);
  if (activeSegments.length === 0) return null;

  // Calculate each segment's output duration in frames
  const segmentLayouts = activeSegments.map((seg) => {
    const inputDuration = seg.end - seg.start; // seconds of source video
    const outputDuration = inputDuration / seg.speed; // seconds at playback speed
    return {
      ...seg,
      outputDurationFrames: Math.ceil(outputDuration * fps),
      startFromFrame: Math.round(seg.start * fps),
    };
  });

  // Scale segment durations to fit total composition duration
  const rawTotalFrames = segmentLayouts.reduce((sum, s) => sum + s.outputDurationFrames, 0);
  const scaleFactor = rawTotalFrames > 0 ? totalDurationFrames / rawTotalFrames : 1;

  let currentFrame = 0;

  return (
    <AbsoluteFill>
      {segmentLayouts.map((seg, i) => {
        const scaledDuration = Math.round(seg.outputDurationFrames * scaleFactor);
        const fromFrame = currentFrame;
        currentFrame += scaledDuration;

        return (
          <Sequence key={`tseg-${i}`} from={fromFrame} durationInFrames={scaledDuration}>
            <OffthreadVideo
              src={recordingUrl}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              startFrom={seg.startFromFrame}
              playbackRate={seg.speed}
              muted
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// SFX speed-zone remapping — corrects SFX timestamps for timing segments
// ---------------------------------------------------------------------------

/**
 * Remap a raw recording timestamp (ms) to the output frame, accounting for
 * timing segments (speed zones) and the global scale factor.
 * Returns null if the timestamp falls in a skipped segment (speed=0).
 */
function remapSfxFrame(
  rawMs: number,
  timingSegments: TimingSegment[] | undefined,
  fps: number,
  totalDurationFrames: number,
): number | null {
  if (!timingSegments || timingSegments.length === 0) {
    return Math.round((rawMs / 1000) * fps);
  }

  const rawSec = rawMs / 1000;

  // Build layout: which segments are active, their output durations
  const activeSegments = timingSegments.filter((s) => s.speed > 0);
  if (activeSegments.length === 0) return null;

  const segmentLayouts = activeSegments.map((seg) => {
    const inputDuration = seg.end - seg.start;
    const outputDuration = inputDuration / seg.speed;
    return { ...seg, outputDurationFrames: Math.ceil(outputDuration * fps) };
  });

  const rawTotalFrames = segmentLayouts.reduce((sum, s) => sum + s.outputDurationFrames, 0);
  const scaleFactor = rawTotalFrames > 0 ? totalDurationFrames / rawTotalFrames : 1;

  // Find which segment contains this timestamp
  let outputFrameOffset = 0;
  for (const seg of segmentLayouts) {
    if (rawSec < seg.start) {
      // Timestamp is before this segment — check if it's in a skipped gap
      return null;
    }
    if (rawSec >= seg.start && rawSec < seg.end) {
      // Timestamp falls in this segment
      const elapsed = rawSec - seg.start;
      const outputElapsed = elapsed / seg.speed;
      const frameInSegment = Math.round(outputElapsed * fps * scaleFactor);
      return outputFrameOffset + frameInSegment;
    }
    outputFrameOffset += Math.round(seg.outputDurationFrames * scaleFactor);
  }

  // Past the last segment
  return null;
}

// ---------------------------------------------------------------------------
// SFX layer: click variants, accurate keystrokes, scroll/zoom, speed-zone remap
// ---------------------------------------------------------------------------

const SfxLayer: React.FC<{ scene: LaunchSceneInput; fps: number }> = ({ scene, fps }) => {
  const { sfxConfig, actionTimingLog, timingSegments } = scene;
  const { durationInFrames } = useVideoConfig();
  if (!sfxConfig) return null;

  const sfxElements: React.ReactElement[] = [];

  // Click sounds — variant selection + speed-zone remap
  if (sfxConfig.clickSounds !== false && actionTimingLog) {
    actionTimingLog
      .filter((e) => e.type === 'click')
      .forEach((entry, i) => {
        const atFrame = remapSfxFrame(entry.timestampMs, timingSegments, fps, durationInFrames);
        if (atFrame === null) return;
        const sfxUrl = pickVariant(CLICK_SFXS, i);
        const vol = jitterVolume(0.6, 0.2, i);
        const rate = jitterRate(i);
        sfxElements.push(
          <Sequence key={`click-${i}`} from={atFrame}>
            <Audio src={sfxUrl} volume={vol} playbackRate={rate} />
          </Sequence>,
        );
      });
  }

  // Keystroke sounds — actual per-character offsets + speed-zone remap
  if (sfxConfig.typingSounds !== false && actionTimingLog) {
    actionTimingLog
      .filter((e) => e.type === 'type')
      .forEach((entry, ti) => {
        const offsets = entry.meta?.keystrokeOffsets as number[] | undefined;
        if (!offsets || offsets.length === 0) return;

        const count = Math.min(offsets.length, 50);
        for (let c = 0; c < count; c++) {
          const rawMs = entry.timestampMs + offsets[c];
          const atFrame = remapSfxFrame(rawMs, timingSegments, fps, durationInFrames);
          if (atFrame === null) continue;
          const sfxUrl = pickVariant(KEYSTROKE_SFXS, ti, c);
          const vol = jitterVolume(0.4, 0.2, ti, c);
          const rate = jitterRate(ti, c);
          sfxElements.push(
            <Sequence key={`key-${ti}-${c}`} from={atFrame}>
              <Audio src={sfxUrl} volume={vol} playbackRate={rate} />
            </Sequence>,
          );
        }
      });
  }

  // Scroll sounds — speed-zone remap
  if (actionTimingLog) {
    actionTimingLog
      .filter((e) => e.type === 'scroll')
      .forEach((entry, i) => {
        const atFrame = remapSfxFrame(entry.timestampMs, timingSegments, fps, durationInFrames);
        if (atFrame === null) return;
        sfxElements.push(
          <Sequence key={`scroll-${i}`} from={atFrame}>
            <Audio src={SCROLL_SFX_URL} volume={0.3} />
          </Sequence>,
        );
      });
  }

  // Zoom sounds — speed-zone remap
  if (actionTimingLog) {
    actionTimingLog
      .filter((e) => e.type === 'zoom' || e.type === 'zoomReset')
      .forEach((entry, i) => {
        const atFrame = remapSfxFrame(entry.timestampMs, timingSegments, fps, durationInFrames);
        if (atFrame === null) return;
        sfxElements.push(
          <Sequence key={`zoom-${i}`} from={atFrame}>
            <Audio src={ZOOM_SFX_URL} volume={0.4} />
          </Sequence>,
        );
      });
  }

  // Ambient loop
  if (sfxConfig.ambientUrl) {
    sfxElements.push(
      <Audio key="ambient" src={sfxConfig.ambientUrl} volume={sfxConfig.ambientVolume ?? 0.15} loop />,
    );
  }

  // Custom cues
  if (sfxConfig.cues) {
    sfxConfig.cues.forEach((cue, i) => {
      const atFrame = Math.round(cue.atSeconds * fps);
      sfxElements.push(
        <Sequence key={`cue-${i}`} from={atFrame}>
          <Audio src={cue.sfxUrl} volume={cue.volume ?? 0.6} />
        </Sequence>,
      );
    });
  }

  if (sfxElements.length === 0) return null;
  return <>{sfxElements}</>;
};

// ---------------------------------------------------------------------------
// Provider banner — adapted from ProviderBadge spring+shimmer pattern
// ---------------------------------------------------------------------------

const PROVIDER_META: Record<string, { name: string; color: string }> = {
  elevenlabs: { name: 'ElevenLabs', color: '#818CF8' },
  openai: { name: 'OpenAI', color: '#10A37F' },
  cartesia: { name: 'Cartesia', color: '#A78BFA' },
  hume: { name: 'Hume AI', color: '#FBBF24' },
  fal: { name: 'Fal', color: '#F87171' },
  replicate: { name: 'Replicate', color: '#60A5FA' },
  minimax: { name: 'MiniMax', color: '#F472B6' },
};

const ProviderBanner: React.FC<{
  config: ProviderBannerConfig;
  fps: number;
  durationInFrames: number;
}> = ({ config, fps, durationInFrames }) => {
  const frame = useCurrentFrame();
  const showFrame = Math.round((config.showAtSeconds ?? 0) * fps);
  const hideFrame = config.hideAtSeconds != null ? Math.round(config.hideAtSeconds * fps) : durationInFrames;

  // Only visible in the show window
  if (frame < showFrame || frame > hideFrame) return null;

  const meta = PROVIDER_META[config.provider] ?? { name: config.provider, color: '#9CA3AF' };
  const localFrame = frame - showFrame;

  const entranceProgress = spring({
    frame: localFrame,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.8 },
  });

  const slideY = interpolate(entranceProgress, [0, 1], [16, 0]);
  const opacity = interpolate(entranceProgress, [0, 1], [0, 1]);

  // Exit fade
  const exitOpacity = interpolate(
    frame,
    [hideFrame - fps * 0.5, hideFrame],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const pos = positionStyle(config.position ?? 'bottom-right');

  return (
    <div
      style={{
        position: 'absolute',
        ...pos,
        display: 'flex',
        alignItems: 'stretch',
        opacity: opacity * exitOpacity,
        transform: `translateY(${slideY}px)`,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: `0 4px 24px rgba(0, 0, 0, 0.35), 0 0 20px ${meta.color}1F`,
        border: '1px solid rgba(255, 255, 255, 0.06)',
      }}
    >
      {/* Accent bar */}
      <div
        style={{
          width: 3,
          minHeight: '100%',
          backgroundColor: meta.color,
          boxShadow: `0 0 8px ${meta.color}60`,
          flexShrink: 0,
        }}
      />
      <div
        style={{
          backgroundColor: 'rgba(12, 12, 16, 0.82)',
          padding: '10px 18px 10px 14px',
        }}
      >
        <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 15, fontWeight: 600, color: '#FFFFFF', letterSpacing: 0.3 }}>
          {meta.name}
        </div>
      </div>
    </div>
  );
};

function positionStyle(position: string): React.CSSProperties {
  switch (position) {
    case 'bottom-left': return { bottom: 64, left: 24 };
    case 'bottom-right': return { bottom: 64, right: 24 };
    case 'top-left': return { top: 24, left: 24 };
    case 'top-right': return { top: 24, right: 24 };
    default: return { bottom: 64, right: 24 };
  }
}

// ---------------------------------------------------------------------------
// Text overlay — React div with fade-in/out
// ---------------------------------------------------------------------------

const TextOverlay: React.FC<{ config: TextOverlayConfig; fps: number }> = ({ config, fps }) => {
  const frame = useCurrentFrame();
  const showFrame = Math.round(config.showAtSeconds * fps);
  const hideFrame = Math.round(config.hideAtSeconds * fps);

  const FADE_FRAMES = 10;

  const opacity = interpolate(
    frame,
    [showFrame, showFrame + FADE_FRAMES, hideFrame - FADE_FRAMES, hideFrame],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  if (opacity === 0) return null;

  const fontSize = config.fontSize ?? 24;
  const bgColor = config.backgroundColor ?? 'rgba(0, 0, 0, 0.7)';
  const textColor = config.textColor ?? 'white';

  return (
    <div
      style={{
        position: 'absolute',
        opacity,
        ...overlayPositionStyle(config.position),
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize,
          fontWeight: 600,
          color: textColor,
          backgroundColor: bgColor,
          padding: '8px 16px',
          borderRadius: 8,
        }}
      >
        {config.text}
      </div>
    </div>
  );
};

function overlayPositionStyle(position: string): React.CSSProperties {
  switch (position) {
    case 'center':
      return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    case 'bottom-center':
      return { bottom: '8%', left: 0, right: 0, textAlign: 'center' };
    case 'top-center':
      return { top: '5%', left: 0, right: 0, textAlign: 'center' };
    case 'bottom-left':
      return { bottom: 20, left: 20 };
    case 'bottom-right':
      return { bottom: 20, right: 20 };
    default:
      return { bottom: '8%', left: 0, right: 0, textAlign: 'center' };
  }
}

// ---------------------------------------------------------------------------
// Avatar PiP — extends existing AvatarPip pattern with timed show/hide
// ---------------------------------------------------------------------------

const LaunchAvatarPip: React.FC<{
  config: LaunchAvatarConfig;
  fps: number;
  durationInFrames: number;
}> = ({ config, fps, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { width: videoWidth, height: videoHeight } = useVideoConfig();

  const showFrame = Math.round((config.showAtSeconds ?? 0) * fps);
  const hideFrame = config.hideAtSeconds != null ? Math.round(config.hideAtSeconds * fps) : durationInFrames;

  if (frame < showFrame || frame > hideFrame) return null;

  const left = (config.posX ?? 0.72) * videoWidth;
  const top = (config.posY ?? 0.05) * videoHeight;
  const w = (config.width ?? 0.25) * videoWidth;
  const h = (config.height ?? 0.35) * videoHeight;

  const hasMask = config.maskShape && config.maskShape !== 'none';
  const borderRadius = config.maskShape === 'circle' ? '50%'
    : config.maskShape === 'rounded' ? 16 : 8;

  // Entrance fade
  const FADE = 10;
  const entranceOpacity = interpolate(
    frame,
    [showFrame, showFrame + FADE],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const exitOpacity = interpolate(
    frame,
    [hideFrame - FADE, hideFrame],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

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
        opacity: entranceOpacity * exitOpacity,
        ...(hasMask && {
          border: '2px solid rgba(255,255,255,0.3)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }),
      }}
    >
      <AvatarEntrance enterAt={showFrame}>
        <OffthreadVideo
          src={config.videoUrl!}
          style={{ width: '100%', height: '100%', objectFit: hasMask ? 'cover' : 'contain' }}
          transparent={!hasMask}
          muted
        />
      </AvatarEntrance>
    </div>
  );
};
