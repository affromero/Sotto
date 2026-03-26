'use client';

import { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';

const CommandPalette = dynamic(
  () => import('./CommandPalette').then((m) => ({ default: m.CommandPalette })),
  { ssr: false }
);

export function CommandPaletteLoader() {
  const [activated, setActivated] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setActivated(true);
    }
  }, []);

  useEffect(() => {
    if (activated) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activated, handleKeyDown]);

  if (!activated) return null;

  return <CommandPalette />;
}
