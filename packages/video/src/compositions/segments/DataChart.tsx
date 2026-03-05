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
} from 'recharts';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { VideoSegment } from '../../types';

const CHART_COLORS = ['#D97706', '#1E3A5F', '#6B7280', '#059669', '#DC2626', '#7C3AED'];

export const DataChart: React.FC<{ segment: VideoSegment }> = ({ segment }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { metadata } = segment;

  const chartType = (metadata?.chartType as string) ?? 'bar';
  const data = (metadata?.data as Array<Record<string, unknown>>) ?? [];
  const title = (metadata?.title as string) ?? '';

  const animateIn = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const titleOpacity = interpolate(frame, [0, fps * 0.3], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const renderChart = () => {
    const dataKeys = data.length > 0 ? Object.keys(data[0]).filter((k) => k !== 'name') : [];

    switch (chartType) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" stroke="#6B7280" />
              <YAxis stroke="#6B7280" />
              {dataKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={3}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey={dataKeys[0] ?? 'value'}
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={150}
                label
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        );

      default:
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" stroke="#6B7280" />
              <YAxis stroke="#6B7280" />
              {dataKeys.map((key, i) => (
                <Bar key={key} dataKey={key} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
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
      <div
        style={{
          width: '100%',
          flex: 1,
          opacity: animateIn,
          transform: `scale(${interpolate(animateIn, [0, 1], [0.9, 1])})`,
        }}
      >
        {renderChart()}
      </div>
    </div>
  );
};
