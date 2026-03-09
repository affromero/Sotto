'use client';

import { useSyncExternalStore } from 'react';
import Lottie from 'lottie-react';

interface LottieAnimationProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  animationData: Record<string, any>;
  loop?: boolean;
  autoplay?: boolean;
  className?: string;
  ariaLabel?: string;
  ariaHidden?: boolean;
}

function subscribeReducedMotion(callback: () => void) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function getReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getReducedMotionServer() {
  return false;
}

export function LottieAnimation({
  animationData,
  loop = true,
  autoplay = true,
  className,
  ariaLabel,
  ariaHidden = true,
}: LottieAnimationProps) {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    getReducedMotionServer
  );

  return (
    <Lottie
      animationData={animationData}
      loop={reducedMotion ? false : loop}
      autoplay={reducedMotion ? false : autoplay}
      className={className}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      initialSegment={reducedMotion ? [0, 1] : undefined}
    />
  );
}
