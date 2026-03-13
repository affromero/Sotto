import React, { useState } from 'react';
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment, MapZoomFrame } from '../../types';

interface AntiqueMapResult {
  title: string;
  date: string;
  thumbnailUrl: string;
  viewUrl: string;
}

interface MapSlideProps {
  segment: VideoSegment;
}

export const MapSlide: React.FC<MapSlideProps> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const [historicalImgError, setHistoricalImgError] = useState(false);

  const metadata = segment.metadata as {
    places?: Array<{
      name: string;
      modernRegion?: string;
      confidence?: number;
      historicalContext?: Array<{ periodName: string }>;
    }>;
    preset?: string;
    historicalMaps?: AntiqueMapResult[];
    zoomFrames?: MapZoomFrame[];
  } | undefined;

  const place = metadata?.places?.[0];
  const placeName = place?.name ?? '';
  const subtitle = place?.historicalContext?.[0]?.periodName ?? place?.modernRegion ?? '';
  const isHighConfidence = (place?.confidence ?? 1) >= 0.7;

  // Apply CSS filter for vintage/parchment presets (sepia tones on the base map tile)
  const presetFilter = metadata?.preset === 'vintage'
    ? 'sepia(0.5) saturate(0.8) contrast(0.9)'
    : metadata?.preset === 'parchment'
      ? 'sepia(0.6) saturate(0.7)'
      : undefined;

  const zoomFrames = metadata?.zoomFrames;

  // ── Globe-to-location zoom animation (when zoomFrames present) ──
  if (zoomFrames && zoomFrames.length > 0) {
    const n = zoomFrames.length;
    const framesPerLevel = durationInFrames / n;
    // 20% overlap between consecutive levels for smooth crossfade
    const overlapFrames = Math.floor(framesPerLevel * 0.2);

    // Annotation fades in during the last 30% of the clip
    const annotationOpacity = interpolate(
      frame,
      [durationInFrames * 0.7, durationInFrames * 0.85],
      [0, 1],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );

    return (
      <AbsoluteFill style={{ backgroundColor: '#0a1628' }}>
        {zoomFrames.map((zf, i) => {
          const levelStart = i * framesPerLevel;
          const levelEnd = (i + 1) * framesPerLevel;

          // Fade in: first frame starts visible, others crossfade from previous
          const fadeIn = i === 0
            ? interpolate(frame, [0, Math.min(fps * 0.3, framesPerLevel * 0.15)], [0, 1], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
              })
            : interpolate(frame, [levelStart - overlapFrames, levelStart + overlapFrames], [0, 1], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
              });

          // Fade out: all except last frame fade out for the next
          const fadeOut = i < n - 1
            ? interpolate(frame, [levelEnd - overlapFrames, levelEnd + overlapFrames], [1, 0], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
              })
            : 1;

          // Scale: zoom in within each level for smooth motion
          const scale = interpolate(
            frame,
            [levelStart, levelEnd],
            [1.0, 1.3],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );

          const opacity = fadeIn * fadeOut;

          // Only apply sepia filter to the higher-zoom frames (zoom >= 5 use preset style)
          const filter = zf.zoom >= 5 ? presetFilter : undefined;

          return (
            <AbsoluteFill key={zf.zoom} style={{ opacity, transform: `scale(${scale})` }}>
              <Img src={zf.assetUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', filter }} />
            </AbsoluteFill>
          );
        })}

        {/* Annotation label — fades in during final zoom */}
        {placeName && (
          <div
            style={{
              position: 'absolute',
              bottom: 40,
              left: 40,
              opacity: annotationOpacity,
              background: 'rgba(0,0,0,0.7)',
              color: '#fefcf8',
              padding: '10px 20px',
              borderRadius: 8,
              borderLeft: `4px ${isHighConfidence ? 'solid' : 'dashed'} #D97706`,
            }}
          >
            <div style={{ fontFamily: 'DM Serif Display, serif', fontSize: 28 }}>
              {placeName}
            </div>
            {subtitle && (
              <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 16, color: '#9CA3AF', marginTop: 4 }}>
                {subtitle}
              </div>
            )}
          </div>
        )}
      </AbsoluteFill>
    );
  }

  // ── Fallback: single-image Ken Burns (no zoomFrames) ──
  const historicalMap = metadata?.historicalMaps?.[0];
  const hasHistorical = !!historicalMap && !historicalImgError;

  const crossfadeStart = Math.floor(durationInFrames * 0.4);
  const crossfadeEnd = Math.floor(durationInFrames * 0.6);

  const scale = interpolate(frame, [0, durationInFrames], [1, 1.08], {
    extrapolateRight: 'clamp',
  });

  const historicalScale = interpolate(
    frame,
    [crossfadeStart, durationInFrames],
    [1, 1.08],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const opacity = interpolate(frame, [0, Math.min(fps * 0.5, durationInFrames)], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const modernOpacity = hasHistorical
    ? interpolate(frame, [crossfadeStart, crossfadeEnd], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;

  const historicalOpacity = hasHistorical
    ? interpolate(frame, [crossfadeStart, crossfadeEnd], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 0;

  const isHistoricalPhase = hasHistorical && frame >= crossfadeEnd;
  const annotationTitle = isHistoricalPhase ? historicalMap!.title : placeName;
  const annotationSubtitle = isHistoricalPhase
    ? historicalMap!.date
    : subtitle;

  const annotationOpacity = interpolate(
    frame,
    [Math.min(fps * 0.8, durationInFrames * 0.3), Math.min(fps * 1.3, durationInFrames * 0.5)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#1a1a2e' }}>
      {segment.assetUrl && (
        <AbsoluteFill style={{ opacity: opacity * modernOpacity, transform: `scale(${scale})` }}>
          <Img src={segment.assetUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: presetFilter }} />
        </AbsoluteFill>
      )}

      {hasHistorical && (
        <AbsoluteFill style={{ opacity: opacity * historicalOpacity, transform: `scale(${historicalScale})` }}>
          <Img
            src={historicalMap!.thumbnailUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setHistoricalImgError(true)}
          />
        </AbsoluteFill>
      )}

      {annotationTitle && (
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            left: 40,
            opacity: annotationOpacity,
            background: 'rgba(0,0,0,0.7)',
            color: '#fefcf8',
            padding: '10px 20px',
            borderRadius: 8,
            borderLeft: `4px ${isHighConfidence ? 'solid' : 'dashed'} #D97706`,
          }}
        >
          <div style={{ fontFamily: 'DM Serif Display, serif', fontSize: 28 }}>
            {annotationTitle}
          </div>
          {annotationSubtitle && (
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 16, color: '#9CA3AF', marginTop: 4 }}>
              {annotationSubtitle}
            </div>
          )}
        </div>
      )}
    </AbsoluteFill>
  );
};
