import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, prefetch } from 'remotion';
import type { VisualsInput, VideoSegment } from '../types';
import { resolveSegmentComponent } from './segments';
import { SottoWatermark } from './shared/SottoWatermark';
import { AttributionOverlay } from './shared/AttributionOverlay';
import { SpeakerLabel } from './shared/SpeakerLabel';
import { Background } from './shared/Background';
import { TransitionOverlay } from './shared/TransitionOverlay';
import { ProviderBadge } from './shared/ProviderBadge';
const LightLeakOverlay = React.lazy(() => import('./shared/LightLeakOverlay').then(m => ({ default: m.LightLeakOverlay })));

const TRANSITION_FRAMES = 30;

const SegmentWithFade: React.FC<{
  children: React.ReactNode;
  durationInFrames: number;
}> = ({ children, durationInFrames }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(
    frame,
    [0, TRANSITION_FRAMES, durationInFrames - TRANSITION_FRAMES, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill style={{ opacity }}>
      {children}
    </AbsoluteFill>
  );
};

const LIGHT_LEAK_FRAMES = 45;

export const PodcastVisuals: React.FC<VisualsInput> = ({
  segments,
  branding,
  transitions,
  enableLightLeaks = true,
}) => {
  const { fps } = useVideoConfig();

  // Prefetch all image/video assets — including sub-visual and transition assets
  React.useEffect(() => {
    const cleanups: (() => void)[] = [];
    const tryPrefetch = (url: string) => {
      try {
        const { free, waitUntilDone } = prefetch(url, { method: 'blob-url' });
        waitUntilDone().catch(() => {});
        cleanups.push(free);
      } catch {
        // Asset may be missing or CORS-blocked — non-fatal, skip prefetch
      }
    };
    for (const segment of segments) {
      if (segment.assetUrl) tryPrefetch(segment.assetUrl);
      if (segment.subVisuals) {
        for (const sv of segment.subVisuals) {
          if (sv.assetUrl) tryPrefetch(sv.assetUrl);
        }
      }
    }
    if (transitions) {
      for (const t of transitions) {
        if (t.assetUrl) tryPrefetch(t.assetUrl);
      }
    }
    return () => cleanups.forEach((fn) => fn());
  }, [segments, transitions]);

  // Build a lookup from toSegmentOrder → segment startTime for transition positioning
  const segmentStartMap = new Map(segments.map((s) => [s.order, s.startTime]));

  return (
    <AbsoluteFill>
      <Background backgroundColor={branding.backgroundColor}>
        {segments.map((segment) => {
          const fromFrame = Math.round(segment.startTime * fps);
          const durationFrames = Math.round(segment.duration * fps);

          // Multi-visual: render nested sequences within the segment window
          if (segment.subVisuals && segment.subVisuals.length > 1) {
            return (
              <Sequence
                key={segment.segmentId}
                from={fromFrame}
                durationInFrames={durationFrames}
              >
                {segment.subVisuals.map((sv) => {
                  const subFromFrame = Math.round(sv.startOffset * fps);
                  const subDurationFrames = Math.round(sv.duration * fps);
                  const SubComponent = resolveSegmentComponent(sv.visualType, sv.assetUrl, sv.assetType);

                  // Build a synthetic VideoSegment for the sub-visual component
                  const subSegment: VideoSegment = {
                    ...segment,
                    visualType: sv.visualType,
                    prompt: sv.prompt,
                    metadata: sv.metadata,
                    assetUrl: sv.assetUrl,
                    assetType: sv.assetType,
                  };

                  return (
                    <Sequence
                      key={`${segment.segmentId}-${sv.subOrder}`}
                      from={subFromFrame}
                      durationInFrames={subDurationFrames}
                    >
                      <SegmentWithFade durationInFrames={subDurationFrames}>
                        <SubComponent segment={subSegment} />
                        {typeof sv.metadata?.photographer === 'string' && (
                          <AttributionOverlay
                            photographer={sv.metadata.photographer}
                            source="Pexels"
                          />
                        )}
                      </SegmentWithFade>
                    </Sequence>
                  );
                })}
                <SpeakerLabel speaker={segment.speaker} branding={branding} />
              </Sequence>
            );
          }

          // Single visual (backward compat) — existing code path
          const SegmentComponent = resolveSegmentComponent(segment.visualType, segment.assetUrl, segment.assetType);

          return (
            <Sequence
              key={segment.segmentId}
              from={fromFrame}
              durationInFrames={durationFrames}
            >
              <SegmentWithFade durationInFrames={durationFrames}>
                <SegmentComponent segment={segment} />
                <SpeakerLabel speaker={segment.speaker} branding={branding} />
                {typeof segment.metadata?.photographer === 'string' && (
                  <AttributionOverlay
                    photographer={segment.metadata.photographer}
                    source="Pexels"
                  />
                )}
              </SegmentWithFade>
            </Sequence>
          );
        })}

        {transitions?.map((t) => {
          const boundaryTime = segmentStartMap.get(t.toSegmentOrder);
          if (boundaryTime === undefined) return null;
          const transitionDurationFrames = Math.round(t.durationSeconds * fps);
          const halfDuration = Math.round(transitionDurationFrames / 2);
          const centerFrame = Math.round(boundaryTime * fps);
          const fromFrame = Math.max(0, centerFrame - halfDuration);

          return (
            <Sequence
              key={`transition-${t.fromSegmentOrder}-${t.toSegmentOrder}`}
              from={fromFrame}
              durationInFrames={transitionDurationFrames}
            >
              <TransitionOverlay
                src={t.assetUrl}
                durationInFrames={transitionDurationFrames}
              />
            </Sequence>
          );
        })}

        {enableLightLeaks && segments.length > 1 && (() => {
          const coveredBoundaries = new Set(
            transitions?.map((t) => `${t.fromSegmentOrder}-${t.toSegmentOrder}`) ?? [],
          );
          const halfLeak = Math.round(LIGHT_LEAK_FRAMES / 2);

          return segments.slice(1).map((segment, i) => {
            const prevSegment = segments[i];
            const key = `${prevSegment.order}-${segment.order}`;
            if (coveredBoundaries.has(key)) return null;

            const centerFrame = Math.round(segment.startTime * fps);
            const fromFrame = Math.max(0, centerFrame - halfLeak);
            const seed = prevSegment.order * 7 + segment.order;

            return (
              <Sequence
                key={`light-leak-${key}`}
                from={fromFrame}
                durationInFrames={LIGHT_LEAK_FRAMES}
              >
                <LightLeakOverlay
                  durationInFrames={LIGHT_LEAK_FRAMES}
                  seed={seed}
                  hueShift={15}
                />
              </Sequence>
            );
          });
        })()}

        <SottoWatermark />
        <ProviderBadge segments={segments} />
      </Background>
    </AbsoluteFill>
  );
};
