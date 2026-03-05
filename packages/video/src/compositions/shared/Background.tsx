import React from 'react';

interface BackgroundProps {
  backgroundColor?: string;
  children: React.ReactNode;
}

export const Background: React.FC<BackgroundProps> = ({
  backgroundColor = '#FEFCF8',
  children,
}) => {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: `linear-gradient(180deg, ${backgroundColor} 0%, #F5F0E8 100%)`,
        position: 'relative',
      }}
    >
      {children}
    </div>
  );
};
