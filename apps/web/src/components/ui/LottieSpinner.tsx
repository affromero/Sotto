'use client';

import { LottieAnimation } from './LottieAnimation';
import sottoLoader from '../../../public/lottie/sotto-loader.json';

interface LottieSpinnerProps {
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

const SIZE_MAP = { small: 24, medium: 40, large: 64 } as const;

export function LottieSpinner({ size = 'medium', className }: LottieSpinnerProps) {
  const px = SIZE_MAP[size];

  return (
    <span
      role="status"
      aria-label="Loading"
      className={className}
      style={{ display: 'inline-block', width: px, height: px }}
    >
      <LottieAnimation animationData={sottoLoader} ariaHidden />
    </span>
  );
}
