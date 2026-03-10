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
  SubtitleConfig,
  LaunchAvatarConfig,
} from '../types';

// ---------------------------------------------------------------------------
// SFX base URL — served statically from the Remotion sidecar
// ---------------------------------------------------------------------------
const SFX_BASE = typeof process !== 'undefined' && process.env.REMOTION_SERVE_URL
  ? `${process.env.REMOTION_SERVE_URL}/assets/sfx`
  : '/assets/sfx';

const CLICK_SFX_URL = `${SFX_BASE}/click.mp3`;
const KEYSTROKE_SFX_URL = `${SFX_BASE}/keystroke.mp3`;

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

      {/* Subtitles */}
      {scene.subtitles?.enabled && scene.narration && (
        <SubtitleTrack
          config={scene.subtitles}
          narration={scene.narration}
          durationInFrames={durationInFrames}
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
// SFX layer: click sounds, keystroke sounds, ambient, custom cues
// ---------------------------------------------------------------------------

const SfxLayer: React.FC<{ scene: LaunchSceneInput; fps: number }> = ({ scene, fps }) => {
  const { sfxConfig, actionTimingLog } = scene;
  if (!sfxConfig) return null;

  const sfxElements: React.ReactElement[] = [];

  // Click sounds from action timing log
  if (sfxConfig.clickSounds !== false && actionTimingLog) {
    actionTimingLog
      .filter((e) => e.type === 'click')
      .forEach((entry, i) => {
        const atFrame = Math.round((entry.timestampMs / 1000) * fps);
        sfxElements.push(
          <Sequence key={`click-${i}`} from={atFrame}>
            <Audio src={CLICK_SFX_URL} volume={0.6} />
          </Sequence>,
        );
      });
  }

  // Keystroke sounds from action timing log
  if (sfxConfig.typingSounds !== false && actionTimingLog) {
    actionTimingLog
      .filter((e) => e.type === 'type')
      .forEach((entry, ti) => {
        const charCount = Math.min((entry.meta?.charCount as number) ?? 10, 50);
        const totalMs = (entry.meta?.estimatedDurationMs as number) ?? charCount * 45;
        const avgDelayMs = totalMs / charCount;
        for (let c = 0; c < charCount; c++) {
          const atFrame = Math.round(((entry.timestampMs + c * avgDelayMs) / 1000) * fps);
          sfxElements.push(
            <Sequence key={`key-${ti}-${c}`} from={atFrame}>
              <Audio src={KEYSTROKE_SFX_URL} volume={0.4} />
            </Sequence>,
          );
        }
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
  kittentts: { name: 'KittenTTS', color: '#2DD4BF' },
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
// Subtitle track — narration split into ~8-word chunks
// ---------------------------------------------------------------------------

const SubtitleTrack: React.FC<{
  config: SubtitleConfig;
  narration: string;
  durationInFrames: number;
}> = ({ config, narration, durationInFrames }) => {
  const frame = useCurrentFrame();

  const words = narration.split(/\s+/);
  const chunkSize = 8;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
  }

  const framesPerChunk = Math.ceil(durationInFrames / chunks.length);
  const isCinematic = config.style === 'cinematic';
  const isTop = config.position === 'top';
  const fontSize = config.fontSize ?? 32;

  const currentChunkIndex = Math.min(Math.floor(frame / framesPerChunk), chunks.length - 1);

  const FADE_FRAMES = 8;
  const chunkStartFrame = currentChunkIndex * framesPerChunk;
  const chunkEndFrame = chunkStartFrame + framesPerChunk;

  const opacity = interpolate(
    frame,
    [chunkStartFrame, chunkStartFrame + FADE_FRAMES, chunkEndFrame - FADE_FRAMES, chunkEndFrame],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        ...(isTop ? { top: '5%' } : { bottom: '8%' }),
        display: 'flex',
        justifyContent: 'center',
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: 'Inter, sans-serif',
          fontSize,
          fontWeight: isCinematic ? 700 : 400,
          color: 'white',
          textAlign: 'center',
          maxWidth: '80%',
          ...(isCinematic
            ? { backgroundColor: 'rgba(0, 0, 0, 0.6)', padding: '10px 20px', borderRadius: 8 }
            : { textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8)' }),
        }}
      >
        {chunks[currentChunkIndex]}
      </div>
    </div>
  );
};

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
      <OffthreadVideo
        src={config.videoUrl!}
        style={{ width: '100%', height: '100%', objectFit: hasMask ? 'cover' : 'contain' }}
        transparent={!hasMask}
        muted
      />
    </div>
  );
};
