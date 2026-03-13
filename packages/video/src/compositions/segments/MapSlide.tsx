import React, { useState } from 'react';
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment } from '../../types';

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
  } | undefined;

  const place = metadata?.places?.[0];
  const placeName = place?.name ?? '';
  const subtitle = place?.historicalContext?.[0]?.periodName ?? place?.modernRegion ?? '';
  const isHighConfidence = (place?.confidence ?? 1) >= 0.7;

  const historicalMap = metadata?.historicalMaps?.[0];
  const hasHistorical = !!historicalMap && !historicalImgError;

  // Crossfade timeline (as frame counts)
  const crossfadeStart = Math.floor(durationInFrames * 0.4);
  const crossfadeEnd = Math.floor(durationInFrames * 0.6);

  // Ken Burns: slow zoom in over the duration
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.08], {
    extrapolateRight: 'clamp',
  });

  // Historical map: separate Ken Burns starting from crossfade midpoint
  const historicalScale = interpolate(
    frame,
    [crossfadeStart, durationInFrames],
    [1, 1.08],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Fade in
  const opacity = interpolate(frame, [0, Math.min(fps * 0.5, durationInFrames)], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Crossfade: modern fades out, historical fades in during 40-60% of duration
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

  // Annotation: show place name for modern portion, switch to historical map title/date after crossfade
  const isHistoricalPhase = hasHistorical && frame >= crossfadeEnd;
  const annotationTitle = isHistoricalPhase ? historicalMap!.title : placeName;
  const annotationSubtitle = isHistoricalPhase
    ? historicalMap!.date
    : subtitle;

  // Annotation fade-in (delayed)
  const annotationOpacity = interpolate(
    frame,
    [Math.min(fps * 0.8, durationInFrames * 0.3), Math.min(fps * 1.3, durationInFrames * 0.5)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#1a1a2e' }}>
      {/* Modern map layer */}
      {segment.assetUrl && (
        <AbsoluteFill style={{ opacity: opacity * modernOpacity, transform: `scale(${scale})` }}>
          <Img src={segment.assetUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </AbsoluteFill>
      )}

      {/* Historical map layer (crossfaded on top) */}
      {hasHistorical && (
        <AbsoluteFill style={{ opacity: opacity * historicalOpacity, transform: `scale(${historicalScale})` }}>
          <Img
            src={historicalMap!.thumbnailUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setHistoricalImgError(true)}
          />
        </AbsoluteFill>
      )}

      {/* Annotation label */}
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
