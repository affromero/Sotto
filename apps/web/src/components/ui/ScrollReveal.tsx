'use client';

import { type ReactNode } from 'react';
import { useScrollReveal } from '@/lib/hooks/useScrollReveal';

interface ScrollRevealProps {
  children: ReactNode;
  as?: 'div' | 'section' | 'article' | 'main';
  className?: string;
  threshold?: number;
  rootMargin?: string;
}

export function ScrollReveal({
  children,
  as: Tag = 'div',
  className,
  threshold,
  rootMargin,
}: ScrollRevealProps) {
  const ref = useScrollReveal({ threshold, rootMargin });

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
