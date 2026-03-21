import React from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  Label,
} from 'recharts';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment } from '../../types';

const CHART_COLORS = ['#D97706', '#1E3A5F', '#6B7280', '#059669', '#DC2626', '#7C3AED'];

const AXIS_LABEL_STYLE = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 15,
  fill: '#1A1A1A',
  fontWeight: 600,
};

const TICK_STYLE = { fontFamily: 'Inter, sans-serif', fontSize: 13 };

const renderPieLabel = (props: Record<string, unknown>) => {
  const { name, percent, x, y } = props as {
    name: string;
    percent: number;
    x: number;
    y: number;
  };
  return (
    <text
      x={x}
      y={y}
      fill="#1A1A1A"
      textAnchor="middle"
      dominantBaseline="central"
      fontFamily="Inter, sans-serif"
      fontSize={14}
      fontWeight={600}
    >
      {`${name} (${(percent * 100).toFixed(0)}%)`}
    </text>
  );
};

export const DataChart: React.FC<{ segment: VideoSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { metadata } = segment;

  const chartType = (metadata?.chartType as string) ?? 'bar';
  const rawData = (metadata?.data as Array<Record<string, unknown>>) ?? [];
  const title = (metadata?.title as string) ?? '';
  const xAxisLabel = (metadata?.xAxisLabel as string) ?? '';
  const yAxisLabel = (metadata?.yAxisLabel as string) ?? '';

  const dataKeys =
    rawData.length > 0 ? Object.keys(rawData[0]).filter((k) => k !== 'name') : [];

  // Title fades in first
  const titleOpacity = interpolate(frame, [0, fps * 0.3], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Chart axes/grid fade in after title
  const chartOpacity = interpolate(frame, [fps * 0.2, fps * 0.5], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Data animates over the middle portion of the segment
  const animStart = fps * 0.5;
  const animEnd = Math.max(animStart + fps, durationInFrames * 0.75);
  const dataProgress = interpolate(frame, [animStart, animEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Legend fades in after data animation completes
  const legendOpacity = interpolate(
    frame,
    [animEnd, Math.min(animEnd + fps * 0.3, durationInFrames)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Bar/default: scale numeric values from 0 → actual
  const animatedData = rawData.map((row) => {
    const animated: Record<string, unknown> = { name: row.name };
    for (const key of dataKeys) {
      animated[key] = (Number(row[key]) || 0) * dataProgress;
    }
    return animated;
  });

  // Line: progressively reveal data points
  const visiblePoints = Math.max(1, Math.ceil(rawData.length * dataProgress));
  const lineData = rawData.slice(0, visiblePoints);

  // Pie: sweep from 0° to 360°
  const pieEndAngle = 90 + 360 * dataProgress;

  const hasMultipleKeys = dataKeys.length > 1;

  // Fixed Y-axis — compute max from raw data, generate stable ticks so axis never moves
  const maxY = rawData.reduce((max, row) => {
    for (const key of dataKeys) {
      const v = Number(row[key]) || 0;
      if (v > max) max = v;
    }
    return max;
  }, 0);
  const niceMax = maxY > 0 ? Math.ceil(maxY * 1.1) : 10;
  const tickStep = Math.ceil(niceMax / 5);
  const yDomainMax = tickStep * 5;
  const yTicks = Array.from({ length: 6 }, (_, i) => i * tickStep);

  const renderChart = () => {
    switch (chartType) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lineData} margin={{ top: 10, right: 30, left: 20, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" stroke="#6B7280" tick={TICK_STYLE}>
                {xAxisLabel && (
                  <Label
                    value={xAxisLabel}
                    position="bottom"
                    offset={20}
                    style={{ ...AXIS_LABEL_STYLE, textAnchor: 'middle' }}
                  />
                )}
              </XAxis>
              <YAxis stroke="#6B7280" tick={TICK_STYLE} domain={[0, yDomainMax]} ticks={yTicks} allowDataOverflow>
                {yAxisLabel && (
                  <Label
                    value={yAxisLabel}
                    angle={-90}
                    position="insideLeft"
                    offset={-5}
                    style={{ ...AXIS_LABEL_STYLE, textAnchor: 'middle' }}
                  />
                )}
              </YAxis>
              {dataKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={3}
                  dot={{ r: 5, fill: CHART_COLORS[i % CHART_COLORS.length] }}
                  isAnimationActive={false}
                />
              ))}
              {hasMultipleKeys && (
                <Legend
                  wrapperStyle={{
                    opacity: legendOpacity,
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 14,
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        );

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={rawData}
                dataKey={dataKeys[0] ?? 'value'}
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={150}
                startAngle={90}
                endAngle={pieEndAngle}
                label={dataProgress >= 0.85 ? renderPieLabel : false}
                labelLine={dataProgress >= 0.85}
                isAnimationActive={false}
              >
                {rawData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Legend
                wrapperStyle={{
                  opacity: legendOpacity,
                  fontFamily: 'Inter, sans-serif',
                  fontSize: 14,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        );

      default:
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={animatedData}
              margin={{ top: 10, right: 30, left: 20, bottom: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" stroke="#6B7280" tick={TICK_STYLE}>
                {xAxisLabel && (
                  <Label
                    value={xAxisLabel}
                    position="bottom"
                    offset={20}
                    style={{ ...AXIS_LABEL_STYLE, textAnchor: 'middle' }}
                  />
                )}
              </XAxis>
              <YAxis stroke="#6B7280" tick={TICK_STYLE} domain={[0, yDomainMax]} ticks={yTicks} allowDataOverflow>
                {yAxisLabel && (
                  <Label
                    value={yAxisLabel}
                    angle={-90}
                    position="insideLeft"
                    offset={-5}
                    style={{ ...AXIS_LABEL_STYLE, textAnchor: 'middle' }}
                  />
                )}
              </YAxis>
              {dataKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  isAnimationActive={false}
                />
              ))}
              {hasMultipleKeys && (
                <Legend
                  wrapperStyle={{
                    opacity: legendOpacity,
                    fontFamily: 'Inter, sans-serif',
                    fontSize: 14,
                  }}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 60,
        backgroundColor: '#FEFCF8',
      }}
    >
      {title && (
        <h2
          style={{
            fontFamily: 'DM Serif Display, serif',
            fontSize: 36,
            color: '#1A1A1A',
            marginBottom: 30,
            opacity: titleOpacity,
          }}
        >
          {title}
        </h2>
      )}
      <div style={{ width: '100%', flex: 1, opacity: chartOpacity }}>
        {renderChart()}
      </div>
    </div>
  );
};
