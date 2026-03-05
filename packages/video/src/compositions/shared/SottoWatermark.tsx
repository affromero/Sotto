import React from 'react';

export const SottoWatermark: React.FC = () => {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        right: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 14px',
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
        borderRadius: 20,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.08)',
      }}
    >
      <div
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          backgroundColor: '#D97706',
        }}
      />
      <span
        style={{
          fontFamily: 'DM Serif Display, serif',
          fontSize: 14,
          color: '#1A1A1A',
          letterSpacing: 0.5,
        }}
      >
        sotto.fm
      </span>
    </div>
  );
};
