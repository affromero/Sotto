import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment, DataTableMetadata, DataTableHighlightCell, DataTableCellTone } from '../../types';

const COLORS = {
  amber: '#D97706',
  navy: '#1E3A5F',
  cream: '#FEFCF8',
  text: '#1A1A1A',
  muted: '#6B7280',
  surface: '#FFFFFF',
  border: '#E5E7EB',
  positive: '#059669',
  negative: '#DC2626',
};

function toneToColor(tone: DataTableCellTone | undefined): string {
  switch (tone) {
    case 'amber':
      return COLORS.amber;
    case 'navy':
      return COLORS.navy;
    case 'positive':
      return COLORS.positive;
    case 'negative':
      return COLORS.negative;
    case 'muted':
      return COLORS.muted;
    default:
      return COLORS.text;
  }
}

function findHighlight(
  highlights: DataTableHighlightCell[] | undefined,
  rowKey: string,
  colKey: string,
): DataTableHighlightCell | undefined {
  if (!highlights) return undefined;
  return highlights.find((h) => h.rowKey === rowKey && h.columnKey === colKey);
}

export const DataTable: React.FC<{ segment: VideoSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const meta = (segment.metadata ?? {}) as DataTableMetadata;

  const columns = meta.columns ?? [];
  const rows = meta.rows ?? [];
  const headers = meta.headers;
  const styleHints = meta.styleHints;
  const highlights = meta.highlightCells;
  const sortIndicators = meta.sortIndicators;

  const maxRows = styleHints?.maxVisibleRows ?? 8;
  const visibleRows = rows.slice(0, maxRows);
  const scale = Math.min(width / 1920, height / 1080);
  const isCompact = styleHints?.density === 'compact';

  // --- Animation timing ---
  const titleInEnd = fps * 0.35;
  const headerInStart = fps * 0.18;
  const headerInEnd = fps * 0.55;
  const rowIntroStart = fps * 0.55;
  const availableRowFrames = Math.max(fps * 1.2, durationInFrames - rowIntroStart - fps * 0.5);
  const rowStep = Math.min(fps * 0.18, availableRowFrames / Math.max(visibleRows.length, 1));
  const rowDuration = Math.min(fps * 0.22, rowStep * 0.9);

  // Title animation
  const titleOpacity = interpolate(frame, [0, titleInEnd], [0, 1], { extrapolateRight: 'clamp' });
  const titleY = interpolate(frame, [0, titleInEnd], [24 * scale, 0], { extrapolateRight: 'clamp' });

  // Header animation
  const headerOpacity = interpolate(frame, [headerInStart, headerInEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const headerY = interpolate(frame, [headerInStart, headerInEnd], [16 * scale, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Sort indicator for a column
  const getSortArrow = (colKey: string): string | null => {
    const si = sortIndicators?.find((s) => s.columnKey === colKey);
    if (!si) return null;
    return si.direction === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  // Row animation helper
  const rowAnim = (rowIndex: number) => {
    const start = rowIntroStart + rowIndex * rowStep;
    const end = start + rowDuration;
    const opacity = interpolate(frame, [start, end], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const y = interpolate(frame, [start, end], [14 * scale, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return { opacity, y };
  };

  // Highlight pulse animation
  const highlightPulse = (rowIndex: number, hl: DataTableHighlightCell) => {
    if (!hl.pulse) return { scale: 1, bgAlpha: 0.12 };
    const rowVisibleAt = rowIntroStart + rowIndex * rowStep + rowDuration;
    const pulseStart = rowVisibleAt + fps * 0.1;
    const pulseMid = pulseStart + fps * 0.2;
    const pulseEnd = pulseMid + fps * 0.2;
    const s = interpolate(frame, [pulseStart, pulseMid, pulseEnd], [1, 1.04, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const a = interpolate(frame, [pulseStart, pulseMid, pulseEnd], [0.12, 0.24, 0.12], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    return { scale: s, bgAlpha: a };
  };

  const pad = 72 * scale;
  const titleSize = 52 * scale;
  const subtitleSize = 22 * scale;
  const headerFontSize = (isCompact ? 20 : 24) * scale;
  const bodyFontSize = (isCompact ? 18 : 22) * scale;
  const cellPadV = (isCompact ? 10 : 16) * scale;
  const cellPadH = 18 * scale;
  const cardWidth = width * 0.88;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: pad,
        backgroundColor: COLORS.cream,
      }}
    >
      {/* Title block */}
      {headers?.title && (
        <div
          style={{
            opacity: titleOpacity,
            transform: `translateY(${titleY}px)`,
            textAlign: 'center',
            marginBottom: 16 * scale,
          }}
        >
          <h2
            style={{
              fontFamily: 'DM Serif Display, serif',
              fontSize: titleSize,
              color: COLORS.text,
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {headers.title}
          </h2>
          {headers.subtitle && (
            <p
              style={{
                fontFamily: 'Inter, sans-serif',
                fontSize: subtitleSize,
                color: COLORS.muted,
                margin: `${8 * scale}px 0 0`,
              }}
            >
              {headers.subtitle}
            </p>
          )}
        </div>
      )}

      {/* Table card */}
      <div
        style={{
          width: cardWidth,
          maxHeight: height * 0.72,
          backgroundColor: COLORS.surface,
          borderRadius: 16 * scale,
          boxShadow: `0 ${4 * scale}px ${24 * scale}px rgba(0,0,0,0.08)`,
          overflow: 'hidden',
        }}
      >
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            tableLayout: 'fixed',
          }}
        >
          {/* Header */}
          <thead>
            <tr
              style={{
                opacity: headerOpacity,
                transform: `translateY(${headerY}px)`,
                backgroundColor: `${COLORS.cream}`,
              }}
            >
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: headerFontSize,
                    fontWeight: 700,
                    color: COLORS.navy,
                    textAlign: col.align ?? (col.isNumeric ? 'right' : 'left'),
                    padding: `${cellPadV}px ${cellPadH}px`,
                    borderBottom: `${2 * scale}px solid ${COLORS.border}`,
                    width: col.widthPercent ? `${col.widthPercent}%` : undefined,
                  }}
                >
                  {col.label}
                  {getSortArrow(col.key) && (
                    <span style={{ fontSize: headerFontSize * 0.7, marginLeft: 4 * scale }}>
                      {getSortArrow(col.key)}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {visibleRows.map((row, ri) => {
              const { opacity, y } = rowAnim(ri);
              const isZebra = styleHints?.zebraRows && ri % 2 === 1;
              return (
                <tr
                  key={row.key}
                  style={{
                    opacity,
                    transform: `translateY(${y}px)`,
                    backgroundColor: isZebra ? `${COLORS.cream}` : 'transparent',
                  }}
                >
                  {columns.map((col, ci) => {
                    const val = row.values[col.key] ?? '';
                    const cellTone = row.toneByColumnKey?.[col.key];
                    const hl = findHighlight(highlights, row.key, col.key);
                    const isFirst = ci === 0 && styleHints?.emphasizeFirstColumn;
                    const pulse = hl ? highlightPulse(ri, hl) : null;
                    const hlColor = hl?.tone ? toneToColor(hl.tone) : COLORS.amber;

                    return (
                      <td
                        key={col.key}
                        style={{
                          fontFamily: 'Inter, sans-serif',
                          fontSize: bodyFontSize,
                          fontWeight: row.isSummary || isFirst ? 700 : 400,
                          color: cellTone ? toneToColor(cellTone) : COLORS.text,
                          textAlign: col.align ?? (col.isNumeric ? 'right' : 'left'),
                          padding: `${cellPadV}px ${cellPadH}px`,
                          borderBottom: styleHints?.showGridLines
                            ? `${1 * scale}px solid ${COLORS.border}`
                            : 'none',
                        }}
                      >
                        {pulse ? (
                          <span
                            style={{
                              display: 'inline-block',
                              transform: `scale(${pulse.scale})`,
                              backgroundColor: `${hlColor}${Math.round(pulse.bgAlpha * 255)
                                .toString(16)
                                .padStart(2, '0')}`,
                              borderRadius: 6 * scale,
                              padding: `${2 * scale}px ${6 * scale}px`,
                            }}
                          >
                            {val}
                          </span>
                        ) : (
                          val
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Source label */}
      {headers?.sourceLabel && (
        <p
          style={{
            opacity: titleOpacity,
            fontFamily: 'Inter, sans-serif',
            fontSize: 18 * scale,
            color: COLORS.muted,
            marginTop: 12 * scale,
          }}
        >
          {headers.sourceLabel}
        </p>
      )}
    </div>
  );
};
